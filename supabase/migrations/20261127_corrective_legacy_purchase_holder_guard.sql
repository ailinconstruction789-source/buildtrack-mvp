-- ==============================================================================
-- BUILDTRACK CORRECTIVE MIGRATION: LEGACY PURCHASE HOLDER GUARD,
-- CANONICAL PLOT SCOPE & ENDED-HISTORY VERIFICATION FOR LEGACY RELEASE
-- ==============================================================================
-- Corrective migration layered on top of already-applied migrations:
--   - 20261125_rental_purchase_plot_ownership_transactions.sql
--   - 20261126_legacy_plot_release_rpc.sql
-- Do NOT edit previously applied migrations; apply this corrective migration next.
--
-- Fixes & guarantees:
-- 1. Counts legacy purchase leads (Reserved/Booked/Contracted/LoanProcessing/
--    Approved/Transferred/Handover or non-terminal ConvertedToBuy) WITHOUT a
--    sales row as active plot holders in sales_private.plot_has_active_holder().
-- 2. Strictly excludes inquiry/pre-booking leads (New, Active, Follow Up,
--    Contacted, Interested, Visit, Appointment, Negotiation, Survey, Loan) and
--    terminal leads (Cancelled, Lost, MovedOut, Expired) so they NEVER create
--    artificial purchase claims.
-- 3. Enforces canonical plot ID + project scope: legacy bare plot_name matches
--    or missing/mismatched project_name references for active holders fail closed
--    (blocked from release, never guessed).
-- 4. Verifies live ended/vacating deal history INSIDE the release transaction
--    (MovedOut/Cancelled contract, Cancelled sale, or ended/cancelled lead;
--    ConvertedToBuy is NOT vacating history). Never relies on a stale dry-run.
-- 5. Tightens permit verification (plot_stock_permit_allowed &
--    guard_plot_stock_integrity) so every stock write permit is bound to its
--    exact plot_id, actor, command, and live DB occupancy evidence.
-- 6. Zero DISABLE TRIGGER, zero RLS bypass, zero blanket reset.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Shared lead-classification & ownership helpers in sales_private
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.normalize_compact_status(p_val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT regexp_replace(lower(btrim(COALESCE(p_val, ''))), '[\s_-]+', '', 'g');
$fn$;
REVOKE ALL ON FUNCTION sales_private.normalize_compact_status(text) FROM PUBLIC, anon, authenticated;

-- Detects contradictory structured purchase/rental fields on a lead (fail closed)
CREATE OR REPLACE FUNCTION sales_private.lead_has_deal_conflict(p_lead public.leads)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_deal_type text := lower(btrim(COALESCE(p_lead.deal_type, '')));
  v_status text := sales_private.normalize_compact_status(p_lead.status);
  v_rental text := sales_private.normalize_compact_status(p_lead.rental_status);
  v_has_contract boolean := NULLIF(btrim(COALESCE(p_lead.active_rental_contract_id::text, '')), '') IS NOT NULL;
  v_is_purchase_prog boolean := v_status IN (
    'contracted', 'downpayment', 'documentprep', 'loanprocessing',
    'loansubmitted', 'loanrejected', 'approved', 'transferpending',
    'transferred', 'handover', 'closedwon'
  );
  v_is_terminal boolean := v_status IN (
    'lost', 'cancelled', 'canceled', 'closedlost', 'dropped',
    'unqualified', 'movedout', 'expired', 'terminated', 'nurture', 'cold', 'rejected'
  );
BEGIN
  IF p_lead.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_deal_type = 'buy' AND (v_rental IN ('active', 'renewed', 'pendingcontract') OR v_status = 'rented') THEN
    RETURN true;
  END IF;

  IF v_deal_type IN ('rent', 'rent_to_own') AND v_rental <> 'convertedtobuy' AND v_is_purchase_prog THEN
    RETURN true;
  END IF;

  IF v_rental = 'pendingcontract' AND (v_status = 'rented' OR v_is_purchase_prog OR v_is_terminal OR v_has_contract) THEN
    RETURN true;
  END IF;

  IF v_rental IN ('active', 'renewed') AND (v_is_terminal OR v_is_purchase_prog) THEN
    RETURN true;
  END IF;

  IF v_status = 'rented' AND v_rental IN ('movedout', 'cancelled', 'canceled', 'expired', 'terminated', 'ended', 'convertedtobuy') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.lead_has_deal_conflict(public.leads) FROM PUBLIC, anon, authenticated;

-- Active or pending rental lead holder (matches dealClassification.ts)
CREATE OR REPLACE FUNCTION sales_private.lead_is_active_or_pending_rental_holder(p_lead public.leads)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_deal_type text := lower(btrim(COALESCE(p_lead.deal_type, '')));
  v_status text := sales_private.normalize_compact_status(p_lead.status);
  v_rental text := sales_private.normalize_compact_status(p_lead.rental_status);
  v_crm text := lower(btrim(COALESCE(p_lead.crm_status, '')));
  v_has_contract boolean := NULLIF(btrim(COALESCE(p_lead.active_rental_contract_id::text, '')), '') IS NOT NULL;
  v_is_terminal boolean := v_status IN (
    'lost', 'cancelled', 'canceled', 'closedlost', 'dropped',
    'unqualified', 'movedout', 'expired', 'terminated', 'nurture', 'cold', 'rejected'
  );
  v_is_rental_ended boolean := v_rental IN ('movedout', 'cancelled', 'canceled', 'expired', 'terminated', 'ended');
  v_is_purchase_prog boolean := v_status IN (
    'contracted', 'downpayment', 'documentprep', 'loanprocessing',
    'loansubmitted', 'loanrejected', 'approved', 'transferpending',
    'transferred', 'handover', 'closedwon'
  );
BEGIN
  IF p_lead.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_rental = 'convertedtobuy' AND v_status <> 'rented' THEN
    RETURN false;
  END IF;

  IF v_is_rental_ended OR v_status = 'movedout' OR (v_deal_type IN ('rent', 'rent_to_own') AND v_is_terminal) THEN
    RETURN false;
  END IF;

  IF v_rental IN ('pendingcontract', 'active', 'renewed') OR v_status = 'rented' THEN
    RETURN true;
  END IF;

  IF v_has_contract AND NOT v_is_terminal AND NOT v_is_purchase_prog THEN
    RETURN true;
  END IF;

  IF v_deal_type IN ('rent', 'rent_to_own')
     AND NOT v_is_terminal
     AND NOT v_is_rental_ended
     AND (
       v_status IN ('reserved', 'booked', 'จองเช่า')
       OR p_lead.booking_date IS NOT NULL
       OR p_lead.booking_amount IS NOT NULL
       OR v_crm ~ 'pending[_ -]?contract|จองเช่า|รอทำสัญญา'
     ) THEN
    RETURN true;
  END IF;

  IF v_deal_type <> 'buy'
     AND v_rental = ''
     AND NOT v_is_terminal
     AND NOT v_is_purchase_prog
     AND (v_status = 'จองเช่า' OR v_crm ~ 'pending[_ -]?contract|จองเช่า|รอทำสัญญาเช่า') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.lead_is_active_or_pending_rental_holder(public.leads) FROM PUBLIC, anon, authenticated;

-- Legacy purchase lead holder WITHOUT requiring a public.sales row.
-- Covers committed purchase bookings/progression (Reserved, Booked, Contracted,
-- DownPayment, DocumentPrep, LoanProcessing, LoanSubmitted, LoanRejected,
-- Approved, TransferPending, Transferred, Handover, ClosedWon, and non-terminal
-- ConvertedToBuy), while strictly excluding pre-booking/inquiry stages
-- (New, Active, Follow Up, Contacted, Interested, Visit, Appointment,
-- Negotiation, Survey, Loan) and terminal/ended stages.
CREATE OR REPLACE FUNCTION sales_private.lead_is_legacy_purchase_holder(p_lead public.leads)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_deal_type text := lower(btrim(COALESCE(p_lead.deal_type, '')));
  v_status text := sales_private.normalize_compact_status(p_lead.status);
  v_rental text := sales_private.normalize_compact_status(p_lead.rental_status);
  v_crm text := lower(btrim(COALESCE(p_lead.crm_status, '')));
  v_is_terminal boolean := v_status IN (
    'lost', 'cancelled', 'canceled', 'closedlost', 'dropped',
    'unqualified', 'movedout', 'expired', 'terminated', 'nurture', 'cold', 'rejected'
  );
  v_is_pre_booking boolean := v_status IN (
    'new', 'newlead', 'active', 'followup', 'contacted',
    'interested', 'visit', 'appointment', 'negotiation', 'survey', 'loan'
  );
  v_is_committed_purchase boolean := v_status IN (
    'reserved', 'booked', 'contracted', 'downpayment', 'documentprep',
    'loanprocessing', 'loansubmitted', 'loanrejected', 'approved',
    'transferpending', 'transferred', 'handover', 'closedwon'
  );
  v_crm_terminal boolean := v_crm ~ '(^|\y)(lost|cancelled|canceled|closed_lost|dropped|unqualified|movedout|expired|terminated)(\y|$)|ยกเลิก|ไม่สนใจ|ยุติการซื้อ|ยุติการติดตาม|สิ้นสุดสัญญา|ย้ายออก';
  v_crm_rental boolean := v_crm ~ 'pending[_ -]?contract|จองเช่า|รอทำสัญญาเช่า|ทำสัญญาเช่าแล้ว|อยู่ระหว่างเช่า|\yrented\y';
  v_crm_committed_purchase boolean := v_crm ~ '(^|\y)(reserved|booked|contracted|downpayment|transfer_pending|transferred|handover)(\y|$)|วางเงินจอง|จองแล้ว|ทำสัญญาแล้ว|โอนกรรมสิทธิ์|โอนแล้ว';
BEGIN
  IF p_lead.id IS NULL THEN
    RETURN false;
  END IF;

  -- Never double-count conflicting or rental leads as pure purchase holders
  -- (conflicts and rental leads are blocked separately by their own checks)
  IF sales_private.lead_has_deal_conflict(p_lead)
     OR sales_private.lead_is_active_or_pending_rental_holder(p_lead) THEN
    RETURN false;
  END IF;

  -- Terminal / ended leads NEVER hold purchase rights
  IF v_is_terminal THEN
    RETURN false;
  END IF;

  -- Ended rental leads NEVER hold purchase rights
  IF v_rental IN ('movedout', 'cancelled', 'canceled', 'expired', 'terminated', 'ended') THEN
    RETURN false;
  END IF;

  -- Pure rental deal_type (not ConvertedToBuy) is not a purchase holder
  IF v_deal_type IN ('rent', 'rent_to_own') AND v_rental <> 'convertedtobuy' THEN
    RETURN false;
  END IF;

  -- ConvertedToBuy lead that is not terminal holds purchase rights
  IF v_rental = 'convertedtobuy' THEN
    RETURN true;
  END IF;

  -- Explicit inquiry / pre-booking statuses (New, Follow Up, Appointment, Visit, etc.)
  -- NEVER create an artificial purchase booking claim
  IF v_is_pre_booking THEN
    RETURN false;
  END IF;

  -- Explicit committed purchase booking/progression statuses
  IF v_is_committed_purchase THEN
    RETURN true;
  END IF;

  -- Legacy row with blank structured status: honor explicit non-terminal, non-rental purchase CRM status only
  IF v_status = '' AND v_crm_committed_purchase AND NOT v_crm_terminal AND NOT v_crm_rental THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.lead_is_legacy_purchase_holder(public.leads) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Ambiguous legacy reference & ended-history checks (canonical plot + project)
-- ------------------------------------------------------------------------------
-- Returns true if an active purchase/rental/conflicting lead references this plot
-- ambiguously (by bare plot_name instead of canonical plot.id, with missing
-- project_name, or with mismatched project_name on canonical plot.id).
CREATE OR REPLACE FUNCTION sales_private.plot_has_ambiguous_legacy_reference(p_plot public.plots)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_plot_id text := btrim(COALESCE(p_plot.id, ''));
  v_plot_name text := NULLIF(btrim(COALESCE(p_plot.plot_name, '')), '');
  v_project text := NULLIF(btrim(COALESCE(p_plot.project_name, '')), '');
BEGIN
  IF v_plot_id = '' THEN
    RETURN true;
  END IF;

  IF v_project IS NULL THEN
    RETURN true;
  END IF;

  -- Check leads referencing this plot ambiguously (never guess and release!)
  IF EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE (
      sales_private.lead_is_legacy_purchase_holder(l)
      OR sales_private.lead_is_active_or_pending_rental_holder(l)
      OR sales_private.lead_has_deal_conflict(l)
    )
    AND (
      -- Case A: Canonical plot ID matches, but lead explicitly belongs to a DIFFERENT project
      (
        btrim(COALESCE(l.interested_plot_id, '')) = v_plot_id
        AND NULLIF(btrim(COALESCE(l.project_name, '')), '') IS NOT NULL
        AND btrim(l.project_name) <> v_project
      )
      -- Case B: Same project, but lead only references bare plot_name (not canonical plot.id)
      OR (
        v_plot_name IS NOT NULL
        AND btrim(COALESCE(l.interested_plot_id, '')) <> v_plot_id
        AND btrim(COALESCE(l.project_name, '')) = v_project
        AND (
          btrim(COALESCE(l.interested_plot_id, '')) = v_plot_name
          OR btrim(COALESCE(l.interested_plot_name, '')) = v_plot_name
        )
      )
      -- Case C: Lead has missing project_name and matches either plot.id or plot.plot_name
      OR (
        NULLIF(btrim(COALESCE(l.project_name, '')), '') IS NULL
        AND (
          btrim(COALESCE(l.interested_plot_id, '')) = v_plot_id
          OR (v_plot_name IS NOT NULL AND btrim(COALESCE(l.interested_plot_id, '')) = v_plot_name)
          OR (v_plot_name IS NOT NULL AND btrim(COALESCE(l.interested_plot_name, '')) = v_plot_name)
        )
      )
    )
  ) THEN
    RETURN true;
  END IF;

  -- Check rental_contracts with canonical plot_id but mismatched non-empty project_name
  IF EXISTS (
    SELECT 1
    FROM public.rental_contracts rc
    WHERE rc.plot_id = v_plot_id
      AND NULLIF(btrim(COALESCE(rc.project_name, '')), '') IS NOT NULL
      AND btrim(rc.project_name) <> v_project
      AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_has_ambiguous_legacy_reference(public.plots) FROM PUBLIC, anon, authenticated;

-- Verifies that REAL vacating/ended deal history exists in DB for this canonical plot.
-- Note: ConvertedToBuy is NOT vacating history because the customer converted to purchase.
CREATE OR REPLACE FUNCTION sales_private.plot_has_ended_deal_history(p_plot public.plots)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_plot_id text := btrim(COALESCE(p_plot.id, ''));
  v_project text := NULLIF(btrim(COALESCE(p_plot.project_name, '')), '');
BEGIN
  IF v_plot_id = '' THEN
    RETURN false;
  END IF;

  -- 1. Ended/cancelled rental contract (MovedOut or Cancelled only; NOT ConvertedToBuy)
  IF EXISTS (
    SELECT 1
    FROM public.rental_contracts rc
    WHERE rc.plot_id = v_plot_id
      AND btrim(COALESCE(rc.status, '')) IN ('MovedOut', 'Cancelled')
      AND (
        v_project IS NULL
        OR NULLIF(btrim(COALESCE(rc.project_name, '')), '') IS NULL
        OR btrim(rc.project_name) = v_project
      )
  ) THEN
    RETURN true;
  END IF;

  -- 2. Cancelled purchase sale
  IF EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.plot_id = v_plot_id
      AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), '') = 'cancelled'
  ) THEN
    RETURN true;
  END IF;

  -- 3. Canonically linked ended/cancelled/moved-out lead in matching project scope
  IF EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE btrim(COALESCE(l.interested_plot_id, '')) = v_plot_id
      AND (
        v_project IS NULL
        OR NULLIF(btrim(COALESCE(l.project_name, '')), '') IS NULL
        OR btrim(l.project_name) = v_project
      )
      AND (
        sales_private.normalize_compact_status(l.status) IN ('cancelled', 'canceled', 'movedout')
        OR sales_private.normalize_compact_status(l.rental_status) IN ('cancelled', 'canceled', 'movedout', 'expired')
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_has_ended_deal_history(public.plots) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. Update sales_private.plot_has_active_holder(text) to cover legacy purchase
--    leads (without sales row), conflicts, and ambiguous legacy references
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.plot_has_active_holder(p_plot_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_has_v2_rental boolean := false;
  v_plot public.plots%ROWTYPE;
BEGIN
  IF p_plot_id IS NULL OR btrim(p_plot_id) = '' THEN
    RETURN false;
  END IF;

  -- 1. Active purchase sale
  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.plot_id = p_plot_id
      AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
  ) THEN
    RETURN true;
  END IF;

  -- 2. PendingContract, Active, Renewed, or unknown legacy rental contract
  IF EXISTS (
    SELECT 1 FROM public.rental_contracts rc
    WHERE rc.plot_id = p_plot_id
      AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
  ) THEN
    RETURN true;
  END IF;

  -- 3. Canonical V2 sales_private.rental_contracts if present
  IF to_regclass('sales_private.rental_contracts') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM sales_private.rental_contracts
        WHERE plot_id = $1 AND status IN ('active', 'renewed', 'pending_contract')
      )
    $q$ INTO v_has_v2_rental USING p_plot_id;
    IF v_has_v2_rental THEN
      RETURN true;
    END IF;
  END IF;

  -- Load plot row for canonical project-scoped lead & ambiguity checks
  SELECT * INTO v_plot FROM public.plots WHERE id = p_plot_id;

  -- 4. Canonically linked active/pending rental lead, legacy purchase lead
  --    (Reserved/Booked/Contracted/etc. without a sales row), or conflicting lead
  IF EXISTS (
    SELECT 1 FROM public.leads l
    WHERE btrim(COALESCE(l.interested_plot_id, '')) = btrim(p_plot_id)
      AND (
        v_plot.id IS NULL
        OR NULLIF(btrim(COALESCE(l.project_name, '')), '') IS NULL
        OR NULLIF(btrim(COALESCE(v_plot.project_name, '')), '') IS NULL
        OR btrim(l.project_name) = btrim(v_plot.project_name)
      )
      AND (
        sales_private.lead_is_active_or_pending_rental_holder(l)
        OR sales_private.lead_is_legacy_purchase_holder(l)
        OR sales_private.lead_has_deal_conflict(l)
      )
  ) THEN
    RETURN true;
  END IF;

  -- 5. Ambiguous legacy reference (bare plot_name in same project, missing/mismatched project_name)
  --    Fail closed: NEVER treat an ambiguously referenced plot as holder-free!
  IF v_plot.id IS NOT NULL AND sales_private.plot_has_ambiguous_legacy_reference(v_plot) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_has_active_holder(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Tighten permit validation & stock-guard scope
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.plot_stock_permit_allowed(p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_permit sales_private.plot_stock_write_permits%ROWTYPE;
  v_plot_id text := p_new ->> 'id';
  v_new_has_customer boolean := (p_new ->> 'has_customer')::boolean;
  v_new_sale_status text := p_new ->> 'sale_status';
  v_old_sale_status text := lower(btrim(COALESCE(p_old ->> 'sale_status', '')));
  v_expected_occupied boolean;
  v_plot public.plots%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_plot_id IS NULL THEN
    RETURN false;
  END IF;

  IF (p_old ->> 'id') IS DISTINCT FROM v_plot_id
     OR (p_old ->> 'project_name') IS DISTINCT FROM (p_new ->> 'project_name') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_permit
  FROM sales_private.plot_stock_write_permits
  WHERE transaction_id = txid_current()
    AND backend_pid = pg_backend_pid()
    AND plot_id = v_plot_id;

  IF NOT FOUND OR v_permit.actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  IF v_new_has_customer IS DISTINCT FROM v_permit.expected_has_customer THEN
    RETURN false;
  END IF;

  IF v_permit.expected_sale_status IS NOT NULL
     AND v_new_sale_status IS DISTINCT FROM v_permit.expected_sale_status THEN
    RETURN false;
  END IF;

  -- Real database occupancy evidence (including legacy purchase leads & ambiguity checks)
  -- MUST match the requested stock flag
  v_expected_occupied := sales_private.plot_has_active_holder(v_plot_id);
  IF v_new_has_customer IS DISTINCT FROM v_expected_occupied THEN
    RETURN false;
  END IF;

  -- Extra command-specific invariants for legacy_plot_release permits
  IF v_permit.command = 'legacy_plot_release' THEN
    IF v_new_has_customer IS DISTINCT FROM false THEN
      RETURN false;
    END IF;
    IF v_old_sale_status IN ('transferred', 'sold', 'handover') THEN
      RETURN false;
    END IF;
    SELECT * INTO v_plot FROM public.plots WHERE id = v_plot_id;
    IF NOT FOUND OR NOT sales_private.plot_has_ended_deal_history(v_plot) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_stock_permit_allowed(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Tighten guard_plot_stock_integrity so external booking_writer_permits is ALSO
-- scoped strictly to NEW.id + exact live occupancy evidence (never a blanket pass).
CREATE OR REPLACE FUNCTION sales_private.guard_plot_stock_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_ext_permit_valid boolean := false;
BEGIN
  -- Construction pause/resume toggle (active <-> ready_for_sale) with unchanged occupancy stays allowed
  IF TG_OP = 'UPDATE'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
     AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
     AND COALESCE(OLD.sale_status, '') IN ('', 'active', 'ready_for_sale')
     AND NEW.sale_status IN ('active', 'ready_for_sale') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
     AND NEW.sale_status IS NOT DISTINCT FROM OLD.sale_status THEN
    RETURN NEW;
  END IF;

  -- Never allow clearing has_customer to false while ANY active purchase/rental/legacy holder exists
  IF TG_OP = 'UPDATE' AND NEW.has_customer IS NOT TRUE AND sales_private.plot_has_active_holder(NEW.id) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_CANNOT_RELEASE';
  END IF;

  -- If Phase 2/3 transactional command permit is active, verify exact permit + live DB evidence
  IF TG_OP = 'UPDATE' AND sales_private.plot_stock_permit_allowed(to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  -- If external booking writer permit is active (V2 booking path), verify it is scoped
  -- strictly to THIS exact plot_id, actor, unchanged sale_status, and live occupancy evidence!
  IF TG_OP = 'UPDATE' AND to_regclass('crm_external_private.booking_writer_permits') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1
        FROM crm_external_private.booking_writer_permits p
        JOIN public.sales s
          ON s.id = p.sale_id
         AND s.project_interest_id = p.interest_id
         AND s.plot_id = $1
        WHERE p.transaction_id = txid_current()
          AND p.backend_pid = pg_backend_pid()
          AND p.actor_id = auth.uid()
      )
    $q$ INTO v_ext_permit_valid USING NEW.id;

    IF v_ext_permit_valid
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
       AND NEW.sale_status IS NOT DISTINCT FROM OLD.sale_status
       AND NEW.has_customer IS NOT DISTINCT FROM sales_private.plot_has_active_holder(NEW.id) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Block unauthorized direct writes to stock columns from authenticated/anon clients
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.guard_plot_stock_integrity() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Harden public.sales_tx_release_legacy_plot with:
--    - Canonical plot ID + exact project scope (NO bare plot_name guessing)
--    - Consistent lock order matching booking commands
--    - Live in-transaction verification of active/legacy purchase holders,
--      ambiguous references, AND verified ended deal history (never trusts stale dry-run)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_tx_release_legacy_plot(
  p_request_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor record;
  v_req sales_private.rental_tx_requests%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_project_name text;
  v_plot_key text;
  v_expected_has_customer boolean;
  v_expected_sale_status text;
  v_reason text;
  v_lead_id uuid;
  v_plot public.plots%ROWTYPE;
  v_current_status text;
  v_target_status text := 'ready_for_sale';
  v_has_legacy_data boolean := false;
  v_plot_released boolean := false;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();
  IF v_actor.actor_role <> 'admin' THEN
    RAISE EXCEPTION 'SALES_TX_FORBIDDEN';
  END IF;

  v_project_name := NULLIF(btrim(COALESCE(p_payload ->> 'projectName', '')), '');
  v_plot_key := NULLIF(btrim(COALESCE(p_payload ->> 'plotId', '')), '');
  v_reason := NULLIF(btrim(COALESCE(p_payload ->> 'reason', '')), '');
  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;

  IF NOT (p_payload ? 'expectedHasCustomer')
     OR jsonb_typeof(p_payload -> 'expectedHasCustomer') <> 'boolean' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;
  v_expected_has_customer := (p_payload ->> 'expectedHasCustomer')::boolean;
  v_expected_sale_status := lower(btrim(COALESCE(p_payload ->> 'expectedSaleStatus', '')));

  IF v_project_name IS NULL OR v_plot_key IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  -- Canonical shared lock order matching crm_v2_booking_command & Phase 2 RPCs:
  -- 1) advisory lock -> 2) projects (FOR SHARE) -> 3) plots (FOR UPDATE)
  -- -> 4) leads (FOR UPDATE) -> 5) rental_contracts (FOR UPDATE) -> 6) sales (FOR UPDATE)
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'legacy_plot_release' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  PERFORM 1 FROM public.projects WHERE name = v_project_name FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_PROJECT_UNAVAILABLE';
  END IF;

  -- Strict canonical plot ID match within exact project scope (NEVER guess by plot_name!)
  SELECT * INTO v_plot
  FROM public.plots
  WHERE id = v_plot_key
    AND project_name = v_project_name
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.plots
      WHERE plot_name = v_plot_key AND project_name = v_project_name
    ) OR EXISTS (
      SELECT 1 FROM public.plots
      WHERE id = v_plot_key
    ) THEN
      RAISE EXCEPTION 'SALES_TX_AMBIGUOUS_PLOT';
    END IF;
    RAISE EXCEPTION 'SALES_TX_PLOT_NOT_FOUND';
  END IF;

  -- Lock ALL related ownership rows deterministically in canonical order
  PERFORM 1
  FROM public.leads l
  WHERE btrim(COALESCE(l.interested_plot_id, '')) = v_plot.id
     OR (
       NULLIF(btrim(COALESCE(v_plot.plot_name, '')), '') IS NOT NULL
       AND (
         btrim(COALESCE(l.interested_plot_id, '')) = btrim(v_plot.plot_name)
         OR btrim(COALESCE(l.interested_plot_name, '')) = btrim(v_plot.plot_name)
       )
       AND (
         NULLIF(btrim(COALESCE(l.project_name, '')), '') IS NULL
         OR btrim(l.project_name) = v_project_name
       )
     )
  ORDER BY l.id
  FOR UPDATE;

  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;

  v_current_status := lower(btrim(COALESCE(v_plot.sale_status, '')));

  -- Never release transferred / sold / handed-over plots
  IF v_current_status IN ('transferred', 'sold', 'handover') THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;

  -- Optimistic concurrency check against caller's expected snapshot
  IF COALESCE(v_plot.has_customer, false) IS DISTINCT FROM v_expected_has_customer
     OR v_current_status IS DISTINCT FROM v_expected_sale_status THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  -- Reject ambiguous legacy references (bare plot_name or missing/mismatched project scope)
  IF sales_private.plot_has_ambiguous_legacy_reference(v_plot) THEN
    RAISE EXCEPTION 'SALES_TX_AMBIGUOUS_PLOT';
  END IF;

  -- Absolute live ownership guard: NEVER release a plot with ANY active purchase sale,
  -- legacy purchase Reserved/Booked/etc. lead without a sales row, PendingContract/Active/
  -- Renewed/unknown rental contract, active/pending rental lead, or conflicting lead!
  IF sales_private.plot_has_active_holder(v_plot.id) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER';
  END IF;

  v_has_legacy_data := (
    COALESCE(v_plot.has_customer, false) IS TRUE
    OR v_current_status NOT IN ('', 'active', 'normal', 'ready_for_sale', 'available', 'vacant')
    OR NULLIF(btrim(COALESCE(v_plot.current_tenant_name, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(v_plot.current_tenant_phone, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(v_plot.rental_program, '')), '') IS NOT NULL
    OR v_plot.monthly_rent IS NOT NULL
    OR v_plot.security_deposit IS NOT NULL
    OR v_plot.lease_start_date IS NOT NULL
    OR v_plot.lease_end_date IS NOT NULL
    OR btrim(COALESCE(v_plot.highlight_note, '')) LIKE 'จองเช่า:%'
    OR btrim(COALESCE(v_plot.highlight_note, '')) LIKE 'เช่า:%'
  );

  IF v_has_legacy_data THEN
    -- Live in-transaction verification of ended/vacating deal history:
    -- NEVER rely on an external dry-run as authorization!
    IF NOT sales_private.plot_has_ended_deal_history(v_plot) THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;

    INSERT INTO sales_private.plot_stock_write_permits (
      transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
    ) VALUES (
      txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'legacy_plot_release', false, v_target_status
    );

    UPDATE public.plots
    SET has_customer = false,
        sale_status = v_target_status,
        current_tenant_name = NULL,
        current_tenant_phone = NULL,
        rental_program = NULL,
        monthly_rent = NULL,
        security_deposit = NULL,
        lease_start_date = NULL,
        lease_end_date = NULL,
        highlight_note = CASE
          WHEN btrim(COALESCE(highlight_note, '')) LIKE 'จองเช่า:%'
            OR btrim(COALESCE(highlight_note, '')) LIKE 'เช่า:%'
            OR btrim(COALESCE(highlight_note, '')) LIKE 'จอง:%'
            OR btrim(COALESCE(highlight_note, '')) LIKE 'จองซื้อ%'
          THEN NULL
          ELSE highlight_note
        END
    WHERE id = v_plot.id;

    DELETE FROM sales_private.plot_stock_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

    v_plot_released := true;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
    VALUES (
      'lead',
      v_lead_id,
      COALESCE(v_plot.sale_status, 'legacy'),
      v_target_status,
      'คืนแปลง Legacy (' || v_actor.actor_label || ') แปลง ' || COALESCE(v_plot.plot_name, v_plot.id) || ': ' || v_reason,
      v_now
    );
  END IF;

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'legacy_plot_release',
    'plotId', v_plot.id,
    'projectName', v_project_name,
    'previousSaleStatus', v_plot.sale_status,
    'previousHasCustomer', COALESCE(v_plot.has_customer, false),
    'plotReleased', v_plot_released,
    'alreadyVacant', NOT v_has_legacy_data,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'legacy_plot_release', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sales_tx_release_legacy_plot(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_release_legacy_plot(uuid, jsonb) TO authenticated;

COMMIT;
