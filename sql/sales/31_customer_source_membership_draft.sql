-- DESIGN ONLY. Compose after 25-30 and before the final reviewed activation.
-- Does not remove parent IDs or change the original archive. Installation alone
-- is inert. An owned rehearsal must install exact-source adapters and activate
-- the complete resolved 958-row cohort before this becomes authoritative.
BEGIN;
DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: full source membership requires reviewed whole replacement rehearsal'; END; $draft_only$;
SET LOCAL lock_timeout='2s';
CREATE SCHEMA customer_source_membership_private;
REVOKE ALL ON SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;
CREATE TABLE customer_source_membership_private.revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_key text UNIQUE NOT NULL,
 payload jsonb NOT NULL,input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 actor_id uuid NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_source_membership_private.members(
 revision_id uuid NOT NULL REFERENCES customer_source_membership_private.revisions ON DELETE RESTRICT,
 source_row integer NOT NULL,source_key text NOT NULL,row_sha256 text NOT NULL,
 customer_id uuid NOT NULL REFERENCES public.sales_customers ON DELETE RESTRICT,
 interest_id uuid REFERENCES public.lead_project_interests ON DELETE RESTRICT,
 sale_id uuid REFERENCES public.sales ON DELETE RESTRICT,
 project_name text,source_stage text NOT NULL,history jsonb NOT NULL,lineage_key text NOT NULL,
 PRIMARY KEY(revision_id,source_row),UNIQUE(revision_id,source_key)
);
CREATE INDEX membership_customer ON customer_source_membership_private.members(revision_id,customer_id);
CREATE INDEX membership_interest ON customer_source_membership_private.members(revision_id,interest_id);
CREATE INDEX membership_sale ON customer_source_membership_private.members(revision_id,sale_id);
-- Scope is captured by original provenance, not by a global allowlist. IDs born
-- through later legitimate intake and bookings remain visible automatically.
CREATE TABLE customer_source_membership_private.scope_customers(id uuid PRIMARY KEY REFERENCES public.sales_customers ON DELETE RESTRICT);
CREATE TABLE customer_source_membership_private.scope_interests(id uuid PRIMARY KEY REFERENCES public.lead_project_interests ON DELETE RESTRICT);
CREATE TABLE customer_source_membership_private.scope_sales(id uuid PRIMARY KEY);
CREATE TABLE customer_source_membership_private.scope_batches(id uuid PRIMARY KEY);
-- Independent legacy Lead archive scope. It is an identity-only frozen set;
-- customer lifecycle status and historical Lead links are never manufactured.
CREATE TABLE customer_source_membership_private.scope_leads(id uuid PRIMARY KEY REFERENCES public.leads ON DELETE RESTRICT,exempt_mapping boolean NOT NULL);
CREATE TABLE customer_source_membership_private.head(id boolean PRIMARY KEY CHECK(id),revision_id uuid NOT NULL REFERENCES customer_source_membership_private.revisions ON DELETE RESTRICT);
CREATE TABLE customer_source_membership_private.adapters(signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL,settings text[] NOT NULL);
DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['revisions','members','scope_customers','scope_interests','scope_sales','scope_batches','scope_leads','head','adapters'] LOOP
  EXECUTE format('ALTER TABLE customer_source_membership_private.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END; $rls$;

CREATE FUNCTION customer_source_membership_private.customer_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers WHERE id=p_id)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.customer_id=p_id);
$$;
CREATE FUNCTION customer_source_membership_private.interest_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR (NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=p_id) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id))
  OR (EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=p_id AND customer_source_membership_private.customer_member(i.customer_id))
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=p_id)));
$$;
CREATE FUNCTION customer_source_membership_private.sale_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR (NOT EXISTS(SELECT 1 FROM public.sales WHERE id=p_id) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_sales WHERE id=p_id))
  OR (EXISTS(SELECT 1 FROM public.sales s WHERE s.id=p_id AND (s.project_interest_id IS NULL OR customer_source_membership_private.interest_member(s.project_interest_id)))
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_sales WHERE id=p_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.sale_id=p_id)));
$$;
CREATE FUNCTION customer_source_membership_private.source_member(p_batch uuid,p_row integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_batches WHERE id=p_batch)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.source_row=p_row);
$$;
CREATE FUNCTION customer_source_membership_private.report_requires_legacy_mapping(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 -- With no authoritative replacement, preserve SQL20's original all-Lead
 -- completeness rule. Future Leads are also never exempted by this archive.
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_leads WHERE id=p_id AND exempt_mapping)
  OR EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link WHERE link.legacy_lead_id=p_id
   AND customer_source_membership_private.customer_member(link.customer_id)
   AND (link.project_interest_id IS NULL OR customer_source_membership_private.interest_member(link.project_interest_id)));
