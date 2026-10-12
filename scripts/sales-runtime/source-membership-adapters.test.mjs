import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileSourceMembershipAdapters,rewriteSourceReads,rewriteSalesReportLegacyGuard,sqlSegments,sourceMembershipCatalogSql} from './source-membership-adapters.mjs';
const metadata=(source,extra={})=>({signature:'public.crm_v2_central_snapshot(integer,integer)',source,owner:'runtime_test',securityDefiner:true,settings:['search_path=pg_catalog'],language:'plpgsql',arguments:'p_page integer, p_page_size integer',...extra});
test('reader filters relation before LIMIT, preserving order and hasMore logic',()=>{
 const original='BEGIN WITH page AS (SELECT * FROM public.sales_customers ORDER BY id LIMIT 51 OFFSET 50) SELECT count(*)>50 FROM page; END;';
 const result=rewriteSourceReads(original);assert.equal(result.changes,1);assert.match(result.body,/FROM customer_source_membership_private.customers ORDER BY id LIMIT 51 OFFSET 50/);assert.match(result.body,/SELECT count\(\*\)>50 FROM page/);
});
test('all three canonical relations are replaced case insensitively',()=>{
 const result=rewriteSourceReads('FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id join public.sales_customers c ON c.id=i.customer_id');
 assert.equal(result.changes,3);assert.match(result.body,/FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i/);
});
test('strings, nested comments, quoted identifiers and dollar literals stay byte exact',()=>{
 const opaque=["'FROM public.sales'","E'FROM public.sales\\\' literal'",'"FROM public.sales"','$$FROM public.sales$$','$custom$JOIN public.sales$custom$','/* FROM public.sales /* JOIN public.sales */ */','-- FROM public.sales\n'];
 for(const item of opaque){const result=rewriteSourceReads(item+' SELECT * FROM public.sales;');assert.equal(result.changes,1);assert.ok(result.body.startsWith(item));}
});
test('mutation targets, rowtype declarations and provenance names stay unchanged',()=>{
 const source='DECLARE r public.sales%ROWTYPE; BEGIN UPDATE public.sales SET contract_status=\'booked\'; INSERT INTO public.sales SELECT * FROM public.sales; DELETE FROM public.sales WHERE id=1; END;';
 const result=rewriteSourceReads(source);assert.match(result.body,/UPDATE public.sales SET/);assert.match(result.body,/INSERT INTO public.sales SELECT \* FROM customer_source_membership_private.sales/);
 assert.match(result.body,/DELETE FROM public.sales WHERE/);
 assert.equal(rewriteSourceReads('DELETE /* safety */ FROM public.sales WHERE id=1').changes,0);
});
test('compiler binds body/config/owner and stores after-source MD5',()=>{
 const result=compileSourceMembershipAdapters([metadata('BEGIN SELECT * FROM public.sales_customers; END;')]);assert.equal(result.entries.length,1);assert.match(result.sql,/owner_name IS DISTINCT FROM 'runtime_test'/);assert.match(result.sql,/CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED/);assert.match(result.sql,/INSERT INTO customer_source_membership_private.adapters/);assert.notEqual(result.entries[0].beforeMd5,result.entries[0].afterMd5);
});
test('command source assertions run before cached replay without changing writes',()=>{
 const source="BEGIN IF cached THEN RETURN prior; END IF; UPDATE public.sales SET contract_status='booked'; END;";
 const result=compileSourceMembershipAdapters([metadata(source,{signature:'public.crm_v2_booking_command(uuid,jsonb)',arguments:'p_request_id uuid, p_payload jsonb'})]);
 assert.match(result.sql,/BEGIN\n PERFORM customer_source_membership_private.assert_payload\(p_payload\);/);assert.match(result.sql,/UPDATE public.sales SET/);
});
test('history adapts complete provenance reader and exact source row predicate',()=>{
 const source="BEGIN SELECT * FROM public.sales_customers; SELECT * FROM source s WHERE s.disposition='mapped_for_review'; RETURN result; END;";
 const result=compileSourceMembershipAdapters([metadata(source,{signature:'sales_history_read_private.records(uuid,uuid,uuid,text)'})]);assert.match(result.sql,/source_member\(s.batch_id,s.source_row\)/);assert.match(result.sql,/RETURN customer_source_membership_private.history\(result,p_customer_id,p_interest_id,p_sale_id,p_project_name\)/);
});
test('source predicate cannot silently disappear on history upgrade',()=>assert.throws(()=>compileSourceMembershipAdapters([metadata('BEGIN RETURN result; END;',{signature:'sales_history_read_private.records(uuid,uuid,uuid,text)'})]),/scope marker missing/));
test('duplicate return markers cannot produce an ambiguous history adapter',()=>assert.throws(()=>compileSourceMembershipAdapters([metadata('BEGIN RETURN result; RETURN result; END;',{signature:'sales_history_read_private.records(uuid,uuid,uuid,text)'})]),/return marker changed/));
test('duplicate signatures are rejected before any SQL is generated',()=>assert.throws(()=>compileSourceMembershipAdapters([metadata('BEGIN SELECT * FROM public.sales; END;'),metadata('BEGIN SELECT * FROM public.sales; END;')]),/Duplicate/));
test('missing security metadata is rejected',()=>{for(const extra of [{securityDefiner:false},{settings:null},{owner:null},{language:'sql'}])assert.throws(()=>compileSourceMembershipAdapters([metadata('BEGIN SELECT * FROM public.sales; END;',extra)]),/Unsupported/);});
test('malformed catalog signature cannot introduce additional SQL',()=>assert.throws(()=>compileSourceMembershipAdapters([metadata('BEGIN SELECT * FROM public.sales; END;',{signature:'public.x(); DELETE FROM public.sales;'})]),/signature/));
test('unterminated SQL constructs are rejected',()=>{for(const source of ['/* open', '$tag$ open', "'open"])assert.throws(()=>sqlSegments(source),/Unterminated/);});
test('catalog signatures are qualified and whitespace normalized',()=>{assert.match(sourceMembershipCatalogSql,/quote_ident\(n.nspname\)/);assert.match(sourceMembershipCatalogSql,/replace\(oidvectortypes\(p.proargtypes\),', ',','\)/);});
test('full catalog SQL normalization and capabilities helpers are skipped without changing their bodies',()=>{
 const rows=[metadata('BEGIN SELECT * FROM public.sales; END;'),metadata("SELECT lower(p_phone);",{signature:'public.crm_v2_normalize_phone(text)',language:'sql',arguments:'p_phone text'}),metadata("SELECT jsonb_build_object('enabled',true);",{signature:'public.crm_v2_capabilities()',language:'sql',arguments:''})];assert.equal(compileSourceMembershipAdapters(rows).entries.length,1);
});
test('SQL voice RLS helper filters retired parents without a BEGIN or new authorization condition',()=>{
 const source="SELECT EXISTS(SELECT 1 FROM public.lead_project_interests i JOIN public.sales_customers c ON c.id=i.customer_id WHERE auth.uid() IS NOT NULL);";
 const result=compileSourceMembershipAdapters([metadata(source,{signature:'public.crm_v2_voice_row_readable(uuid)',language:'sql',arguments:'p_visit_id uuid'})]);assert.equal(result.entries[0].relationReplacements,2);assert.match(result.sql,/WHERE auth.uid\(\) IS NOT NULL/);assert.doesNotMatch(result.sql,/assert_payload/);
});
test('SQL voice Admin/Owner bypass still refuses an explicitly retired parent',()=>{
 const source="SELECT COALESCE(public.crm_v2_role() IN ('admin','owner') OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=p_visit_id),false);";
 const result=compileSourceMembershipAdapters([metadata(source,{signature:'public.crm_v2_voice_row_readable(uuid)',language:'sql',arguments:'p_visit_id uuid'})]);assert.match(result.sql,/public.crm_v2_role\(\) IN \(''admin'',''owner''\)/);assert.match(result.sql,/NOT customer_source_membership_private.interest_member\(retired_interest.id\)/);assert.match(result.sql,/retired_visit.id=p_visit_id/);
});
test('actual central search filters all canonical reads and preserves literal wildcard rules',()=>{
 const source=readFileSync('sql/sales/22_central_search_draft.sql','utf8');const body=source.split('AS $snapshot$')[1].split('$snapshot$;')[0];const result=compileSourceMembershipAdapters([metadata(body,{signature:'public.crm_v2_central_search(jsonb,integer)',arguments:'p_filters jsonb, p_page integer'})]);assert.equal(result.entries[0].relationReplacements,6);assert.match(result.sql,/strpos\(lower\(c.customer_name\)/);assert.match(result.sql,/ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page\*50/);
});
test('SQL20 mapping guard remains complete and gains only a scoped legacy predicate',()=>{
 const source=readFileSync('sql/sales/20_sales_reports_read_draft.sql','utf8').replace(/\r\n/g,'\n');
 const body=source.split('AS $snapshot$')[1].split('$snapshot$;')[0];
 const rewritten=rewriteSourceReads(body).body;
 const adapted=rewriteSalesReportLegacyGuard(rewritten);
 assert.ok(adapted.includes('WHERE customer_source_membership_private.report_requires_legacy_mapping(legacy.id) AND (link.legacy_lead_id IS NULL'));
 assert.equal(adapted.replace('customer_source_membership_private.report_requires_legacy_mapping(legacy.id) AND (','').replace('link.customer_id)))) THEN','link.customer_id))) THEN'),rewritten);
 assert.ok(adapted.includes("RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED'"));
 assert.ok(adapted.includes("(c.lead_created_at AT TIME ZONE 'Asia/Bangkok')::date"));
 assert.ok(adapted.includes('unknownLeadDateCustomers'));
});
test('changed or duplicated SQL20 mapping guard refuses automatic adaptation',()=>{
 const source=readFileSync('sql/sales/20_sales_reports_read_draft.sql','utf8').replace(/\r\n/g,'\n');
 const body=rewriteSourceReads(source.split('AS $snapshot$')[1].split('$snapshot$;')[0]).body;
 assert.throws(()=>rewriteSalesReportLegacyGuard(body.replace('link.customer_id))) THEN','link.customer_id)) AND true) THEN')),/legacy integrity guard changed/);
 assert.throws(()=>rewriteSalesReportLegacyGuard(body+body),/legacy integrity guard changed/);
});
test('SQL20 exact-source compiler keeps role, capability and historical date semantics',()=>{
 const source=readFileSync('sql/sales/20_sales_reports_read_draft.sql','utf8');
 const body=source.split('AS $snapshot$')[1].split('$snapshot$;')[0];
 const result=compileSourceMembershipAdapters([metadata(body,{signature:'public.crm_v2_sales_report(text,text,text)',arguments:'p_project_name text, p_from_date text, p_to_date text'})]);
 assert.equal(result.entries.length,1);
 assert.match(result.sql,/report_requires_legacy_mapping\(legacy.id\)/);
 assert.match(result.sql,/CRM_SALES_REPORTS_FORBIDDEN/);
 assert.match(result.sql,/crm_v2_sales_reports_capabilities/);
 assert.doesNotMatch(result.sql,/UPDATE public.leads|INSERT INTO public.leads|INSERT INTO public.crm_legacy_lead_links/);
});
test('legacy exemption requires authority head and immutable reviewed identity scope',()=>{
 const source=readFileSync('sql/sales/31_customer_source_membership_draft.sql','utf8');
 const helper=source.split('CREATE FUNCTION customer_source_membership_private.report_requires_legacy_mapping(p_id uuid)')[1].split('$$;')[0];
 assert.match(helper,/NOT EXISTS\(SELECT 1 FROM customer_source_membership_private.head\)/);
 assert.match(helper,/NOT EXISTS\(SELECT 1 FROM customer_source_membership_private.scope_leads WHERE id=p_id AND exempt_mapping\)/);
 assert.match(helper,/customer_member\(link.customer_id\)/);
 assert.match(helper,/interest_member\(link.project_interest_id\)/);
 assert.match(source,/scope_leads\(id uuid PRIMARY KEY REFERENCES public.leads ON DELETE RESTRICT,exempt_mapping boolean NOT NULL\)/);
 assert.ok(source.includes("'scope_batches','scope_leads','head','adapters'"));
 assert.ok(source.includes("'scope_batches','scope_leads','adapters'"));
 assert.doesNotMatch(helper,/crm_stage|status|phone|customer_name|lead_created_at/);
});
test('legacy identity scope pins the reviewed973 UUIDs and freezes active-link protection before authority',()=>{
 const source=readFileSync('sql/sales/31_customer_source_membership_draft.sql','utf8');
 const activation=source.split('CREATE FUNCTION customer_source_membership_private.activate(')[1].split('END; $$;')[0];
 assert.match(activation,/public.sales,public.leads,public.crm_legacy_lead_links IN SHARE ROW EXCLUSIVE MODE/);
 assert.match(activation,/count\(\*\) FROM public.leads\)<>973/);
 assert.match(activation,/md5\(string_agg\(id::text,E'\\n' ORDER BY id\)\)/);
 assert.ok(activation.includes('96bca8c3499c91241b9f4258175f4f2d'));
 assert.ok(activation.indexOf('CUSTOMER_MEMBERSHIP_REPLAY_CONFLICT')<activation.indexOf('CUSTOMER_MEMBERSHIP_LEGACY_SCOPE_REVIEW_REQUIRED'));
 assert.ok(activation.indexOf('INSERT INTO customer_source_membership_private.scope_leads')<activation.indexOf('INSERT INTO customer_source_membership_private.head'));
 assert.match(activation,/m.revision_id=revision AND m.customer_id=link.customer_id/);
 assert.match(activation,/m.revision_id=revision AND m.interest_id=link.project_interest_id/);
 assert.doesNotMatch(activation,/UPDATE public.leads|INSERT INTO public.leads|INSERT INTO public.crm_legacy_lead_links/);
});
test('direct Data API retirement policies are restrictive SELECT-only and retain existing authorization policies',()=>{
 const source=readFileSync('sql/sales/31_customer_source_membership_draft.sql','utf8');
 for(const [table,kind] of [['sales_customers','customer'],['lead_project_interests','interest'],['sales','sale']]){
  assert.ok(source.includes(`CREATE POLICY ${kind}_source_membership_read ON public.${table} AS RESTRICTIVE FOR SELECT TO authenticated`));
  assert.ok(source.includes(`USING(customer_source_membership_private.rls_${kind}_member(id))`));
 }
 assert.doesNotMatch(source,/DROP POLICY|ALTER POLICY|GRANT SELECT|CREATE POLICY[^;]+FOR ALL/);
 assert.match(source,/CUSTOMER_MEMBERSHIP_SELECT_POLICY_DRIFT/);
});
test('RLS boolean definers avoid recursive table policies and grant only their three safe wrappers',()=>{
 const source=readFileSync('sql/sales/31_customer_source_membership_draft.sql','utf8');
 for(const kind of ['customer','interest','sale']){
  const helper=source.split(`CREATE FUNCTION customer_source_membership_private.rls_${kind}_member(p_id uuid)`)[1].split('$$;')[0];
  assert.match(helper,/RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off/);
  assert.ok(helper.includes(`SELECT customer_source_membership_private.${kind}_member(p_id);`));
  assert.doesNotMatch(helper,/INSERT|UPDATE|DELETE|RETURN QUERY/);
 }
 const grants=source.split('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;')[1];
 assert.ok(grants.includes('GRANT USAGE ON SCHEMA customer_source_membership_private TO authenticated;'));
 assert.match(grants,/GRANT EXECUTE ON FUNCTION customer_source_membership_private.rls_customer_member\(uuid\),customer_source_membership_private.rls_interest_member\(uuid\),customer_source_membership_private.rls_sale_member\(uuid\) TO authenticated;/);
 assert.doesNotMatch(grants,/TO PUBLIC|TO anon|GRANT ALL|GRANT SELECT|activate\(/);
});
