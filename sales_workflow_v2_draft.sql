-- BUILDTRACK SALES V2 — DESIGN DRAFT, revised 2026-09-15 after supplied preflight
-- Scope: Phase 1–2 data design. NOT an executable deployment migration.
-- Source of business rules: docs/sales-workflow-phase-1-2.md.
-- This replaces the unapplied 2026-09-04 design; it does not upgrade an installed V2.
-- No legacy data updates, policy replacement, discount approval, or public QR RPC.
-- Direct table writes remain closed; central-intake RPCs below default to disabled.
--
-- Read-only preflight required before producing a deployable migration:
--   * Inspect pg_attribute/pg_constraint for projects.name, plots.id, sales.plot_id,
--     leads.id, sales.id and customer_voices.id. Supplied report dated 2026-09-15
--     12:27:34 +07 confirms plots.id/sales.plot_id TEXT, projects.name TEXT PK,
--     and lead/sale/voice IDs UUID. It found no V2 tables in the inspected names.
--   * Inspect pg_policies, pg_trigger and existing functions for legacy CRM tables.
--   * Check duplicate project names and multiple non-cancelled sales per plot.
--   * Review customers missing names/phones, shared phones, and legacy owner mapping.
--   * Compare booking value vs deposit; never infer deposits or missing event dates.
--   * Inspect legacy required columns, money defaults and cascading Lead deletes.
--   * If any older V2 objects already exist, design an explicit forward migration.
--   * Existing plots/projects have permissive PUBLIC ALL policies plus anon grants.
--     Fix grants/policies with all affected app roles reviewed before any cutover.
--   * Step 3 received: the phone group contains ALL 895 legacy leads; user confirms
--     real historical records with placeholder phones, not one duplicate customer.
--     All 289 deposits are stored as zero and booking dates absent; 9 prices absent.
--     Unproven historical fields stay unknown; preserve raw source before backfill.
--   * User confirms existing Auth TEAW is TAEW (display name), not a new account.
--   * users ALSO has broad anon grants/policies. Security cutover, verified staff
--     mapping, full legacy-ID manifest and staging tests remain deployment gates.
--
-- Whole-file execution deliberately aborts BEFORE persistent DDL and also ends in
-- ROLLBACK. Remove neither safeguard for production without a separate reviewed
-- migration and the user's explicit Supabase authorization.

BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: this file is not authorized for database execution';
END;
$draft_only$;

-- 1. Trusted roles and phone lookup.
-- Bootstrap/link roles using verified auth IDs via an Admin-only server process.
-- Do not authorize from client-controlled form fields or user_metadata.
CREATE SCHEMA sales_private;
REVOKE ALL ON SCHEMA sales_private FROM PUBLIC, anon, authenticated;

CREATE TABLE sales_private.crm_user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('admin', 'owner', 'sales')),
  display_name text,
  is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE sales_private.crm_user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_user_roles FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $role$
  SELECT COALESCE((
    SELECT r.role FROM sales_private.crm_user_roles r
    WHERE r.user_id = auth.uid() AND r.is_active
  ), '');
$role$;
REVOKE ALL ON FUNCTION public.crm_v2_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_role() TO authenticated;

CREATE FUNCTION public.crm_v2_normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $phone$
  SELECT CASE
    WHEN length(digits) IN (12,13) AND digits LIKE '0066%' THEN '0'||substring(digits FROM 5)
    WHEN length(digits) IN (10,11) AND digits LIKE '66%' THEN '0'||substring(digits FROM 3)
    ELSE digits END
  FROM (SELECT regexp_replace(COALESCE(p_phone,''),'[^0-9]','','g') AS digits) n;
$phone$;
REVOKE ALL ON FUNCTION public.crm_v2_normalize_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_normalize_phone(text) TO authenticated;