$$;
-- Private views are evaluated inside the existing reviewed SECURITY DEFINER
-- readers. They retain complete row types and filter BEFORE LIMIT/count/search.
CREATE VIEW customer_source_membership_private.customers AS SELECT c.* FROM public.sales_customers c WHERE customer_source_membership_private.customer_member(c.id);
CREATE VIEW customer_source_membership_private.interests AS SELECT i.* FROM public.lead_project_interests i WHERE customer_source_membership_private.interest_member(i.id);
CREATE VIEW customer_source_membership_private.sales AS SELECT s.* FROM public.sales s WHERE customer_source_membership_private.sale_member(s.id);
-- Direct Data API SELECT must obey the same source authority as reviewed RPCs.
-- These boolean-only definers avoid recursive public RLS reads in the parent
-- predicates. Existing permissive role policies remain the authorization gate;
-- restrictive policies can only remove inactive archived rows from that gate.
CREATE FUNCTION customer_source_membership_private.rls_customer_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT customer_source_membership_private.customer_member(p_id);
$$;
CREATE FUNCTION customer_source_membership_private.rls_interest_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT customer_source_membership_private.interest_member(p_id);
$$;
CREATE FUNCTION customer_source_membership_private.rls_sale_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT customer_source_membership_private.sale_member(p_id);
$$;
CREATE POLICY customer_source_membership_read ON public.sales_customers AS RESTRICTIVE FOR SELECT TO authenticated
 USING(customer_source_membership_private.rls_customer_member(id));
CREATE POLICY interest_source_membership_read ON public.lead_project_interests AS RESTRICTIVE FOR SELECT TO authenticated
 USING(customer_source_membership_private.rls_interest_member(id));
CREATE POLICY sale_source_membership_read ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated
 USING(customer_source_membership_private.rls_sale_member(id));

