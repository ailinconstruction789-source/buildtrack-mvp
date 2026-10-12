-- LOCAL DESIGN ONLY. Read-only projection; no imports, backfills or flag writes.
-- Requires the actual canonical 18/19/25/26/27/28 and Excel reader bodies.
-- Private definer boundary projects reviewed provenance without exposing raw cells.
BEGIN;
DO $draft_only$
BEGIN
 RAISE EXCEPTION 'DESIGN ONLY: imported history projection requires isolated verification and separate installation review';
END;
$draft_only$;
CREATE SCHEMA sales_history_read_private;
REVOKE ALL ON SCHEMA sales_history_read_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA sales_history_read_private TO authenticated;

CREATE FUNCTION sales_history_read_private.records(p_customer_id uuid DEFAULT NULL,p_interest_id uuid DEFAULT NULL,p_sale_id uuid DEFAULT NULL,p_project_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' SET datestyle='ISO, YMD' AS $records$
DECLARE actor uuid:=auth.uid(); role_name text:=public.crm_v2_role(); result jsonb; loop_entry record; h jsonb;
BEGIN
 IF actor IS NULL OR coalesce(role_name,'') NOT IN('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_FORBIDDEN'; END IF;
 IF (public.crm_v2_project_sales_capabilities()->>'enabled')::boolean IS DISTINCT FROM true
  OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_SETUP_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w LEFT JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
  WHERE b.id IS NULL OR b.feed IS DISTINCT FROM 'customer-sheet' OR b.plan_digest IS DISTINCT FROM w.plan_digest)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_NOT_FOUND'; END IF;
 IF p_interest_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=p_interest_id AND customer_id=p_customer_id))
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_SCOPE_INVALID'; END IF;
 IF p_sale_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id
  WHERE s.id=p_sale_id AND i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_SCOPE_INVALID'; END IF;
 IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_NOT_FOUND'; END IF;

 -- Reuse the complete project reader's stock, identity, prior-round and source
 -- integrity checks before collecting or filtering historical evidence.
 FOR loop_entry IN SELECT DISTINCT i.project_name FROM public.lead_project_interests i
  WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
 LOOP PERFORM public.crm_v2_project_sales(loop_entry.project_name,'all','',0); END LOOP;
 IF EXISTS(SELECT 1 FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id
  LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id
  LEFT JOIN crm_external_private.source_records sr ON sr.batch_id=p.batch_id AND sr.source_row=(p.payload->>'source_row')::integer
  WHERE s.external_booking_id IS NOT NULL AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p.id IS NULL OR sr.source_row IS NULL OR sr.customer_key IS DISTINCT FROM c.external_customer_key OR p.batch_id IS DISTINCT FROM c.external_snapshot_batch_id
    OR p.payload->>'customer_id' IS DISTINCT FROM c.id::text OR p.payload->>'interest_id' IS DISTINCT FROM i.id::text))
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales p JOIN public.sales s ON s.external_booking_id=p.id
  JOIN public.lead_project_interests i ON i.id=s.project_interest_id WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  GROUP BY p.batch_id,(p.payload->>'source_row')::integer,i.id HAVING count(*)>1)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM sales_source_creation_private.records r
  LEFT JOIN public.sales_customers c ON c.id=r.customer_id LEFT JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (c.id IS NULL OR i.id IS NULL OR c.merged_into_customer_id IS NOT NULL
   OR c.supplemental_creation_id IS DISTINCT FROM r.id OR i.supplemental_creation_id IS DISTINCT FROM r.id OR i.customer_id IS DISTINCT FROM c.id
   OR i.project_name IS DISTINCT FROM r.payload->>'projectName')) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM sales_unknown_history_private.records r LEFT JOIN public.sales_customers c ON c.id=r.customer_id
  LEFT JOIN public.lead_project_interests i ON i.id=r.interest_id WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id)
  AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR (r.interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM c.id))))
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 FOR loop_entry IN SELECT e.*,to_jsonb(s) AS current_sale FROM sales_revision_private.events e LEFT JOIN public.sales s ON s.id=e.sale_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id)
 LOOP
  IF loop_entry.current_sale IS NULL OR (loop_entry.operation='cancel' AND loop_entry.current_sale->>'historical_revision_id' IS DISTINCT FROM loop_entry.id::text)
   OR (loop_entry.operation='create_booking' AND loop_entry.current_sale->>'historical_import_id' IS DISTINCT FROM loop_entry.id::text)
   THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
  h:=sales_private.crm_booking_imported_history(loop_entry.current_sale);
  IF h IS NULL OR h->>'sourceRow' IS DISTINCT FROM loop_entry.source_row::text THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 END LOOP;

 -- A source row is selected only through explicit candidate membership. Two
 -- visits with the same customer/day keep separate source keys. Ambiguous
 -- multi-interest membership is represented as unknown in customer scope.
 WITH original_members AS (
  SELECT s.batch_id,s.source_row,c.id customer_id,i.id interest_id,i.project_name,
   s.payload->'reviewedHistory'->>'visitHistoryDate' visit_day,
   (SELECT sale.id FROM public.sales sale JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    WHERE sale.project_interest_id=i.id AND p.batch_id=s.batch_id AND (p.payload->>'source_row')::integer=s.source_row ORDER BY sale.id LIMIT 1) sale_id
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed='customer-sheet'
  JOIN public.sales_customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row)
  JOIN public.lead_project_interests i ON i.external_snapshot_batch_id=ic.batch_id AND i.external_interest_key=ic.entity_key AND i.customer_id=c.id AND i.project_name=ic.project_label
  WHERE s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_interest_id IS NULL OR i.id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p_sale_id IS NULL OR EXISTS(SELECT 1 FROM public.sales selected_sale JOIN crm_external_private.prepared_booking_sales selected_source ON selected_source.id=selected_sale.external_booking_id
    WHERE selected_sale.id=p_sale_id AND selected_sale.project_interest_id=i.id AND selected_source.batch_id=s.batch_id AND (selected_source.payload->>'source_row')::integer=s.source_row))
 ), original_unassigned AS (
  SELECT s.batch_id::text||':'||s.source_row::text key,c.id customer_id,s.source_row,NULL::uuid interest_id,NULL::text project_name,'[]'::jsonb project_names,NULL::uuid sale_id,
   jsonb_build_array(jsonb_build_object('kind','visited','date',s.payload->'reviewedHistory'->>'visitHistoryDate','precision',CASE WHEN s.payload->'reviewedHistory'->>'visitHistoryDate' IS NULL THEN 'unknown' ELSE 'day' END)) events,0 priority
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed='customer-sheet'
  JOIN public.sales_customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  WHERE s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966 AND s.payload->'reviewedHistory'->'projectLabels'='[]'
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row))
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND p_interest_id IS NULL AND p_sale_id IS NULL
 ), originals AS (
  SELECT batch_id::text||':'||source_row::text key,customer_id,source_row,
   CASE WHEN count(DISTINCT interest_id)=1 THEN min(interest_id::text)::uuid END interest_id,
   CASE WHEN count(DISTINCT project_name)=1 THEN min(project_name) END project_name,
   to_jsonb(array_agg(DISTINCT project_name ORDER BY project_name)) project_names,
   CASE WHEN count(DISTINCT interest_id)=1 AND count(DISTINCT sale_id)=1 THEN min(sale_id::text)::uuid END sale_id,
   jsonb_build_array(jsonb_build_object('kind','visited','date',min(visit_day),'precision',CASE WHEN min(visit_day) IS NULL THEN 'unknown' ELSE 'day' END)) events,0 priority
  FROM original_members GROUP BY batch_id,source_row,customer_id
 ), creation AS (
  SELECT 'source:'||r.source_key key,r.customer_id,r.source_row,r.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'date',to_char(e.event_day,'YYYY-MM-DD'),'precision',e.precision) ORDER BY e.event_key),'[]')
     FROM sales_source_creation_private.events e WHERE e.record_id=r.id) events,1 priority
  FROM sales_source_creation_private.records r JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), unknown_rows AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||':'||r.row_number::text FROM crm_external_private.source_records s
    JOIN public.sales_customers c ON c.id=r.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=r.row_number),'unknown:'||r.source_key) key,
   r.customer_id,r.row_number source_row,r.interest_id,i.project_name,CASE WHEN i.project_name IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(i.project_name) END project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'date',to_char(e.occurred_date,'YYYY-MM-DD'),'precision',e.precision) ORDER BY e.sequence),'[]')
    FROM sales_unknown_history_private.events e WHERE e.batch_id=r.batch_id AND e.source_key=r.source_key) events,2 priority
  FROM sales_unknown_history_private.records r LEFT JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name OR r.reason='unknown_project')
 ), revised AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||':'||e.source_row::text FROM crm_external_private.source_records s
    JOIN public.sales_customers c ON c.id=e.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=e.source_row),'revision:'||e.source_key) key,
   e.customer_id,e.source_row,e.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,e.sale_id,e.source_history events,3 priority
  FROM sales_revision_private.events e JOIN public.lead_project_interests i ON i.id=e.interest_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id) AND (p_interest_id IS NULL OR e.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), all_rows AS (SELECT * FROM originals UNION ALL SELECT * FROM original_unassigned UNION ALL SELECT * FROM creation UNION ALL SELECT * FROM unknown_rows UNION ALL SELECT * FROM revised),
 chosen AS (SELECT DISTINCT ON(key) * FROM all_rows ORDER BY key,priority DESC),
 scoped AS (SELECT * FROM chosen WHERE p_sale_id IS NULL OR sale_id=p_sale_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'customerId',customer_id,'projectName',project_name,'projectNames',project_names,'interestId',interest_id,'saleId',sale_id,'sourceRow',source_row,'events',events) ORDER BY key),'[]') INTO result FROM scoped;
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_LIMIT'; END IF;
 -- Original booking days come through the unchanged provenance verifier, not
 -- through guessed timestamps. Revision records already contain their full
 -- approved visit/booking/cancellation timeline.
 FOR loop_entry IN SELECT value item FROM jsonb_array_elements(result) WHERE value->'saleId'<>'null'::jsonb LOOP
  IF NOT EXISTS(SELECT 1 FROM sales_revision_private.events WHERE sale_id=(loop_entry.item->>'saleId')::uuid) THEN
   SELECT sales_private.crm_booking_imported_history(to_jsonb(s)) INTO h FROM public.sales s WHERE id=(loop_entry.item->>'saleId')::uuid;
   IF h IS NULL THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
   h:=jsonb_build_array(jsonb_build_object('kind','booked','date',h->'bookedDate','precision',CASE WHEN h->>'bookedDate' IS NULL THEN 'unknown' ELSE 'day' END))
    ||CASE WHEN h->>'sourceStage'='cancelled' THEN jsonb_build_array(jsonb_build_object('kind','cancelled','date',h->'cancelledDate','precision',CASE WHEN h->>'cancelledDate' IS NULL THEN 'unknown' ELSE 'day' END)) ELSE '[]'::jsonb END
    ||CASE WHEN h->>'sourceStage'='transferred' THEN jsonb_build_array(jsonb_build_object('kind','transferred','date',h->'transferredDate','precision',CASE WHEN h->>'transferredDate' IS NULL THEN 'unknown' ELSE 'day' END)) ELSE '[]'::jsonb END;
   SELECT jsonb_agg(CASE WHEN value->>'key'=loop_entry.item->>'key' THEN value||jsonb_build_object('events',value->'events'||h) ELSE value END ORDER BY ordinality) INTO result FROM jsonb_array_elements(result) WITH ORDINALITY;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->'events') ev
  WHERE ev->>'kind' NOT IN('visited','booked','contracted','loan_submitted','transferred','handover','cancelled') OR ev->>'kind' IS NULL
   OR ((ev->>'precision'='unknown' AND ev->'date'='null') OR (ev->>'precision'='day' AND jsonb_typeof(ev->'date')='string'
    AND ev->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(ev->>'date','date'))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_DATE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->'events') ev
  GROUP BY rr->>'key',ev->>'kind' HAVING count(*)>1) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 RETURN result;
