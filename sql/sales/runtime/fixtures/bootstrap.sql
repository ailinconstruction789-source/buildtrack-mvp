-- BUILDTRACK SALES RUNTIME TEST BOOTSTRAP -- LOCAL SYNTHETIC DATA ONLY.
-- NOT a Supabase migration. NEVER run against a real application database.
-- Use once in a NEW disposable native PostgreSQL cluster/database created by the
-- isolated runner. No database URL, credentials or exported production data are
-- accepted here. The runner must additionally verify its own fresh data_directory,
-- bind/listen only on 127.0.0.1 with a random high port, and own cluster cleanup.
-- This fixture creates only prerequisites referenced by the base + 04--09 drafts;
-- the read-only legacy audit reports 01--03 and unrelated app modules are excluded.
-- No original design-file execution guards are changed by this fixture.
--
-- Deliberately minimal legacy facade: identifier types/PKs and referenced columns
-- only, NOT the production schema, grants, RLS, triggers or cascading behavior.
-- Successful tests cannot certify real Supabase auth, legacy compatibility, live
-- migrations, legacy access cutover, deployment or production concurrency.
-- No user, role mapping, project, Lead or other row is seeded. Scenario fixtures
-- supply explicitly fake identities/data after compiling the guarded draft bodies
-- through the runner's separately controlled in-memory/local-test-only process.

BEGIN;
DO $synthetic_only$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-z0-9_]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR (inet_server_addr() IN ('127.0.0.1'::inet,'::1'::inet)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SYNTHETIC TEST ONLY: require disposable runtime database, explicit runner marker and TCP loopback';
  END IF;
  IF to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'SYNTHETIC TEST ONLY: native PostgreSQL gen_random_uuid() is required; do not install extensions against another database';
  END IF;
  IF to_regnamespace('auth') IS NOT NULL OR to_regnamespace('sales_private') IS NOT NULL
    OR to_regclass('public.projects') IS NOT NULL OR to_regclass('public.plots') IS NOT NULL
    OR to_regclass('public.leads') IS NOT NULL OR to_regclass('public.sales') IS NOT NULL
    OR to_regclass('public.customer_voices') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated')) THEN
    RAISE EXCEPTION 'SYNTHETIC TEST ONLY: bootstrap requires a fresh cluster/database; never overwrite existing objects or roles';
  END IF;
END;
$synthetic_only$;

-- Role names are the only Supabase-specific role prerequisite in the drafts.
-- NOLOGIN/NOBYPASSRLS let scenarios exercise SET ROLE without granting elevated
-- permissions. No real accounts, passwords, service-role credentials or JWTs.
CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth.users FROM PUBLIC, anon, authenticated;

-- Emulates only auth.uid()'s request-sub lookup, not Supabase authentication/JWT
-- verification. The trusted TEST HARNESS sets these local/session GUCs explicitly;
-- arbitrary clients must never receive SQL connections or this fixture in an app.
-- Missing/empty request identity returns NULL; invalid UUID text raises instead
-- of silently inventing a user. Supports both common PostgREST claim encodings.
CREATE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog
AS $synthetic_uid$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub',true),''),
    NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'
  )::uuid;
$synthetic_uid$;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

-- Exact minimal identifier types from the supplied design dependency contract.
-- Extra production NOT NULL/default/FK/trigger behavior is intentionally NOT
-- guessed. Scenarios explicitly set any stock/status values they need.
CREATE TABLE public.projects (
  name text PRIMARY KEY,
  is_closed boolean
);
CREATE TABLE public.plots (
  id text PRIMARY KEY,
  project_name text,
  has_customer boolean,
  sale_status text
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text
);
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  plot_id text,
  contract_status text,
  cancellation_reason text
);
CREATE TABLE public.customer_voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
REVOKE ALL ON public.projects, public.plots, public.leads, public.sales, public.customer_voices
  FROM PUBLIC, anon, authenticated;

-- No fixture feature enablement or fake staff/Lead rows: scenarios own those.
COMMIT;
