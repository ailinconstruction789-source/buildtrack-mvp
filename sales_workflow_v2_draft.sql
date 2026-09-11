-- =============================================================================
-- BUILDTRACK SALES WORKFLOW V2 — DRAFT ONLY / DO NOT RUN YET
-- =============================================================================
-- Purpose:
--   Add the approved customer + per-project-interest sales model without
--   dropping the legacy leads/sales columns used by the current UI.
--
-- IMPORTANT:
--   1. This file has NOT been run against Supabase.
--   2. Populate sales_project_members before enabling the new UI for Sales.
--   3. Legacy data backfill is intentionally excluded until duplicate-phone
--      and missing-phone reports have been reviewed.
--   4. No discount approval table or approval state is created. Sales only
--      records list price, discount amount, and final sale price at booking.
-- =============================================================================

-- Preflight queries to run read-only before deployment:
--
-- SELECT name, count(*)
-- FROM public.projects
-- GROUP BY name
-- HAVING name IS NULL OR btrim(name) = '' OR count(*) > 1;
--
-- SELECT id, customer_name, phone, project_name
-- FROM public.leads
-- WHERE NULLIF(btrim(customer_name), '') IS NULL
--    OR NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), '') IS NULL;
--
-- SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS normalized_phone,
--        count(*) AS lead_rows,
--        array_agg(DISTINCT customer_name) AS names,
--        array_agg(DISTINCT project_name) AS projects
-- FROM public.leads
-- WHERE NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
-- GROUP BY regexp_replace(phone, '[^0-9]', '', 'g')
-- HAVING count(*) > 1;
--
-- SELECT plot_id, count(*)
-- FROM public.sales
-- WHERE plot_id IS NOT NULL
--   AND lower(COALESCE(contract_status, '')) <> 'cancelled'
-- GROUP BY plot_id
-- HAVING count(*) > 1;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Project key compatibility
-- The live application currently uses projects.name and plots.project_name.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.projects
    WHERE name IS NULL OR btrim(name) = ''
  ) THEN
    RAISE EXCEPTION 'Cannot create sales V2 schema: projects.name contains blank values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.projects
    GROUP BY name
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create sales V2 schema: projects.name contains duplicates';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS projects_name_sales_unique_idx
  ON public.projects (name);

-- -----------------------------------------------------------------------------
-- 2. Shared helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_sales_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.sales_current_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', ''));
$$;

-- -----------------------------------------------------------------------------
-- 3. Customer master
-- Company KPI counts one row here, using lead_created_at as the cohort date.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (btrim(customer_name) <> ''),
  phone text NOT NULL CHECK (public.normalize_sales_phone(phone) <> ''),
  phone_normalized text GENERATED ALWAYS AS (public.normalize_sales_phone(phone)) STORED,
  email text,
  line_id text,
  occupation text,
  monthly_income numeric(15, 2) CHECK (monthly_income IS NULL OR monthly_income >= 0),
  personal_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  lead_created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_customers_phone_normalized_uidx
  ON public.sales_customers (phone_normalized);

-- -----------------------------------------------------------------------------
-- 4. Sales access by project
-- Sales sees all sales records inside projects assigned by Admin.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales_project_members (
  project_name text NOT NULL REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_name, user_id)
);

CREATE OR REPLACE FUNCTION public.sales_can_access_project(p_project_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.sales_current_role() IN ('admin', 'owner')
    OR (
      public.sales_current_role() = 'sales'
      AND EXISTS (
      SELECT 1
      FROM public.sales_project_members spm
      WHERE spm.project_name = p_project_name
        AND spm.user_id = auth.uid()
        AND spm.is_active = true
      )
    );
$$;

-- -----------------------------------------------------------------------------
-- 5. Per-project Lead/Opportunity
-- Status, owner, target plot, and SLA are separated per interested project.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lead_project_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_name text NOT NULL REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',
    'contacted',
    'appointment',
    'visit_pending_voice',
    'visit_complete',
    'considering',
    'follow_up',
    'booked',
    'contract_downpayment',
    'document_prep',
    'loan_submitted',
    'loan_rejected',
    'loan_approved',
    'transfer_pending',
    'transferred',
    'handover',
    'lost',
    'cancelled'
  )),
  channel text,
  source text,
  interested_plot_id uuid REFERENCES public.plots(id) ON DELETE SET NULL,
  lead_at timestamptz NOT NULL DEFAULT now(),
  first_contact_due_at timestamptz,
  first_contacted_at timestamptz,
  last_follow_up_at timestamptz,
  next_follow_up_due_at timestamptz,
  status_change_reason_code text,
  status_change_reason_text text,
  lost_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  notes text,
  legacy_lead_id uuid UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, project_name)
);