CREATE FUNCTION customer_source_membership_private.assert_payload(p_payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text; value text;
BEGIN
 -- Preserve the original authorization errors and input validators. This adds
 -- only source retirement checks for already authorized canonical commands.
 IF auth.uid() IS NULL OR coalesce(public.crm_v2_role(),'') NOT IN('sales','admin','owner') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN; END IF;
 FOREACH k IN ARRAY ARRAY['customerId','interestId','projectInterestId','saleId','previousSaleId'] LOOP
  value:=p_payload->>k;
  IF value IS NULL OR value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
  IF (k='customerId' AND NOT customer_source_membership_private.customer_member(value::uuid))
   OR (k IN('interestId','projectInterestId') AND NOT customer_source_membership_private.interest_member(value::uuid))
   OR (k IN('saleId','previousSaleId') AND NOT customer_source_membership_private.sale_member(value::uuid))
   THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 END LOOP;
END; $$;
CREATE FUNCTION customer_source_membership_private.guard_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; customer_id uuid; interest_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 old_row:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 new_row:=CASE WHEN TG_OP='DELETE' THEN old_row ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='sales_customers' THEN
  IF (old_row IS NOT NULL AND NOT customer_source_membership_private.customer_member((old_row->>'id')::uuid)) OR NOT customer_source_membership_private.customer_member((new_row->>'id')::uuid) THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 ELSIF TG_TABLE_NAME='lead_project_interests' THEN
  customer_id:=(new_row->>'customer_id')::uuid;
  IF NOT customer_source_membership_private.customer_member(customer_id) OR (old_row IS NOT NULL AND NOT customer_source_membership_private.interest_member((old_row->>'id')::uuid))
   OR (EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=(new_row->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=(new_row->>'id')::uuid)) THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 ELSIF TG_TABLE_NAME='sales' THEN
  interest_id:=(new_row->>'project_interest_id')::uuid;
  IF (interest_id IS NOT NULL AND NOT customer_source_membership_private.interest_member(interest_id)) OR (old_row IS NOT NULL AND NOT customer_source_membership_private.sale_member((old_row->>'id')::uuid))
   OR (EXISTS(SELECT 1 FROM customer_source_membership_private.scope_sales WHERE id=(new_row->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.sale_id=(new_row->>'id')::uuid)) THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER customer_source_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_customers FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.guard_parent();
CREATE TRIGGER interest_source_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lead_project_interests FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.guard_parent();
CREATE TRIGGER sale_source_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.guard_parent();

CREATE FUNCTION customer_source_membership_private.history(p_original jsonb,p_customer uuid,p_interest uuid,p_sale uuid,p_project text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RETURN p_original; END IF;
 IF (p_customer IS NOT NULL AND NOT customer_source_membership_private.customer_member(p_customer))
  OR (p_interest IS NOT NULL AND NOT customer_source_membership_private.interest_member(p_interest))
  OR (p_sale IS NOT NULL AND NOT customer_source_membership_private.sale_member(p_sale)) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_NOT_FOUND'; END IF;
 WITH retained AS (
  SELECT value row FROM jsonb_array_elements(p_original)
  WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_batches b WHERE value->>'key' LIKE b.id::text||':%')
   AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id
    WHERE value->>'key' IN('source:'||m.source_key,'unknown:'||m.source_key,'revision:'||m.source_key))
   AND customer_source_membership_private.customer_member((value->>'customerId')::uuid)
   AND (value->>'interestId' IS NULL OR customer_source_membership_private.interest_member((value->>'interestId')::uuid))
 ), reviewed AS (
  SELECT jsonb_build_object('key',m.lineage_key,'customerId',m.customer_id,'projectName',m.project_name,
    'projectNames',CASE WHEN m.project_name IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(m.project_name) END,
    'interestId',m.interest_id,'saleId',m.sale_id,'sourceRow',m.source_row,
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e->>'kind','date',e->'date','precision',e->>'precision') ORDER BY ordinality),'[]') FROM jsonb_array_elements(m.history) WITH ORDINALITY AS items(e,ordinality))) row
  FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id
  WHERE (p_customer IS NULL OR m.customer_id=p_customer) AND (p_interest IS NULL OR m.interest_id=p_interest)
   AND (p_sale IS NULL OR m.sale_id=p_sale) AND (p_project IS NULL OR m.project_name=p_project)
 ), combined AS (SELECT row FROM retained UNION ALL SELECT row FROM reviewed)
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'key'),'[]') INTO result FROM combined;
 RETURN result;
END; $$;