-- 2. Central customer/Lead. A customer needs ZERO projects at creation.
-- Command API: owner = authenticated Sales creator, never supplied by the client.
-- Admin import/create-on-behalf must explicitly choose a Sales owner.
CREATE TABLE public.sales_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (btrim(customer_name) <> ''),
  record_origin text NOT NULL DEFAULT 'live' CHECK (record_origin IN ('live','legacy_import')),
  legacy_source_lead_id uuid UNIQUE REFERENCES public.leads(id) ON DELETE RESTRICT,
  phone text,
  phone_data_status text NOT NULL DEFAULT 'provided' CHECK (phone_data_status IN ('provided','unknown_legacy')),
  phone_normalized text GENERATED ALWAYS AS (
    CASE WHEN phone IS NULL THEN NULL ELSE public.crm_v2_normalize_phone(phone) END
  ) STORED,
  email text,
  line_id text,
  intake_channel text,
  acquisition_source text,
  intake_notes text,
  occupation text,
  monthly_income numeric(15,2) CHECK (monthly_income >= 0),
  personal_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  intake_status text NOT NULL DEFAULT 'new'
    CHECK (intake_status IN ('new','contacted','following_up','nurture','lost','legacy_unclassified')),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_assigned_at timestamptz NOT NULL DEFAULT now(),
  lead_created_at timestamptz DEFAULT now(), -- explicit NULL for unknown legacy date
  first_contacted_at timestamptz,
  merged_into_customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_customer_id IS NULL OR merged_into_customer_id <> id),
  CONSTRAINT crm_customer_origin_check CHECK (
    (record_origin='live' AND legacy_source_lead_id IS NULL AND lead_created_at IS NOT NULL
      AND intake_status<>'legacy_unclassified')
    OR (record_origin='legacy_import' AND legacy_source_lead_id IS NOT NULL)
  ),
  CONSTRAINT crm_customer_phone_evidence_check CHECK (
    (phone_data_status='unknown_legacy' AND record_origin='legacy_import' AND phone IS NULL)
    OR (phone_data_status='provided' AND phone IS NOT NULL
      AND phone ~ '^\+?[0-9 ()-]+$'
      AND length(regexp_replace(phone,'[^0-9]','','g')) BETWEEN 7 AND 15)
  )
);
-- Deliberately NOT UNIQUE: two different people can share a contact phone.
-- Canonical Thai country prefixes support duplicate warnings, never automatic merge.
-- Live create commands require the actual intake timestamp; imports explicitly
-- supply NULL when unknown and exclude those rows from dated cohort calculations.
-- Imports without a verified Sales owner remain in import review, not this table.
-- For the user-confirmed 895-row legacy batch: one initial customer per legacy ID,
-- not per placeholder phone OR name. Unknown phone is NULL/unknown_legacy; preserve
-- raw fields in the private snapshot. No live endpoint accepts these origin fields.
-- Historical unproven lead dates are explicitly NULL, never the default now().
-- Use legacy_unclassified instead of copying the old blanket Follow-up default.
-- No initial-contact SLA, fake Visit or loan attempt is created by historical import.
CREATE INDEX sales_customers_phone_lookup_idx ON public.sales_customers(phone_normalized);

CREATE TABLE public.crm_duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  candidate_customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','same_person','distinct_people_shared_phone')),
  reason text,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id <> candidate_customer_id),
  CHECK (decision = 'pending' OR
    (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
     AND reason IS NOT NULL AND btrim(reason) <> ''))
);
CREATE UNIQUE INDEX crm_duplicate_pair_idx ON public.crm_duplicate_reviews
  (LEAST(customer_id,candidate_customer_id), GREATEST(customer_id,candidate_customer_id));

-- 3. Prospective project interests, later activated by a Visit or Booking.
-- Supplied preflight confirms PRIMARY KEY projects(name): reuse it, no duplicate index.
CREATE TABLE public.lead_project_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_name text NOT NULL REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_assigned_at timestamptz NOT NULL DEFAULT now(),
  workspace_state text NOT NULL DEFAULT 'central_interest'
    CHECK (workspace_state IN ('central_interest','project_active')),
  activated_at timestamptz,
  activation_reason text CHECK (activation_reason IN ('visit','booking','legacy_import')),
  engagement_status text NOT NULL DEFAULT 'new'
    CHECK (engagement_status IN ('new','contacted','considering','follow_up','nurture','lost')),
  interested_plot_id text REFERENCES public.plots(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel text,
  source text,
  interest_created_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id,project_name),
  UNIQUE (id,customer_id),
  UNIQUE (id,project_name),
  CHECK (
    (workspace_state = 'central_interest' AND activated_at IS NULL AND activation_reason IS NULL)
    OR (workspace_state = 'project_active' AND activation_reason IS NOT NULL
        AND (activated_at IS NOT NULL OR activation_reason = 'legacy_import'))
  )
);
-- No per-project membership table: Sales/Owner/Admin read ALL projects.
-- New interest inherits the central owner; ONLY Admin may change the owner.
-- Target plot must match project and be available at save; selection never books.
-- Company and project cohort use customer.lead_created_at. interest_created_at and
-- activated_at are separate operational dates; transfer must not reset the cohort.
CREATE INDEX lead_interests_owner_idx ON public.lead_project_interests(owner_user_id);
CREATE INDEX lead_interests_workspace_idx ON public.lead_project_interests(project_name,workspace_state);

-- 4. Appointments and Visits are separate, repeatable events.
CREATE TABLE public.lead_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','rescheduled','attended','no_show','cancelled')),
  assigned_sales_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,project_interest_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE public.lead_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  appointment_id uuid,
  status text NOT NULL DEFAULT 'awaiting_voice'
    CHECK (status IN ('awaiting_voice','completed','cancelled')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  completed_voice_id uuid,
  completion_evidence_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,project_interest_id),
  UNIQUE (appointment_id),
  FOREIGN KEY (appointment_id,project_interest_id)
    REFERENCES public.lead_appointments(id,project_interest_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completed_voice_id IS NOT NULL
     AND completion_evidence_state IS NOT NULL AND completion_evidence_state = 'submitted')
    OR (status <> 'completed' AND completed_at IS NULL AND completed_voice_id IS NULL
        AND completion_evidence_state IS NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= checked_in_at)
);

