-- SYNTHETIC ONLY. Missing legacy fields for the minimal bootstrap, not a migration.
-- Reviewed catalog types/defaults only; this does not recreate real RLS/triggers.
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR EXISTS(SELECT 1 FROM public.sales) THEN
    RAISE EXCEPTION 'SYNTHETIC EMPTY POST BOOKING FACADE ONLY';
  END IF;
END;
$guard$;
ALTER TABLE public.sales ADD COLUMN sale_price numeric(15,2) DEFAULT 0,
  ADD COLUMN booking_amount numeric(15,2) DEFAULT 0, ADD COLUMN bank_name varchar,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(),
  ADD COLUMN transferred_at timestamptz;
COMMIT;
