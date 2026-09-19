-- SALES V2 WORK SCHEDULE -- DESIGN ONLY, 2026-09-16. NEVER RUN ON SUPABASE.
-- Depends on the UNAPPLIED base, 04 and 05 drafts. Not a deployment migration.
-- Admin publishes an explicitly complete replacement snapshot, not row patches.
-- No backfill, schedule guesses, SLA recalculation, notice delivery or HR scoring.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: work-schedule draft is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings
  ADD COLUMN work_schedule_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE sales_private.crm_work_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  current_version_id uuid NOT NULL,
  UNIQUE (id,sales_user_id)
);
CREATE TABLE sales_private.crm_work_calendar_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL,
  sales_user_id uuid NOT NULL,
  previous_version_id uuid,
  coverage_starts_at timestamptz NOT NULL,
  coverage_ends_at timestamptz NOT NULL,
  coverage_complete boolean NOT NULL CHECK (coverage_complete),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  published_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 1 AND 1000),
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object' AND octet_length(request_payload::text)<=65536),
  UNIQUE (published_by_user_id,request_id),
  UNIQUE (id,calendar_id),
  UNIQUE (id,sales_user_id),
  FOREIGN KEY (calendar_id,sales_user_id) REFERENCES sales_private.crm_work_calendars(id,sales_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_version_id,calendar_id) REFERENCES sales_private.crm_work_calendar_versions(id,calendar_id) ON DELETE RESTRICT,
  CHECK (previous_version_id IS NULL OR previous_version_id<>id),
  CHECK (isfinite(coverage_starts_at) AND isfinite(coverage_ends_at)
    AND coverage_starts_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND coverage_ends_at <= TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
    AND coverage_ends_at>coverage_starts_at
    AND coverage_ends_at-coverage_starts_at<=interval '31622400 seconds')
);
ALTER TABLE sales_private.crm_work_calendars
  ADD CONSTRAINT crm_work_current_version_fk FOREIGN KEY (current_version_id,id)
    REFERENCES sales_private.crm_work_calendar_versions(id,calendar_id)
    DEFERRABLE INITIALLY DEFERRED;
-- The deferred circular FK permits initial head+version in one transaction only;
-- no committed head may point to no version or another calendar's version.
ALTER TABLE public.crm_work_periods
  ADD COLUMN calendar_version_id uuid,
  ADD CONSTRAINT crm_work_period_version_owner_fk FOREIGN KEY (calendar_version_id,sales_user_id)
    REFERENCES sales_private.crm_work_calendar_versions(id,sales_user_id) ON DELETE RESTRICT;
CREATE INDEX crm_work_periods_version_idx ON public.crm_work_periods(calendar_version_id,starts_at,id)
  WHERE calendar_version_id IS NOT NULL;
-- Existing rows deliberately retain NULL version: unknown/unattested coverage.
-- Never infer their completeness, attach them to a version, or use them as fallback.

ALTER TABLE sales_private.crm_work_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.crm_work_calendar_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_work_calendars FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sales_private.crm_work_calendar_versions FROM PUBLIC, anon, authenticated;
-- Required privacy cutover: the base global CRM read policy is too broad for
-- staff leave/break reasons. Revoke direct reads, even for Admin; only the gated
-- Admin RPC projects schedules. No raw period reason or HR details are returned.
REVOKE ALL ON public.crm_work_periods FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sales_private.crm_work_version_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $immutable_version$
BEGIN
  RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT';
END;
$immutable_version$;
REVOKE ALL ON FUNCTION sales_private.crm_work_version_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_work_versions_immutable BEFORE UPDATE OR DELETE ON sales_private.crm_work_calendar_versions
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_work_version_immutable();

CREATE FUNCTION sales_private.crm_work_versioned_period_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $immutable_period$
BEGIN
  IF OLD.calendar_version_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.calendar_version_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$immutable_period$;
REVOKE ALL ON FUNCTION sales_private.crm_work_versioned_period_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_work_versioned_periods_immutable BEFORE UPDATE OR DELETE ON public.crm_work_periods
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_work_versioned_period_immutable();

