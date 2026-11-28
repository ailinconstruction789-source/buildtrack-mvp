-- ==============================================================================
-- BUILDTRACK CORRECTIVE MIGRATION (ISSUE 2):
-- TRANSACTIONAL PERMIT ORDERING, INTERMEDIATE SYNC SUPPORT, GUARD CONSUMPTION
-- OF sale_tx_write_permits, AND PRESERVATION OF DEPLOYED RECOVERY/REVISION/
-- RETIREMENT/NATIVE-SIDEBAR PERMISSION PATHS
-- ==============================================================================
-- Corrective migration layered on top of:
--   - 20261125_rental_purchase_plot_ownership_transactions.sql
--   - 20261126_legacy_plot_release_rpc.sql
--   - 20261127_corrective_legacy_purchase_holder_guard.sql
--
-- Fixes & guarantees:
-- 1. Preflight inspects any deployed crm_external_private.guard_cutover_sale()
--    and crm_external_private.guard_booking_plot_stock() definitions and ABORTS
--    explicitly if any unrecognized *_private.* hook exists (never overwrites
--    an unknown deployed guard by guessing).
-- 2. Restores & preserves ALL verified permission paths across both
--    crm_external_private.guard_booking_plot_stock(),
--    sales_private.guard_plot_stock_integrity(), and
--    crm_external_private.guard_cutover_sale():
--      - sales_recovery_private.{stock_allowed,row_allowed}
--      - rental_source_retirement_private.{plot_allowed,sale_allowed}
--      - sales_revision_private.{plot_allowed,allowed}
--      - native sidebar compatibility (when crm_settings canonical flags are off)
--      - crm_post_booking_external_sale_allowed / booking_sale_allowed / booking_writer_permits
--      - sales_cutover_permits / sales_cutover_receipts / sales_rollback_receipts
-- 3. crm_external_private.guard_cutover_sale() and sales_private.guard_sale_plot_exclusivity()
--    now actively CONSUME sales_private.sale_tx_permit_allowed(), enforcing
--    exact (txid, pid, actor, sale_id, plot_id, lead_id, op, contract_status,
--    crm_stage) and rejecting imported/V2 identity mutations.
-- 4. sales_tx_book_purchase, ensure_lead_sale_record, and sales_tx_convert_rental_to_buy
--    issue scoped sale_tx_write_permits AND plot_stock_write_permits BEFORE
--    sales DML so AFTER trigger public.sync_plot_customer_status() succeeds
--    within a tightly bounded intermediate state (no wildcard permit, no
--    DISABLE TRIGGER, no RLS bypass).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Preflight check: Refuse to overwrite unknown deployed private guard hooks
-- ------------------------------------------------------------------------------
DO $preflight_guard_hooks$
DECLARE
  v_def text;
  v_hook text;
  v_known_sale_hooks text[] := ARRAY[
    'sales_recovery_private.row_allowed',
    'rental_source_retirement_private.sale_allowed',
    'sales_revision_private.allowed',
    'sales_private.crm_post_booking_external_sale_allowed',
    'sales_private.sale_tx_permit_allowed',
    'crm_external_private.booking_sale_allowed',
    'crm_external_private.guard_cutover_sale',
    'crm_external_private.sales_cutover_permits',
    'crm_external_private.sales_cutover_receipts',
    'crm_external_private.sales_rollback_receipts',
    'crm_external_private.prepared_booking_sales'
  ];
  v_known_stock_hooks text[] := ARRAY[
    'sales_recovery_private.stock_allowed',
    'rental_source_retirement_private.plot_allowed',
    'sales_revision_private.plot_allowed',
    'sales_private.plot_stock_permit_allowed',
    'sales_private.plot_has_active_holder',
    'crm_external_private.guard_booking_plot_stock',
    'crm_external_private.booking_writer_releases',
    'crm_external_private.booking_writer_permits'
  ];
BEGIN
  IF to_regprocedure('crm_external_private.guard_cutover_sale()') IS NOT NULL THEN
    v_def := pg_get_functiondef('crm_external_private.guard_cutover_sale()'::regprocedure);
    FOR v_hook IN
      SELECT DISTINCT lower(m[1])
      FROM regexp_matches(v_def, '([a-z0-9_]+_private\.[a-z0-9_]+)', 'gi') AS m
    LOOP
      IF NOT (v_hook = ANY(v_known_sale_hooks)) THEN
        RAISE EXCEPTION 'SALES_GUARD_INTEROP_UNKNOWN_DEPLOYED_HOOK: guard_cutover_sale references %', v_hook;
      END IF;
    END LOOP;
  END IF;

  IF to_regprocedure('crm_external_private.guard_booking_plot_stock()') IS NOT NULL THEN
    v_def := pg_get_functiondef('crm_external_private.guard_booking_plot_stock()'::regprocedure);
    FOR v_hook IN
      SELECT DISTINCT lower(m[1])
      FROM regexp_matches(v_def, '([a-z0-9_]+_private\.[a-z0-9_]+)', 'gi') AS m
    LOOP
      IF NOT (v_hook = ANY(v_known_stock_hooks)) THEN
        RAISE EXCEPTION 'SALES_GUARD_INTEROP_UNKNOWN_DEPLOYED_HOOK: guard_booking_plot_stock references %', v_hook;
      END IF;
    END LOOP;
  END IF;
END;
$preflight_guard_hooks$;

-- ------------------------------------------------------------------------------
-- 2. Additive scoped columns on private permit tables
-- ------------------------------------------------------------------------------
ALTER TABLE sales_private.plot_stock_write_permits
  ADD COLUMN IF NOT EXISTS allowed_intermediate_sale_status text;

ALTER TABLE sales_private.sale_tx_write_permits
  ADD COLUMN IF NOT EXISTS expected_op text,
  ADD COLUMN IF NOT EXISTS expected_contract_status text,
  ADD COLUMN IF NOT EXISTS expected_crm_stage text;