-- Legacy survey rows keep visit_id NULL; they do not fabricate completed Visits.
-- Required answers are validated by a versioned command before marking submitted.
ALTER TABLE public.customer_voices
  ADD COLUMN visit_id uuid REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  ADD COLUMN crm_answers jsonb,
  ADD COLUMN crm_form_version text,
  ADD COLUMN crm_submission_state text CHECK (crm_submission_state IN ('draft','submitted')),
  ADD COLUMN crm_submitted_at timestamptz,
  ADD COLUMN crm_validated_at timestamptz,
  ADD COLUMN crm_submitted_by_customer boolean;
ALTER TABLE public.customer_voices ADD CONSTRAINT customer_voices_v2_submission_check CHECK (
  visit_id IS NULL OR
  (crm_submission_state IS NOT NULL AND crm_form_version IS NOT NULL AND btrim(crm_form_version) <> ''
   AND crm_answers IS NOT NULL AND jsonb_typeof(crm_answers) = 'object'
   AND (crm_submission_state = 'draft' OR
     (crm_submitted_at IS NOT NULL AND crm_validated_at IS NOT NULL
      AND crm_submitted_by_customer IS NOT NULL AND crm_submitted_by_customer = true)))
);
CREATE UNIQUE INDEX customer_voices_one_per_visit_idx ON public.customer_voices(visit_id)
  WHERE visit_id IS NOT NULL;
ALTER TABLE public.customer_voices ADD CONSTRAINT customer_voices_submission_identity_key
  UNIQUE (id,visit_id,crm_submission_state);
-- A completed Visit must reference a submitted response FOR THAT SAME Visit.
ALTER TABLE public.lead_visits ADD CONSTRAINT lead_visits_submission_evidence_fk
  FOREIGN KEY (completed_voice_id,id,completion_evidence_state)
  REFERENCES public.customer_voices(id,visit_id,crm_submission_state) ON DELETE RESTRICT;

-- Store only token HASHES here, not a plaintext QR secret in a readable Visit row.
CREATE TABLE sales_private.visit_submission_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
ALTER TABLE sales_private.visit_submission_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.visit_submission_tokens FROM PUBLIC, anon, authenticated;
-- No public submission function is shipped in this design. Future command must
-- validate form_version, required answers, type/range/size, token expiry and reuse,
-- and commit response + Visit completion + token consumption atomically.