CREATE INDEX IF NOT EXISTS lead_project_interests_project_status_idx
  ON public.lead_project_interests (project_name, status);

CREATE INDEX IF NOT EXISTS lead_project_interests_owner_idx
  ON public.lead_project_interests (owner_user_id);

CREATE INDEX IF NOT EXISTS lead_project_interests_follow_up_idx
  ON public.lead_project_interests (next_follow_up_due_at)
  WHERE status NOT IN ('lost', 'cancelled', 'transferred', 'handover');

CREATE OR REPLACE FUNCTION public.sales_can_access_interest(p_interest_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lead_project_interests i
    WHERE i.id = p_interest_id
      AND public.sales_can_access_project(i.project_name)
  );
$$;

CREATE OR REPLACE FUNCTION public.sales_can_access_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.sales_current_role() IN ('admin', 'owner')
    OR EXISTS (
      SELECT 1
      FROM public.lead_project_interests i
      WHERE i.customer_id = p_customer_id
        AND public.sales_can_access_project(i.project_name)
    );
$$;

CREATE OR REPLACE FUNCTION public.sales_can_access_legacy_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id = p_lead_id
      AND public.sales_can_access_project(l.project_name)
  );
$$;

-- -----------------------------------------------------------------------------
-- 6. Configurable SLA and Admin-managed reason catalog
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.crm_settings (
  scope_key text PRIMARY KEY,
  project_name text REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE CASCADE,
  initial_contact_hours integer NOT NULL DEFAULT 24 CHECK (initial_contact_hours > 0),
  follow_up_max_gap_hours integer NOT NULL DEFAULT 48 CHECK (follow_up_max_gap_hours > 0),
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_key = '__global__' AND project_name IS NULL)
    OR (scope_key = project_name AND project_name IS NOT NULL)
  )
);

INSERT INTO public.crm_settings (
  scope_key,
  project_name,
  initial_contact_hours,
  follow_up_max_gap_hours
)
VALUES ('__global__', NULL, 24, 48)
ON CONFLICT (scope_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sales_reason_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_type text NOT NULL CHECK (reason_type IN ('status_change', 'lost', 'cancellation')),
  code text NOT NULL,
  label_th text NOT NULL,
  applies_to_status text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reason_type, code)
);

INSERT INTO public.sales_reason_catalog (reason_type, code, label_th, applies_to_status, sort_order)
VALUES
  ('status_change', 'contact_completed', 'ติดต่อลูกค้าแล้ว', 'contacted', 10),
  ('status_change', 'appointment_created', 'นัดหมายลูกค้าแล้ว', 'appointment', 20),
  ('status_change', 'visit_checked_in', 'ลูกค้าเช็กอินเข้าชมโครงการ', 'visit_pending_voice', 30),
  ('status_change', 'customer_voice_submitted', 'ลูกค้าส่ง Customer Voices แล้ว', 'visit_complete', 40),
  ('status_change', 'follow_up_completed', 'ติดตามลูกค้าแล้ว', 'follow_up', 50),
  ('status_change', 'booking_created', 'ลูกค้ายืนยันการจอง', 'booked', 60),
  ('status_change', 'loan_submitted', 'ส่งคำขอสินเชื่อแล้ว', 'loan_submitted', 70),
  ('status_change', 'loan_rejected', 'สถาบันการเงินปฏิเสธคำขอ', 'loan_rejected', 80),
  ('status_change', 'loan_approved', 'สินเชื่อได้รับอนุมัติ', 'loan_approved', 90),
  ('status_change', 'transfer_confirmed', 'Sales ยืนยันการโอน', 'transferred', 100),
  ('lost', 'budget', 'งบประมาณไม่ถึงหรือราคาสูงเกิน', 'lost', 10),
  ('lost', 'location', 'ทำเลไม่ตรงความต้องการ', 'lost', 20),
  ('lost', 'not_ready', 'ยังไม่พร้อมซื้อ', 'lost', 30),
  ('lost', 'other_project', 'เลือกโครงการอื่น', 'lost', 40),
  ('lost', 'unreachable', 'ติดต่อไม่ได้', 'lost', 50),
  ('lost', 'other', 'อื่น ๆ', 'lost', 99),
  ('cancellation', 'booking_cancelled', 'ยกเลิกการจอง', 'cancelled', 10),
  ('cancellation', 'downpayment_abandoned', 'ทิ้งเงินดาวน์', 'cancelled', 20),
  ('cancellation', 'final_loan_rejection', 'กู้ไม่ผ่านและยุติการยื่นใหม่', 'cancelled', 30),
  ('cancellation', 'other', 'อื่น ๆ', 'cancelled', 99)