-- ------------------------------------------------------------------------------
-- 3. Refine plot_has_active_holder(text) so a sale JUST cancelled for its own
--    lead (s.updated_at >= l.updated_at) does not falsely trap sync_plot_customer_status
--    mid-cancel before the caller updates leads.status = 'Cancelled', while ALWAYS
--    protecting legacy purchase Reserved/Booked leads that have NO sales row (or
--    were re-booked after an older cancelled sale).
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

  SELECT * INTO v_plot FROM public.plots WHERE id = p_plot_id;

  -- 4. Canonically linked active/pending rental lead, legacy purchase lead
  --    (without a newer cancelled sale for the same lead+plot), or conflicting lead
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
        OR sales_private.lead_has_deal_conflict(l)
        OR (
          sales_private.lead_is_legacy_purchase_holder(l)
          AND NOT EXISTS (
            SELECT 1 FROM public.sales s
            WHERE s.lead_id = l.id
              AND s.plot_id = p_plot_id
              AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), '') = 'cancelled'
              AND COALESCE(s.updated_at, s.created_at) >= COALESCE(l.updated_at, l.created_at, s.created_at)
          )
        )
      )
  ) THEN
    RETURN true;
  END IF;

  -- 5. Ambiguous legacy reference (bare plot_name in same project, missing/mismatched project_name)
  IF v_plot.id IS NOT NULL AND sales_private.plot_has_ambiguous_legacy_reference(v_plot) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_has_active_holder(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Strictly scoped permit validators (intermediate + final state; NO wildcards)
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
  v_old_sale_status text := p_old ->> 'sale_status';
  v_old_sale_status_lower text := lower(btrim(COALESCE(v_old_sale_status, '')));
  v_expected_occupied boolean;
  v_plot public.plots%ROWTYPE;
  v_status_allowed boolean := false;
  v_non_stock_unchanged boolean := false;
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

  -- Final state check OR tightly-scoped intermediate sync state (for AFTER trigger sync_plot_customer_status)
  -- Never allow NULL expected_sale_status wildcard permits
  IF v_permit.expected_sale_status IS NOT NULL
     AND v_new_sale_status IS NOT DISTINCT FROM v_permit.expected_sale_status THEN
    v_status_allowed := true;
  ELSIF v_permit.allowed_intermediate_sale_status IS NOT NULL
        AND v_permit.command IN ('purchase_book', 'purchase_ensure_sale', 'rental_convert_to_buy')
        AND v_new_sale_status IS NOT DISTINCT FROM v_permit.allowed_intermediate_sale_status
        AND (
          v_new_sale_status IS NOT DISTINCT FROM v_old_sale_status
          OR (v_new_sale_status = 'transferred' AND v_permit.expected_sale_status = 'transferred')
        ) THEN
    v_non_stock_unchanged := (
      (p_old - ARRAY['has_customer', 'sale_status'])
      IS NOT DISTINCT FROM
      (p_new - ARRAY['has_customer', 'sale_status'])
    );
    v_status_allowed := v_non_stock_unchanged;
  END IF;

  IF NOT v_status_allowed THEN
    RETURN false;
  END IF;

  -- Real database occupancy evidence MUST match the requested stock flag
  v_expected_occupied := sales_private.plot_has_active_holder(v_plot_id);
  IF v_new_has_customer IS DISTINCT FROM v_expected_occupied THEN
    RETURN false;
  END IF;

  -- Extra command-specific invariants for legacy_plot_release permits
  IF v_permit.command = 'legacy_plot_release' THEN
    IF v_new_has_customer IS DISTINCT FROM false THEN
      RETURN false;
    END IF;
    IF v_old_sale_status_lower IN ('transferred', 'sold', 'handover') THEN
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

CREATE OR REPLACE FUNCTION sales_private.sale_tx_permit_allowed(p_op text, p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_permit sales_private.sale_tx_write_permits%ROWTYPE;
  v_sale_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_op NOT IN ('INSERT', 'UPDATE') OR p_new IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_sale_id := (p_new ->> 'id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  SELECT * INTO v_permit
  FROM sales_private.sale_tx_write_permits
  WHERE transaction_id = txid_current()
    AND backend_pid = pg_backend_pid()
    AND sale_id = v_sale_id;

  IF NOT FOUND OR v_permit.actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  IF (p_new ->> 'plot_id') IS DISTINCT FROM v_permit.plot_id
     OR (p_new ->> 'lead_id') IS DISTINCT FROM v_permit.lead_id::text THEN
    RETURN false;
  END IF;

  -- Require concrete op, contract_status, and crm_stage on permit (never allow NULL wildcard)
  IF v_permit.expected_op IS NULL OR p_op IS DISTINCT FROM v_permit.expected_op THEN
    RETURN false;
  END IF;

  IF v_permit.expected_contract_status IS NULL
     OR (p_new ->> 'contract_status') IS DISTINCT FROM v_permit.expected_contract_status THEN
    RETURN false;
  END IF;

  IF v_permit.expected_crm_stage IS NULL
     OR (p_new ->> 'crm_stage') IS DISTINCT FROM v_permit.expected_crm_stage THEN
    RETURN false;
  END IF;

  -- Never permit mutating or forging CRM-V2 / imported sale identities through native sale_tx permits
  IF NULLIF(btrim(COALESCE(p_new ->> 'project_interest_id', '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(p_new ->> 'external_booking_id', '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(p_new ->> 'external_source_stage', '')), '') IS NOT NULL THEN
    RETURN false;
  END IF;

  IF p_op = 'UPDATE' AND p_old IS NOT NULL THEN
    IF (p_old ->> 'id') IS DISTINCT FROM (p_new ->> 'id')
       OR (p_old ->> 'lead_id') IS DISTINCT FROM (p_new ->> 'lead_id')
       OR (
         NULLIF(btrim(COALESCE(p_old ->> 'plot_id', '')), '') IS NOT NULL
         AND (p_old ->> 'plot_id') IS DISTINCT FROM (p_new ->> 'plot_id')
       )
       OR NULLIF(btrim(COALESCE(p_old ->> 'project_interest_id', '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(p_old ->> 'external_booking_id', '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(p_old ->> 'external_source_stage', '')), '') IS NOT NULL THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.sale_tx_permit_allowed(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Update sales_private.guard_sale_plot_exclusivity() to verify convert permit
--    through sale_tx_permit_allowed() (never a loose table check)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.guard_sale_plot_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_stage text := COALESCE(lower(btrim(NEW.crm_stage)), lower(btrim(NEW.contract_status)), 'unknown');
  v_plot public.plots%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_is_convert_tx boolean := false;
BEGIN
  IF v_stage = 'cancelled' OR NEW.plot_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));
  SELECT * INTO v_plot FROM public.plots WHERE id = NEW.plot_id FOR UPDATE;

  -- Strictly validate atomic convert_to_buy via sale_tx_permit_allowed + exact command
  IF sales_private.sale_tx_permit_allowed(
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW)
  ) THEN
    SELECT EXISTS (
      SELECT 1 FROM sales_private.sale_tx_write_permits p
      WHERE p.transaction_id = txid_current()
        AND p.backend_pid = pg_backend_pid()
        AND p.sale_id = NEW.id
        AND p.plot_id = NEW.plot_id
        AND p.command = 'rental_convert_to_buy'
    ) INTO v_is_convert_tx;
  END IF;

  -- 1. Reject if any active/pending/unknown rental contract holds this plot
  IF EXISTS (
    SELECT 1 FROM public.rental_contracts rc
    WHERE rc.plot_id = NEW.plot_id
      AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
  ) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_BY_RENTAL';
  END IF;

  -- 2. Reject if canonical V2 rental contract holds this plot
  IF to_regclass('sales_private.rental_contracts') IS NOT NULL THEN
    DECLARE v_v2_rented boolean := false;
    BEGIN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM sales_private.rental_contracts WHERE plot_id = $1 AND status IN (''active'', ''renewed'', ''pending_contract''))'
        INTO v_v2_rented USING NEW.plot_id;
      IF v_v2_rented THEN
        RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_BY_RENTAL';
      END IF;
    END;
  END IF;

  -- 3. Reject if a legacy pending/active rental lead holds this plot
  IF EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.interested_plot_id = NEW.plot_id
      AND (NOT v_is_convert_tx OR l.id IS DISTINCT FROM NEW.lead_id)
      AND sales_private.lead_is_active_or_pending_rental_holder(l)
  ) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_BY_RENTAL';
  END IF;

  -- 4. Reject if plots carries legacy rental occupancy (unless atomic convert_to_buy transaction)
  IF NOT v_is_convert_tx AND v_plot.id IS NOT NULL AND (
    NULLIF(btrim(COALESCE(v_plot.rental_program, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(v_plot.current_tenant_name, '')), '') IS NOT NULL
    OR v_plot.lease_start_date IS NOT NULL
    OR lower(btrim(COALESCE(v_plot.sale_status, ''))) = 'rented'
  ) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_BY_RENTAL';
  END IF;

  -- 5. Reject if another non-cancelled sale already holds this plot
  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.plot_id = NEW.plot_id
      AND s.id IS DISTINCT FROM NEW.id
      AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'SALES_PLOT_ALREADY_BOOKED';
  END IF;

  -- 6. Reject if the target lead itself is currently a rental deal (unless atomic convert_to_buy)
  IF NEW.lead_id IS NOT NULL AND NOT v_is_convert_tx THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
    IF FOUND AND sales_private.lead_is_rental_deal(v_lead) THEN
      RAISE EXCEPTION 'SALES_LEAD_IS_RENTAL_DEAL';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.guard_sale_plot_exclusivity() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. Restore ALL verified deployed permission paths in BOTH stock guards:
--    - sales_private.guard_plot_stock_integrity()
--    - crm_external_private.guard_booking_plot_stock() (if installed)
--    AND wire sale_tx_permit_allowed() into crm_external_private.guard_cutover_sale() (if installed)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.guard_plot_stock_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_allowed boolean := false;
  v_ext_permit_valid boolean := false;
  v_native_mode boolean := false;
  v_crm_role text := NULL;
  v_expected_occupied boolean;
BEGIN
  -- Preserve verified recovery / rental retirement / historical revision hooks when installed
  IF TG_OP = 'UPDATE' AND to_regprocedure('sales_recovery_private.stock_allowed(jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE 'SELECT sales_recovery_private.stock_allowed($1, $2)' INTO v_allowed USING to_jsonb(OLD), to_jsonb(NEW);
    IF v_allowed IS TRUE THEN RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND to_regprocedure('rental_source_retirement_private.plot_allowed(jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE 'SELECT rental_source_retirement_private.plot_allowed($1, $2)' INTO v_allowed USING to_jsonb(OLD), to_jsonb(NEW);
    IF v_allowed IS TRUE THEN RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND to_regprocedure('sales_revision_private.plot_allowed(jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE 'SELECT sales_revision_private.plot_allowed($1, $2)' INTO v_allowed USING to_jsonb(OLD), to_jsonb(NEW);
    IF v_allowed IS TRUE THEN RETURN NEW; END IF;
  END IF;

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

  -- Absolute occupancy guard: NEVER clear has_customer to false while ANY active holder exists
  IF TG_OP = 'UPDATE' AND NEW.has_customer IS NOT TRUE AND sales_private.plot_has_active_holder(NEW.id) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_CANNOT_RELEASE';
  END IF;

  -- Authorized transactional command permit (verified against plot, actor, transition, and live occupancy)
  IF TG_OP = 'UPDATE' AND sales_private.plot_stock_permit_allowed(to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  -- Preserved Native Sidebar sync path (when canonical CRM flags are off and sync_plot_customer_status runs
  -- for a native lead-linked sale with exact live occupancy evidence)
  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
     AND (to_jsonb(OLD) - ARRAY['has_customer', 'sale_status'])
         IS NOT DISTINCT FROM (to_jsonb(NEW) - ARRAY['has_customer', 'sale_status'])
     AND to_regprocedure('public.crm_v2_role()') IS NOT NULL
     AND to_regclass('public.crm_settings') IS NOT NULL THEN
    EXECUTE 'SELECT public.crm_v2_role()' INTO v_crm_role;
    IF v_crm_role IN ('sales', 'admin') THEN
      EXECUTE 'SELECT NOT EXISTS (SELECT 1 FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled)'
        INTO v_native_mode;
      IF v_native_mode
         AND EXISTS (
           SELECT 1 FROM public.sales s JOIN public.leads l ON l.id = s.lead_id
           WHERE s.plot_id = NEW.id
             AND l.project_name = NEW.project_name
             AND s.project_interest_id IS NULL
             AND NULLIF(btrim(COALESCE(to_jsonb(s) ->> 'external_booking_id', '')), '') IS NULL
             AND NULLIF(btrim(COALESCE(to_jsonb(s) ->> 'external_source_stage', '')), '') IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.sales s
           WHERE s.plot_id = NEW.id
             AND COALESCE(s.contract_status, '') <> 'Cancelled'
             AND (
               s.project_interest_id IS NOT NULL
               OR NULLIF(btrim(COALESCE(to_jsonb(s) ->> 'external_booking_id', '')), '') IS NOT NULL
               OR NULLIF(btrim(COALESCE(to_jsonb(s) ->> 'external_source_stage', '')), '') IS NOT NULL
             )
         ) THEN
        v_expected_occupied := sales_private.plot_has_active_holder(NEW.id);
        IF NEW.has_customer IS NOT DISTINCT FROM v_expected_occupied
           AND NEW.sale_status IS NOT DISTINCT FROM (
             CASE WHEN EXISTS (
               SELECT 1 FROM public.sales WHERE plot_id = NEW.id AND contract_status = 'Transferred'
             ) THEN 'transferred' ELSE OLD.sale_status END
           ) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'NATIVE_SIDEBAR_STOCK_EVIDENCE_REQUIRED';
      END IF;
    END IF;
  END IF;

  -- Scoped external booking writer permit (V2 booking path, bound strictly to THIS plot_id + live occupancy)
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

-- Reconcile crm_external_private.guard_booking_plot_stock() cleanly if installed,
-- restoring recovery/retirement/revision/native-sidebar paths while keeping Phase 2 permits
-- and shared rental+purchase occupancy enforcement.
DO $restore_external_stock_guard$
BEGIN
  IF to_regprocedure('crm_external_private.guard_booking_plot_stock()') IS NOT NULL THEN
    EXECUTE $ext_fn$
      CREATE OR REPLACE FUNCTION crm_external_private.guard_booking_plot_stock()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $guard$
      DECLARE
        permit crm_external_private.booking_writer_permits%ROWTYPE;
        expected_occupied boolean;
        v_allowed boolean := false;
        v_crm_role text := NULL;
        v_native_mode boolean := false;
      BEGIN
        IF TG_OP = 'UPDATE' AND pg_catalog.to_regprocedure('sales_recovery_private.stock_allowed(jsonb,jsonb)') IS NOT NULL THEN
          EXECUTE 'SELECT sales_recovery_private.stock_allowed($1, $2)' INTO v_allowed USING pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW);
          IF v_allowed IS TRUE THEN RETURN NEW; END IF;
        END IF;

        IF TG_OP = 'UPDATE' AND pg_catalog.to_regprocedure('rental_source_retirement_private.plot_allowed(jsonb,jsonb)') IS NOT NULL THEN
          EXECUTE 'SELECT rental_source_retirement_private.plot_allowed($1, $2)' INTO v_allowed USING pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW);
          IF v_allowed IS TRUE THEN RETURN NEW; END IF;
        END IF;

        IF TG_OP = 'UPDATE' AND pg_catalog.to_regprocedure('sales_revision_private.plot_allowed(jsonb,jsonb)') IS NOT NULL THEN
          EXECUTE 'SELECT sales_revision_private.plot_allowed($1, $2)' INTO v_allowed USING pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW);
          IF v_allowed IS TRUE THEN RETURN NEW; END IF;
        END IF;

        IF TG_OP = 'INSERT' THEN
          IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
             AND (NEW.has_customer IS DISTINCT FROM false OR pg_catalog.lower(pg_catalog.btrim(NEW.sale_status)) = 'transferred') THEN
            RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
          END IF;
          RETURN NEW;
        END IF;

        IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
           AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name)
           AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id = OLD.id) THEN
          RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
        END IF;

        IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
           AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
           AND COALESCE(OLD.sale_status, '') IN ('', 'active', 'ready_for_sale')
           AND NEW.sale_status IN ('active', 'ready_for_sale') THEN
          RETURN NEW;
        END IF;

        IF NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
           AND NEW.sale_status IS NOT DISTINCT FROM OLD.sale_status THEN
          RETURN NEW;
        END IF;

        IF NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases) THEN
          RETURN NEW;
        END IF;

        -- Authorized transactional command permit (intermediate or final state + live occupancy evidence)
        IF sales_private.plot_stock_permit_allowed(pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW)) THEN
          RETURN NEW;
        END IF;

        -- Preserved Native Sidebar sync path (exact live occupancy across sales + rentals + legacy purchase)
        IF TG_OP = 'UPDATE'
           AND auth.uid() IS NOT NULL
           AND NEW.id IS NOT DISTINCT FROM OLD.id
           AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
           AND (pg_catalog.to_jsonb(OLD) - ARRAY['has_customer', 'sale_status'])
               IS NOT DISTINCT FROM (pg_catalog.to_jsonb(NEW) - ARRAY['has_customer', 'sale_status'])
           AND pg_catalog.to_regprocedure('public.crm_v2_role()') IS NOT NULL
           AND pg_catalog.to_regclass('public.crm_settings') IS NOT NULL THEN
          EXECUTE 'SELECT public.crm_v2_role()' INTO v_crm_role;
          IF v_crm_role IN ('sales', 'admin') THEN
            EXECUTE 'SELECT NOT EXISTS (SELECT 1 FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled)'
              INTO v_native_mode;
            IF v_native_mode
               AND EXISTS (
                 SELECT 1 FROM public.sales s JOIN public.leads l ON l.id = s.lead_id
                 WHERE s.plot_id = NEW.id
                   AND l.project_name = NEW.project_name
                   AND s.project_interest_id IS NULL
                   AND NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.to_jsonb(s) ->> 'external_booking_id', '')), '') IS NULL
                   AND NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.to_jsonb(s) ->> 'external_source_stage', '')), '') IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM public.sales s
                 WHERE s.plot_id = NEW.id
                   AND COALESCE(s.contract_status, '') <> 'Cancelled'
                   AND (
                     s.project_interest_id IS NOT NULL
                     OR NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.to_jsonb(s) ->> 'external_booking_id', '')), '') IS NOT NULL
                     OR NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.to_jsonb(s) ->> 'external_source_stage', '')), '') IS NOT NULL
                   )
               ) THEN
              expected_occupied := sales_private.plot_has_active_holder(NEW.id);
              IF NEW.has_customer IS NOT DISTINCT FROM expected_occupied
                 AND NEW.sale_status IS NOT DISTINCT FROM (
                   CASE WHEN EXISTS (
                     SELECT 1 FROM public.sales WHERE plot_id = NEW.id AND contract_status = 'Transferred'
                   ) THEN 'transferred' ELSE OLD.sale_status END
                 ) THEN
                RETURN NEW;
              END IF;
              RAISE EXCEPTION 'NATIVE_SIDEBAR_STOCK_EVIDENCE_REQUIRED';
            END IF;
          END IF;
        END IF;

        -- Existing external booking writer permit path
        SELECT * INTO permit FROM crm_external_private.booking_writer_permits
        WHERE transaction_id = pg_catalog.txid_current() AND backend_pid = pg_catalog.pg_backend_pid();

        IF permit.transaction_id IS NULL OR permit.actor_id IS DISTINCT FROM auth.uid()
           OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id = permit.sale_id
             AND s.project_interest_id = permit.interest_id AND s.plot_id = NEW.id)
           OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name
           OR NEW.sale_status IS DISTINCT FROM OLD.sale_status THEN
          RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
        END IF;

        expected_occupied := sales_private.plot_has_active_holder(NEW.id);
        IF NEW.has_customer IS DISTINCT FROM expected_occupied THEN
          RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_EVIDENCE_REQUIRED';
        END IF;
        RETURN NEW;
      END;
      $guard$;
    $ext_fn$;
    REVOKE ALL ON FUNCTION crm_external_private.guard_booking_plot_stock() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$restore_external_stock_guard$;

