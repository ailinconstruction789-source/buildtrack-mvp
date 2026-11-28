-- ==============================================================================
-- BUILDTRACK PHASE 2: SHARED PLOT OWNERSHIP, STOCK GUARD EXTENSION &
-- TRANSACTIONAL RENTAL / PURCHASE COMMANDS
-- ==============================================================================
-- Review-ready migration candidate. Do NOT apply to production without review.
--
-- Design guarantees:
-- 1. Zero DISABLE TRIGGER anywhere. All writes run with triggers & RLS enabled.
-- 2. Extends existing transaction-local permit pattern (txid_current() +
--    pg_backend_pid() + auth.uid() + live DB occupancy evidence).
-- 3. Single shared plot ownership rule across purchase sales, PendingContract
--    rental bookings, Active/Renewed rental contracts, and legacy occupancy.
-- 4. Consistent global + row lock order matching crm_v2_booking_command:
--    pg_advisory_xact_lock('crm-booking-command') -> projects (FOR SHARE) ->
--    plots (FOR UPDATE) -> leads (FOR UPDATE) -> rental_contracts (FOR UPDATE)
--    -> sales (FOR UPDATE).
-- 5. Transactional RPCs with role/scope/revision checks, idempotency receipts,
--    audit logging, and atomic rollback on any failure.
-- 6. Hardens direct/legacy purchase inserts and replaces ensure_lead_sale_record
--    so rental deals cannot create purchase sales and no triggers are disabled.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Private schema, additive revision columns, and private permit/receipt tables
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS sales_private;
REVOKE ALL ON SCHEMA sales_private FROM PUBLIC, anon, authenticated;

-- Additive optimistic-concurrency revision tokens (never break existing rows)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS deal_revision uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS deal_revision uuid NOT NULL DEFAULT gen_random_uuid();

-- Ensure additive sales columns referenced by ensure_lead_sale_record / convert_to_buy exist
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS crm_stage text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS booking_route text,
  ADD COLUMN IF NOT EXISTS booking_route_reason text,
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS contracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS crm_handover_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_category text;

-- Transaction-local plot stock write permits (never exposed to clients or GUCs)
CREATE TABLE IF NOT EXISTS sales_private.plot_stock_write_permits (
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  actor_user_id uuid NOT NULL,
  plot_id text NOT NULL,
  command text NOT NULL CHECK (command IN (
    'rental_book',
    'rental_sign_contract',
    'rental_cancel_booking',
    'rental_move_out',
    'rental_convert_to_buy',
    'purchase_book',
    'purchase_ensure_sale'
  )),
  expected_has_customer boolean NOT NULL,
  expected_sale_status text,
  PRIMARY KEY (transaction_id, backend_pid, plot_id)
);

-- Transaction-local exact sale write permits (for sealed external cutover interop)
CREATE TABLE IF NOT EXISTS sales_private.sale_tx_write_permits (
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  actor_user_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  plot_id text NOT NULL,
  lead_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN (
    'rental_convert_to_buy',
    'purchase_book',
    'purchase_ensure_sale'
  )),
  PRIMARY KEY (transaction_id, backend_pid, sale_id)
);

-- Idempotency receipt ledger per (actor_user_id, request_id)
CREATE TABLE IF NOT EXISTS sales_private.rental_tx_requests (
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN (
    'rental_book',
    'rental_sign_contract',
    'rental_cancel_booking',
    'rental_move_out',
    'rental_convert_to_buy',
    'purchase_book'
  )),
  request_payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_user_id, request_id)
);