ON CONFLICT (reason_type, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Activities and follow-up history
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN (
    'lead_created',
    'call',
    'chat',
    'appointment',
    'follow_up',
    'note',
    'owner_changed',
    'plot_interest_changed',
    'booking',
    'cancellation',
    'transfer'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  next_follow_up_at timestamptz,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_activities_interest_occurred_idx
  ON public.lead_activities (project_interest_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 8. Visit and Customer Voices
-- A visit cannot become completed until a linked Customer Voice exists.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lead_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE CASCADE,
  interested_plot_id uuid REFERENCES public.plots(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_customer_voice' CHECK (status IN (
    'pending_customer_voice',
    'completed',
    'cancelled'
  )),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  public_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  public_token_expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (public_token)
);

ALTER TABLE public.customer_voices
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by_customer boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS customer_voices_visit_uidx
  ON public.customer_voices (visit_id)
  WHERE visit_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 9. Loan attempts
-- Rejection does not close the Lead. A later attempt receives a new number.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.loan_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  bank_name text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  result_status text NOT NULL DEFAULT 'submitted' CHECK (result_status IN (
    'submitted',
    'pending',
    'rejected',
    'approved',
    'withdrawn'
  )),
  result_at timestamptz,
  rejection_reason text,
  approved_amount numeric(15, 2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
  note text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_interest_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS loan_attempts_interest_idx
  ON public.loan_attempts (project_interest_id, attempt_number DESC);

-- -----------------------------------------------------------------------------
-- 10. Extend legacy tables for a gradual cutover
-- -----------------------------------------------------------------------------

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.sales_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE SET NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_price numeric(15, 2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(15, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_list_price_nonnegative_chk'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_list_price_nonnegative_chk
      CHECK (list_price IS NULL OR list_price >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_discount_amount_nonnegative_chk'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_discount_amount_nonnegative_chk
      CHECK (discount_amount >= 0) NOT VALID;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sales_project_interest_uidx
  ON public.sales (project_interest_id)
  WHERE project_interest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sales_can_access_sale(p_sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = p_sale_id
      AND (
        (s.project_interest_id IS NOT NULL
          AND public.sales_can_access_interest(s.project_interest_id))
        OR (s.lead_id IS NOT NULL
          AND public.sales_can_access_legacy_lead(s.lead_id))
      )
  );
$$;

-- Only a real booking locks a plot. Target/interest selection does not.
-- Run the duplicate-active-plot preflight before creating this index in production.
CREATE UNIQUE INDEX IF NOT EXISTS sales_one_active_booking_per_plot_uidx
  ON public.sales (plot_id)
  WHERE plot_id IS NOT NULL
    AND lower(COALESCE(contract_status, '')) <> 'cancelled';

ALTER TABLE public.status_history
  ADD COLUMN IF NOT EXISTS project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_text text,
  ADD COLUMN IF NOT EXISTS changed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS status_history_interest_created_idx
  ON public.status_history (project_interest_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 11. Database guards and automatic history
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_interest_plot_availability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_name text;
  v_has_customer boolean;
  v_sale_status text;
BEGIN
  IF NEW.interested_plot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.project_name, COALESCE(p.has_customer, false), lower(COALESCE(p.sale_status, ''))
  INTO v_project_name, v_has_customer, v_sale_status
  FROM public.plots p
  WHERE p.id = NEW.interested_plot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plot does not exist';
  END IF;

  IF v_project_name IS DISTINCT FROM NEW.project_name THEN
    RAISE EXCEPTION 'Selected plot must belong to the same project as the Lead interest';
  END IF;

  IF v_has_customer OR v_sale_status IN ('reserved', 'booked', 'sold', 'transferred') THEN
    RAISE EXCEPTION 'Selected plot is no longer available';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_interest_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_initial_contact_hours integer;
BEGIN
  SELECT COALESCE(project_setting.initial_contact_hours, global_setting.initial_contact_hours, 24)
  INTO v_initial_contact_hours
  FROM (SELECT 1) seed
  LEFT JOIN public.crm_settings project_setting
    ON project_setting.scope_key = NEW.project_name
  LEFT JOIN public.crm_settings global_setting
    ON global_setting.scope_key = '__global__';

  NEW.first_contact_due_at := COALESCE(
    NEW.first_contact_due_at,
    NEW.lead_at + make_interval(hours => v_initial_contact_hours)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_interest_sla_trigger
  ON public.lead_project_interests;
CREATE TRIGGER apply_interest_sla_trigger
BEFORE INSERT ON public.lead_project_interests
FOR EACH ROW
EXECUTE FUNCTION public.apply_interest_sla();

DROP TRIGGER IF EXISTS validate_interest_plot_availability_trigger
  ON public.lead_project_interests;
CREATE TRIGGER validate_interest_plot_availability_trigger
BEFORE INSERT OR UPDATE OF interested_plot_id, project_name
ON public.lead_project_interests
FOR EACH ROW
EXECUTE FUNCTION public.validate_interest_plot_availability();

CREATE OR REPLACE FUNCTION public.guard_and_log_interest_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.sales_current_role();
  v_actor_name text := COALESCE(auth.jwt() -> 'user_metadata' ->> 'username', auth.uid()::text);
BEGIN
  IF OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'Only Admin can change the Lead owner';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NULLIF(btrim(COALESCE(NEW.status_change_reason_code, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(NEW.status_change_reason_text, '')), '') IS NULL THEN
      RAISE EXCEPTION 'A reason is required for every status change';
    END IF;

    IF NEW.status IN ('lost', 'cancelled')
       AND NULLIF(btrim(COALESCE(NEW.status_change_reason_code, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Lost and cancelled statuses require a reason category';
    END IF;

    IF NEW.status = 'lost'
       AND NOT EXISTS (
         SELECT 1
         FROM public.sales_reason_catalog r
         WHERE r.reason_type = 'lost'
           AND r.code = NEW.status_change_reason_code
           AND r.is_active = true
       ) THEN
      RAISE EXCEPTION 'Invalid or inactive Lost reason';
    END IF;

    IF NEW.status = 'cancelled'
       AND NOT EXISTS (
         SELECT 1
         FROM public.sales_reason_catalog r
         WHERE r.reason_type = 'cancellation'
           AND r.code = NEW.status_change_reason_code
           AND r.is_active = true
       ) THEN
      RAISE EXCEPTION 'Invalid or inactive cancellation reason';
    END IF;

    IF NEW.status = 'lost'
       AND OLD.status IN (
         'booked', 'contract_downpayment', 'document_prep', 'loan_submitted',
         'loan_rejected', 'loan_approved', 'transfer_pending', 'transferred', 'handover'
       ) THEN
      RAISE EXCEPTION 'Use cancelled, not lost, after booking';
    END IF;

    IF NEW.status = 'cancelled'
       AND OLD.status NOT IN (
         'booked', 'contract_downpayment', 'document_prep', 'loan_submitted',
         'loan_rejected', 'loan_approved', 'transfer_pending'
       ) THEN
      RAISE EXCEPTION 'Cancelled is only valid after booking and before transfer';
    END IF;

    NEW.lost_at := CASE WHEN NEW.status = 'lost' THEN now() ELSE NEW.lost_at END;
    NEW.cancelled_at := CASE WHEN NEW.status = 'cancelled' THEN now() ELSE NEW.cancelled_at END;
    NEW.closed_at := CASE
      WHEN NEW.status IN ('lost', 'cancelled', 'transferred', 'handover') THEN COALESCE(NEW.closed_at, now())
      ELSE NULL
    END;

    INSERT INTO public.status_history (
      entity_type,
      entity_id,
      project_interest_id,
      old_status,
      new_status,
      changed_by,
      changed_by_user_id,
      reason_code,
      reason_text,
      created_at
    ) VALUES (
      'project_interest',
      NEW.id,
      NEW.id,
      OLD.status,
      NEW.status,
      v_actor_name,
      auth.uid(),
      NULLIF(btrim(COALESCE(NEW.status_change_reason_code, '')), ''),
      NULLIF(btrim(COALESCE(NEW.status_change_reason_text, '')), ''),
      now()
    );

    -- Reason fields are command fields. Clearing them prevents accidental reuse.
    NEW.status_change_reason_code := NULL;
    NEW.status_change_reason_text := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_and_log_interest_change_trigger
  ON public.lead_project_interests;
CREATE TRIGGER guard_and_log_interest_change_trigger
BEFORE UPDATE ON public.lead_project_interests
FOR EACH ROW
EXECUTE FUNCTION public.guard_and_log_interest_change();

CREATE OR REPLACE FUNCTION public.log_interest_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id THEN
    INSERT INTO public.lead_activities (
      project_interest_id,
      activity_type,
      occurred_at,
      note,
      metadata,
      created_by_user_id
    ) VALUES (
      NEW.id,
      'owner_changed',
      now(),
      'Admin เปลี่ยนเจ้าของ Lead',
      jsonb_build_object(
        'old_owner_user_id', OLD.owner_user_id,
        'new_owner_user_id', NEW.owner_user_id
      ),
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_interest_owner_change_trigger
  ON public.lead_project_interests;
CREATE TRIGGER log_interest_owner_change_trigger
AFTER UPDATE OF owner_user_id ON public.lead_project_interests
FOR EACH ROW
EXECUTE FUNCTION public.log_interest_owner_change();

CREATE OR REPLACE FUNCTION public.log_new_interest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.status_history (
    entity_type,
    entity_id,
    project_interest_id,
    old_status,
    new_status,
    changed_by,
    changed_by_user_id,
    reason_code,
    reason_text,
    created_at
  ) VALUES (
    'project_interest',
    NEW.id,
    NEW.id,
    NULL,
    NEW.status,
    COALESCE(auth.jwt() -> 'user_metadata' ->> 'username', auth.uid()::text),
    auth.uid(),
    'lead_created',
    'สร้าง Lead ในโครงการ',
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_new_interest_trigger
  ON public.lead_project_interests;
CREATE TRIGGER log_new_interest_trigger
AFTER INSERT ON public.lead_project_interests
FOR EACH ROW
EXECUTE FUNCTION public.log_new_interest();

CREATE OR REPLACE FUNCTION public.apply_follow_up_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_name text;
  v_follow_up_hours integer;
  v_max_due_at timestamptz;
BEGIN
  IF NEW.activity_type NOT IN ('call', 'chat', 'follow_up') THEN
    RETURN NEW;
  END IF;

  SELECT i.project_name
  INTO v_project_name
  FROM public.lead_project_interests i
  WHERE i.id = NEW.project_interest_id;

  SELECT COALESCE(project_setting.follow_up_max_gap_hours, global_setting.follow_up_max_gap_hours, 48)
  INTO v_follow_up_hours
  FROM (SELECT 1) seed
  LEFT JOIN public.crm_settings project_setting
    ON project_setting.scope_key = v_project_name
  LEFT JOIN public.crm_settings global_setting
    ON global_setting.scope_key = '__global__';

  v_max_due_at := NEW.occurred_at + make_interval(hours => v_follow_up_hours);

  IF NEW.next_follow_up_at IS NOT NULL AND NEW.next_follow_up_at > v_max_due_at THEN
    RAISE EXCEPTION 'Next follow-up exceeds the configured maximum gap of % hours', v_follow_up_hours;
  END IF;

  UPDATE public.lead_project_interests
  SET last_follow_up_at = NEW.occurred_at,
      next_follow_up_due_at = COALESCE(NEW.next_follow_up_at, v_max_due_at),
      first_contacted_at = CASE
        WHEN first_contacted_at IS NULL THEN NEW.occurred_at
        ELSE first_contacted_at
      END,
      updated_at = now()
  WHERE id = NEW.project_interest_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_follow_up_sla_trigger ON public.lead_activities;
CREATE TRIGGER apply_follow_up_sla_trigger
AFTER INSERT ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.apply_follow_up_sla();

CREATE OR REPLACE FUNCTION public.validate_booking_plot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_interest_project text;
  v_plot_project text;
BEGIN
  -- Legacy rows remain valid during the gradual cutover.
  IF NEW.project_interest_id IS NULL OR NEW.plot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project_name
  INTO v_interest_project
  FROM public.lead_project_interests
  WHERE id = NEW.project_interest_id;

  SELECT project_name
  INTO v_plot_project
  FROM public.plots
  WHERE id = NEW.plot_id;

  IF v_interest_project IS NULL OR v_plot_project IS NULL THEN
    RAISE EXCEPTION 'Booking interest or plot does not exist';
  END IF;

  IF v_interest_project IS DISTINCT FROM v_plot_project THEN
    RAISE EXCEPTION 'Booked plot must belong to the same project as the Lead interest';
  END IF;

  IF lower(COALESCE(NEW.contract_status, '')) <> 'cancelled'
     AND EXISTS (
       SELECT 1
       FROM public.sales existing_sale
       WHERE existing_sale.plot_id = NEW.plot_id
         AND existing_sale.id IS DISTINCT FROM NEW.id
         AND lower(COALESCE(existing_sale.contract_status, '')) <> 'cancelled'
     ) THEN
    RAISE EXCEPTION 'Plot is already locked by another active booking';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_booking_plot_trigger ON public.sales;
CREATE TRIGGER validate_booking_plot_trigger
BEFORE INSERT OR UPDATE OF project_interest_id, plot_id, contract_status
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.validate_booking_plot();

CREATE OR REPLACE FUNCTION public.guard_visit_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NOT EXISTS (
       SELECT 1
       FROM public.customer_voices cv
       WHERE cv.visit_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'Visit completes only after Customer Voices is submitted';
  END IF;

  NEW.completed_at := CASE
    WHEN NEW.status = 'completed' THEN COALESCE(NEW.completed_at, now())
    ELSE NULL
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_visit_completion_trigger ON public.lead_visits;
CREATE TRIGGER guard_visit_completion_trigger
BEFORE INSERT OR UPDATE OF status ON public.lead_visits
FOR EACH ROW
EXECUTE FUNCTION public.guard_visit_completion();

CREATE OR REPLACE FUNCTION public.complete_visit_after_customer_voice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.visit_id IS NOT NULL THEN
    UPDATE public.lead_visits
    SET status = 'completed',
        completed_at = COALESCE(completed_at, COALESCE(NEW.submitted_at, now())),
        updated_at = now()
    WHERE id = NEW.visit_id;

    UPDATE public.lead_project_interests i
    SET status = 'visit_complete',
        status_change_reason_code = 'customer_voice_submitted',
        status_change_reason_text = 'ลูกค้าส่ง Customer Voices แล้ว'
    FROM public.lead_visits v
    WHERE v.id = NEW.visit_id
      AND i.id = v.project_interest_id
      AND i.status = 'visit_pending_voice';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complete_visit_after_customer_voice_trigger
  ON public.customer_voices;
CREATE TRIGGER complete_visit_after_customer_voice_trigger
AFTER INSERT OR UPDATE OF submitted_at ON public.customer_voices
FOR EACH ROW
EXECUTE FUNCTION public.complete_visit_after_customer_voice();

-- Public QR submission uses a token-specific RPC. Anonymous users receive no
-- direct table privileges and cannot read customer/visit records.
CREATE OR REPLACE FUNCTION public.submit_customer_voice(
  p_public_token text,
  p_answers jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit public.lead_visits%ROWTYPE;
  v_customer public.sales_customers%ROWTYPE;
  v_interest public.lead_project_interests%ROWTYPE;
  v_voice_id uuid;
BEGIN
  SELECT *
  INTO v_visit
  FROM public.lead_visits
  WHERE public_token = p_public_token
    AND public_token_expires_at >= now()
    AND status = 'pending_customer_voice'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR link is invalid, expired, or already completed';
  END IF;

  SELECT * INTO v_interest
  FROM public.lead_project_interests
  WHERE id = v_visit.project_interest_id;

  SELECT * INTO v_customer
  FROM public.sales_customers
  WHERE id = v_interest.customer_id;

  INSERT INTO public.customer_voices (
    visit_id,
    lead_id,
    survey_date,
    submitted_at,
    submitted_by_customer,
    customer_name,
    phone,
    project_name,
    answers
  ) VALUES (
    v_visit.id,
    v_interest.legacy_lead_id,
    now(),
    now(),
    true,
    v_customer.customer_name,
    v_customer.phone,
    v_interest.project_name,
    COALESCE(p_answers, '{}'::jsonb)
  )
  RETURNING id INTO v_voice_id;

  RETURN v_voice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_customer_voice(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_customer_voice(text, jsonb) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 12. Row Level Security for the new model
-- -----------------------------------------------------------------------------

ALTER TABLE public.sales_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_project_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_reason_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_customers_select_policy ON public.sales_customers;
CREATE POLICY sales_customers_select_policy
ON public.sales_customers FOR SELECT TO authenticated
USING (public.sales_can_access_customer(id));

DROP POLICY IF EXISTS sales_customers_insert_policy ON public.sales_customers;
CREATE POLICY sales_customers_insert_policy
ON public.sales_customers FOR INSERT TO authenticated
WITH CHECK (public.sales_current_role() IN ('admin', 'owner', 'sales'));

DROP POLICY IF EXISTS sales_customers_update_policy ON public.sales_customers;
CREATE POLICY sales_customers_update_policy
ON public.sales_customers FOR UPDATE TO authenticated
USING (public.sales_can_access_customer(id))
WITH CHECK (public.sales_can_access_customer(id));

DROP POLICY IF EXISTS sales_customers_delete_policy ON public.sales_customers;
CREATE POLICY sales_customers_delete_policy
ON public.sales_customers FOR DELETE TO authenticated
USING (public.sales_current_role() = 'admin');

DROP POLICY IF EXISTS sales_project_members_select_policy ON public.sales_project_members;
CREATE POLICY sales_project_members_select_policy
ON public.sales_project_members FOR SELECT TO authenticated
USING (
  public.sales_current_role() IN ('admin', 'owner')
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS sales_project_members_write_policy ON public.sales_project_members;
CREATE POLICY sales_project_members_write_policy
ON public.sales_project_members FOR ALL TO authenticated
USING (public.sales_current_role() = 'admin')
WITH CHECK (public.sales_current_role() = 'admin');

DROP POLICY IF EXISTS lead_project_interests_select_policy ON public.lead_project_interests;
CREATE POLICY lead_project_interests_select_policy
ON public.lead_project_interests FOR SELECT TO authenticated
USING (public.sales_can_access_project(project_name));

DROP POLICY IF EXISTS lead_project_interests_insert_policy ON public.lead_project_interests;
CREATE POLICY lead_project_interests_insert_policy
ON public.lead_project_interests FOR INSERT TO authenticated
WITH CHECK (
  public.sales_current_role() IN ('admin', 'owner', 'sales')
  AND public.sales_can_access_project(project_name)
);

DROP POLICY IF EXISTS lead_project_interests_update_policy ON public.lead_project_interests;
CREATE POLICY lead_project_interests_update_policy
ON public.lead_project_interests FOR UPDATE TO authenticated
USING (public.sales_can_access_project(project_name))
WITH CHECK (public.sales_can_access_project(project_name));

DROP POLICY IF EXISTS lead_project_interests_delete_policy ON public.lead_project_interests;
CREATE POLICY lead_project_interests_delete_policy
ON public.lead_project_interests FOR DELETE TO authenticated
USING (public.sales_current_role() = 'admin');

DROP POLICY IF EXISTS crm_settings_select_policy ON public.crm_settings;
CREATE POLICY crm_settings_select_policy
ON public.crm_settings FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS crm_settings_write_policy ON public.crm_settings;
CREATE POLICY crm_settings_write_policy
ON public.crm_settings FOR ALL TO authenticated
USING (public.sales_current_role() = 'admin')
WITH CHECK (public.sales_current_role() = 'admin');

DROP POLICY IF EXISTS sales_reason_catalog_select_policy ON public.sales_reason_catalog;
CREATE POLICY sales_reason_catalog_select_policy
ON public.sales_reason_catalog FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS sales_reason_catalog_write_policy ON public.sales_reason_catalog;
CREATE POLICY sales_reason_catalog_write_policy
ON public.sales_reason_catalog FOR ALL TO authenticated
USING (public.sales_current_role() = 'admin')
WITH CHECK (public.sales_current_role() = 'admin');

DROP POLICY IF EXISTS lead_activities_access_policy ON public.lead_activities;
CREATE POLICY lead_activities_access_policy
ON public.lead_activities FOR ALL TO authenticated
USING (public.sales_can_access_interest(project_interest_id))
WITH CHECK (public.sales_can_access_interest(project_interest_id));

DROP POLICY IF EXISTS lead_visits_access_policy ON public.lead_visits;
CREATE POLICY lead_visits_access_policy
ON public.lead_visits FOR ALL TO authenticated
USING (public.sales_can_access_interest(project_interest_id))
WITH CHECK (public.sales_can_access_interest(project_interest_id));

DROP POLICY IF EXISTS loan_attempts_access_policy ON public.loan_attempts;
CREATE POLICY loan_attempts_access_policy
ON public.loan_attempts FOR ALL TO authenticated
USING (public.sales_can_access_interest(project_interest_id))
WITH CHECK (public.sales_can_access_interest(project_interest_id));

-- Scope the legacy compatibility tables by project as part of the cutover.
DROP POLICY IF EXISTS "Allow read access to leads" ON public.leads;
DROP POLICY IF EXISTS "Allow write access to leads" ON public.leads;
DROP POLICY IF EXISTS leads_project_select_policy ON public.leads;
CREATE POLICY leads_project_select_policy
ON public.leads FOR SELECT TO authenticated
USING (public.sales_can_access_project(project_name));

DROP POLICY IF EXISTS leads_project_write_policy ON public.leads;
CREATE POLICY leads_project_write_policy
ON public.leads FOR ALL TO authenticated
USING (
  public.sales_current_role() IN ('admin', 'owner', 'sales')
  AND public.sales_can_access_project(project_name)
)
WITH CHECK (
  public.sales_current_role() IN ('admin', 'owner', 'sales')
  AND public.sales_can_access_project(project_name)
);

DROP POLICY IF EXISTS "Allow read access to sales" ON public.sales;
DROP POLICY IF EXISTS "Allow write access to sales" ON public.sales;
DROP POLICY IF EXISTS sales_project_select_policy ON public.sales;
CREATE POLICY sales_project_select_policy
ON public.sales FOR SELECT TO authenticated
USING (
  (project_interest_id IS NOT NULL
    AND public.sales_can_access_interest(project_interest_id))
  OR (lead_id IS NOT NULL
    AND public.sales_can_access_legacy_lead(lead_id))
);

DROP POLICY IF EXISTS sales_project_write_policy ON public.sales;
CREATE POLICY sales_project_write_policy
ON public.sales FOR ALL TO authenticated
USING (
  public.sales_current_role() IN ('admin', 'owner', 'sales')
  AND (
    (project_interest_id IS NOT NULL
      AND public.sales_can_access_interest(project_interest_id))
    OR (lead_id IS NOT NULL
      AND public.sales_can_access_legacy_lead(lead_id))
  )
)
WITH CHECK (
  public.sales_current_role() IN ('admin', 'owner', 'sales')
  AND (
    (project_interest_id IS NOT NULL
      AND public.sales_can_access_interest(project_interest_id))
    OR (lead_id IS NOT NULL
      AND public.sales_can_access_legacy_lead(lead_id))
  )
);

DROP POLICY IF EXISTS "Allow read access to status_history" ON public.status_history;
DROP POLICY IF EXISTS "Allow write access to status_history" ON public.status_history;
DROP POLICY IF EXISTS status_history_project_select_policy ON public.status_history;
CREATE POLICY status_history_project_select_policy
ON public.status_history FOR SELECT TO authenticated
USING (
  (project_interest_id IS NOT NULL
    AND public.sales_can_access_interest(project_interest_id))
  OR (entity_type = 'lead'
    AND public.sales_can_access_legacy_lead(entity_id))
  OR (entity_type = 'sale'
    AND public.sales_can_access_sale(entity_id))
);

DROP POLICY IF EXISTS status_history_project_insert_policy ON public.status_history;
CREATE POLICY status_history_project_insert_policy
ON public.status_history FOR INSERT TO authenticated
WITH CHECK (
  public.sales_current_role() IN ('admin', 'owner', 'sales')
  AND (
    (project_interest_id IS NOT NULL
      AND public.sales_can_access_interest(project_interest_id))
    OR (entity_type = 'lead'
      AND public.sales_can_access_legacy_lead(entity_id))
    OR (entity_type = 'sale'
      AND public.sales_can_access_sale(entity_id))
  )
);

-- Replace the current broad Customer Voices policies with project-scoped access.
DROP POLICY IF EXISTS "Allow read access to customer_voices" ON public.customer_voices;
DROP POLICY IF EXISTS "Allow write access to customer_voices" ON public.customer_voices;
DROP POLICY IF EXISTS customer_voices_select_policy ON public.customer_voices;
CREATE POLICY customer_voices_select_policy
ON public.customer_voices FOR SELECT TO authenticated
USING (
  (visit_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.lead_visits v
    WHERE v.id = customer_voices.visit_id
      AND public.sales_can_access_interest(v.project_interest_id)
  ))
  OR (lead_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id = customer_voices.lead_id
      AND public.sales_can_access_project(l.project_name)
  ))
);

DROP POLICY IF EXISTS customer_voices_write_policy ON public.customer_voices;
CREATE POLICY customer_voices_write_policy
ON public.customer_voices FOR ALL TO authenticated
USING (
  visit_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.lead_visits v
    WHERE v.id = customer_voices.visit_id
      AND public.sales_can_access_interest(v.project_interest_id)
  )
)
WITH CHECK (
  visit_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.lead_visits v
    WHERE v.id = customer_voices.visit_id
      AND public.sales_can_access_interest(v.project_interest_id)
  )
);

-- No anonymous SELECT/INSERT policy is created. QR writes only through the RPC.

COMMIT;

-- =============================================================================
-- Intentionally not included in this draft:
--   - Running any statement on Supabase
--   - Legacy Lead deduplication/backfill
--   - Populating Sales-to-project assignments
--   - Dropping legacy columns
--   - Discount approval/confirmation workflow
-- =============================================================================