-- Wire sales_private.sale_tx_permit_allowed() into crm_external_private.guard_cutover_sale()
-- while preserving 100% of recovery, retirement, cutover, native-sidebar, revision,
-- post-booking, and booking_sale_allowed paths!
DO $wire_cutover_sale_guard$
BEGIN
  IF to_regprocedure('crm_external_private.guard_cutover_sale()') IS NOT NULL THEN
    EXECUTE $sale_guard_fn$
      CREATE OR REPLACE FUNCTION crm_external_private.guard_cutover_sale()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $guard$
      DECLARE
        permit crm_external_private.sales_cutover_permits%ROWTYPE;
        source crm_external_private.prepared_booking_sales%ROWTYPE;
        baseline jsonb;
        allowed boolean := false;
        v_crm_role text := NULL;
        v_native_mode boolean := false;
        v_old_json jsonb := NULL;
        v_new_json jsonb := NULL;
      BEGIN
        IF TG_OP = 'TRUNCATE' THEN
          RAISE EXCEPTION 'EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN';
        END IF;

        v_old_json := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
        v_new_json := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;

        IF pg_catalog.to_regprocedure('sales_recovery_private.row_allowed(text,text,jsonb,jsonb)') IS NOT NULL THEN
          EXECUTE 'SELECT sales_recovery_private.row_allowed($1,$2,$3,$4)' INTO allowed
            USING TG_TABLE_NAME, TG_OP, v_old_json, v_new_json;
          IF allowed IS TRUE THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
        END IF;

        IF pg_catalog.to_regprocedure('rental_source_retirement_private.sale_allowed(text,jsonb,jsonb)') IS NOT NULL THEN
          EXECUTE 'SELECT rental_source_retirement_private.sale_allowed($1,$2,$3)' INTO allowed
            USING TG_OP, v_old_json, v_new_json;
          IF allowed IS TRUE THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
        END IF;

        SELECT * INTO permit FROM crm_external_private.sales_cutover_permits
        WHERE transaction_id = pg_catalog.txid_current() AND backend_pid = pg_catalog.pg_backend_pid();

        IF permit.transaction_id IS NULL THEN
          -- Actively consume scoped Phase 2 transactional sale_tx_write_permits!
          IF TG_OP IN ('INSERT', 'UPDATE')
             AND TG_TABLE_SCHEMA = 'public'
             AND TG_TABLE_NAME = 'sales'
             AND sales_private.sale_tx_permit_allowed(TG_OP, v_old_json, v_new_json) THEN
            RETURN NEW;
          END IF;

          -- Preserved Native Sidebar compatibility (exact Lead/plot identity, no imported fields or bypass permits)
          IF TG_OP IN ('INSERT', 'UPDATE') AND TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'sales'
             AND auth.uid() IS NOT NULL
             AND pg_catalog.to_regprocedure('public.crm_v2_role()') IS NOT NULL
             AND pg_catalog.to_regclass('public.crm_settings') IS NOT NULL THEN
            EXECUTE 'SELECT public.crm_v2_role()' INTO v_crm_role;
            EXECUTE 'SELECT NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled)'
              INTO v_native_mode;
            IF v_crm_role IN ('sales', 'admin')
               AND v_native_mode
               AND NEW.lead_id IS NOT NULL AND NEW.plot_id IS NOT NULL
               AND NEW.project_interest_id IS NULL
               AND NULLIF(pg_catalog.btrim(COALESCE(v_new_json ->> 'external_booking_id', '')), '') IS NULL
               AND NULLIF(pg_catalog.btrim(COALESCE(v_new_json ->> 'external_source_stage', '')), '') IS NULL
               AND EXISTS (
                 SELECT 1 FROM public.leads l JOIN public.plots p ON p.id = NEW.plot_id
                 WHERE l.id = NEW.lead_id AND l.project_name = p.project_name
               ) THEN
              IF TG_OP = 'UPDATE' THEN
                IF OLD.lead_id IS NOT NULL AND OLD.project_interest_id IS NULL
                   AND NULLIF(pg_catalog.btrim(COALESCE(v_old_json ->> 'external_booking_id', '')), '') IS NULL
                   AND NULLIF(pg_catalog.btrim(COALESCE(v_old_json ->> 'external_source_stage', '')), '') IS NULL
                   AND (v_old_json - ARRAY['sale_price','land_office_price','bank_name','payment_method','contract_status','crm_stage',
                     'contracted_at','transferred_at','crm_handover_at','cancelled_at','cancellation_reason','cancellation_category',
                     'expected_transfer_date','updated_at'])
                     IS NOT DISTINCT FROM
                     (v_new_json - ARRAY['sale_price','land_office_price','bank_name','payment_method','contract_status','crm_stage',
                     'contracted_at','transferred_at','crm_handover_at','cancelled_at','cancellation_reason','cancellation_category',
                     'expected_transfer_date','updated_at']) THEN
                  RETURN NEW;
                END IF;
              ELSE
                PERFORM 1 FROM public.plots WHERE id = NEW.plot_id FOR UPDATE;
                IF NEW.contract_status = 'Reserved' AND NEW.crm_stage = 'booked'
                   AND NEW.payment_method IN ('cash', 'mortgage') AND NEW.sale_price >= 0 AND NEW.booking_amount >= 0
                   AND NOT EXISTS (
                     SELECT 1 FROM public.sales s
                     WHERE s.plot_id = NEW.plot_id
                       AND COALESCE(s.contract_status, '') NOT IN ('Cancelled', 'Rejected')
                   ) THEN
                  RETURN NEW;
                END IF;
              END IF;
              RAISE EXCEPTION 'NATIVE_SIDEBAR_IDENTITY_OR_FIELDS_FORBIDDEN';
            END IF;
          END IF;

          IF pg_catalog.to_regprocedure('sales_revision_private.allowed(text,jsonb,jsonb)') IS NOT NULL THEN
            EXECUTE 'SELECT sales_revision_private.allowed($1,$2,$3)' INTO allowed
              USING TG_OP, v_old_json, v_new_json;
            IF allowed IS TRUE THEN RETURN NEW; END IF;
          END IF;

          IF TG_OP = 'UPDATE' AND pg_catalog.to_regprocedure('sales_private.crm_post_booking_external_sale_allowed(jsonb,jsonb)') IS NOT NULL THEN
            EXECUTE 'SELECT sales_private.crm_post_booking_external_sale_allowed($1,$2)' INTO allowed
              USING v_old_json, v_new_json;
            IF allowed IS TRUE THEN RETURN NEW; END IF;
          END IF;

          IF pg_catalog.to_regprocedure('crm_external_private.booking_sale_allowed(text,jsonb,jsonb)') IS NOT NULL THEN
            EXECUTE 'SELECT crm_external_private.booking_sale_allowed($1,$2,$3)' INTO allowed
              USING TG_OP, v_old_json, v_new_json;
            IF allowed IS TRUE THEN RETURN NEW; END IF;
          END IF;

          IF EXISTS (
            SELECT 1 FROM crm_external_private.sales_cutover_receipts c
            WHERE NOT EXISTS (SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id = c.batch_id)
          ) THEN
            RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALES_SEALED';
          END IF;

          IF TG_OP <> 'DELETE' AND (
            NULLIF(pg_catalog.btrim(COALESCE(v_new_json ->> 'external_booking_id', '')), '') IS NOT NULL
            OR NULLIF(pg_catalog.btrim(COALESCE(v_new_json ->> 'external_source_stage', '')), '') IS NOT NULL
            OR (TG_NARGS > 0 AND EXISTS (
              SELECT 1 FROM pg_catalog.jsonb_array_elements_text(TG_ARGV[0]::jsonb) k
              WHERE v_new_json -> k IS DISTINCT FROM 'null'::jsonb
            ))
          ) THEN
            RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
          END IF;

          RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END IF;

        IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_UPDATE_FORBIDDEN'; END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

        IF permit.operation = 'rollback' THEN
          SELECT row_value INTO baseline FROM crm_external_private.sales_cutover_receipts r,
            LATERAL pg_catalog.jsonb_array_elements(r.before_sales) row_value
            WHERE r.batch_id = permit.batch_id AND row_value ->> 'id' = NEW.id::text;
          IF baseline IS NULL OR baseline IS DISTINCT FROM v_new_json THEN
            RAISE EXCEPTION 'EXTERNAL_CUTOVER_RESTORE_EVIDENCE_REQUIRED';
          END IF;
          RETURN NEW;
        END IF;

        SELECT * INTO source FROM crm_external_private.prepared_booking_sales
        WHERE id = NEW.external_booking_id AND batch_id = permit.batch_id;
        IF source.id IS NULL OR (source.payload ->> 'eligible_for_release_review')::boolean IS DISTINCT FROM true
           OR NEW.id IS DISTINCT FROM source.id OR NEW.external_source_stage IS DISTINCT FROM source.stage OR NEW.lead_id IS NOT NULL
           OR NEW.project_interest_id IS DISTINCT FROM (source.payload ->> 'interest_id')::uuid
           OR NEW.plot_id IS DISTINCT FROM source.plot_id OR NEW.crm_stage IS DISTINCT FROM source.stage
           OR NEW.sale_price IS DISTINCT FROM (source.payload ->> 'sale_price')::numeric
           OR NEW.booking_amount IS DISTINCT FROM (source.payload ->> 'deposit_amount')::numeric
           OR NEW.closing_sales_user_id IS DISTINCT FROM (source.payload ->> 'closing_sales_user_id')::uuid
           OR NEW.payment_method IS DISTINCT FROM (source.payload ->> 'payment_method')
           OR NEW.cancellation_reason IS DISTINCT FROM (source.payload ->> 'cancellation_reason')
           OR NEW.contract_status IS DISTINCT FROM (CASE source.stage WHEN 'booked' THEN 'Reserved' WHEN 'transferred' THEN 'Transferred' ELSE 'Cancelled' END)
           OR NEW.booking_route IS DISTINCT FROM 'legacy_import'
           OR NEW.booking_route_reason IS DISTINCT FROM 'External snapshot: ' || source.booking_key
           OR NEW.booking_round IS NOT NULL OR NEW.previous_sale_id IS NOT NULL
           OR NEW.booked_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
           OR NEW.contracted_at IS NOT NULL OR NEW.crm_handover_at IS NOT NULL
           OR NEW.list_price IS NOT NULL OR NEW.discount_amount IS NOT NULL
           OR NEW.bank_status IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.land_office_price IS NOT NULL
           OR NEW.transferred_at IS NOT NULL OR NEW.expected_transfer_date IS NOT NULL
           OR NEW.legacy_cancellation_batch_id IS NOT NULL OR NEW.cancellation_category IS NOT NULL THEN
          RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALE_EVIDENCE_REQUIRED';
        END IF;
        RETURN NEW;
      END;
      $guard$;
    $sale_guard_fn$;
    REVOKE ALL ON FUNCTION crm_external_private.guard_cutover_sale() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$wire_cutover_sale_guard$;