CREATE FUNCTION customer_source_membership_private.assert_catalog()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
   ('sales_customers','customer_source_membership_read','rls_customer_member','customer_member'),
   ('lead_project_interests','interest_source_membership_read','rls_interest_member','interest_member'),
   ('sales','sale_source_membership_read','rls_sale_member','sale_member')) expected(table_name,policy_name,helper_name,parent_name)
  LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||expected.table_name)
  LEFT JOIN pg_policy policy ON policy.polrelid=c.oid AND policy.polname=expected.policy_name
  LEFT JOIN pg_proc helper ON helper.oid=to_regprocedure('customer_source_membership_private.'||expected.helper_name||'(uuid)')
  WHERE NOT coalesce(c.relrowsecurity,false) OR policy.oid IS NULL OR policy.polpermissive OR policy.polcmd<>'r'
   OR policy.polroles IS DISTINCT FROM ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
   OR pg_get_expr(policy.polqual,c.oid) IS DISTINCT FROM 'customer_source_membership_private.'||expected.helper_name||'(id)'
   OR helper.oid IS NULL OR NOT helper.prosecdef OR pg_get_userbyid(helper.proowner)<>current_user
   OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog','row_security=off']::text[]
   OR replace(helper.prosrc,E'\r\n',E'\n') IS DISTINCT FROM chr(10)||' SELECT customer_source_membership_private.'||expected.parent_name||'(p_id);'||chr(10)
   OR NOT has_function_privilege('authenticated',helper.oid,'EXECUTE') OR has_function_privilege('anon',helper.oid,'EXECUTE'))
  OR NOT has_schema_privilege('authenticated','customer_source_membership_private','USAGE')
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_SELECT_POLICY_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc,E'\r\n',E'\n')) IS DISTINCT FROM a.after_md5 OR NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>current_user OR p.proconfig IS DISTINCT FROM a.settings)
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'crm_v2_%' AND p.prosecdef
   AND (p.prosrc ~ 'public\.(sales_customers|lead_project_interests|sales)\M' OR pg_get_function_arguments(p.oid) LIKE '%p_payload jsonb%')
   AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')'))
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_COVERAGE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['public.crm_v2_central_snapshot(integer,integer)','public.crm_v2_central_search(jsonb,integer)','public.crm_v2_lead_work_snapshot(uuid,uuid)','public.crm_v2_booking_search(text,integer)','public.crm_v2_booking_context(uuid,integer)','public.crm_v2_project_sales(text,text,text,integer)','public.crm_v2_sales_report(text,text,text)','sales_history_read_private.records(uuid,uuid,uuid,text)','sales_history_read_private.original_excel(text)']) required(signature)
   WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=required.signature))
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_HISTORY_COVERAGE_REQUIRED'; END IF;
END; $$;

