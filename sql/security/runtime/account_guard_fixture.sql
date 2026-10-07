-- SYNTHETIC ONLY: executed solely by the fresh, loopback-only native test runner.
BEGIN;
DO $local_only$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR to_regnamespace('auth') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated')) THEN
    RAISE EXCEPTION 'FRESH SYNTHETIC ACCOUNT TEST DATABASE REQUIRED';
  END IF;
END;
$local_only$;
CREATE ROLE anon NOLOGIN NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE synthetic_guard_delegate NOLOGIN NOBYPASSRLS;
GRANT synthetic_guard_delegate TO authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE SCHEMA extensions;
-- The portable PostgreSQL already bundles pgcrypto. Local test cluster only.
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text UNIQUE,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean DEFAULT false
);
CREATE TABLE auth.identities (
  id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id text, identity_data jsonb, provider text, created_at timestamptz, updated_at timestamptz
);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  not_after timestamptz
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT NULLIF(current_setting('request.jwt.claims',true),'')::jsonb; $$;
REVOKE ALL ON FUNCTION auth.uid(),auth.jwt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated;
-- Real JWT signature validation and Supabase Auth API are NOT emulated here.

CREATE TABLE public.users (
  id serial PRIMARY KEY, username text UNIQUE NOT NULL, role text NOT NULL,
  created_at timestamptz DEFAULT now(), last_seen_at timestamptz
);
CREATE TABLE public.foremen (id serial PRIMARY KEY, name text UNIQUE NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE public.task_updates (user_name text);
CREATE TABLE public.defects (reported_by text);
CREATE TABLE public.assignments (user_name text);
CREATE TABLE public.task_material_requests (requested_by text);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- Reproduce the dangerous combination discovered by catalog audit, not real data.
CREATE POLICY legacy_open_users ON public.users FOR ALL TO public USING (true) WITH CHECK (true);
GRANT ALL ON public.users TO anon,authenticated;
GRANT UPDATE (role), INSERT (username,role), REFERENCES (id) ON public.users TO anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.users_id_seq TO anon,authenticated;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('a0250000-0000-4000-8000-000000000001','guard_admin@buildtrack.local','{"username":"guard_admin","role":"Admin"}'),
  ('a0250000-0000-4000-8000-000000000002','guard_sales@buildtrack.local','{"username":"guard_sales","role":"Sales"}'),
  ('a0250000-0000-4000-8000-000000000003','guard_owner@buildtrack.local','{"username":"guard_owner","role":"Owner"}'),
  ('a0250000-0000-4000-8000-000000000004','guard_foreman@buildtrack.local','{"username":"guard_foreman","role":"Foreman"}');
INSERT INTO auth.sessions(id,user_id) SELECT
  replace(id::text,'a025','b025')::uuid,id FROM auth.users;
INSERT INTO public.users(id,username,role) VALUES
  (1,'guard_admin','Admin'),(2,'guard_sales','Sales'),(3,'guard_owner','Owner'),(4,'guard_foreman','Foreman');
SELECT setval('public.users_id_seq',100,true);
INSERT INTO public.task_updates VALUES ('guard_target');
INSERT INTO public.defects VALUES ('guard_target');
INSERT INTO public.assignments VALUES ('guard_target');
INSERT INTO public.task_material_requests VALUES ('guard_target');
-- Adversarial defaults, not assumptions about the real project's defaults.
-- The runner resets these after phase 1 so later drafts keep their own fixtures.
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role,synthetic_guard_delegate;
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role,synthetic_guard_delegate;
COMMIT;