CREATE FUNCTION public.crm_v2_work_schedule_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','work_schedule_v1','enabled',
    public.crm_v2_role()='admin' AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND work_schedule_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_work_schedule_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_work_schedule_capabilities() TO authenticated;

-- One STABLE data snapshot, read-only, with no role/head/advisory locks or last_seen.
-- asOf is read after projection so a just-committed publication cannot appear to
-- occur after the read merely because statement_timestamp preceded its commit.
CREATE FUNCTION public.crm_v2_work_schedule_snapshot(p_sales_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  candidates_json jsonb; candidates_more boolean; calendar_json jsonb:=NULL;
  head_row sales_private.crm_work_calendars%ROWTYPE;
  version_row sales_private.crm_work_calendar_versions%ROWTYPE;
  periods_json jsonb; period_count bigint; as_of timestamptz;
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SCHEDULE_FORBIDDEN'; END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND work_schedule_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_SCHEDULE_SETUP_REQUIRED'; END IF;
  IF p_sales_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_private.crm_user_roles
    WHERE user_id=p_sales_user_id AND role='sales' AND is_active) THEN RAISE EXCEPTION 'CRM_SCHEDULE_NOT_FOUND'; END IF;
  -- A selected active Sales is first even outside the ordinary first 200; this
  -- still returns at most 200, with accurate evidence of any omitted candidate.
  WITH recent AS (
    SELECT user_id,display_name FROM sales_private.crm_user_roles WHERE role='sales' AND is_active
      ORDER BY (user_id=p_sales_user_id) DESC NULLS LAST,user_id LIMIT 201
  ), numbered AS (
    SELECT r.*,row_number() OVER (ORDER BY (user_id=p_sales_user_id) DESC NULLS LAST,user_id) AS rn FROM recent r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',n.user_id,'displayName',n.display_name)
    ORDER BY n.rn) FILTER (WHERE n.rn<=200),'[]'::jsonb),count(*)>200
    INTO candidates_json,candidates_more FROM numbered n;
  IF p_sales_user_id IS NOT NULL THEN
    SELECT * INTO head_row FROM sales_private.crm_work_calendars WHERE sales_user_id=p_sales_user_id;
    IF FOUND THEN
      SELECT * INTO version_row FROM sales_private.crm_work_calendar_versions
        WHERE id=head_row.current_version_id AND calendar_id=head_row.id AND sales_user_id=p_sales_user_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SCHEDULE_SETUP_REQUIRED'; END IF;
      WITH bounded AS (
        SELECT id,sales_user_id,period_type,starts_at,ends_at FROM public.crm_work_periods
          WHERE calendar_version_id=version_row.id AND sales_user_id=p_sales_user_id
          ORDER BY starts_at,id LIMIT 401
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'salesUserId',p.sales_user_id,
        'type',p.period_type,'startsAt',p.starts_at,'endsAt',p.ends_at) ORDER BY p.starts_at,p.id),'[]'::jsonb),count(*)
        INTO periods_json,period_count FROM bounded p;
      IF period_count>400 THEN RAISE EXCEPTION 'CRM_SCHEDULE_SETUP_REQUIRED'; END IF;
      calendar_json:=jsonb_build_object('raw',jsonb_build_object('id',head_row.id,'version',version_row.id,
        'ownerUserId',p_sales_user_id,'coverage',jsonb_build_object('startsAt',version_row.coverage_starts_at,
          'endsAt',version_row.coverage_ends_at,'complete',version_row.coverage_complete),'periods',periods_json),
        'publishedAt',version_row.published_at,'publishedByUserId',version_row.published_by_user_id,
        'changeReason',version_row.change_reason);
    END IF;
  END IF;
  as_of:=clock_timestamp();
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role','admin'),'asOf',as_of,
    'sales',candidates_json,'salesHasMore',candidates_more,'selectedSalesUserId',p_sales_user_id,'calendar',calendar_json);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_work_schedule_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_work_schedule_snapshot(uuid) TO authenticated;