-- 5. SOP completion is INDEPENDENT of Visit completion.
-- Keep the user's legacy house_visit_checklists and its policies untouched.
CREATE TABLE public.house_visit_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name text NOT NULL REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  plot_id text NOT NULL REFERENCES public.plots(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  project_interest_id uuid,
  appointment_id uuid,
  visit_id uuid,
  responsible_sales_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  template_version text NOT NULL,
  current_stage text NOT NULL DEFAULT 'stage_a'
    CHECK (current_stage IN ('stage_a','stage_b','stage_c','completed')),
  stage_a_completed_at timestamptz,
  stage_b_started_at timestamptz,
  stage_c_completed_at timestamptz,
  recap jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_action text,
  next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_interest_id,project_name)
    REFERENCES public.lead_project_interests(id,project_name) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id,project_interest_id)
    REFERENCES public.lead_appointments(id,project_interest_id) ON DELETE RESTRICT,
  FOREIGN KEY (visit_id,project_interest_id)
    REFERENCES public.lead_visits(id,project_interest_id) ON DELETE RESTRICT,
  CHECK ((appointment_id IS NULL AND visit_id IS NULL) OR project_interest_id IS NOT NULL),
  CHECK (current_stage <> 'completed' OR
    (stage_a_completed_at IS NOT NULL AND stage_b_started_at IS NOT NULL AND stage_c_completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX checklist_run_per_visit_idx ON public.house_visit_checklist_runs(visit_id)
  WHERE visit_id IS NOT NULL;
CREATE TABLE public.house_visit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.house_visit_checklist_runs(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('stage_a','stage_b','stage_c')),
  item_key text NOT NULL,
  item_label_snapshot text NOT NULL,
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','done','not_applicable','skipped')),
  reason text,
  answered_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  answered_at timestamptz,
  UNIQUE (run_id,stage,item_key),
  CHECK (result NOT IN ('not_applicable','skipped') OR (reason IS NOT NULL AND btrim(reason) <> '')),
  CHECK (result = 'pending' OR (answered_by_user_id IS NOT NULL AND answered_at IS NOT NULL))
);
-- Stage completion command checks the full versioned item list, not just the rows
-- present, and saves each stage before opening the customer questionnaire.
-- Standalone house preparation may initially have no customer and later link to a
-- matching appointment/Visit. Only Sales performs SOP; Admin corrections are audited.
-- The command verifies the prepared plot belongs to this project; preparing a
-- house does not reserve it. Interested plot and actual visited plot may differ.

-- 6. Existing sales becomes MANY bookings per interest, one per plot/booking round.
-- Nullable columns preserve the shape of legacy rows until explicit backfill.
ALTER TABLE public.sales
  ADD COLUMN project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  ADD COLUMN booking_round integer CHECK (booking_round > 0),
  ADD COLUMN previous_sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  ADD COLUMN crm_stage text CHECK (crm_stage IN (
    'booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected',
    'loan_approved','transfer_pending','transferred','handover','cancelled'
  )),
  ADD COLUMN payment_method text CHECK (payment_method IN ('cash','mortgage')),
  ADD COLUMN booking_route text CHECK (booking_route IN ('visited','without_visit','legacy_import')),
  ADD COLUMN booking_route_reason text,
  ADD COLUMN list_price numeric(15,2) CHECK (list_price >= 0),
  ADD COLUMN discount_amount numeric(15,2) CHECK (discount_amount >= 0),
  ADD COLUMN booked_at timestamptz,
  ADD COLUMN contracted_at timestamptz,
  ADD COLUMN crm_handover_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN legacy_cancellation_batch_id uuid, -- FK to proven pre-cutover cancellation below
  ADD COLUMN cancellation_category text CHECK (cancellation_category IN (
    'booking_cancelled','downpayment_abandoned','final_loan_rejection','other'
  )),
  ADD COLUMN closing_sales_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_fields_check CHECK (
  project_interest_id IS NULL OR
  (booking_round IS NOT NULL AND crm_stage IS NOT NULL AND booking_route IS NOT NULL)
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_remote_booking_check CHECK (
  booking_route IS DISTINCT FROM 'without_visit'
  OR (booking_route_reason IS NOT NULL AND btrim(booking_route_reason) <> '')
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_cancellation_check CHECK (
  crm_stage IS DISTINCT FROM 'cancelled'
  OR (COALESCE(booking_route = 'legacy_import', false) AND legacy_cancellation_batch_id IS NOT NULL)
  OR (cancelled_at IS NOT NULL AND cancellation_category IS NOT NULL
      AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_legacy_provenance_check CHECK (
  booking_route IS DISTINCT FROM 'legacy_import'
  OR (booking_route_reason IS NOT NULL AND btrim(booking_route_reason) <> '')
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_legacy_cancellation_origin_check CHECK (
  legacy_cancellation_batch_id IS NULL
  OR (COALESCE(booking_route = 'legacy_import', false) AND COALESCE(crm_stage = 'cancelled', false))
);
-- Imported ACTIVE sales do not get a cancellation exception. The FK below only
-- permits the same sale ID whose immutable source snapshot was already Cancelled.
-- A later cancellation of an imported active sale still needs date/category/reason.
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_not_own_predecessor_check
  CHECK (previous_sale_id IS NULL OR previous_sale_id <> id);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_identity_key UNIQUE (id,project_interest_id);
CREATE UNIQUE INDEX sales_interest_booking_round_idx ON public.sales(project_interest_id,booking_round)
  WHERE project_interest_id IS NOT NULL;
-- There is deliberately NO UNIQUE(project_interest_id): allow multiple plots and
-- a NEW sale after cancellation. Preserve prior sale and each loan attempt.
-- Requires legacy duplicate/unknown-status audit and compatible triggers BEFORE cutover.
CREATE UNIQUE INDEX sales_active_plot_booking_idx ON public.sales(plot_id)
  WHERE plot_id IS NOT NULL
    AND COALESCE(crm_stage, lower(contract_status), 'unknown') <> 'cancelled';
-- This index retains ownership after transfer/handover; such plots are not stock.
-- Booking/cancel/switch commands must lock plots, recheck project/availability,
-- synchronize legacy contract_status and has_customer, and append audit atomically.
-- Existing sale_price = agreed house price; booking_amount = deposit.
-- Unknown historical amounts stay unknown. Validate list_price - discount_amount
-- against agreed sale_price for NEW bookings only. No approval entity/status.
-- A separately reviewed backfill must snapshot raw sales first, then set proven
-- placeholder deposits to NULL for its EXACT manifest IDs (not every zero ever).
-- Existing positive prices stay recorded legacy values; absent 9 prices stay NULL.
-- Do not fill unknown booking/cancellation dates, categories or customer reasons.
-- legacy_import requires migration provenance, distinct from a customer reason;
-- actual new cancellation commands still require date, category and reason.

CREATE TABLE public.sale_plot_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  -- Historical plot identifiers are snapshots, not mutable foreign keys. A rename
  -- must not rewrite the old/new identifier recorded in this immutable event.
  old_plot_id text NOT NULL,
  new_plot_id text NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_plot_id <> new_plot_id)
);

CREATE TABLE public.loan_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  sale_id uuid,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  kind text NOT NULL CHECK (kind IN ('preapproval','purchase')),
  bank_name text NOT NULL CHECK (btrim(bank_name) <> ''),
  result_status text NOT NULL DEFAULT 'submitted'
    CHECK (result_status IN ('submitted','pending','rejected','approved','withdrawn')),
  submitted_at timestamptz,
  result_at timestamptz,
  result_reason text,
  approved_amount numeric(15,2) CHECK (approved_amount >= 0),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sale_id,project_interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE RESTRICT,
  CHECK (kind <> 'purchase' OR sale_id IS NOT NULL),
  CHECK (result_status <> 'rejected' OR (result_reason IS NOT NULL AND btrim(result_reason) <> ''))
);
CREATE UNIQUE INDEX loan_sale_attempt_idx ON public.loan_attempts(sale_id,attempt_number) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX loan_preapproval_attempt_idx ON public.loan_attempts(project_interest_id,attempt_number) WHERE sale_id IS NULL;
-- Cash purchases bypass loan commands; rejected attempts stay immutable after result.
-- A fresh attempt is a fresh row, not a reset from rejected back to submitted.

-- 7. Activities and immutable event history.
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  sale_id uuid,
  activity_type text NOT NULL CHECK (activity_type IN ('call','chat','follow_up','note')),
  result text CHECK (result IN ('contact_success','no_answer','customer_requested_later','other')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  next_follow_up_at timestamptz,
  note text,
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  FOREIGN KEY (sale_id,project_interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE RESTRICT,
  CHECK (sale_id IS NULL OR project_interest_id IS NOT NULL)
);
CREATE INDEX lead_activities_customer_time_idx ON public.lead_activities(customer_id,occurred_at DESC);
CREATE TABLE public.crm_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  reason_code text,
  reason_text text NOT NULL CHECK (btrim(reason_text) <> ''),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff','customer','system','legacy_import')),
  actor_name_snapshot text,
  old_values jsonb,
  new_values jsonb,
  occurred_at timestamptz, -- unknown imported dates remain NULL
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correction_of_event_id uuid REFERENCES public.crm_audit_events(id) ON DELETE RESTRICT
);
-- Future commands derive actor from session/token, append events for every status,
-- owner/plot/stage change, and retain creator/closing-agent snapshots.
-- No blanket UPDATE/DELETE policy for history and no cascade-delete of customers.

-- 8. Fair SLA: actual customer wait AND staff working-time accountability.
CREATE TABLE public.crm_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  central_intake_enabled boolean NOT NULL DEFAULT false,
  initial_contact_hours integer NOT NULL DEFAULT 24 CHECK (initial_contact_hours > 0),
  follow_up_max_gap_hours integer NOT NULL DEFAULT 48 CHECK (follow_up_max_gap_hours > 0),
  next_shift_response_minutes integer NOT NULL DEFAULT 120 CHECK (next_shift_response_minutes > 0),
  timezone_name text NOT NULL DEFAULT 'Asia/Bangkok',
  notification_channel text NOT NULL DEFAULT 'in_app' CHECK (notification_channel = 'in_app'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_work_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  period_type text NOT NULL CHECK (period_type IN ('work','leave','break')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX crm_work_periods_sales_time_idx ON public.crm_work_periods(sales_user_id,starts_at,ends_at);
CREATE TABLE public.crm_sla_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  source_activity_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  task_type text NOT NULL CHECK (task_type IN ('first_contact','follow_up')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  obligation_started_at timestamptz NOT NULL,
  service_due_at timestamptz NOT NULL,
  staff_due_at timestamptz,
  notify_at timestamptz,
  accountability_state text NOT NULL DEFAULT 'needs_schedule'
    CHECK (accountability_state IN ('needs_schedule','needs_owner','ready','exception')),
  evaluation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_by_activity_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  CHECK (service_due_at >= obligation_started_at),
  CHECK (accountability_state <> 'ready' OR (owner_user_id IS NOT NULL AND staff_due_at IS NOT NULL)),
  CHECK (status <> 'done' OR (completed_at IS NOT NULL AND completed_by_activity_id IS NOT NULL))
);
CREATE UNIQUE INDEX crm_first_contact_open_idx ON public.crm_sla_tasks(customer_id)
  WHERE task_type = 'first_contact' AND status = 'open';
CREATE INDEX crm_sla_due_idx ON public.crm_sla_tasks(service_due_at) WHERE status = 'open';
CREATE TABLE public.crm_sla_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT,
  exception_type text NOT NULL CHECK (exception_type IN (
    'customer_requested_later','outside_shift','approved_leave','owner_change','missing_schedule','legacy_data'
  )),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_follow_up_at timestamptz,
  evidence_note text,
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Never reset lead_created_at or service_due_at on assignment/project activation.
-- Compute staff_due_at from actual assigned work windows minus leave/breaks.
-- No schedule = no automatic poor-performance score. Outside-hours target is two
-- working hours from next shift; a customer's later appointment is explicit exception.
-- A no-answer attempt is NOT first_contacted_at/contact_success.
-- Backdated activities must not replace the latest follow-up deadline.

CREATE TABLE public.crm_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT,
  visit_id uuid REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  checklist_run_id uuid REFERENCES public.house_visit_checklist_runs(id) ON DELETE RESTRICT,
  notification_type text NOT NULL CHECK (notification_type IN (
    'due_soon','overdue','voice_pending','checklist_pending','owner_missing'
  )),
  dedupe_key text NOT NULL,
  message text NOT NULL,
  available_at timestamptz NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id,dedupe_key)
);
-- Future scheduled backend task emits these; this SQL schedules NO automation.

-- 9. Admin master data and legacy mapping. No automatic matching by name/phone.
CREATE TABLE public.sales_reason_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  code text NOT NULL,
  label_th text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (category,code)
);
CREATE TABLE public.crm_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  file_hash text NOT NULL,
  mapping_version text NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','validated','applied','failed')),
  created_by_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_hash,mapping_version)
);
CREATE TABLE sales_private.crm_legacy_source_snapshots (
  import_batch_id uuid NOT NULL REFERENCES public.crm_import_batches(id) ON DELETE RESTRICT,
  legacy_lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT,
  legacy_sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload)='object'),
  legacy_cancelled_sale_id uuid GENERATED ALWAYS AS (
    CASE WHEN legacy_sale_id IS NOT NULL
      AND source_payload->>'id'=legacy_sale_id::text
      AND source_payload->>'contract_status'='Cancelled'
    THEN legacy_sale_id ELSE NULL END
  ) STORED,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((legacy_lead_id IS NOT NULL AND legacy_sale_id IS NULL)
    OR (legacy_lead_id IS NULL AND legacy_sale_id IS NOT NULL)),
  UNIQUE (import_batch_id,legacy_lead_id),
  UNIQUE (import_batch_id,legacy_sale_id),
  UNIQUE (import_batch_id,legacy_cancelled_sale_id)
);
ALTER TABLE sales_private.crm_legacy_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_legacy_source_snapshots FROM PUBLIC, anon, authenticated;
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_legacy_cancellation_source_fk
  FOREIGN KEY (legacy_cancellation_batch_id,id)
  REFERENCES sales_private.crm_legacy_source_snapshots(import_batch_id,legacy_cancelled_sale_id)
  ON DELETE RESTRICT;