END;
$records$;
REVOKE ALL ON FUNCTION sales_history_read_private.records(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_history_read_private.customer_history(p_customer_id uuid,p_interest_id uuid,p_sale_id uuid,p_page integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb; result jsonb;
BEGIN
 IF p_customer_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INVALID_INPUT'; END IF;
 rows:=sales_history_read_private.records(p_customer_id,p_interest_id,p_sale_id,NULL);
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO result FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE ordinality>p_page*50 AND ordinality<=(p_page+1)*50;
 RETURN jsonb_build_object('contractVersion','historical_customer_evidence_v1','actor',jsonb_build_object('userId',auth.uid(),'role',public.crm_v2_role()),
  'customerId',p_customer_id,'interestId',p_interest_id,'saleId',p_sale_id,'page',p_page,'hasMore',jsonb_array_length(rows)>(p_page+1)*50,'readOnly',true,
  'records',result);
END; $$;
REVOKE ALL ON FUNCTION sales_history_read_private.customer_history(uuid,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION sales_history_read_private.customer_history(uuid,uuid,uuid,integer) TO authenticated;
CREATE FUNCTION public.crm_v2_customer_history(p_customer_id uuid,p_interest_id uuid DEFAULT NULL,p_sale_id uuid DEFAULT NULL,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT sales_history_read_private.customer_history(p_customer_id,p_interest_id,p_sale_id,p_page);
$$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_history(uuid,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_history(uuid,uuid,uuid,integer) TO authenticated;

-- Keep and call the FULL original 26-adapted reader before any merge. This is
-- deliberately an exact-body adapter: unknown definitions fail installation.
DO $excel_preserve$
DECLARE d text; b text; settings text[]; secured boolean; owner_name text;
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner)
 INTO d,b,settings,secured,owner_name FROM pg_proc WHERE oid='crm_excel_private.evidence(text)'::regprocedure;
 IF md5(replace(b,'sales_import_private.expected_transfer_date(sale.id,s.payload->''reviewedHistory''->>''expectedTransferDate'') AS source_day','s.payload->''reviewedHistory''->>''expectedTransferDate'' AS source_day'))<>'738a8d0787d234d2fd06dce3966bdc11'
  OR owner_name<>current_user OR NOT secured OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']
  OR strpos(b,'sales_import_private.expected_transfer_date(sale.id,')=0 THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_EXCEL_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(d,'crm_excel_private.evidence(','sales_history_read_private.original_excel(');
END;
$excel_preserve$;
REVOKE ALL ON FUNCTION sales_history_read_private.original_excel(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION crm_excel_private.evidence(p_project_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE original jsonb; rows jsonb; visits jsonb; unassigned jsonb; forecasts jsonb; pending jsonb; unknown_count integer; unknown_unassigned integer;
BEGIN
 original:=sales_history_read_private.original_excel(p_project_name);
 rows:=sales_history_read_private.records(NULL,NULL,NULL,p_project_name);
 -- Original known-project/unassigned rows are replaced only by the exact
 -- approved source-lineage key. Unknown dates remain counters, never fake days.
 WITH selected AS (SELECT value r FROM jsonb_array_elements(rows)),
 source_visits AS (SELECT r,e FROM selected CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE e->>'kind'='visited'),
 merged AS (
  SELECT value v FROM jsonb_array_elements(original->'legacyVisits') WHERE NOT EXISTS(SELECT 1 FROM selected WHERE r->>'key'=value->>'key')
  UNION ALL SELECT jsonb_build_object('key',r->>'key','customerId',r->'customerId','visitDate',e->'date','leadDate',e->'date') FROM source_visits WHERE r->>'projectName'=p_project_name AND e->>'precision'='day'
 ) SELECT coalesce(jsonb_agg(v ORDER BY v->>'key'),'[]') INTO visits FROM merged;
 WITH selected AS (SELECT value r FROM jsonb_array_elements(rows)),
 source_visits AS (SELECT r,e FROM selected CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE e->>'kind'='visited'),
 merged AS (
  SELECT value v FROM jsonb_array_elements(original->'unassignedLegacyVisits') WHERE NOT EXISTS(SELECT 1 FROM selected WHERE r->>'key'=value->>'key')
  UNION ALL SELECT jsonb_build_object('key',r->>'key','customerId',r->'customerId','visitDate',e->'date','leadDate',e->'date') FROM source_visits WHERE r->'projectName'='null' AND e->>'precision'='day'
 ) SELECT coalesce(jsonb_agg(v ORDER BY v->>'key'),'[]') INTO unassigned FROM merged;
 SELECT count(*) INTO unknown_count FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE r->>'projectName'=p_project_name AND e->>'kind'='visited' AND e->>'precision'='unknown';
 SELECT count(*) INTO unknown_unassigned FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE r->'projectName'='null' AND e->>'kind'='visited' AND e->>'precision'='unknown';
 SELECT coalesce(jsonb_agg(k ORDER BY k),'[]') INTO pending FROM jsonb_array_elements(original->'pendingLegacyKeys') k
 WHERE NOT EXISTS(SELECT 1 FROM sales_source_creation_private.records r JOIN crm_external_private.source_records s ON s.source_row=r.source_row
  JOIN crm_external_private.snapshot_batches b ON b.id=s.batch_id AND b.feed='customer-sheet' WHERE s.entity_key=r.source_key AND k#>>'{}'=s.batch_id::text||':'||s.source_row::text);
 SELECT coalesce(jsonb_agg(jsonb_build_object('saleId',f->'saleId','expectedTransferDate',sales_import_private.expected_transfer_date((f->>'saleId')::uuid,f->>'expectedTransferDate')) ORDER BY f->>'saleId'),'[]') INTO forecasts FROM jsonb_array_elements(original->'forecasts') f;
 RETURN original||jsonb_build_object('legacyVisits',visits,'unassignedLegacyVisits',unassigned,'forecasts',forecasts,'pendingLegacyKeys',pending,
  'pendingLegacyRows',jsonb_array_length(pending),'unknownLegacyDates',unknown_count,'unknownUnassignedLegacyDates',unknown_unassigned);
END; $$;
-- CREATE OR REPLACE retains the existing Excel function's owner and grants.
ROLLBACK;