ALTER TABLE sales_private.plot_stock_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.sale_tx_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.rental_tx_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sales_private.plot_stock_write_permits,
              sales_private.sale_tx_write_permits,
              sales_private.rental_tx_requests
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Partial unique indexes enforcing single active holder per plot per table
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS sales_active_plot_unique_idx
  ON public.sales (plot_id)
  WHERE plot_id IS NOT NULL
    AND COALESCE(lower(btrim(crm_stage)), lower(btrim(contract_status)), 'unknown') <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS rental_contracts_active_or_pending_plot_unique_idx
  ON public.rental_contracts (plot_id)
  WHERE plot_id IS NOT NULL
    AND COALESCE(status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy');

-- ------------------------------------------------------------------------------
-- 3. Canonical actor/role resolver (no JWT user_metadata, no read-only Owner)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.require_sales_writer(
  OUT actor_id uuid,
  OUT actor_role text,
  OUT actor_label text
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_crm_role text;
  v_legacy_role text;
  v_legacy_username text;
BEGIN
  actor_id := auth.uid();
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_AUTH_REQUIRED';
  END IF;

  -- 1. Prefer reviewed CRM V2 role registry when installed
  IF to_regprocedure('public.crm_v2_role()') IS NOT NULL THEN
    v_crm_role := lower(btrim(COALESCE(public.crm_v2_role(), '')));
    IF v_crm_role IN ('sales', 'admin') THEN
      actor_role := v_crm_role;
      IF to_regclass('sales_private.crm_user_roles') IS NOT NULL THEN
        EXECUTE 'SELECT COALESCE(NULLIF(btrim(display_name), ''''), $1::text) FROM sales_private.crm_user_roles WHERE user_id = $1 AND is_active = true FOR SHARE'
          INTO actor_label USING actor_id;
        IF actor_label IS NULL THEN
          RAISE EXCEPTION 'SALES_TX_FORBIDDEN';
        END IF;
      END IF;
      actor_label := COALESCE(actor_label, actor_id::text);
      RETURN;
    END IF;
    -- When crm_v2_role() is installed, it is authoritative: owner/viewer/other MUST be rejected
    RAISE EXCEPTION 'SALES_TX_FORBIDDEN';
  END IF;

  -- 2. Native-only fallback: verify active writer role from public.users ONLY (never JWT user_metadata)
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE $q$
      SELECT lower(btrim(COALESCE(role, ''))), COALESCE(NULLIF(btrim(username), ''), id::text)
      FROM public.users
      WHERE id::text = $1::text
         OR (to_jsonb(users) ->> 'auth_user_id') = $1::text
      LIMIT 1
    $q$ INTO v_legacy_role, v_legacy_username USING actor_id;

    IF v_legacy_role IN ('sales', 'sale', 'admin', 'administrator', 'superadmin', 'manager') THEN
      actor_role := CASE WHEN v_legacy_role IN ('sales', 'sale') THEN 'sales' ELSE 'admin' END;
      actor_label := COALESCE(v_legacy_username, actor_id::text);
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'SALES_TX_FORBIDDEN';
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.require_sales_writer() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Shared Plot Ownership Rules (Buy + PendingContract + Active/Renewed + Legacy)
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
        WHERE plot_id = $1 AND status IN ('active', 'renewed')
      )
    $q$ INTO v_has_v2_rental USING p_plot_id;
    IF v_has_v2_rental THEN
      RETURN true;
    END IF;
  END IF;

  -- 4. Legacy pending/active rental lead without a rental_contracts row
  IF EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.interested_plot_id = p_plot_id
      AND (
        l.rental_status IN ('PendingContract', 'Active', 'Renewed')
        OR l.status = 'Rented'
        OR (
          l.deal_type IN ('rent', 'rent_to_own')
          AND l.status IN ('Reserved', 'Booked')
          AND COALESCE(l.rental_status, '') NOT IN ('Cancelled', 'MovedOut', 'ConvertedToBuy', 'Expired')
        )
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_has_active_holder(text) FROM PUBLIC, anon, authenticated;

-- Strict vacancy check for claiming a plot (new purchase booking, new rental booking, or direct contract)
-- Never uses tenant_name as identity, but treats non-null legacy rental/stock flags as NOT vacant.
CREATE OR REPLACE FUNCTION sales_private.plot_is_vacant_for_claim(p_plot public.plots)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_status text := lower(btrim(COALESCE(p_plot.sale_status, '')));
BEGIN
  IF p_plot.id IS NULL THEN
    RETURN false;
  END IF;

  IF p_plot.has_customer IS TRUE THEN
    RETURN false;
  END IF;

  IF v_status NOT IN ('', 'active', 'normal', 'ready_for_sale', 'available', 'vacant') THEN
    RETURN false;
  END IF;

  -- Legacy rental occupancy fields on plots still mark the plot unavailable until formally cleared
  IF NULLIF(btrim(COALESCE(p_plot.rental_program, '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(p_plot.current_tenant_name, '')), '') IS NOT NULL
     OR p_plot.lease_start_date IS NOT NULL THEN
    RETURN false;
  END IF;

  IF sales_private.plot_has_active_holder(p_plot.id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.plot_is_vacant_for_claim(public.plots) FROM PUBLIC, anon, authenticated;

-- Check if a lead is currently a rental deal (must be rejected by purchase-only commands)
CREATE OR REPLACE FUNCTION sales_private.lead_is_rental_deal(p_lead public.leads)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_lead.id IS NULL THEN
    RETURN false;
  END IF;

  -- ConvertedToBuy is explicitly allowed to proceed in purchase workflows (unless contradicted by status='Rented')
  IF p_lead.rental_status = 'ConvertedToBuy' AND COALESCE(p_lead.status, '') <> 'Rented' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.lead_id = p_lead.id
        AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
    );
  END IF;

  IF p_lead.rental_status IN ('PendingContract', 'Active', 'Renewed')
     OR p_lead.status = 'Rented'
     OR p_lead.active_rental_contract_id IS NOT NULL
     OR (
       p_lead.deal_type IN ('rent', 'rent_to_own')
       AND COALESCE(p_lead.rental_status, '') NOT IN ('MovedOut', 'Cancelled', 'Expired', 'ConvertedToBuy')
       AND COALESCE(p_lead.status, '') NOT IN ('MovedOut', 'Cancelled', 'Lost')
     ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rental_contracts rc
    WHERE rc.lead_id = p_lead.id
      AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.lead_is_rental_deal(public.leads) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Permit verification helpers & DB-level exclusivity / stock-guard triggers
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
  v_expected_occupied boolean;
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

  -- Real database occupancy evidence MUST match the requested stock flag
  v_expected_occupied := sales_private.plot_has_active_holder(v_plot_id);
  IF v_new_has_customer IS DISTINCT FROM v_expected_occupied THEN
    RETURN false;
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
  IF auth.uid() IS NULL OR p_op NOT IN ('INSERT', 'UPDATE') THEN
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

  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.sale_tx_permit_allowed(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Unified stock guard trigger on public.plots (always active; protects direct stock tampering
-- and keeps has_customer consistent with real purchase/rental occupancy evidence)
CREATE OR REPLACE FUNCTION sales_private.guard_plot_stock_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_ext_permit_exists boolean := false;
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

  -- Never allow clearing has_customer to false while an active sale or active/pending rental still holds the plot
  IF TG_OP = 'UPDATE' AND NEW.has_customer IS NOT TRUE AND sales_private.plot_has_active_holder(NEW.id) THEN
    RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_CANNOT_RELEASE';
  END IF;

  -- If Phase 2 transactional command permit is active, verify exact permit + DB evidence
  IF TG_OP = 'UPDATE' AND sales_private.plot_stock_permit_allowed(to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  -- If external booking writer permit is active (V2 booking path), allow its existing guard to validate
  IF to_regclass('crm_external_private.booking_writer_permits') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM crm_external_private.booking_writer_permits
        WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND actor_id = auth.uid()
      )
    $q$ INTO v_ext_permit_exists;
    IF v_ext_permit_exists THEN
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

DROP TRIGGER IF EXISTS sales_phase2_guard_plot_stock ON public.plots;
CREATE TRIGGER sales_phase2_guard_plot_stock
  BEFORE UPDATE ON public.plots
  FOR EACH ROW
  EXECUTE FUNCTION sales_private.guard_plot_stock_integrity();

-- Extend existing crm_external_private.guard_booking_plot_stock() cleanly if installed,
-- preserving 100% of existing external booking writer checks while recognizing Phase 2 permits
-- and counting active/pending rentals in expected_occupied.
DO $extend_external_stock_guard$
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
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
             AND (NEW.has_customer IS DISTINCT FROM false OR lower(btrim(NEW.sale_status)) = 'transferred') THEN
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

        -- Authorized Phase 2 transactional command permit (verified against real DB occupancy)
        IF sales_private.plot_stock_permit_allowed(to_jsonb(OLD), to_jsonb(NEW)) THEN
          RETURN NEW;
        END IF;

        -- Existing external booking writer permit path
        SELECT * INTO permit FROM crm_external_private.booking_writer_permits
        WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid();

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
  END IF;
END;
$extend_external_stock_guard$;

-- Cross-table exclusivity trigger on public.sales:
-- Prevents ANY purchase booking path (including direct INSERT/UPDATE or V2 booking)
-- from booking a plot occupied by a PendingContract/Active/Renewed/legacy rental,
-- or creating a sale for a lead that is currently a rental deal.
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

  -- Consistent lock order with transactional commands
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));
  SELECT * INTO v_plot FROM public.plots WHERE id = NEW.plot_id FOR UPDATE;

  -- Check if this exact transaction is performing an atomic rental_convert_to_buy for this plot
  SELECT EXISTS (
    SELECT 1 FROM sales_private.sale_tx_write_permits p
    WHERE p.transaction_id = txid_current()
      AND p.backend_pid = pg_backend_pid()
      AND p.sale_id = NEW.id
      AND p.plot_id = NEW.plot_id
      AND p.command = 'rental_convert_to_buy'
  ) INTO v_is_convert_tx;

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
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM sales_private.rental_contracts WHERE plot_id = $1 AND status IN (''active'', ''renewed''))'
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
      AND (
        l.rental_status IN ('PendingContract', 'Active', 'Renewed')
        OR l.status = 'Rented'
        OR (
          l.deal_type IN ('rent', 'rent_to_own')
          AND l.status IN ('Reserved', 'Booked')
          AND COALESCE(l.rental_status, '') NOT IN ('Cancelled', 'MovedOut', 'ConvertedToBuy', 'Expired')
        )
      )
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

DROP TRIGGER IF EXISTS sales_phase2_guard_sale_plot_exclusivity ON public.sales;
CREATE TRIGGER sales_phase2_guard_sale_plot_exclusivity
  BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION sales_private.guard_sale_plot_exclusivity();

-- Cross-table exclusivity & Active-contract cancellation guard on public.rental_contracts
CREATE OR REPLACE FUNCTION sales_private.guard_rental_contract_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  -- Never allow cancelling an Active or Renewed rental contract via status='Cancelled'
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('Active', 'Renewed')
     AND NEW.status = 'Cancelled' THEN
    RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
  END IF;

  IF COALESCE(NEW.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
     AND NEW.plot_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));
    PERFORM 1 FROM public.plots WHERE id = NEW.plot_id FOR UPDATE;

    -- Block rental contract on a plot already held by a non-cancelled purchase sale
    IF EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.plot_id = NEW.plot_id
        AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'SALES_PLOT_OCCUPIED_BY_PURCHASE';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.guard_rental_contract_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_phase2_guard_rental_contract_integrity ON public.rental_contracts;
CREATE TRIGGER sales_phase2_guard_rental_contract_integrity
  BEFORE INSERT OR UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION sales_private.guard_rental_contract_integrity();

-- ------------------------------------------------------------------------------
-- 6. Helper: Canonical plot resolution within project scope (locked FOR UPDATE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_private.lock_plot_in_project(
  p_project_name text,
  p_plot_key text
)
RETURNS public.plots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_plot public.plots%ROWTYPE;
  v_match_count integer;
BEGIN
  IF p_project_name IS NULL OR btrim(p_project_name) = '' OR p_plot_key IS NULL OR btrim(p_plot_key) = '' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  -- Exact ID match within project first
  SELECT * INTO v_plot
  FROM public.plots
  WHERE id = btrim(p_plot_key)
    AND project_name = btrim(p_project_name)
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_plot;
  END IF;

  -- Fallback: unique plot_name within the exact same project
  SELECT count(*) INTO v_match_count
  FROM public.plots
  WHERE plot_name = btrim(p_plot_key)
    AND project_name = btrim(p_project_name);

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'SALES_TX_AMBIGUOUS_PLOT';
  END IF;

  IF v_match_count = 1 THEN
    SELECT * INTO v_plot
    FROM public.plots
    WHERE plot_name = btrim(p_plot_key)
      AND project_name = btrim(p_project_name)
    FOR UPDATE;
    RETURN v_plot;
  END IF;

  RAISE EXCEPTION 'SALES_TX_PLOT_NOT_FOUND';
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.lock_plot_in_project(text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. RPC 1: Book Rental (จองเช่า -> PendingContract)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_tx_book_rental(
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
  v_program_type text;
  v_tenant_name text;
  v_tenant_phone text;
  v_agent_name text;
  v_notes text;
  v_lead_id uuid;
  v_expected_lead_rev uuid;
  v_expected_lead_updated_at timestamptz;
  v_monthly_rent numeric;
  v_deposit numeric;
  v_savings_per_month numeric;
  v_base_price numeric;
  v_booking_amount numeric;
  v_booking_date date;
  v_start_date date;
  v_duration_months integer;
  v_end_date date;
  v_plot public.plots%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_contract_id uuid := gen_random_uuid();
  v_new_lead_rev uuid := gen_random_uuid();
  v_new_contract_rev uuid := gen_random_uuid();
  v_program_label text;
  v_crm_status text;
  v_combined_notes text;
  v_old_lead_status text := 'Visit';
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  -- Parse & validate inputs before taking locks
  v_project_name := NULLIF(btrim(COALESCE(p_payload ->> 'projectName', '')), '');
  v_plot_key := NULLIF(btrim(COALESCE(p_payload ->> 'plotId', '')), '');
  v_program_type := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'programType', '')), ''), 'program_a');
  v_tenant_name := NULLIF(btrim(COALESCE(p_payload ->> 'tenantName', '')), '');
  v_tenant_phone := NULLIF(btrim(COALESCE(p_payload ->> 'tenantPhone', '')), '');
  v_agent_name := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'agentName', '')), ''), v_actor.actor_label);
  v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');

  IF v_project_name IS NULL OR v_plot_key IS NULL OR v_tenant_name IS NULL
     OR v_program_type NOT IN ('program_a', 'program_b', 'program_c') THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;
  v_expected_lead_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadRevision', '')), '')::uuid;
  v_expected_lead_updated_at := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadUpdatedAt', '')), '')::timestamptz;

  v_monthly_rent := COALESCE((p_payload ->> 'monthlyRent')::numeric, 0);
  v_deposit := COALESCE((p_payload ->> 'securityDeposit')::numeric, v_monthly_rent * 2);
  v_savings_per_month := CASE WHEN v_program_type = 'program_b' THEN COALESCE((p_payload ->> 'savingsPerMonth')::numeric, 5000) ELSE 0 END;
  v_base_price := CASE WHEN v_program_type IN ('program_b', 'program_c') THEN COALESCE((p_payload ->> 'basePrice')::numeric, 0) ELSE 0 END;
  v_booking_amount := COALESCE((p_payload ->> 'bookingAmount')::numeric, 0);
  v_booking_date := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'bookingDate', '')), '')::date, (v_now AT TIME ZONE 'Asia/Bangkok')::date);
  v_start_date := NULLIF(btrim(COALESCE(p_payload ->> 'startDate', '')), '')::date;
  v_duration_months := COALESCE((p_payload ->> 'durationMonths')::integer, 12);

  IF v_monthly_rent <= 0 OR v_deposit < 0 OR v_booking_amount < 0 OR v_duration_months < 1 OR v_duration_months > 120 THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  v_end_date := (COALESCE(v_start_date, v_booking_date) + make_interval(months => v_duration_months))::date - 1;

  -- Lock order: global booking lock -> idempotency check -> project -> plot -> lead -> contracts -> sales
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'rental_book' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  -- Verify project exists and is open
  PERFORM 1 FROM public.projects WHERE name = v_project_name AND COALESCE(is_closed, false) = false FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_PROJECT_UNAVAILABLE';
  END IF;

  -- Lock plot FIRST (prevents creating orphan lead if plot is unavailable!)
  v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);

  -- Lock any existing contracts / sales on this plot deterministically
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;

  IF NOT sales_private.plot_is_vacant_for_claim(v_plot) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
  END IF;

  -- Lock & validate existing lead if provided
  IF v_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
    END IF;
    IF v_lead.project_name IS NOT NULL AND btrim(v_lead.project_name) <> '' AND v_lead.project_name <> v_project_name THEN
      RAISE EXCEPTION 'SALES_TX_PROJECT_MISMATCH';
    END IF;
    IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    IF v_expected_lead_updated_at IS NOT NULL AND v_lead.updated_at IS DISTINCT FROM v_expected_lead_updated_at THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;

    IF v_lead.status IN ('Reserved', 'Booked', 'Contracted', 'Transferred', 'Handover', 'Rented', 'Cancelled', 'Lost', 'MovedOut')
       OR v_lead.rental_status IN ('PendingContract', 'Active', 'Renewed')
       OR EXISTS (SELECT 1 FROM public.sales s WHERE s.lead_id = v_lead.id AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled')
       OR EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.lead_id = v_lead.id AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')) THEN
      RAISE EXCEPTION 'SALES_TX_LEAD_ALREADY_COMMITTED';
    END IF;
    v_old_lead_status := COALESCE(v_lead.status, 'Visit');
  END IF;

  v_program_label := CASE v_program_type
    WHEN 'program_b' THEN 'Rent to Own (เช่าซื้อ)'
    WHEN 'program_c' THEN 'Rent and Save (เช่าออม)'
    ELSE 'Rent (เช่าปกติ)'
  END;
  v_crm_status := 'จองเช่า — รอทำสัญญา (' || v_program_label || ')';
  v_combined_notes := concat_ws(E'\n', NULLIF(v_lead.notes, ''), '[จองเช่า ' || v_program_label || ']: แปลง ' || COALESCE(v_plot.plot_name, v_plot.id) || CASE WHEN v_notes IS NOT NULL THEN ' | ' || v_notes ELSE '' END);

  -- Create or update lead (AFTER plot lock + vacancy check passed)
  IF v_lead_id IS NULL THEN
    v_lead_id := gen_random_uuid();
    INSERT INTO public.leads (
      id, customer_name, phone, project_name, channel, source,
      agent_name, created_by_agent, deal_type, rental_program,
      crm_status, status, interested_plot_id, interested_plot_name,
      rental_monthly_rent, rental_deposit, rental_savings_per_month, rental_base_price,
      rental_start_date, rental_end_date, rental_status,
      actual_visit_date, booking_date, booking_amount, notes,
      deal_revision, created_at, updated_at
    ) VALUES (
      v_lead_id, v_tenant_name, v_tenant_phone, v_project_name, 'Walk in', 'Walk in',
      v_agent_name, v_agent_name, 'rent', v_program_type,
      v_crm_status, 'Reserved', v_plot.id, COALESCE(v_plot.plot_name, v_plot.id),
      v_monthly_rent, v_deposit, v_savings_per_month, v_base_price,
      v_start_date, CASE WHEN v_start_date IS NOT NULL THEN v_end_date ELSE NULL END, 'PendingContract',
      v_now, (v_booking_date::timestamp AT TIME ZONE 'UTC'), v_booking_amount, v_combined_notes,
      v_new_lead_rev, v_now, v_now
    );
  ELSE
    UPDATE public.leads
    SET customer_name = v_tenant_name,
        phone = COALESCE(v_tenant_phone, phone),
        project_name = v_project_name,
        deal_type = 'rent',
        rental_program = v_program_type,
        crm_status = v_crm_status,
        status = 'Reserved',
        interested_plot_id = v_plot.id,
        interested_plot_name = COALESCE(v_plot.plot_name, v_plot.id),
        rental_monthly_rent = v_monthly_rent,
        rental_deposit = v_deposit,
        rental_savings_per_month = v_savings_per_month,
        rental_base_price = v_base_price,
        rental_start_date = v_start_date,
        rental_end_date = CASE WHEN v_start_date IS NOT NULL THEN v_end_date ELSE NULL END,
        rental_status = 'PendingContract',
        actual_visit_date = COALESCE(actual_visit_date, v_now),
        booking_date = (v_booking_date::timestamp AT TIME ZONE 'UTC'),
        booking_amount = v_booking_amount,
        notes = v_combined_notes,
        deal_revision = v_new_lead_rev,
        updated_at = v_now
    WHERE id = v_lead_id;
  END IF;

  -- Insert canonical PendingContract record (backed by partial unique index on plot_id)
  INSERT INTO public.rental_contracts (
    id, lead_id, project_name, plot_id, plot_name,
    tenant_name, tenant_phone, agent_name, program_type,
    monthly_rent, security_deposit, advance_rent,
    savings_per_month, accumulated_savings, base_price,
    lease_duration_months, lease_start_date, lease_end_date,
    status, notes, deal_revision, created_at, updated_at
  ) VALUES (
    v_contract_id, v_lead_id, v_project_name, v_plot.id, COALESCE(v_plot.plot_name, v_plot.id),
    v_tenant_name, v_tenant_phone, v_agent_name, v_program_type,
    v_monthly_rent, v_deposit, 0,
    v_savings_per_month, 0, v_base_price,
    v_duration_months, COALESCE(v_start_date, v_booking_date), v_end_date,
    'PendingContract', v_notes, v_new_contract_rev, v_now, v_now
  );

  -- Update plots stock flags AND rental fields atomically via transaction-local permit
  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_book', true, 'reserved'
  );

  UPDATE public.plots
  SET has_customer = true,
      sale_status = 'reserved',
      current_tenant_name = v_tenant_name,
      current_tenant_phone = v_tenant_phone,
      rental_program = v_program_type,
      monthly_rent = v_monthly_rent,
      highlight_note = 'จองเช่า: ' || v_program_label || ' (' || v_tenant_name || ')'
  WHERE id = v_plot.id;

  DELETE FROM sales_private.plot_stock_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

  -- Audit trail
  INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
  VALUES (
    'lead', v_lead_id, v_old_lead_status, 'Reserved',
    'จองเช่า (' || v_agent_name || ') - แปลง ' || COALESCE(v_plot.plot_name, v_plot.id),
    v_now
  );

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'rental_book',
    'leadId', v_lead_id,
    'contractId', v_contract_id,
    'plotId', v_plot.id,
    'projectName', v_project_name,
    'rentalStatus', 'PendingContract',
    'leadRevision', v_new_lead_rev,
    'contractRevision', v_new_contract_rev,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'rental_book', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_book_rental(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_book_rental(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. RPC 2: Sign Rental Contract (from PendingContract OR direct contract)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_tx_sign_rental_contract(
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
  v_program_type text;
  v_tenant_name text;
  v_tenant_phone text;
  v_agent_name text;
  v_notes text;
  v_lead_id uuid;
  v_contract_id uuid;
  v_expected_lead_rev uuid;
  v_expected_contract_rev uuid;
  v_expected_lead_updated_at timestamptz;
  v_monthly_rent numeric;
  v_deposit numeric;
  v_advance_rent numeric;
  v_savings_per_month numeric;
  v_base_price numeric;
  v_booking_amount numeric;
  v_booking_date date;
  v_contract_date date;
  v_start_date date;
  v_duration_months integer;
  v_end_date date;
  v_plot public.plots%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_pending_contract public.rental_contracts%ROWTYPE;
  v_is_from_pending boolean := false;
  v_new_lead_rev uuid := gen_random_uuid();
  v_new_contract_rev uuid := gen_random_uuid();
  v_program_label text;
  v_crm_status text;
  v_old_lead_status text := 'Visit';
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  v_project_name := NULLIF(btrim(COALESCE(p_payload ->> 'projectName', '')), '');
  v_plot_key := NULLIF(btrim(COALESCE(p_payload ->> 'plotId', '')), '');
  v_program_type := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'programType', '')), ''), 'program_a');
  v_tenant_name := NULLIF(btrim(COALESCE(p_payload ->> 'tenantName', '')), '');
  v_tenant_phone := NULLIF(btrim(COALESCE(p_payload ->> 'tenantPhone', '')), '');
  v_agent_name := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'agentName', '')), ''), v_actor.actor_label);
  v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');

  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;
  v_contract_id := NULLIF(btrim(COALESCE(p_payload ->> 'contractId', '')), '')::uuid;
  v_expected_lead_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadRevision', '')), '')::uuid;
  v_expected_contract_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedContractRevision', '')), '')::uuid;
  v_expected_lead_updated_at := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadUpdatedAt', '')), '')::timestamptz;

  v_monthly_rent := COALESCE((p_payload ->> 'monthlyRent')::numeric, 0);
  v_deposit := COALESCE((p_payload ->> 'securityDeposit')::numeric, v_monthly_rent * 2);
  v_advance_rent := COALESCE((p_payload ->> 'advanceRent')::numeric, v_monthly_rent);
  v_savings_per_month := CASE WHEN v_program_type = 'program_b' THEN COALESCE((p_payload ->> 'savingsPerMonth')::numeric, 5000) ELSE 0 END;
  v_base_price := CASE WHEN v_program_type IN ('program_b', 'program_c') THEN COALESCE((p_payload ->> 'basePrice')::numeric, 0) ELSE 0 END;
  v_booking_amount := COALESCE((p_payload ->> 'bookingAmount')::numeric, 0);
  v_booking_date := NULLIF(btrim(COALESCE(p_payload ->> 'bookingDate', '')), '')::date;
  v_contract_date := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'contractDate', '')), '')::date, (v_now AT TIME ZONE 'Asia/Bangkok')::date);
  v_start_date := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'startDate', '')), '')::date, v_contract_date);
  v_duration_months := COALESCE((p_payload ->> 'durationMonths')::integer, 12);

  IF v_project_name IS NULL OR v_plot_key IS NULL OR v_tenant_name IS NULL
     OR v_program_type NOT IN ('program_a', 'program_b', 'program_c')
     OR v_monthly_rent <= 0 OR v_deposit < 0 OR v_advance_rent < 0 OR v_booking_amount < 0
     OR v_duration_months < 1 OR v_duration_months > 120 THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  v_end_date := (v_start_date + make_interval(months => v_duration_months))::date - 1;

  -- Shared lock order
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'rental_sign_contract' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  PERFORM 1 FROM public.projects WHERE name = v_project_name AND COALESCE(is_closed, false) = false FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_PROJECT_UNAVAILABLE';
  END IF;

  -- Lock plot FIRST
  v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);

  -- Lock lead if provided
  IF v_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
    END IF;
    IF v_lead.project_name IS NOT NULL AND btrim(v_lead.project_name) <> '' AND v_lead.project_name <> v_project_name THEN
      RAISE EXCEPTION 'SALES_TX_PROJECT_MISMATCH';
    END IF;
    IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    IF v_expected_lead_updated_at IS NOT NULL AND v_lead.updated_at IS DISTINCT FROM v_expected_lead_updated_at THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    v_old_lead_status := COALESCE(v_lead.status, 'Visit');
  END IF;

  -- Lock contracts & sales on plot/lead deterministically
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id OR (v_lead_id IS NOT NULL AND lead_id = v_lead_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id OR (v_lead_id IS NOT NULL AND lead_id = v_lead_id) ORDER BY id FOR UPDATE;

  -- Reject if an active sale holds this plot
  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.plot_id = v_plot.id
      AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
  END IF;

  -- Resolve pending contract if upgrading from rental booking
  IF v_contract_id IS NOT NULL THEN
    SELECT * INTO v_pending_contract FROM public.rental_contracts WHERE id = v_contract_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_CONTRACT_NOT_FOUND';
    END IF;
    IF v_pending_contract.plot_id <> v_plot.id OR v_pending_contract.project_name <> v_project_name THEN
      RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
    END IF;
    IF v_lead_id IS NOT NULL AND v_pending_contract.lead_id IS DISTINCT FROM v_lead_id THEN
      RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
    END IF;
    IF v_expected_contract_rev IS NOT NULL AND v_pending_contract.deal_revision IS DISTINCT FROM v_expected_contract_rev THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    IF v_pending_contract.status <> 'PendingContract' THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    v_is_from_pending := true;
    IF v_lead_id IS NULL AND v_pending_contract.lead_id IS NOT NULL THEN
      v_lead_id := v_pending_contract.lead_id;
      SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
      END IF;
      IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
        RAISE EXCEPTION 'SALES_TX_STALE_STATE';
      END IF;
      IF v_expected_lead_updated_at IS NOT NULL AND v_lead.updated_at IS DISTINCT FROM v_expected_lead_updated_at THEN
        RAISE EXCEPTION 'SALES_TX_STALE_STATE';
      END IF;
      v_old_lead_status := COALESCE(v_lead.status, 'Reserved');
    END IF;
  ELSIF v_lead_id IS NOT NULL THEN
    -- Check if this lead already has a PendingContract row on this plot
    SELECT * INTO v_pending_contract
    FROM public.rental_contracts
    WHERE lead_id = v_lead_id AND plot_id = v_plot.id AND status = 'PendingContract'
    LIMIT 1;

    IF FOUND THEN
      IF v_expected_contract_rev IS NOT NULL AND v_pending_contract.deal_revision IS DISTINCT FROM v_expected_contract_rev THEN
        RAISE EXCEPTION 'SALES_TX_STALE_STATE';
      END IF;
      v_is_from_pending := true;
      v_contract_id := v_pending_contract.id;
    ELSIF v_lead.rental_status = 'PendingContract'
          AND v_lead.interested_plot_id = v_plot.id THEN
      -- Legacy PendingContract lead without a rental_contracts row yet
      v_is_from_pending := true;
    END IF;
  END IF;

  -- Check lead & plot preconditions based on mode (pending upgrade vs direct contract)
  IF v_lead_id IS NOT NULL THEN
    IF v_lead.status IN ('Rented', 'Transferred', 'Handover', 'Cancelled', 'Lost', 'MovedOut')
       OR v_lead.rental_status IN ('Active', 'Renewed', 'Cancelled', 'MovedOut') THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    -- Ensure lead does not hold another Active/Renewed/Pending rental on another plot
    IF EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.lead_id = v_lead_id
        AND rc.id IS DISTINCT FROM v_pending_contract.id
        AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
    ) THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
  END IF;

  IF v_is_from_pending THEN
    -- Ensure NO other contract holds this plot
    IF EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.plot_id = v_plot.id
        AND rc.id IS DISTINCT FROM v_pending_contract.id
        AND COALESCE(rc.status, 'unknown') NOT IN ('MovedOut', 'Cancelled', 'ConvertedToBuy')
    ) THEN
      RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
    END IF;
    -- Ensure NO other lead holds a pending/active rental on this plot
    IF EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.interested_plot_id = v_plot.id
        AND l.id IS DISTINCT FROM v_lead_id
        AND (l.rental_status IN ('PendingContract', 'Active', 'Renewed') OR l.status = 'Rented')
    ) THEN
      RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
    END IF;
  ELSE
    -- Direct rental contract requires a completely vacant plot
    IF NOT sales_private.plot_is_vacant_for_claim(v_plot) THEN
      RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
    END IF;
  END IF;

  v_program_label := CASE v_program_type
    WHEN 'program_b' THEN 'Rent to Own (เช่าซื้อ)'
    WHEN 'program_c' THEN 'Rent and Save (เช่าออม)'
    ELSE 'Rent (เช่าปกติ)'
  END;
  v_crm_status := CASE
    WHEN v_program_type = 'program_b' THEN 'Rent-to-Own / Active — สัญญาเช่าซื้อ/เช่าออม (สะสมเงินดาวน์)'
    ELSE 'Rented / Active — ทำสัญญาเช่าแล้ว (อยู่ระหว่างเช่า)'
  END;

  -- Create walk-in lead if direct contract has no leadId
  IF v_lead_id IS NULL THEN
    v_lead_id := gen_random_uuid();
    INSERT INTO public.leads (
      id, customer_name, phone, project_name, channel, source,
      agent_name, created_by_agent, deal_type, rental_program,
      crm_status, status, interested_plot_id, interested_plot_name,
      rental_monthly_rent, rental_deposit, rental_savings_per_month, rental_base_price,
      rental_start_date, rental_end_date, rental_status,
      actual_visit_date, booking_date, booking_amount, notes,
      deal_revision, created_at, updated_at
    ) VALUES (
      v_lead_id, v_tenant_name, v_tenant_phone, v_project_name, 'Walk in', 'Walk in',
      v_agent_name, v_agent_name, 'rent', v_program_type,
      v_crm_status, 'Rented', v_plot.id, COALESCE(v_plot.plot_name, v_plot.id),
      v_monthly_rent, v_deposit, v_savings_per_month, v_base_price,
      v_start_date, v_end_date, 'Active',
      v_now, COALESCE((v_booking_date::timestamp AT TIME ZONE 'UTC'), v_now), v_booking_amount, v_notes,
      v_new_lead_rev, v_now, v_now
    );
  END IF;

  -- Upgrade existing PendingContract OR insert new Active rental_contracts row
  IF v_pending_contract.id IS NOT NULL THEN
    v_contract_id := v_pending_contract.id;
    UPDATE public.rental_contracts
    SET lead_id = v_lead_id,
        tenant_name = v_tenant_name,
        tenant_phone = COALESCE(v_tenant_phone, tenant_phone),
        agent_name = v_agent_name,
        program_type = v_program_type,
        monthly_rent = v_monthly_rent,
        security_deposit = v_deposit,
        advance_rent = v_advance_rent,
        savings_per_month = v_savings_per_month,
        base_price = v_base_price,
        lease_duration_months = v_duration_months,
        lease_start_date = v_start_date,
        lease_end_date = v_end_date,
        status = 'Active',
        notes = COALESCE(v_notes, notes),
        deal_revision = v_new_contract_rev,
        updated_at = v_now
    WHERE id = v_contract_id AND status = 'PendingContract';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
  ELSE
    v_contract_id := gen_random_uuid();
    INSERT INTO public.rental_contracts (
      id, lead_id, project_name, plot_id, plot_name,
      tenant_name, tenant_phone, agent_name, program_type,
      monthly_rent, security_deposit, advance_rent,
      savings_per_month, accumulated_savings, base_price,
      lease_duration_months, lease_start_date, lease_end_date,
      status, notes, deal_revision, created_at, updated_at
    ) VALUES (
      v_contract_id, v_lead_id, v_project_name, v_plot.id, COALESCE(v_plot.plot_name, v_plot.id),
      v_tenant_name, v_tenant_phone, v_agent_name, v_program_type,
      v_monthly_rent, v_deposit, v_advance_rent,
      v_savings_per_month, 0, v_base_price,
      v_duration_months, v_start_date, v_end_date,
      'Active', v_notes, v_new_contract_rev, v_now, v_now
    );
  END IF;

  -- Link lead to Active contract
  UPDATE public.leads
  SET customer_name = v_tenant_name,
      phone = COALESCE(v_tenant_phone, phone),
      project_name = v_project_name,
      deal_type = 'rent',
      rental_program = v_program_type,
      crm_status = v_crm_status,
      status = 'Rented',
      interested_plot_id = v_plot.id,
      interested_plot_name = COALESCE(v_plot.plot_name, v_plot.id),
      rental_monthly_rent = v_monthly_rent,
      rental_deposit = v_deposit,
      rental_savings_per_month = v_savings_per_month,
      rental_base_price = v_base_price,
      rental_start_date = v_start_date,
      rental_end_date = v_end_date,
      rental_status = 'Active',
      active_rental_contract_id = v_contract_id,
      booking_date = COALESCE((v_booking_date::timestamp AT TIME ZONE 'UTC'), booking_date, v_now),
      booking_amount = CASE WHEN v_booking_amount > 0 THEN v_booking_amount ELSE booking_amount END,
      notes = CASE WHEN v_notes IS NOT NULL THEN concat_ws(E'\n', NULLIF(notes, ''), '[สัญญาเช่า ' || v_program_label || ']: ' || v_notes) ELSE notes END,
      deal_revision = v_new_lead_rev,
      updated_at = v_now
  WHERE id = v_lead_id;

  -- Update plots stock & rental metadata atomically via permit
  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_sign_contract', true, 'rented'
  );

  UPDATE public.plots
  SET has_customer = true,
      sale_status = 'rented',
      current_tenant_name = v_tenant_name,
      current_tenant_phone = v_tenant_phone,
      rental_program = v_program_type,
      monthly_rent = v_monthly_rent,
      security_deposit = v_deposit,
      lease_start_date = v_start_date,
      lease_end_date = v_end_date,
      highlight_note = 'เช่า: ' || v_program_label || ' (' || v_tenant_name || ')'
  WHERE id = v_plot.id;

  DELETE FROM sales_private.plot_stock_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

  INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
  VALUES (
    'lead', v_lead_id, v_old_lead_status, 'Rented',
    'ทำสัญญาเช่า (' || v_agent_name || ') - ' || v_program_label || ' แปลง ' || COALESCE(v_plot.plot_name, v_plot.id),
    v_now
  );

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'rental_sign_contract',
    'leadId', v_lead_id,
    'contractId', v_contract_id,
    'plotId', v_plot.id,
    'projectName', v_project_name,
    'rentalStatus', 'Active',
    'leadRevision', v_new_lead_rev,
    'contractRevision', v_new_contract_rev,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'rental_sign_contract', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_sign_rental_contract(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_sign_rental_contract(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 9. RPC 3: Cancel Rental Booking (PendingContract ONLY — NEVER Active/Renewed!)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_tx_cancel_rental_booking(
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
  v_lead_id uuid;
  v_contract_id uuid;
  v_expected_lead_rev uuid;
  v_expected_contract_rev uuid;
  v_expected_lead_updated_at timestamptz;
  v_reason text;
  v_lead public.leads%ROWTYPE;
  v_contract public.rental_contracts%ROWTYPE;
  v_plot public.plots%ROWTYPE;
  v_plot_key text;
  v_project_name text;
  v_new_lead_rev uuid := gen_random_uuid();
  v_new_contract_rev uuid := gen_random_uuid();
  v_plot_released boolean := false;
  v_cancel_note text;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;
  v_contract_id := NULLIF(btrim(COALESCE(p_payload ->> 'contractId', '')), '')::uuid;
  v_expected_lead_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadRevision', '')), '')::uuid;
  v_expected_contract_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedContractRevision', '')), '')::uuid;
  v_expected_lead_updated_at := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadUpdatedAt', '')), '')::timestamptz;
  v_reason := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'reason', '')), ''), 'ยกเลิกการจองเช่า');

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'rental_cancel_booking' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  -- Peek target plot/project to establish canonical lock order: project -> plot -> lead -> contracts -> sales
  SELECT project_name, COALESCE(interested_plot_id, interested_plot_name)
  INTO v_project_name, v_plot_key
  FROM public.leads
  WHERE id = v_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
  END IF;

  IF v_contract_id IS NOT NULL THEN
    SELECT COALESCE(project_name, v_project_name), COALESCE(plot_id, v_plot_key)
    INTO v_project_name, v_plot_key
    FROM public.rental_contracts
    WHERE id = v_contract_id;
  END IF;

  IF v_project_name IS NOT NULL AND btrim(v_project_name) <> '' THEN
    PERFORM 1 FROM public.projects WHERE name = v_project_name FOR SHARE;
  END IF;

  IF v_project_name IS NOT NULL AND v_plot_key IS NOT NULL THEN
    v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
  END IF;

  -- Lock related contracts and sales deterministically
  PERFORM 1 FROM public.rental_contracts WHERE lead_id = v_lead_id OR (v_plot.id IS NOT NULL AND plot_id = v_plot.id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE lead_id = v_lead_id OR (v_plot.id IS NOT NULL AND plot_id = v_plot.id) ORDER BY id FOR UPDATE;

  -- Optimistic concurrency / revision checks
  IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;
  IF v_expected_lead_updated_at IS NOT NULL AND v_lead.updated_at IS DISTINCT FROM v_expected_lead_updated_at THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  -- Reject Active / Renewed rentals unconditionally!
  IF v_lead.status = 'Rented'
     OR v_lead.rental_status IN ('Active', 'Renewed')
     OR v_lead.active_rental_contract_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.lead_id = v_lead_id AND rc.status IN ('Active', 'Renewed')) THEN
    RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
  END IF;

  IF v_lead.status = 'Cancelled' OR v_lead.rental_status = 'Cancelled' THEN
    RAISE EXCEPTION 'SALES_TX_ALREADY_CANCELLED';
  END IF;

  IF v_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.rental_contracts WHERE id = v_contract_id FOR UPDATE;
    IF NOT FOUND OR v_contract.lead_id IS DISTINCT FROM v_lead_id THEN
      RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
    END IF;
    IF v_expected_contract_rev IS NOT NULL AND v_contract.deal_revision IS DISTINCT FROM v_expected_contract_rev THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    IF v_contract.status IN ('Active', 'Renewed') THEN
      RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
    END IF;
    IF v_contract.status <> 'PendingContract' THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
  END IF;

  -- Must strictly be PendingContract (never cancel purchase bookings or ConvertedToBuy)
  IF NOT (
    v_lead.rental_status = 'PendingContract'
    OR v_contract.id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.lead_id = v_lead_id AND rc.status = 'PendingContract')
    OR (v_lead.deal_type IN ('rent', 'rent_to_own') AND v_lead.status IN ('Reserved', 'Booked') AND COALESCE(v_lead.rental_status, '') NOT IN ('ConvertedToBuy', 'MovedOut', 'Cancelled', 'Expired'))
  ) THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;

  -- Verify plot ownership safety before writing
  IF v_plot.id IS NOT NULL THEN
    IF lower(btrim(COALESCE(v_plot.sale_status, ''))) = 'transferred' THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.plot_id = v_plot.id AND rc.status IN ('Active', 'Renewed')) THEN
      RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.plot_id = v_plot.id AND rc.lead_id IS DISTINCT FROM v_lead_id AND rc.status = 'PendingContract')
       OR EXISTS (SELECT 1 FROM public.sales s WHERE s.plot_id = v_plot.id AND s.lead_id IS DISTINCT FROM v_lead_id AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled') THEN
      RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER';
    END IF;
  END IF;

  v_cancel_note := '[ยกเลิกการจองเช่า โดย ' || v_actor.actor_label || ']: ' || v_reason;

  -- 1. Cancel ONLY PendingContract rows belonging to this lead
  UPDATE public.rental_contracts
  SET status = 'Cancelled',
      notes = concat_ws(E'\n', v_cancel_note, NULLIF(notes, '')),
      deal_revision = v_new_contract_rev,
      updated_at = v_now
  WHERE lead_id = v_lead_id
    AND status = 'PendingContract'
    AND (v_contract_id IS NULL OR id = v_contract_id);

  -- 2. Cancel lead
  UPDATE public.leads
  SET status = 'Cancelled',
      crm_status = 'Cancelled — ยกเลิกการจองเช่า',
      rental_status = 'Cancelled',
      lost_reason = v_reason,
      notes = concat_ws(E'\n\n---\n', v_cancel_note, NULLIF(notes, '')),
      deal_revision = v_new_lead_rev,
      updated_at = v_now
  WHERE id = v_lead_id;

  -- 3. Release plot stock + rental fields ONLY if no other holder remains on the plot
  IF v_plot.id IS NOT NULL AND NOT sales_private.plot_has_active_holder(v_plot.id) THEN
    INSERT INTO sales_private.plot_stock_write_permits (
      transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
    ) VALUES (
      txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_cancel_booking', false, 'ready_for_sale'
    );

    UPDATE public.plots
    SET has_customer = false,
        sale_status = 'ready_for_sale',
        current_tenant_name = NULL,
        current_tenant_phone = NULL,
        rental_program = NULL,
        monthly_rent = NULL,
        security_deposit = NULL,
        lease_start_date = NULL,
        lease_end_date = NULL,
        highlight_note = NULL
    WHERE id = v_plot.id;

    DELETE FROM sales_private.plot_stock_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

    v_plot_released := true;
  END IF;

  INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
  VALUES (
    'lead', v_lead_id, COALESCE(v_lead.status, 'Reserved'), 'Cancelled',
    'ยกเลิกการจองเช่า (' || v_actor.actor_label || '): ' || v_reason,
    v_now
  );

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'rental_cancel_booking',
    'leadId', v_lead_id,
    'contractId', v_contract.id,
    'plotId', v_plot.id,
    'plotReleased', v_plot_released,
    'rentalStatus', 'Cancelled',
    'leadRevision', v_new_lead_rev,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'rental_cancel_booking', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_cancel_rental_booking(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_cancel_rental_booking(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. RPC 4: Move Out / End Active Rental Contract
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_tx_move_out_rental(
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
  v_move_out_date date;
  v_utility numeric;
  v_damage numeric;
  v_cleaning numeric;
  v_notes text;
  v_refund numeric;
  v_contract public.rental_contracts%ROWTYPE;
  v_plot public.plots%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_new_contract_rev uuid := gen_random_uuid();
  v_new_lead_rev uuid := gen_random_uuid();
  v_plot_released boolean := false;
  v_move_out_log text;
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
  v_move_out_date := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'moveOutDate', '')), '')::date, (v_now AT TIME ZONE 'Asia/Bangkok')::date);
  v_utility := COALESCE((p_payload ->> 'utilityDeduction')::numeric, 0);
  v_damage := COALESCE((p_payload ->> 'damageDeduction')::numeric, 0);
  v_cleaning := COALESCE((p_payload ->> 'cleaningDeduction')::numeric, 0);
  v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');

  IF v_contract_id IS NULL OR v_utility < 0 OR v_damage < 0 OR v_cleaning < 0 THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'rental_move_out' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  -- Peek contract to resolve plot & project for canonical lock order
  SELECT * INTO v_contract FROM public.rental_contracts WHERE id = v_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_CONTRACT_NOT_FOUND';
  END IF;

  PERFORM 1 FROM public.projects WHERE name = v_contract.project_name FOR SHARE;
  v_plot := sales_private.lock_plot_in_project(v_contract.project_name, v_contract.plot_id);

  IF v_contract.lead_id IS NOT NULL THEN
    IF v_lead_id IS NOT NULL AND v_lead_id <> v_contract.lead_id THEN
      RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
    END IF;
    SELECT * INTO v_lead FROM public.leads WHERE id = v_contract.lead_id FOR UPDATE;
  END IF;

  SELECT * INTO v_contract FROM public.rental_contracts WHERE id = v_contract_id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;

  IF v_expected_contract_rev IS NOT NULL AND v_contract.deal_revision IS DISTINCT FROM v_expected_contract_rev THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;
  IF v_lead.id IS NOT NULL AND v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  IF v_contract.status NOT IN ('Active', 'Renewed') THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  -- Preserve exact existing refund formula
  v_refund := ROUND(GREATEST(0, COALESCE(v_contract.security_deposit, 0) - (v_utility + v_damage + v_cleaning)), 2);
  v_move_out_log := '[สิ้นสุดสัญญาเช่า ย้ายออก ' || to_char(v_move_out_date, 'YYYY-MM-DD') || ' คืนประกัน ' || v_refund::text || ' บ.]'
    || CASE WHEN v_notes IS NOT NULL THEN ' หมายเหตุ: ' || v_notes ELSE '' END;

  -- 1. End contract
  UPDATE public.rental_contracts
  SET status = 'MovedOut',
      move_out_date = v_move_out_date,
      deposit_refunded = v_refund,
      notes = concat_ws(E'\n', NULLIF(notes, ''), v_move_out_log),
      deal_revision = v_new_contract_rev,
      updated_at = v_now
  WHERE id = v_contract.id;

  -- 2. Update lead if still bound to this contract
  IF v_lead.id IS NOT NULL AND (v_lead.active_rental_contract_id IS NULL OR v_lead.active_rental_contract_id = v_contract.id) THEN
    UPDATE public.leads
    SET status = 'MovedOut',
        rental_status = 'MovedOut',
        crm_status = 'MovedOut — ย้ายออก / สิ้นสุดสัญญาเช่า',
        active_rental_contract_id = NULL,
        notes = concat_ws(E'\n', NULLIF(notes, ''), v_move_out_log),
        deal_revision = v_new_lead_rev,
        updated_at = v_now
    WHERE id = v_lead.id;
  END IF;

  -- 3. Release plot ONLY if no other active sale or rental remains
  IF NOT sales_private.plot_has_active_holder(v_plot.id) THEN
    INSERT INTO sales_private.plot_stock_write_permits (
      transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
    ) VALUES (
      txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_move_out', false, 'ready_for_sale'
    );

    UPDATE public.plots
    SET has_customer = false,
        sale_status = 'ready_for_sale',
        current_tenant_name = NULL,
        current_tenant_phone = NULL,
        rental_program = NULL,
        monthly_rent = NULL,
        security_deposit = NULL,
        lease_start_date = NULL,
        lease_end_date = NULL,
        highlight_note = NULL
    WHERE id = v_plot.id;

    DELETE FROM sales_private.plot_stock_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

    v_plot_released := true;
  END IF;

  IF v_lead.id IS NOT NULL THEN
    INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
    VALUES (
      'lead', v_lead.id, COALESCE(v_lead.status, 'Rented'), 'MovedOut',
      'ย้ายออก (' || v_actor.actor_label || ') คืนประกัน ' || v_refund::text || ' บ.',
      v_now
    );
  END IF;

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'rental_move_out',
    'contractId', v_contract.id,
    'leadId', v_lead.id,
    'plotId', v_plot.id,
    'depositRefunded', v_refund,
    'plotReleased', v_plot_released,
    'rentalStatus', 'MovedOut',
    'contractRevision', v_new_contract_rev,
    'leadRevision', CASE WHEN v_lead.id IS NOT NULL THEN v_new_lead_rev ELSE NULL END,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'rental_move_out', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_move_out_rental(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_move_out_rental(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 11. RPC 5: Convert Active Rental to Purchase (Atomic Handover, Zero Vacant Gap)
-- ------------------------------------------------------------------------------
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
  v_purchase_date := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'purchaseDate', '')), '')::date, (v_now AT TIME ZONE 'Asia/Bangkok')::date);
  v_purchase_ts := (v_purchase_date::timestamp AT TIME ZONE 'Asia/Bangkok');
  v_final_price := COALESCE((p_payload ->> 'finalPurchasePrice')::numeric, 0);
  v_booking_credit := COALESCE((p_payload ->> 'appliedBookingCredit')::numeric, 0);
  v_payment_method := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'paymentMethod', '')), ''), 'mortgage');
  v_closing_agent := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'closingAgent', '')), ''), v_actor.actor_label);
  v_notes := NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), '');

  IF v_contract_id IS NULL OR v_final_price <= 0 OR v_booking_credit < 0
     OR v_booking_credit > v_final_price
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
  IF v_contract.lead_id IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_REQUIRED';
  END IF;
  IF v_lead_id IS NOT NULL AND v_lead_id <> v_contract.lead_id THEN
    RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
  END IF;
  v_lead_id := v_contract.lead_id;

  -- Canonical lock order: project -> plot -> lead -> contracts -> sales
  PERFORM 1 FROM public.projects WHERE name = v_contract.project_name FOR SHARE;
  v_plot := sales_private.lock_plot_in_project(v_contract.project_name, v_contract.plot_id);
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
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;
  IF v_lead.status IN ('Cancelled', 'Lost', 'Transferred', 'Handover') THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;
  IF v_lead.active_rental_contract_id IS NOT NULL AND v_lead.active_rental_contract_id <> v_contract.id THEN
    RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
  END IF;
  IF lower(btrim(COALESCE(v_plot.sale_status, ''))) = 'transferred' THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;

  -- Reject if another customer holds any non-cancelled sale or active/pending rental on this plot
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

  -- Step B: Create/update purchase sale record IMMEDIATELY (plot has_customer NEVER drops to false!)
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
    INSERT INTO sales_private.sale_tx_write_permits (transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command)
    VALUES (txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, v_lead_id, 'rental_convert_to_buy');

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
    v_sale_id := gen_random_uuid();
    INSERT INTO sales_private.sale_tx_write_permits (transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command)
    VALUES (txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, v_lead_id, 'rental_convert_to_buy');

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

  -- Step D: Transition plots atomically (has_customer stays TRUE continuously; rental fields cleared)
  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_convert_to_buy', true, 'reserved'
  );

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

-- ------------------------------------------------------------------------------
-- 12. RPC 6: Transactional Purchase Booking (Shared Lock & Ownership Rules)
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

  -- Lock plot FIRST
  v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;

  IF NOT sales_private.plot_is_vacant_for_claim(v_plot) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_UNAVAILABLE';
  END IF;

  IF v_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
    END IF;
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

  INSERT INTO sales_private.sale_tx_write_permits (transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command)
  VALUES (txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, v_lead_id, 'purchase_book');

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

  INSERT INTO sales_private.plot_stock_write_permits (
    transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
  ) VALUES (
    txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'purchase_book', true, 'reserved'
  );

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

-- ------------------------------------------------------------------------------
-- 13. Replace public.ensure_lead_sale_record (NO DISABLE TRIGGER, BLOCKS RENTALS)
-- ------------------------------------------------------------------------------
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
  v_target_plot_key text;
  v_target_contract_status text;
  v_target_plot_status text;
BEGIN
  -- 1. Strict writer role check (rejects anon, owner/read-only, and never reads JWT user_metadata)
  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'CRM_LEAD_REQUIRED';
  END IF;

  -- 2. Shared global lock
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  -- Peek lead to resolve canonical plot & project for deterministic lock order
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

  -- Lock lead, contracts, and sales in canonical order
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id OR lead_id = p_lead_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id OR lead_id = p_lead_id ORDER BY id FOR UPDATE;

  -- 3. HARD GUARD: Never allow rental deals to create or mutate a purchase sale record!
  --    (ConvertedToBuy leads that already completed conversion are allowed.)
  IF sales_private.lead_is_rental_deal(v_lead) THEN
    RAISE EXCEPTION 'CRM_RENTAL_DEAL_FORBIDDEN_IN_SALE_RPC';
  END IF;

  -- Block creating/linking sale on a plot occupied by any rental contract or another customer's sale
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
    WHEN p_stage IN ('transferred', 'handover') THEN 'Transferred'
    WHEN p_stage = 'booked' THEN 'Reserved'
    WHEN p_stage = 'cancelled' THEN 'Cancelled'
    ELSE 'Contracted'
  END;

  v_target_plot_status := CASE
    WHEN p_stage IN ('transferred', 'handover') THEN 'transferred'
    WHEN p_stage = 'cancelled' THEN 'ready_for_sale'
    ELSE COALESCE(NULLIF(v_plot.sale_status, ''), 'reserved')
  END;

  -- 4. Reuse existing non-cancelled sale for this lead or insert a new one WITH ALL TRIGGERS ENABLED
  SELECT id INTO v_sale_id
  FROM public.sales
  WHERE lead_id = p_lead_id
    AND COALESCE(lower(btrim(crm_stage)), lower(btrim(contract_status)), 'unknown') <> 'cancelled'
  LIMIT 1;

  IF v_sale_id IS NOT NULL THEN
    INSERT INTO sales_private.sale_tx_write_permits (transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command)
    VALUES (txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, p_lead_id, 'purchase_ensure_sale');

    UPDATE public.sales
    SET plot_id = COALESCE(v_plot.id, plot_id),
        sale_price = COALESCE(p_sale_price, sale_price),
        land_office_price = COALESCE(p_land_office_price, land_office_price),
        bank_name = COALESCE(p_bank_name, bank_name),
        payment_method = COALESCE(p_payment_method, payment_method, 'mortgage'),
        contract_status = v_target_contract_status,
        crm_stage = COALESCE(p_stage, crm_stage),
        transferred_at = CASE WHEN p_stage = 'transferred' THEN COALESCE(p_event_date, transferred_at, v_now) ELSE transferred_at END,
        contracted_at = CASE WHEN p_stage = 'contracted' THEN COALESCE(p_event_date, contracted_at, v_now) ELSE contracted_at END,
        crm_handover_at = CASE WHEN p_stage = 'handover' THEN COALESCE(p_event_date, crm_handover_at, v_now) ELSE crm_handover_at END,
        cancelled_at = CASE WHEN p_stage = 'cancelled' THEN COALESCE(p_event_date, cancelled_at, v_now) ELSE cancelled_at END,
        updated_at = v_now
    WHERE id = v_sale_id;
  ELSE
    v_sale_id := gen_random_uuid();
    INSERT INTO sales_private.sale_tx_write_permits (transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command)
    VALUES (txid_current(), pg_backend_pid(), v_actor.actor_id, v_sale_id, v_plot.id, p_lead_id, 'purchase_ensure_sale');

    INSERT INTO public.sales (
      id, lead_id, plot_id, sale_price, land_office_price, bank_name,
      payment_method, contract_status, crm_stage, booking_route, booking_route_reason,
      booked_at, transferred_at, contracted_at, crm_handover_at, cancelled_at,
      created_at, updated_at
    ) VALUES (
      v_sale_id, p_lead_id, v_plot.id, p_sale_price, p_land_office_price, p_bank_name,
      COALESCE(p_payment_method, 'mortgage'), v_target_contract_status, COALESCE(p_stage, 'booked'),
      'without_visit', 'Auto-created from Lead deal workflow',
      v_now,
      CASE WHEN p_stage = 'transferred' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      CASE WHEN p_stage = 'contracted' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      CASE WHEN p_stage = 'handover' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      CASE WHEN p_stage = 'cancelled' THEN COALESCE(p_event_date, v_now) ELSE NULL END,
      v_now, v_now
    );
  END IF;

  DELETE FROM sales_private.sale_tx_write_permits
  WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND sale_id = v_sale_id;

  -- 5. Sync plot stock flags via transaction-local permit (NO DISABLE TRIGGER!)
  DECLARE
    v_should_occupy boolean := sales_private.plot_has_active_holder(v_plot.id);
  BEGIN
    INSERT INTO sales_private.plot_stock_write_permits (
      transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
    ) VALUES (
      txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'purchase_ensure_sale',
      v_should_occupy,
      CASE WHEN v_should_occupy THEN v_target_plot_status ELSE 'ready_for_sale' END
    );

    UPDATE public.plots
    SET has_customer = v_should_occupy,
        sale_status = CASE WHEN v_should_occupy THEN v_target_plot_status ELSE 'ready_for_sale' END
    WHERE id = v_plot.id;

    DELETE FROM sales_private.plot_stock_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;
  END;

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