CREATE FUNCTION customer_source_membership_private.activate(p_payload jsonb,p_input_digest text,p_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v_record jsonb; revision uuid; batch uuid; known record; customer uuid; interest uuid; sale uuid;
BEGIN
 IF auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'admin' OR session_user<>current_user THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED'; END IF;
 IF p_payload->>'version' IS DISTINCT FROM 'reviewed-full-canonical-cohort-v1'
  OR p_payload->>'sourceSha256' IS DISTINCT FROM '7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
  OR p_payload->>'reviewSha256' IS DISTINCT FROM 'de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
  OR p_payload->>'adapterPlanDigest' IS DISTINCT FROM '379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR p_payload->'originalSourceBatchIds' IS DISTINCT FROM '["5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5"]'::jsonb
  OR p_payload->'exclusions'->'rentalSourceRows' IS DISTINCT FROM '[859,951,954,958,959,960,961,969]'::jsonb
  OR p_payload->'exclusions'->'heldIdentitySourceRows' IS DISTINCT FROM '[967,968,970,971,972,973,974,975,976,977,978,979,980]'::jsonb
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'records')<>958
  OR p_input_digest !~ '^[0-9a-f]{64}$' OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_REVIEW_REQUIRED'; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.leads,public.crm_legacy_lead_links IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 PERFORM customer_source_membership_private.assert_catalog();
 SELECT * INTO known FROM customer_source_membership_private.revisions WHERE dataset_key=p_payload->>'datasetKey';
 IF FOUND THEN
  IF known.payload IS DISTINCT FROM p_payload OR known.input_digest IS DISTINCT FROM p_input_digest OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=known.id) THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_REPLAY_CONFLICT'; END IF;
  RETURN jsonb_build_object('revisionId',known.id,'sourceRows',958,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ALREADY_ACTIVE'; END IF;
 -- Exact reviewed original Lead identity set only. These rows are an
 -- independent old-system archive; they do not represent the new workbook's
 -- Customer identities and must not acquire invented links or lifecycle dates.
 -- Replays above deliberately do not require the old global count: legitimate
 -- future Lead intake remains possible after activation.
 IF (SELECT count(*) FROM public.leads)<>973
  OR (SELECT md5(string_agg(id::text,E'\n' ORDER BY id)) FROM public.leads) IS DISTINCT FROM '96bca8c3499c91241b9f4258175f4f2d'
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_LEGACY_SCOPE_REVIEW_REQUIRED'; END IF;
 IF (SELECT count(DISTINCT r->>'sourceRow') FROM jsonb_array_elements(p_payload->'records') r)<>958
  OR (SELECT count(DISTINCT r->>'sourceKey') FROM jsonb_array_elements(p_payload->'records') r)<>958
  OR (SELECT count(DISTINCT r->>'customerId') FROM jsonb_array_elements(p_payload->'records') r)<>957
  OR (SELECT count(DISTINCT r->>'interestId') FROM jsonb_array_elements(p_payload->'records') r)<>948
  OR (SELECT count(DISTINCT r->>'saleId') FROM jsonb_array_elements(p_payload->'records') r)<>298 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_COUNTS_REQUIRED'; END IF;
 batch:=(p_payload->'originalSourceBatchIds'->>0)::uuid;
 INSERT INTO customer_source_membership_private.scope_batches VALUES(batch);
 INSERT INTO customer_source_membership_private.scope_customers SELECT id FROM public.sales_customers WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_interests SELECT id FROM public.lead_project_interests WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_sales SELECT s.id FROM public.sales s JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id WHERE p.batch_id=batch;
 -- Deleted rental Sale IDs remain scoped so a later blind re-insert cannot
 -- resurrect them. No FK is placed on these deliberately absent rows.
 INSERT INTO customer_source_membership_private.scope_sales SELECT sale_id FROM rental_source_retirement_private.archives WHERE old_batch_id=batch ON CONFLICT DO NOTHING;
 INSERT INTO customer_source_membership_private.revisions(dataset_key,payload,input_digest,actor_id,review_reference) VALUES(p_payload->>'datasetKey',p_payload,p_input_digest,auth.uid(),p_review) RETURNING id INTO revision;
 FOR v_record IN SELECT value FROM jsonb_array_elements(p_payload->'records') LOOP
  customer:=(v_record->>'customerId')::uuid;interest:=(v_record->>'interestId')::uuid;sale:=(v_record->>'saleId')::uuid;
  IF customer IS NULL OR (v_record->>'sourceRow')::integer NOT BETWEEN 2 AND 980
   OR (v_record->>'sourceRow')::integer IN(859,951,954,958,959,960,961,969,967,968,970,971,972,973,974,975,976,977,978,979,980)
   OR v_record->>'sourceKey' !~ '^[0-9a-f]{64}$' OR v_record->>'rowSha256' !~ '^[0-9a-f]{64}$'
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND c.merged_into_customer_id IS NULL)
   -- Existing parent relationships alone cannot establish which source row
   -- belongs to which customer. Prevent a permutation of valid UUIDs from
   -- moving reviewed dates to a different customer while preserving counts.
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND (
    (c.supplemental_creation_id IS NULL AND c.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.source_records original WHERE original.batch_id=batch
      AND original.source_row=(v_record->>'sourceRow')::integer AND original.customer_key=c.external_customer_key))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=c.supplemental_creation_id
     AND created.customer_id=c.id AND created.source_row=(v_record->>'sourceRow')::integer
     AND created.source_key=v_record->>'sourceKey' AND created.row_sha256=v_record->>'rowSha256')))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND i.customer_id=customer AND i.project_name IS NOT DISTINCT FROM v_record->>'projectName'))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND (
    (i.supplemental_creation_id IS NULL AND i.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.interest_candidates original WHERE original.batch_id=batch
      AND original.entity_key=i.external_interest_key AND original.payload->'sourceRows' @> jsonb_build_array((v_record->>'sourceRow')::integer)))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=i.supplemental_creation_id
     AND created.interest_id=i.id AND created.customer_id=customer AND created.source_row=(v_record->>'sourceRow')::integer
     AND created.source_key=v_record->>'sourceKey' AND created.row_sha256=v_record->>'rowSha256'))))
   OR (interest IS NULL AND v_record->>'projectName' IS NOT NULL)
   OR (sale IS NOT NULL AND (interest IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND s.project_interest_id=interest AND s.plot_id IS NOT DISTINCT FROM v_record->>'plotId' AND s.crm_stage IS NOT DISTINCT FROM v_record->>'sourceStage')))
   OR (sale IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND (
    EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales original WHERE original.id=s.external_booking_id
     AND original.batch_id=batch AND (original.payload->>'source_row')::integer=(v_record->>'sourceRow')::integer)
    OR EXISTS(SELECT 1 FROM sales_revision_private.events created WHERE created.id=s.historical_import_id
     AND created.sale_id=s.id AND created.customer_id=customer AND created.interest_id=interest
     AND created.source_row=(v_record->>'sourceRow')::integer AND created.source_key=v_record->>'sourceKey' AND created.row_sha256=v_record->>'rowSha256'))))
   OR jsonb_typeof(v_record->'history') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->'history') e WHERE e->>'kind' NOT IN('visited','booked','contracted','loan_submitted','transferred','handover','cancelled') OR e->>'kind' IS NULL
    OR ((e->>'precision'='unknown' AND e->'date'='null') OR (e->>'precision'='day' AND e->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(e->>'date','date'))) IS DISTINCT FROM true)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->'history') e GROUP BY e->>'kind' HAVING count(*)>1)
   THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_BINDING_REQUIRED'; END IF;
  INSERT INTO customer_source_membership_private.members VALUES(revision,(v_record->>'sourceRow')::integer,v_record->>'sourceKey',v_record->>'rowSha256',customer,interest,sale,v_record->>'projectName',v_record->>'sourceStage',v_record->'history',batch::text||':'||(v_record->>'sourceRow'));
 END LOOP;
 -- Freeze which original Leads were independently archived at activation.
 -- An original Lead already linked to active canonical parents must retain its
 -- mapping integrity requirement even if that link is subsequently removed.
 INSERT INTO customer_source_membership_private.scope_leads(id,exempt_mapping)
 SELECT legacy.id,NOT EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link
  WHERE link.legacy_lead_id=legacy.id
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers old_customer WHERE old_customer.id=link.customer_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.customer_id=link.customer_id))
   AND (link.project_interest_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests old_interest WHERE old_interest.id=link.project_interest_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.interest_id=link.project_interest_id)))
 FROM public.leads legacy;
 INSERT INTO customer_source_membership_private.head VALUES(true,revision);
 RETURN jsonb_build_object('revisionId',revision,'sourceRows',958,'customers',957,'interests',948,'sales',298,'replayed',false);