-- ------------------------------------------------------------------------------
-- 7. Fix permit issuance order in sales_tx_book_purchase, ensure_lead_sale_record,
--    and sales_tx_convert_rental_to_buy (issue BOTH permits BEFORE sales DML so
--    AFTER trigger sync_plot_customer_status() passes with all guards active!)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_tx_book_purchase(
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
  v_customer_name text;
  v_phone text;
  v_agent_name text;
  v_payment_method text;
  v_bank_name text;
  v_notes text;
  v_lead_id uuid;
  v_expected_lead_rev uuid;
  v_sale_price numeric;
  v_booking_amount numeric;
  v_plot public.plots%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_sale_id uuid := gen_random_uuid();
  v_new_lead_rev uuid := gen_random_uuid();
  v_old_lead_status text := 'Visit';
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  v_project_name := NULLIF(btrim(COALESCE(p_payload ->> 'projectName', '')), '');
  v_plot_key := NULLIF(btrim(COALESCE(p_payload ->> 'plotId', '')), '');
  v_customer_name := NULLIF(btrim(COALESCE(p_payload ->> 'customerName', '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_payload ->> 'phone', '')), '');
  v_agent_name := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'agentName', '')), ''), v_actor.actor_label);
  v_payment_method := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'paymentMethod', '')), ''), 'mortgage');
  v_bank_name := NULLIF(btrim(COALESCE(p_payload ->> 'bankName', '')), '');
  v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');
  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;
  v_expected_lead_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadRevision', '')), '')::uuid;
  v_sale_price := COALESCE((p_payload ->> 'salePrice')::numeric, 0);
  v_booking_amount := COALESCE((p_payload ->> 'bookingAmount')::numeric, 0);

  IF v_project_name IS NULL OR v_plot_key IS NULL OR v_customer_name IS NULL
     OR v_sale_price < 0 OR v_booking_amount < 0
     OR v_payment_method NOT IN ('mortgage', 'cash') THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'purchase_book' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  PERFORM 1 FROM public.projects WHERE name = v_project_name AND COALESCE(is_closed, false) = false FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_PROJECT_UNAVAILABLE';
  END IF;

  -- Canonical lock order: projects -> plots -> leads -> rental_contracts -> sales
  v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);
  IF v_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
    END IF;
  END IF;
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;

  IF NOT sales_private.plot_is_vacant_for_claim(v_plot) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
  END IF;

  IF v_lead_id IS NOT NULL THEN
    IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    IF sales_private.lead_is_rental_deal(v_lead) THEN
      RAISE EXCEPTION 'SALES_LEAD_IS_RENTAL_DEAL';
    END IF;
    IF v_lead.status IN ('Reserved', 'Booked', 'Contracted', 'Transferred', 'Handover', 'Rented', 'Cancelled', 'Lost', 'MovedOut') THEN
      RAISE EXCEPTION 'SALES_TX_LEAD_ALREADY_COMMITTED';
    END IF;
    v_old_lead_status := COALESCE(v_lead.status, 'Visit');
  END IF;

  IF v_lead_id IS NULL THEN
    v_lead_id := gen_random_uuid();
    INSERT INTO public.leads (
      id, customer_name, phone, project_name, channel, source,
      agent_name, created_by_agent, deal_type, status, crm_status,
      interested_plot_id, interested_plot_name, actual_visit_date,
      booking_date, booking_amount, notes, deal_revision, created_at, updated_at
    ) VALUES (
      v_lead_id, v_customer_name, v_phone, v_project_name, 'Walk in', 'Walk in',
      v_agent_name, v_agent_name, 'buy', 'Booked', 'Booked — วางเงินจองแปลงแล้ว',
      v_plot.id, COALESCE(v_plot.plot_name, v_plot.id), v_now,
      v_now, v_booking_amount, v_notes, v_new_lead_rev, v_now, v_now
    );
  ELSE
    UPDATE public.leads
    SET customer_name = v_customer_name,
        phone = COALESCE(v_phone, phone),
        project_name = v_project_name,
        deal_type = 'buy',
        status = 'Booked',
        crm_status = 'Booked — วางเงินจองแปลงแล้ว',
        interested_plot_id = v_plot.id,
        interested_plot_name = COALESCE(v_plot.plot_name, v_plot.id),
        actual_visit_date = COALESCE(actual_visit_date, v_now),
        booking_date = v_now,
        booking_amount = v_booking_amount,
        notes = concat_ws(E'\n', v_notes, NULLIF(notes, '')),
        deal_revision = v_new_lead_rev,
        updated_at = v_now
    WHERE id = v_lead_id;
  END IF;

  -- Issue BOTH scoped permits BEFORE sales INSERT so AFTER trigger sync_plot_customer_status()
  -- and BEFORE trigger guard_cutover_sale() both verify exact actor, plot, op, and states!
  INSERT INTO sales_private.sale_tx_write_permits (
    transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command,
    expected_op, expected_contract_status, expected_crm_stage
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, v_lead_id, 'purchase_book',
    'INSERT', 'Reserved', 'booked'
  );

  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command,
    expected_has_customer, expected_sale_status, allowed_intermediate_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'purchase_book',
    true, 'reserved', v_plot.sale_status
  );

  INSERT INTO public.sales (
    id, lead_id, plot_id, sale_price, booking_amount, bank_name, payment_method,
    contract_status, crm_stage, booking_route, booking_route_reason,
    booked_at, created_at, updated_at
  ) VALUES (
    v_sale_id, v_lead_id, v_plot.id, v_sale_price, v_booking_amount, v_bank_name, v_payment_method,
    'Reserved', 'booked', 'without_visit', 'Transactional purchase booking',
    v_now, v_now, v_now
  );

  DELETE FROM sales_private.sale_tx_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND sale_id = v_sale_id;

  UPDATE public.plots
  SET has_customer = true,
      sale_status = 'reserved',
      highlight_note = 'จอง: ' || v_customer_name
  WHERE id = v_plot.id;

  DELETE FROM sales_private.plot_stock_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

  INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
  VALUES (
    'lead', v_lead_id, v_old_lead_status, 'Booked',
    'จองซื้อ (' || v_agent_name || ') - แปลง ' || COALESCE(v_plot.plot_name, v_plot.id),
    v_now
  );

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'purchase_book',
    'leadId', v_lead_id,
    'saleId', v_sale_id,
    'plotId', v_plot.id,
    'projectName', v_project_name,
    'leadRevision', v_new_lead_rev,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'purchase_book', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_book_purchase(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_book_purchase(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_tx_convert_rental_to_buy(
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
  v_contract_id uuid;
  v_lead_id uuid;
  v_expected_contract_rev uuid;
  v_expected_lead_rev uuid;
  v_purchase_date date;
  v_purchase_ts timestamptz;
  v_final_price numeric;
  v_booking_credit numeric;
  v_payment_method text;
  v_closing_agent text;
  v_notes text;
  v_contract public.rental_contracts%ROWTYPE;
  v_plot public.plots%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_existing_sale public.sales%ROWTYPE;
  v_sale_id uuid;
  v_existing_plot_id text;
  v_sale_op text;
  v_new_contract_rev uuid := gen_random_uuid();
  v_new_lead_rev uuid := gen_random_uuid();
  v_convert_log text;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  v_contract_id := NULLIF(btrim(COALESCE(p_payload ->> 'contractId', '')), '')::uuid;
  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;
  v_expected_contract_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedContractRevision', '')), '')::uuid;
  v_expected_lead_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadRevision', '')), '')::uuid;
  v_purchase_date := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'purchaseDate', '')), '')::date, CURRENT_DATE);
  v_purchase_ts := (v_purchase_date::text || ' 12:00:00+07')::timestamptz;
  v_final_price := COALESCE((p_payload ->> 'finalPurchasePrice')::numeric, 0);
  v_booking_credit := COALESCE((p_payload ->> 'appliedBookingCredit')::numeric, 0);
  v_payment_method := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'paymentMethod', '')), ''), 'mortgage');
  v_closing_agent := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'closingAgent', '')), ''), v_actor.actor_label);
  v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');

  IF v_contract_id IS NULL OR v_final_price <= 0 OR v_booking_credit < 0
     OR v_payment_method NOT IN ('mortgage', 'cash') THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'rental_convert_to_buy' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_contract FROM public.rental_contracts WHERE id = v_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_CONTRACT_NOT_FOUND';
  END IF;

  PERFORM 1 FROM public.projects WHERE name = v_contract.project_name FOR SHARE;
  v_plot := sales_private.lock_plot_in_project(v_contract.project_name, v_contract.plot_id);

  v_lead_id := COALESCE(v_contract.lead_id, v_lead_id);
  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
  END IF;

  SELECT * INTO v_contract FROM public.rental_contracts WHERE id = v_contract_id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id OR lead_id = v_lead_id ORDER BY id FOR UPDATE;

  IF v_expected_contract_rev IS NOT NULL AND v_contract.deal_revision IS DISTINCT FROM v_expected_contract_rev THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;
  IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  IF v_contract.status NOT IN ('Active', 'Renewed') THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.plot_id = v_plot.id
      AND s.lead_id IS DISTINCT FROM v_lead_id
      AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
  ) OR EXISTS (
    SELECT 1 FROM public.rental_contracts rc
    WHERE rc.plot_id = v_plot.id
      AND rc.id IS DISTINCT FROM v_contract.id
      AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
  ) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER';
  END IF;

  v_convert_log := '[เปลี่ยนจากสัญญาเช่าเป็นซื้อ ' || to_char(v_purchase_date, 'YYYY-MM-DD')
    || ' ราคาสุทธิ ' || v_final_price::text || ' บ. เครดิตจอง ' || v_booking_credit::text || ' บ. โดย ' || v_closing_agent || ']'
    || CASE WHEN v_notes IS NOT NULL THEN ' หมายเหตุ: ' || v_notes ELSE '' END;

  -- Step A: Mark rental contract ConvertedToBuy inside the same transaction
  UPDATE public.rental_contracts
  SET status = 'ConvertedToBuy',
      conversion_date = v_purchase_date,
      notes = concat_ws(E'\n', NULLIF(notes, ''), v_convert_log),
      deal_revision = v_new_contract_rev,
      updated_at = v_now
  WHERE id = v_contract.id;

  SELECT * INTO v_existing_sale
  FROM public.sales
  WHERE lead_id = v_lead_id
    AND plot_id = v_plot.id
    AND COALESCE(lower(btrim(crm_stage)), lower(btrim(contract_status)), 'unknown') <> 'cancelled'
  LIMIT 1;

  IF FOUND THEN
    IF lower(btrim(COALESCE(v_existing_sale.contract_status, ''))) = 'transferred'
       OR lower(btrim(COALESCE(v_existing_sale.crm_stage, ''))) IN ('transferred', 'handover') THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
    v_sale_id := v_existing_sale.id;
    v_sale_op := 'UPDATE';
  ELSE
    v_sale_id := gen_random_uuid();
    v_sale_op := 'INSERT';
  END IF;

  -- Step B: Issue BOTH scoped permits BEFORE sales DML so AFTER trigger sync_plot_customer_status()
  -- and BEFORE trigger guard_cutover_sale() both succeed cleanly (has_customer stays TRUE continuously!)
  INSERT INTO sales_private.sale_tx_write_permits (
    transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command,
    expected_op, expected_contract_status, expected_crm_stage
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, v_lead_id, 'rental_convert_to_buy',
    v_sale_op, 'Reserved', 'booked'
  );

  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command,
    expected_has_customer, expected_sale_status, allowed_intermediate_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_convert_to_buy',
    true, 'reserved', v_plot.sale_status
  );

  IF v_sale_op = 'UPDATE' THEN
    UPDATE public.sales
    SET sale_price = v_final_price,
        booking_amount = v_booking_credit,
        payment_method = v_payment_method,
        contract_status = 'Reserved',
        crm_stage = 'booked',
        booked_at = COALESCE(booked_at, v_purchase_ts),
        updated_at = v_now
    WHERE id = v_sale_id;
  ELSE
    INSERT INTO public.sales (
      id, lead_id, plot_id, sale_price, booking_amount, payment_method,
      contract_status, crm_stage, booking_route, booking_route_reason,
      booked_at, created_at, updated_at
    ) VALUES (
      v_sale_id, v_lead_id, v_plot.id, v_final_price, v_booking_credit, v_payment_method,
      'Reserved', 'booked', 'without_visit', 'Converted from rental contract ' || v_contract.id::text,
      v_purchase_ts, v_now, v_now
    );
  END IF;

  DELETE FROM sales_private.sale_tx_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND sale_id = v_sale_id;

  -- Step C: Transition lead atomically from Rented -> Booked (ConvertedToBuy)
  UPDATE public.leads
  SET deal_type = 'buy',
      rental_status = 'ConvertedToBuy',
      active_rental_contract_id = NULL,
      status = 'Booked',
      crm_status = 'Booked — เปลี่ยนจากเช่าเป็นซื้อ (Convert to Buy)',
      booking_date = v_purchase_ts,
      booking_amount = v_booking_credit,
      interested_plot_id = v_plot.id,
      interested_plot_name = COALESCE(v_plot.plot_name, v_plot.id),
      closing_agent = v_closing_agent,
      notes = concat_ws(E'\n', NULLIF(notes, ''), v_convert_log),
      deal_revision = v_new_lead_rev,
      updated_at = v_now
  WHERE id = v_lead_id;

  -- Step D: Final plot transition (has_customer stays TRUE continuously; rental fields cleared)
  UPDATE public.plots
  SET has_customer = true,
      sale_status = 'reserved',
      current_tenant_name = NULL,
      current_tenant_phone = NULL,
      rental_program = NULL,
      monthly_rent = NULL,
      security_deposit = NULL,
      lease_start_date = NULL,
      lease_end_date = NULL,
      highlight_note = 'จองซื้อ (เปลี่ยนจากเช่า): ' || COALESCE(v_lead.customer_name, v_contract.tenant_name)
  WHERE id = v_plot.id;

  DELETE FROM sales_private.plot_stock_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

  INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
  VALUES (
    'lead', v_lead_id, COALESCE(v_lead.status, 'Rented'), 'Booked',
    'เปลี่ยนเช่าเป็นซื้อ (' || v_closing_agent || ') - แปลง ' || COALESCE(v_plot.plot_name, v_plot.id),
    v_now
  );

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'rental_convert_to_buy',
    'contractId', v_contract.id,
    'leadId', v_lead_id,
    'saleId', v_sale_id,
    'plotId', v_plot.id,
    'rentalStatus', 'ConvertedToBuy',
    'leadStatus', 'Booked',
    'contractRevision', v_new_contract_rev,
    'leadRevision', v_new_lead_rev,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'rental_convert_to_buy', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_convert_rental_to_buy(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_convert_rental_to_buy(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_lead_sale_record(
  p_lead_id uuid,
  p_plot_id text,
  p_sale_price numeric DEFAULT NULL,
  p_land_office_price numeric DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_payment_method text DEFAULT 'mortgage',
  p_stage text DEFAULT 'booked',
  p_event_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor record;
  v_now timestamptz := clock_timestamp();
  v_lead public.leads%ROWTYPE;
  v_plot public.plots%ROWTYPE;
  v_sale_id uuid;
  v_existing_plot_id text;
  v_sale_op text;
  v_target_plot_key text;
  v_target_crm_stage text := COALESCE(NULLIF(btrim(COALESCE(p_stage, '')), ''), 'booked');
  v_target_contract_status text;
  v_target_plot_status text;
  v_expected_has_customer boolean;
  v_intermediate_plot_status text;
BEGIN
  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'CRM_LEAD_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM_LEAD_NOT_FOUND';
  END IF;

  v_target_plot_key := COALESCE(NULLIF(btrim(COALESCE(p_plot_id, '')), ''), v_lead.interested_plot_id, v_lead.interested_plot_name);
  IF v_target_plot_key IS NULL OR btrim(v_target_plot_key) = '' THEN
    RAISE EXCEPTION 'CRM_PLOT_REQUIRED';
  END IF;

  IF v_lead.project_name IS NOT NULL AND btrim(v_lead.project_name) <> '' THEN
    PERFORM 1 FROM public.projects WHERE name = v_lead.project_name FOR SHARE;
    v_plot := sales_private.lock_plot_in_project(v_lead.project_name, v_target_plot_key);
  ELSE
    SELECT * INTO v_plot FROM public.plots WHERE id = v_target_plot_key FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_PLOT_NOT_FOUND';
    END IF;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id OR lead_id = p_lead_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id OR lead_id = p_lead_id ORDER BY id FOR UPDATE;

  IF sales_private.lead_is_rental_deal(v_lead) THEN
    RAISE EXCEPTION 'CRM_RENTAL_DEAL_FORBIDDEN_IN_SALE_RPC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rental_contracts rc
    WHERE rc.plot_id = v_plot.id
      AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
  ) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_BY_RENTAL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.plot_id = v_plot.id
      AND s.lead_id IS DISTINCT FROM p_lead_id
      AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'SALES_PLOT_ALREADY_BOOKED';
  END IF;

  v_target_contract_status := CASE
    WHEN v_target_crm_stage IN ('transferred', 'handover') THEN 'Transferred'
    WHEN v_target_crm_stage = 'booked' THEN 'Reserved'
    WHEN v_target_crm_stage = 'cancelled' THEN 'Cancelled'
    ELSE 'Contracted'
  END;

  v_target_plot_status := CASE
    WHEN v_target_crm_stage IN ('transferred', 'handover') THEN 'transferred'
    WHEN v_target_crm_stage = 'cancelled' THEN 'ready_for_sale'
    ELSE COALESCE(NULLIF(v_plot.sale_status, ''), 'reserved')
  END;

  SELECT id, plot_id INTO v_sale_id, v_existing_plot_id
  FROM public.sales
  WHERE lead_id = p_lead_id
    AND COALESCE(lower(btrim(crm_stage)), lower(btrim(contract_status)), 'unknown') <> 'cancelled'
  LIMIT 1;

  IF v_sale_id IS NOT NULL THEN
    IF NULLIF(btrim(COALESCE(v_existing_plot_id, '')), '') IS NOT NULL
       AND v_existing_plot_id IS DISTINCT FROM v_plot.id THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
    v_sale_op := 'UPDATE';
  ELSE
    v_sale_id := gen_random_uuid();
    v_sale_op := 'INSERT';
  END IF;

  IF v_target_crm_stage = 'cancelled' THEN
    v_expected_has_customer := (
      EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.plot_id = v_plot.id
          AND s.id IS DISTINCT FROM v_sale_id
          AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
      )
      OR EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id IS DISTINCT FROM p_lead_id
          AND btrim(COALESCE(l.interested_plot_id, '')) = v_plot.id
          AND (
            sales_private.lead_is_active_or_pending_rental_holder(l)
            OR sales_private.lead_is_legacy_purchase_holder(l)
            OR sales_private.lead_has_deal_conflict(l)
          )
      )
    );
  ELSE
    v_expected_has_customer := true;
  END IF;

  v_intermediate_plot_status := CASE
    WHEN v_target_contract_status = 'Transferred' THEN 'transferred'
    ELSE v_plot.sale_status
  END;

  -- Issue BOTH scoped permits BEFORE sales DML so AFTER trigger sync_plot_customer_status()
  -- and BEFORE trigger guard_cutover_sale() validate cleanly with zero disabled triggers!
  INSERT INTO sales_private.sale_tx_write_permits (
    transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command,
    expected_op, expected_contract_status, expected_crm_stage
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, p_lead_id, 'purchase_ensure_sale',
    v_sale_op, v_target_contract_status, v_target_crm_stage
  );

  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command,
    expected_has_customer, expected_sale_status, allowed_intermediate_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'purchase_ensure_sale',
    v_expected_has_customer,
    CASE WHEN v_expected_has_customer THEN v_target_plot_status ELSE 'ready_for_sale' END,
    v_intermediate_plot_status
  );

  IF v_sale_op = 'UPDATE' THEN
    UPDATE public.sales
    SET plot_id = COALESCE(v_plot.id, plot_id),
        sale_price = COALESCE(p_sale_price, sale_price),
        land_office_price = COALESCE(p_land_office_price, land_office_price),
        bank_name = COALESCE(p_bank_name, bank_name),
        payment_method = COALESCE(p_payment_method, payment_method, 'mortgage'),
        contract_status = v_target_contract_status,
        crm_stage = v_target_crm_stage,
        transferred_at = CASE WHEN v_target_crm_stage = 'transferred' THEN COALESCE(p_event_date, transferred_at, v_now) ELSE transferred_at END,
        contracted_at = CASE WHEN v_target_crm_stage = 'contracted' THEN COALESCE(p_event_date, contracted_at, v_now) ELSE contracted_at END,
        crm_handover_at = CASE WHEN v_target_crm_stage = 'handover' THEN COALESCE(p_event_date, crm_handover_at, v_now) ELSE crm_handover_at END,
        cancelled_at = CASE WHEN v_target_crm_stage = 'cancelled' THEN COALESCE(p_event_date, cancelled_at, v_now) ELSE cancelled_at END,
        updated_at = v_now
    WHERE id = v_sale_id;
  ELSE
    INSERT INTO public.sales (
      id, lead_id, plot_id, sale_price, land_office_price, bank_name,
      payment_method, contract_status, crm_stage, booking_route, booking_route_reason,
      booked_at, transferred_at, contracted_at, crm_handover_at, cancelled_at,
      created_at, updated_at
    ) VALUES (
      v_sale_id, p_lead_id, v_plot.id, p_sale_price, p_land_office_price, p_bank_name,
      COALESCE(p_payment_method, 'mortgage'), v_target_contract_status, v_target_crm_stage,
      'without_visit', 'Auto-created from Lead deal workflow',
      v_now,
      CASE WHEN v_target_crm_stage = 'transferred' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      CASE WHEN v_target_crm_stage = 'contracted' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      CASE WHEN v_target_crm_stage = 'handover' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      CASE WHEN v_target_crm_stage = 'cancelled' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      v_now, v_now
    );
  END IF;

  DELETE FROM sales_private.sale_tx_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND sale_id = v_sale_id;

  -- Final plot stock sync (matches exact final state on plot_stock_write_permits)
  UPDATE public.plots
  SET has_customer = v_expected_has_customer,
      sale_status = CASE WHEN v_expected_has_customer THEN v_target_plot_status ELSE 'ready_for_sale' END
  WHERE id = v_plot.id;

  DELETE FROM sales_private.plot_stock_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'plot_id', v_plot.id
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.ensure_lead_sale_record(uuid, text, numeric, numeric, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_lead_sale_record(uuid, text, numeric, numeric, text, text, text, timestamptz) TO authenticated;

COMMIT;
