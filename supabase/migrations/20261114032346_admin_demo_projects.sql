-- Isolated map sandbox. No rows, relations, triggers or reports in production
-- projects/plots are changed. Requires the existing trusted actor deployment.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.app_current_actor()') IS NULL
    OR to_regprocedure('account_security_private.current_actor()') IS NULL THEN
    RAISE EXCEPTION 'DEMO_PROJECT_TRUSTED_AUTH_REQUIRED';
  END IF;
END;
$preflight$;

GRANT USAGE ON SCHEMA account_security_private TO authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.current_actor(), public.app_current_actor() TO authenticated;

CREATE SCHEMA buildtrack_demo_private;
REVOKE ALL ON SCHEMA buildtrack_demo_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA buildtrack_demo_private TO authenticated;

CREATE FUNCTION buildtrack_demo_private.valid_layout(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $validation$
DECLARE
  cell jsonb;
  identifiers text[] := ARRAY[]::text[];
  positions text[] := ARRAY[]::text[];
  position_key text;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object'
    OR octet_length(value::text) > 1048576
    OR (SELECT count(*) FROM jsonb_object_keys(value)) <> 4
    OR value->'version' IS DISTINCT FROM '1'::jsonb
    OR value->'cols' IS DISTINCT FROM '24'::jsonb
    OR value->'rows' IS DISTINCT FROM '16'::jsonb
    OR jsonb_typeof(value->'cells') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value->'cells') > 3456 THEN RETURN false; END IF;
  FOR cell IN SELECT * FROM jsonb_array_elements(value->'cells') LOOP
    IF jsonb_typeof(cell) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(cell)) <> 4
      OR jsonb_typeof(cell->'id') IS DISTINCT FROM 'string'
      OR length(btrim(cell->>'id')) NOT BETWEEN 1 AND 100
      OR (cell->>'id') ~ '[[:cntrl:]]'
      OR jsonb_typeof(cell->'kind') IS DISTINCT FROM 'string'
      OR cell->>'kind' NOT IN ('plot','road','earthwork','fence','drainage','water','electric','pole','walkway')
      OR jsonb_typeof(cell->'x') IS DISTINCT FROM 'number'
      OR jsonb_typeof(cell->'y') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF (cell->>'x')::numeric <> trunc((cell->>'x')::numeric)
      OR (cell->>'y')::numeric <> trunc((cell->>'y')::numeric)
      OR (cell->>'x')::numeric NOT BETWEEN 0 AND 23
      OR (cell->>'y')::numeric NOT BETWEEN 0 AND 15 THEN RETURN false; END IF;
    position_key := (cell->>'kind') || ':' || ((cell->>'x')::integer)::text || ':' || ((cell->>'y')::integer)::text;
    IF cell->>'id' = ANY(identifiers) OR position_key = ANY(positions) THEN RETURN false; END IF;
    identifiers := array_append(identifiers, cell->>'id');
    positions := array_append(positions, position_key);
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_parameter_value OR numeric_value_out_of_range OR invalid_text_representation THEN
  RETURN false;
END;
$validation$;
REVOKE ALL ON FUNCTION buildtrack_demo_private.valid_layout(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION buildtrack_demo_private.valid_layout(jsonb) TO authenticated;

CREATE TABLE public.admin_demo_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100 AND name !~ '[[:cntrl:]]'),
  layout_data jsonb NOT NULL DEFAULT '{"version":1,"cols":24,"rows":16,"cells":[]}'::jsonb
    CHECK (buildtrack_demo_private.valid_layout(layout_data)),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
COMMENT ON TABLE public.admin_demo_projects IS
  'Admin-only development sandbox. Never include in live project analytics, billing, customer data or notifications.';

CREATE FUNCTION buildtrack_demo_private.advance_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $revision$
BEGIN
  NEW.id := OLD.id;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := statement_timestamp();
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$revision$;
REVOKE ALL ON FUNCTION buildtrack_demo_private.advance_revision() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER admin_demo_projects_revision
  BEFORE UPDATE ON public.admin_demo_projects
  FOR EACH ROW EXECUTE FUNCTION buildtrack_demo_private.advance_revision();

CREATE FUNCTION buildtrack_demo_private.current_actor_role()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $actor_role$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  v_role text;
BEGIN
  IF current_setting('transaction_read_only', true) <> 'on' THEN
    RETURN public.app_current_actor()->>'role';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'APP_ACTOR_REQUIRED';
  END IF;
  BEGIN
    v_session := NULLIF(auth.jwt()->>'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'APP_ACTOR_REQUIRED';
  END;
  SELECT r.role INTO v_role
  FROM account_security_private.reviewed_roles r
  JOIN auth.users u ON u.id = r.auth_user_id
  JOIN auth.sessions s ON s.user_id = u.id AND s.id = v_session
  JOIN public.users p ON p.id = r.legacy_user_id
  WHERE r.auth_user_id = v_uid AND r.enabled
    AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous, false)
    AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
    AND (s.not_after IS NULL OR s.not_after > statement_timestamp());
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'APP_ACTOR_REQUIRED';
  END IF;
  RETURN v_role;
END;
$actor_role$;
REVOKE ALL ON FUNCTION buildtrack_demo_private.current_actor_role() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION buildtrack_demo_private.current_actor_role() TO authenticated;

ALTER TABLE public.admin_demo_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_demo_projects FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_demo_projects FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_demo_projects TO authenticated;
GRANT INSERT (id, name, layout_data) ON public.admin_demo_projects TO authenticated;
GRANT UPDATE (name, layout_data) ON public.admin_demo_projects TO authenticated;

CREATE POLICY admin_demo_projects_admin_only ON public.admin_demo_projects
  FOR ALL TO authenticated
  USING ((SELECT buildtrack_demo_private.current_actor_role()) = 'Admin')
  WITH CHECK (((SELECT public.app_current_actor())->>'role') = 'Admin');

-- No DELETE/TRUNCATE privilege. Ownership, timestamps and revision are never
-- client writable. Use id + expected revision on updates for optimistic locking.
NOTIFY pgrst, 'reload schema';
COMMIT;
