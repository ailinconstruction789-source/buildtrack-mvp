-- SALES V2 CENTRAL REGISTRY SEARCH -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on the guarded base draft; no writes or backfill.
-- Uses the existing default-disabled central_intake_enabled switch. Intake v1
-- and its create RPC remain unchanged. Search is a separately versioned reader.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: central search is not authorized for database execution';
END;
$draft_only$;

CREATE FUNCTION public.crm_v2_central_search_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $capabilities$
  SELECT jsonb_build_object('contract_version','central_search_v1','enabled',
    COALESCE((public.crm_v2_capabilities()->>'enabled')::boolean,false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_central_search_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_central_search_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_central_search(p_filters jsonb,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  trim_chars text:=U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  search_value text; project_value text; channel_value text; owner_value uuid; status_value text; unassigned boolean;
  filters_json jsonb; customers_json jsonb; channels_json jsonb; more_rows boolean; more_channels boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF (public.crm_v2_central_search_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SETUP_REQUIRED';
  END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 OR p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_filters))<>6
    OR NOT p_filters ?& ARRAY['search','project','channel','owner','status','unassignedOnly']
    OR jsonb_typeof(p_filters->'unassignedOnly') IS DISTINCT FROM 'boolean'
    OR EXISTS(SELECT 1 FROM jsonb_each(p_filters) e WHERE e.key<>'unassignedOnly'
      AND (jsonb_typeof(e.value)<>'string' OR (e.value#>>'{}') ~ U&'[\0001-\001F\007F-\009F\2028\2029]')) THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  search_value:=btrim(p_filters->>'search',trim_chars); project_value:=p_filters->>'project';
  channel_value:=p_filters->>'channel'; status_value:=p_filters->>'status'; unassigned:=(p_filters->>'unassignedOnly')::boolean;
  IF length(search_value)>200 OR length(project_value)>200 OR length(channel_value)>80
    OR status_value NOT IN ('','new','contacted','considering','follow_up','nurture','lost','legacy_unclassified')
    OR (unassigned AND project_value<>'')
    OR ((p_filters->>'owner')<>'' AND (p_filters->>'owner')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  owner_value:=NULLIF(p_filters->>'owner','')::uuid;
  filters_json:=jsonb_build_object('search',search_value,'project',project_value,'channel',channel_value,
    'owner',COALESCE(owner_value::text,''),'status',status_value,'unassignedOnly',unassigned);

  -- Every filter is evaluated on the whole registry BEFORE the bounded page.
  -- Literal strpos means %, _ and backslash are text, not wildcard instructions.
  -- EXISTS preserves one row per customer ID, never a name/phone deduplication.
  WITH page_rows AS (
    SELECT c.* FROM public.sales_customers c
    WHERE c.merged_into_customer_id IS NULL
      AND (channel_value='' OR c.intake_channel=channel_value)
      AND (NOT unassigned OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id))
      AND (search_value='' OR strpos(lower(c.customer_name),lower(search_value))>0
        OR strpos(lower(COALESCE(c.phone,'')),lower(search_value))>0
        OR strpos(lower(COALESCE(c.intake_notes,'')),lower(search_value))>0
        OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id
          AND (strpos(lower(i.project_name),lower(search_value))>0
            OR strpos(lower(COALESCE(i.interested_plot_id,'')),lower(search_value))>0)))
      AND ((project_value='' AND (owner_value IS NULL OR c.owner_user_id=owner_value)
          AND (status_value='' OR CASE WHEN c.intake_status='following_up' THEN 'follow_up' ELSE c.intake_status END=status_value))
        OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id
          AND (project_value='' OR i.project_name=project_value)
          AND (owner_value IS NULL OR i.owner_user_id=owner_value)
          AND (status_value='' OR i.engagement_status=status_value)))
    ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY created_at DESC,id) rn FROM page_rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.customer_name,'phone',c.phone,'channel',c.intake_channel,'notes',c.intake_notes,
    'ownerUserId',c.owner_user_id,'leadCreatedAt',c.lead_created_at,'intakeStatus',c.intake_status,
    'interests',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'projectName',i.project_name,
      'ownerUserId',i.owner_user_id,'workspaceState',i.workspace_state,'engagementStatus',i.engagement_status,
      'plotId',i.interested_plot_id) ORDER BY i.interest_created_at,i.id)
      FROM public.lead_project_interests i WHERE i.customer_id=c.id),'[]'::jsonb)
  ) ORDER BY c.created_at DESC,c.id) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50
  INTO customers_json,more_rows FROM numbered c;
  -- Global suggestions are independent of page/filter. Free-text exact channel
  -- remains supported when the bounded list has more than 200 distinct values.
  WITH distinct_channels AS (
    SELECT DISTINCT intake_channel FROM public.sales_customers
    WHERE merged_into_customer_id IS NULL AND intake_channel IS NOT NULL AND intake_channel<>''
    ORDER BY intake_channel LIMIT 201
  ), numbered AS (SELECT intake_channel,row_number() OVER(ORDER BY intake_channel) rn FROM distinct_channels)
  SELECT COALESCE(jsonb_agg(intake_channel ORDER BY intake_channel) FILTER(WHERE rn<=200),'[]'::jsonb),count(*)>200
  INTO channels_json,more_channels FROM numbered;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name)
      FROM public.projects WHERE is_closed IS NOT TRUE),'[]'::jsonb),
    'salesOwners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,
      'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE is_active AND role='sales'),'[]'::jsonb),
    'customers',customers_json,'page',p_page,'hasMore',more_rows,
    'search',jsonb_build_object('contractVersion','central_search_v1','filters',filters_json,
      'projects',COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM public.projects),'[]'::jsonb),
      'owners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,
        'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
        FROM sales_private.crm_user_roles WHERE role='sales'),'[]'::jsonb),
      'channels',channels_json,'hasMoreChannels',more_channels));
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_central_search(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_central_search(jsonb,integer) TO authenticated;

ROLLBACK;