-- Immutable through future Admin import commands: compare full payload on replay,
-- never overwrite a prior snapshot. No generic source-payload browser read API.
-- source_payload is the full original row, including id and exact contract_status.
-- Only capture the frozen pre-cutover manifest; later runtime writes cannot create
-- new legacy cancellation evidence or replace the original source snapshot.
-- A new mapping version uses a new batch; links below keep legacy-ID idempotency.
CREATE TABLE public.crm_legacy_lead_links (
  legacy_lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  import_batch_id uuid REFERENCES public.crm_import_batches(id) ON DELETE RESTRICT,
  resolution_note text NOT NULL,
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT
);
CREATE TABLE public.crm_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.crm_import_batches(id) ON DELETE RESTRICT,
  sheet_name text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending','review','applied','failed','skipped')),
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (batch_id,sheet_name,source_row)
);
-- Many legacy Lead rows may map to the same customer/interest; retain every link.
-- Missing names/unverified owners remain in review. User-confirmed historical
-- missing phones may become NULL only with legacy provenance, never a placeholder.
-- "Transfer pending" is not transferred; "Lost / ไม่จอง" is not booked.
-- Match status codes exactly and price/deposit columns explicitly.
-- Missing dates, salaries and deposits remain unknown; show a preview before applying.

-- 10. New-object access only. No changes to legacy leads/sales/voice/checklist RLS.
-- Existing clients remain legacy until separately reviewed cutover.
-- Read global CRM as Sales/Admin/Owner. Write commands will later enforce:
--   * central customer: owning Sales or Admin
--   * interest/sales/activity: owning Sales of interest or Admin
--   * Owner: read-only
--   * ownership/duplicate resolution/master data/import: Admin
--   * actual SOP work: Sales; Admin corrections are distinct audit events
-- Intentionally no INSERT/UPDATE/DELETE policy or authenticated mutation GRANT.
DO $new_table_read_access$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_customers','lead_project_interests','lead_appointments','lead_visits',
    'house_visit_checklist_runs','house_visit_checklist_items','sale_plot_changes',
    'loan_attempts','lead_activities','crm_audit_events','crm_settings',
    'crm_work_periods','crm_sla_tasks','crm_sla_exceptions','sales_reason_catalog'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',table_name);
    EXECUTE format(
      'CREATE POLICY crm_v2_read ON public.%I FOR SELECT TO authenticated USING (public.crm_v2_role() IN (''admin'',''owner'',''sales''))',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'crm_duplicate_reviews','crm_import_batches','crm_legacy_lead_links','crm_import_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',table_name);
    EXECUTE format(
      'CREATE POLICY crm_v2_admin_read ON public.%I FOR SELECT TO authenticated USING (public.crm_v2_role() = ''admin'')',
      table_name
    );
  END LOOP;