END; $$;

-- Durable ledgers are append-only. Only head has a separate explicit reviewed
-- recovery path; full business recovery belongs to the whole replacement.
CREATE FUNCTION customer_source_membership_private.sealed()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_IMMUTABLE'; END; $$;
DO $seal$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['revisions','members','scope_customers','scope_interests','scope_sales','scope_batches','scope_leads','adapters'] LOOP
  EXECUTE format('CREATE TRIGGER membership_immutable BEFORE UPDATE OR DELETE ON customer_source_membership_private.%I FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.sealed()',t);
  EXECUTE format('CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON customer_source_membership_private.%I FOR EACH STATEMENT EXECUTE FUNCTION customer_source_membership_private.sealed()',t);
 END LOOP;
END; $seal$;
CREATE TABLE customer_source_membership_private.recoveries(revision_id uuid PRIMARY KEY REFERENCES customer_source_membership_private.revisions,actor_id uuid NOT NULL,review_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE customer_source_membership_private.recoveries ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER membership_immutable BEFORE UPDATE OR DELETE ON customer_source_membership_private.recoveries FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.sealed();
CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON customer_source_membership_private.recoveries FOR EACH STATEMENT EXECUTE FUNCTION customer_source_membership_private.sealed();
CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON customer_source_membership_private.head FOR EACH STATEMENT EXECUTE FUNCTION customer_source_membership_private.sealed();
CREATE FUNCTION customer_source_membership_private.deactivate(p_revision uuid,p_review text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'admin' OR session_user<>current_user OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED'; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=p_revision) THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_RECOVERY_STALE'; END IF;
 INSERT INTO customer_source_membership_private.recoveries(revision_id,actor_id,review_reference) VALUES(p_revision,auth.uid(),p_review);
 DELETE FROM customer_source_membership_private.head WHERE revision_id=p_revision;
END; $$;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA customer_source_membership_private TO authenticated;
GRANT EXECUTE ON FUNCTION customer_source_membership_private.rls_customer_member(uuid),customer_source_membership_private.rls_interest_member(uuid),customer_source_membership_private.rls_sale_member(uuid) TO authenticated;
ROLLBACK;