CREATE FUNCTION public.crm_v2_publish_work_schedule(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $publish$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); enabled boolean;
  target_id uuid; expected_version uuid; reason_value text; coverage_json jsonb; row_json jsonb;
  coverage_from timestamptz; coverage_through timestamptz; row_from timestamptz; row_through timestamptz;
  row_type text; period_types text[]:=ARRAY[]::text[];
  period_starts timestamptz[]:=ARRAY[]::timestamptz[]; period_ends timestamptz[]:=ARRAY[]::timestamptz[];
  role_row sales_private.crm_user_roles%ROWTYPE; target_active boolean:=false;
  head_row sales_private.crm_work_calendars%ROWTYPE; head_exists boolean;
  receipt_row sales_private.crm_work_calendar_versions%ROWTYPE;
  calendar_id_value uuid; next_version uuid:=gen_random_uuid(); server_now timestamptz;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SCHEDULE_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND work_schedule_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_SCHEDULE_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>65536 THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
  IF NOT (p_payload ?& ARRAY['salesUserId','expectedVersion','coverage','periods','confirmedComplete','reason'])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
      'salesUserId','expectedVersion','coverage','periods','confirmedComplete','reason'))
    OR jsonb_typeof(p_payload->'salesUserId') IS DISTINCT FROM 'string'
    OR length(p_payload->>'salesUserId')<>36 OR (p_payload->>'salesUserId') !~ uuid_pattern
    OR jsonb_typeof(p_payload->'expectedVersion') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'expectedVersion')='string'
      AND (length(p_payload->>'expectedVersion')<>36 OR (p_payload->>'expectedVersion') !~ uuid_pattern))
    OR (p_payload->'confirmedComplete') IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'coverage') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'periods') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_payload->'periods')>400 THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
  coverage_json:=p_payload->'coverage';
  IF NOT (coverage_json ?& ARRAY['startsAt','endsAt'])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(coverage_json) k WHERE k NOT IN ('startsAt','endsAt'))
    OR jsonb_typeof(coverage_json->'startsAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(coverage_json->'endsAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
  BEGIN
    reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
    coverage_from:=sales_private.crm_work_timestamp(coverage_json->>'startsAt');
    coverage_through:=sales_private.crm_work_timestamp(coverage_json->>'endsAt');
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END;
  IF coverage_from<TIMESTAMPTZ '0001-01-01 00:00:00+00'
    OR coverage_through>TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
    OR coverage_from>=coverage_through OR coverage_through-coverage_from>interval '31622400 seconds' THEN
    RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT';
  END IF;
  FOR row_json IN SELECT value FROM jsonb_array_elements(p_payload->'periods')
  LOOP
    IF jsonb_typeof(row_json) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
    IF NOT (row_json ?& ARRAY['type','startsAt','endsAt'])
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(row_json) k WHERE k NOT IN ('type','startsAt','endsAt'))
      OR jsonb_typeof(row_json->'type') IS DISTINCT FROM 'string' OR (row_json->>'type') NOT IN ('work','leave','break')
      OR jsonb_typeof(row_json->'startsAt') IS DISTINCT FROM 'string'
      OR jsonb_typeof(row_json->'endsAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
    BEGIN
      row_from:=sales_private.crm_work_timestamp(row_json->>'startsAt');
      row_through:=sales_private.crm_work_timestamp(row_json->>'endsAt');
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END;
    IF row_from<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR row_through>TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
      OR row_from>=row_through THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
    row_type:=row_json->>'type';
    IF row_type='work' AND (row_from<coverage_from OR row_through>coverage_through) THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
    period_types:=array_append(period_types,row_type);
    period_starts:=array_append(period_starts,row_from); period_ends:=array_append(period_ends,row_through);
  END LOOP;
  -- Work overlap is ambiguous. Leave/break may overlap each other or span coverage;
  -- the pure adapter clips/unions approved exclusions, preserving [start,end).
  IF EXISTS (SELECT 1 FROM (
    SELECT p.starts_at,max(p.ends_at) OVER (ORDER BY p.starts_at,p.ends_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end
    FROM unnest(period_types,period_starts,period_ends) AS p(period_type,starts_at,ends_at) WHERE p.period_type='work'
  ) checked WHERE starts_at<prior_end) THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'; END IF;
  target_id:=(p_payload->>'salesUserId')::uuid; expected_version:=(p_payload->>'expectedVersion')::uuid;

  -- Lock order: settings -> actor/request advisory -> Sales advisory -> head ->
  -- ordered role rows. Initial publication must share the same per-Sales lock as
  -- replacements. Future role/roster writers must honor this order; no role writes
  -- occur here. Lead commands lock roles only after their own scope locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('work-schedule-request:'||actor_id::text||':'||p_request_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('work-schedule-sales:'||target_id::text,0));
  SELECT * INTO head_row FROM sales_private.crm_work_calendars WHERE sales_user_id=target_id FOR UPDATE;
  head_exists:=FOUND;
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN (actor_id,target_id) ORDER BY user_id FOR SHARE
  LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; END IF;
    IF role_row.user_id=target_id THEN target_active:=role_row.role='sales' AND role_row.is_active; END IF;
  END LOOP;
  IF actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SCHEDULE_FORBIDDEN'; END IF;
  -- Immutable version IS the receipt. Current Admin authority is mandatory, but
  -- replay precedes target-active/CAS checks so an earlier successful request is
  -- still recoverable after another version was published or Sales deactivated.
  SELECT * INTO receipt_row FROM sales_private.crm_work_calendar_versions
    WHERE published_by_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt_row.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_SCHEDULE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('calendarId',receipt_row.calendar_id,'version',receipt_row.id,
      'salesUserId',receipt_row.sales_user_id,'replayed',true);
  END IF;
  IF target_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_SCHEDULE_INACTIVE_TARGET'; END IF;
  IF (head_exists AND head_row.current_version_id IS DISTINCT FROM expected_version)
    OR (NOT head_exists AND expected_version IS NOT NULL) THEN RAISE EXCEPTION 'CRM_SCHEDULE_STALE_VERSION'; END IF;
  calendar_id_value:=CASE WHEN head_exists THEN head_row.id ELSE gen_random_uuid() END;
  server_now:=clock_timestamp();
  IF NOT head_exists THEN
    INSERT INTO sales_private.crm_work_calendars(id,sales_user_id,current_version_id)
      VALUES (calendar_id_value,target_id,next_version);
  END IF;
  INSERT INTO sales_private.crm_work_calendar_versions(id,calendar_id,sales_user_id,previous_version_id,
    coverage_starts_at,coverage_ends_at,coverage_complete,published_at,published_by_user_id,change_reason,request_id,request_payload)
    VALUES (next_version,calendar_id_value,target_id,CASE WHEN head_exists THEN head_row.current_version_id ELSE NULL END,
      coverage_from,coverage_through,true,server_now,actor_id,reason_value,p_request_id,p_payload);
  -- No per-row reason is accepted or copied. Keep only operational change reason
  -- on the Admin-only version; never request medical/health details for leave.
  INSERT INTO public.crm_work_periods(sales_user_id,period_type,starts_at,ends_at,reason,created_by_admin_id,created_at,calendar_version_id)
    SELECT target_id,p.period_type,p.starts_at,p.ends_at,NULL,actor_id,server_now,next_version
      FROM unnest(period_types,period_starts,period_ends) AS p(period_type,starts_at,ends_at);
  IF head_exists THEN
    UPDATE sales_private.crm_work_calendars SET current_version_id=next_version WHERE id=calendar_id_value;
  END IF;
  -- Do not mutate current SLA/tasks/notifications. Future calculation and delivery
  -- must resolve current head+version and reject stale evaluation snapshots first.
  RETURN jsonb_build_object('calendarId',calendar_id_value,'version',next_version,'salesUserId',target_id,'replayed',false);
END;
$publish$;
REVOKE ALL ON FUNCTION public.crm_v2_publish_work_schedule(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_publish_work_schedule(uuid,jsonb) TO authenticated;

ROLLBACK;