END;
$new_table_read_access$;
ALTER TABLE public.crm_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_notifications TO authenticated;
CREATE POLICY crm_v2_own_notifications ON public.crm_notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() AND public.crm_v2_role() IN ('admin','owner','sales'));

-- 11. Central intake API contract. This whole file remains guarded DESIGN ONLY.
-- Installing this schema defaults to disabled. The DB setting is the actual RPC
-- write kill switch, including direct authenticated calls to Supabase. The Next
-- server flag gates only the app route, not direct RPC access. Reviewed app cutover
-- needs both enabled; a write freeze/rollback MUST also disable the DB setting.
CREATE TABLE sales_private.central_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
ALTER TABLE sales_private.central_command_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.central_command_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','central_intake_v1','enabled',
    public.crm_v2_role() IN ('sales','admin','owner') AND
    COALESCE((SELECT central_intake_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_central_snapshot(p_page integer DEFAULT 0,p_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $snapshot$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.crm_v2_role();
  customers_json jsonb;
  more_rows boolean;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF NOT COALESCE((public.crm_v2_capabilities()->>'enabled')::boolean,false) THEN
    RAISE EXCEPTION 'CRM_SETUP_REQUIRED';
  END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>100000 OR p_page_size IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  WITH page_rows AS (
    SELECT c.* FROM public.sales_customers c WHERE c.merged_into_customer_id IS NULL
    ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50
  ), visible_rows AS (
    SELECT * FROM page_rows ORDER BY created_at DESC,id LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.customer_name,'phone',c.phone,'channel',c.intake_channel,
    'notes',c.intake_notes,'ownerUserId',c.owner_user_id,'leadCreatedAt',c.lead_created_at,
    'intakeStatus',c.intake_status,'interests',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',i.id,'projectName',i.project_name,'ownerUserId',i.owner_user_id,
      'workspaceState',i.workspace_state,'engagementStatus',i.engagement_status,'plotId',i.interested_plot_id
    ) ORDER BY i.interest_created_at,i.id) FROM public.lead_project_interests i WHERE i.customer_id=c.id),'[]'::jsonb)
  ) ORDER BY c.created_at DESC,c.id),'[]'::jsonb),
    (SELECT count(*)>50 FROM page_rows)
  INTO customers_json,more_rows FROM visible_rows c;
  RETURN jsonb_build_object(
    'actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name)
      FROM public.projects WHERE is_closed IS NOT TRUE),'[]'::jsonb),
    'salesOwners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,
      'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE is_active AND role='sales'),'[]'::jsonb),
    'customers',customers_json,'page',p_page,'hasMore',more_rows);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_central_snapshot(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_central_snapshot(integer,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_create_customer(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $create_customer$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.crm_v2_role();
  owner_id uuid;
  actor_name text;
  saved_request sales_private.central_command_requests%ROWTYPE;
  normalized_phone text;
  new_customer_id uuid;
  new_interest_id uuid;
  interested_project text;
  chosen_plot text;
  interest jsonb;
  result jsonb;
  intake_at timestamptz := now();
  first_contact_hours integer;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_FORBIDDEN'; END IF;
  IF NOT COALESCE((public.crm_v2_capabilities()->>'enabled')::boolean,false) THEN
    RAISE EXCEPTION 'CRM_SETUP_REQUIRED';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_INVALID_INPUT'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
      ('name','phone','channel','notes','interests','assignedSalesUserId'))
    OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'phone') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'channel') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'interests') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  IF length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 200
    OR length(p_payload->>'phone')>32 OR (p_payload->>'phone') !~ '^\+?[0-9 ()-]+$'
    OR length(regexp_replace(p_payload->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 15
    OR length(btrim(p_payload->>'channel')) NOT BETWEEN 1 AND 80
    OR length(p_payload->>'notes')>4000 OR jsonb_array_length(p_payload->'interests')>20 THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  IF actor_role='sales' THEN
    IF p_payload ? 'assignedSalesUserId' THEN RAISE EXCEPTION 'CRM_FORBIDDEN'; END IF;
    owner_id := actor_id;
  ELSE
    IF jsonb_typeof(p_payload->'assignedSalesUserId') IS DISTINCT FROM 'string'
      OR (p_payload->>'assignedSalesUserId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'CRM_SALES_OWNER_REQUIRED';
    END IF;
    owner_id := (p_payload->>'assignedSalesUserId')::uuid;
  END IF;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND is_active AND role='sales' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SALES_OWNER_REQUIRED'; END IF;

  -- Serialize retries of the same authenticated actor+command, then compare the
  -- complete JSON payload (not a weak hash); no duplicate rows on retry.
  PERFORM pg_advisory_xact_lock(hashtextextended('central-request:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO saved_request FROM sales_private.central_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF saved_request.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN saved_request.response || jsonb_build_object('replayed',true);
  END IF;

  normalized_phone := public.crm_v2_normalize_phone(p_payload->>'phone');
  PERFORM pg_advisory_xact_lock(hashtextextended('central-phone:'||normalized_phone,0));
  IF EXISTS (SELECT 1 FROM public.sales_customers WHERE phone_normalized=normalized_phone)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE public.crm_v2_normalize_phone(l.phone)=normalized_phone
      AND NOT EXISTS (SELECT 1 FROM public.crm_legacy_lead_links k WHERE k.legacy_lead_id=l.id)) THEN
    -- Never merge by phone or silently create a second owner of legacy data.
    RAISE EXCEPTION 'CRM_DUPLICATE_REVIEW_REQUIRED';
  END IF;
  -- Mapped legacy rows use canonical customer phones; raw historical placeholders
  -- are retained for audit, not duplicate matching. Unmigrated legacy rows still
  -- block an exact phone match until reviewed. Writer cutover remains mandatory.
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'interests')) <>
    (SELECT count(DISTINCT btrim(value->>'projectName')) FROM jsonb_array_elements(p_payload->'interests')) THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  FOR interest IN SELECT value FROM jsonb_array_elements(p_payload->'interests') LOOP
    IF jsonb_typeof(interest) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_INVALID_INPUT'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(interest) k WHERE k NOT IN ('projectName','plotId'))
      OR jsonb_typeof(interest->'projectName') IS DISTINCT FROM 'string'
      OR length(btrim(interest->>'projectName')) NOT BETWEEN 1 AND 200
      OR NOT (interest ? 'plotId') OR jsonb_typeof(interest->'plotId') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'CRM_INVALID_INPUT';
    END IF;
    interested_project := btrim(interest->>'projectName');
    chosen_plot := interest->>'plotId';
    IF chosen_plot IS NOT NULL AND (length(chosen_plot) NOT BETWEEN 1 AND 255 OR btrim(chosen_plot)='') THEN
      RAISE EXCEPTION 'CRM_INVALID_INPUT';
    END IF;
    PERFORM 1 FROM public.projects WHERE name=interested_project AND is_closed IS NOT TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_INVALID_INPUT'; END IF;
    IF chosen_plot IS NOT NULL THEN
      PERFORM 1 FROM public.plots p WHERE p.id=chosen_plot AND p.project_name=interested_project
        AND p.has_customer IS FALSE AND lower(btrim(COALESCE(p.sale_status,'')))
          IN ('','active','normal','ready_for_sale','available','vacant') FOR SHARE;
      IF NOT FOUND OR EXISTS (SELECT 1 FROM public.sales s WHERE s.plot_id=chosen_plot
        AND lower(btrim(COALESCE(s.crm_stage,s.contract_status,'')))<>'cancelled') THEN
        RAISE EXCEPTION 'CRM_PLOT_UNAVAILABLE';
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(NULLIF(btrim(display_name),''),actor_id::text) INTO actor_name
    FROM sales_private.crm_user_roles WHERE user_id=actor_id;
  INSERT INTO public.sales_customers(customer_name,phone,intake_channel,intake_notes,
    owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at)
  VALUES (btrim(p_payload->>'name'),btrim(p_payload->>'phone'),btrim(p_payload->>'channel'),p_payload->>'notes',
    owner_id,actor_id,intake_at,intake_at) RETURNING id INTO new_customer_id;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
    actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at)
  VALUES (new_customer_id,'customer',new_customer_id,'created','รับ Lead ใหม่',actor_id,'staff',actor_name,
    jsonb_build_object('ownerUserId',owner_id,'intakeStatus','new'),intake_at);
  FOR interest IN SELECT value FROM jsonb_array_elements(p_payload->'interests') LOOP
    INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,
      interested_plot_id,created_by_user_id,owner_assigned_at,interest_created_at)
    VALUES (new_customer_id,btrim(interest->>'projectName'),owner_id,interest->>'plotId',actor_id,intake_at,intake_at)
    RETURNING id INTO new_interest_id;
    INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
      actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at)
    VALUES (new_customer_id,'interest',new_interest_id,'created','บันทึกโครงการที่ลูกค้าสนใจ',actor_id,'staff',actor_name,
      jsonb_build_object('projectName',btrim(interest->>'projectName'),'ownerUserId',owner_id,'workspaceState','central_interest'),intake_at);
  END LOOP;
  SELECT COALESCE((SELECT initial_contact_hours FROM public.crm_settings WHERE id),24) INTO first_contact_hours;
  INSERT INTO public.crm_sla_tasks(customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,
    accountability_state,evaluation_snapshot)
  VALUES (new_customer_id,owner_id,'first_contact',intake_at,intake_at+make_interval(hours=>first_contact_hours),
    'needs_schedule',jsonb_build_object('initialContactHours',first_contact_hours,'clock','elapsed','staffDueKnown',false));
  result := jsonb_build_object('customerId',new_customer_id,'replayed',false);
  INSERT INTO sales_private.central_command_requests(actor_user_id,request_id,request_payload,response)
    VALUES (actor_id,p_request_id,p_payload,result);
  RETURN result;
END;
$create_customer$;
REVOKE ALL ON FUNCTION public.crm_v2_create_customer(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_create_customer(uuid,jsonb) TO authenticated;
-- No inserts into legacy leads/sales/plots, no automatic owner merge, no QR/booking
-- cutover here. Legacy writer retirement is required before enabling this contract.

-- Deployment gates, NOT completed by this draft:
--   API/RPC write authorization + immutable history + lifecycle transition rules;
--   customer duplicate merge locking and Admin verification;
--   price/stock locking against actual live key types and existing sales triggers;
--   questionnaire validation and token rate-limits;
--   calendar-aware SLA calculation, snapshots and in-app notification worker;
--   staging backfill rehearsal and legacy read/write policy cutover;
--   legacy money defaults/required fields/cascading deletes and unknown dates;
--   PostgreSQL integration tests of the acceptance scenarios in the design document.
-- This draft makes no changes unless executed (which the guard prevents). Local
-- app code is prepared separately; environment and production data stay unchanged.

ROLLBACK;
