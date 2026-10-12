-- DESIGN ONLY. Compose after 25-33 and the complete source membership install.
-- Read wrappers leave the original immutable reader/adapter bodies untouched.
-- No business writes, flags, Auth changes, identity inference or data import.
BEGIN;
DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: canonical workspace reader requires reviewed native rehearsal'; END; $draft_only$;
CREATE SCHEMA sales_workspace_read_private;
REVOKE ALL ON SCHEMA sales_workspace_read_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales_workspace_read_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION sales_workspace_read_private.membership_metadata(p_include_legacy_scope boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE revision uuid; result jsonb;
BEGIN
 SELECT revision_id INTO revision FROM customer_source_membership_private.head;
 IF revision IS NOT NULL AND (SELECT count(*) FROM customer_source_membership_private.members WHERE revision_id=revision)<>958
 THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED'; END IF;
 SELECT jsonb_build_object('active',revision IS NOT NULL,'revisionId',revision,
  'legacyScopeIncluded',revision IS NOT NULL AND p_include_legacy_scope,
  'originalLegacyLeadIds',CASE WHEN revision IS NULL OR NOT p_include_legacy_scope THEN '[]'::jsonb ELSE
   (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM customer_source_membership_private.scope_leads) END) INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION sales_workspace_read_private.history_metadata(p_customer uuid,p_interest uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 WITH reviewed AS (
  SELECT m.history FROM customer_source_membership_private.members m
  JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id
  WHERE m.customer_id=p_customer AND (p_interest IS NULL OR m.interest_id=p_interest)
 ), source_visit AS (
  SELECT min(e->>'date') AS day FROM reviewed r CROSS JOIN LATERAL jsonb_array_elements(r.history) e
  WHERE e->>'kind'='visited' AND e->>'precision'='day' AND e->>'date' IS NOT NULL
 ), native_visit AS (
  SELECT min(to_char(v.checked_in_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')) AS day
  FROM public.lead_visits v JOIN customer_source_membership_private.interests i ON i.id=v.project_interest_id
  WHERE i.customer_id=p_customer AND (p_interest IS NULL OR i.id=p_interest) AND v.status<>'cancelled'
 )
 SELECT jsonb_build_object('sourceKind',CASE WHEN EXISTS(SELECT 1 FROM reviewed) THEN 'reviewed_import' ELSE 'native' END,
  'visitHistoryDate',CASE WHEN EXISTS(SELECT 1 FROM reviewed) THEN (SELECT day FROM source_visit) ELSE (SELECT day FROM native_visit) END);
$$;

CREATE FUNCTION public.crm_v2_workspace_capabilities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.crm_v2_role(),'') NOT IN('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_FORBIDDEN'; END IF;
 RETURN jsonb_build_object('contract_version','source_membership_workspace_v1','enabled',
  coalesce((public.crm_v2_capabilities()->>'enabled')::boolean,false)
  AND coalesce((public.crm_v2_central_search_capabilities()->>'enabled')::boolean,false)
  AND coalesce((public.crm_v2_project_sales_capabilities()->>'enabled')::boolean,false),
  'sourceMembership',sales_workspace_read_private.membership_metadata());
END; $$;

CREATE FUNCTION public.crm_v2_workspace_project_sales(p_project_name text DEFAULT NULL,p_tab text DEFAULT 'booked',p_query text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE snapshot jsonb; rows_json jsonb; metadata jsonb;
BEGIN
 -- The original reader supplies identical authorization, scope validation,
 -- imported-round integrity, membership predicates, ordering and pagination.
 snapshot:=public.crm_v2_project_sales(p_project_name,p_tab,p_query,p_page);
 metadata:=sales_workspace_read_private.membership_metadata(false);
 IF (metadata->>'active')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(item || jsonb_build_object(
   'bankName',CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END,
   'expectedTransferDate',sales_import_private.expected_transfer_date(s.id,s.expected_transfer_date::text),
   'leadId',s.lead_id) || sales_workspace_read_private.history_metadata(i.customer_id,i.id) ORDER BY ordinal),'[]')
 INTO rows_json FROM jsonb_array_elements(snapshot->'rows') WITH ORDINALITY AS items(item,ordinal)
 JOIN customer_source_membership_private.sales s ON s.id=(item->>'saleId')::uuid
 JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
 LEFT JOIN sales_private.deal_details_corrections dc ON dc.sale_id=s.id;
 IF jsonb_array_length(rows_json)<>jsonb_array_length(snapshot->'rows') THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED'; END IF;
 RETURN snapshot || jsonb_build_object('rows',rows_json,'sourceMembership',metadata);
END; $$;

CREATE FUNCTION public.crm_v2_workspace_central_search(p_filters jsonb,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE snapshot jsonb; rows_json jsonb; metadata jsonb;
BEGIN
 snapshot:=public.crm_v2_central_search(p_filters,p_page);
 metadata:=sales_workspace_read_private.membership_metadata(p_page=0);
 IF (metadata->>'active')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_SETUP_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(item || sales_workspace_read_private.history_metadata((item->>'id')::uuid,NULL) || jsonb_build_object(
  'interests',(SELECT coalesce(jsonb_agg(interest || sales_workspace_read_private.history_metadata((item->>'id')::uuid,(interest->>'id')::uuid) ORDER BY n),'[]')
   FROM jsonb_array_elements(item->'interests') WITH ORDINALITY AS nested(interest,n))) ORDER BY ordinal),'[]')
 INTO rows_json FROM jsonb_array_elements(snapshot->'customers') WITH ORDINALITY AS items(item,ordinal);
 RETURN snapshot || jsonb_build_object('customers',rows_json,'sourceMembership',metadata);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_workspace_read_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_v2_workspace_capabilities(),public.crm_v2_workspace_project_sales(text,text,text,integer),public.crm_v2_workspace_central_search(jsonb,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.crm_v2_workspace_capabilities(),public.crm_v2_workspace_project_sales(text,text,text,integer),public.crm_v2_workspace_central_search(jsonb,integer) TO authenticated;
ROLLBACK;
