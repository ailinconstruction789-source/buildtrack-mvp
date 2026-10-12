// Synthetic six-row inputs against actual canonical DDL and exact imported seals.
// This module opens no connection, reads no environment/credentials, and is callable
// only inside the owned random loopback cluster supplied by the root runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { syntheticDraftBody } from './safety.mjs';
export const sourceBoundCreationDraftPath='sql/sales/27_source_bound_customer_creation_draft.sql';
const hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>`'${String(s).replaceAll("'","''")}'`,j=s=>`${q(JSON.stringify(s))}::jsonb`;
const session=(sql,actor,role='')=>`BEGIN; ${role?`SET LOCAL ROLE ${role};`:''} SET LOCAL "request.jwt.claim.sub"=${q(actor??'')}; ${sql} COMMIT;`;
export async function runSourceBoundCustomerCreation({query,root,report}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern=/SOURCE_CREATION_|permission denied|duplicate key|invalid input|out of range|date\/time field|check constraint|foreign key/)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 report.sources??={};
 const read=path=>{const source=readFileSync(join(root,path),'utf8');report.sources[path]=hash(source);return source;};
 read('scripts/sales-runtime/source-bound-customer-creation.mjs');
 const beforeConstraint=await query("SELECT jsonb_object_agg(conname,pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid IN('public.sales_customers'::regclass,'public.lead_project_interests'::regclass) AND conname IN('crm_customer_origin_check','crm_interest_created_evidence_check','lead_project_interests_engagement_status_check');");
 // Install the UNCHANGED imported-source guard function over typed fixture
 // prerequisites. Existing customer_candidates/interest_candidates contain just
 // identity keys in post-booking-historical; add their exact fields used by guard.
 // Account-security proof for old inserts is not synthesized or certified here.
 const bridge=read('sql/sales/external_crm_bridge_draft.sql');
 const start=bridge.indexOf('CREATE FUNCTION crm_external_private.guard_materialized_history('),end=bridge.indexOf('$$;',start);
 assert.ok(start>=0&&end>start);
 if(await query("SELECT to_regprocedure('crm_external_private.guard_materialized_history()') IS NULL;")==='t') {
  await query(`ALTER TABLE crm_external_private.customer_candidates ADD COLUMN payload jsonb,ADD COLUMN customer_name text,ADD COLUMN owner_login text;
   ALTER TABLE crm_external_private.interest_candidates ADD COLUMN payload jsonb,ADD COLUMN owner_login text,ADD COLUMN project_label text,ADD COLUMN customer_key text;
   ${bridge.slice(start,end+3)}
   REVOKE ALL ON FUNCTION crm_external_private.guard_materialized_history() FROM PUBLIC,anon,authenticated;
   CREATE TRIGGER external_customer_seal BEFORE INSERT OR UPDATE OR DELETE ON public.sales_customers FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_materialized_history();
   CREATE TRIGGER external_interest_seal BEFORE INSERT OR UPDATE OR DELETE ON public.lead_project_interests FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_materialized_history();`);
 }
 const originalSeal=await query("SELECT pg_get_functiondef('crm_external_private.guard_materialized_history()'::regprocedure);");
 await query(syntheticDraftBody(sourceBoundCreationDraftPath,read(sourceBoundCreationDraftPath)));
 const constraints=JSON.parse(beforeConstraint);
 for(const [key,old] of Object.entries(constraints)) {
  const changed=await query(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname=${q(key)};`);
  // PostgreSQL's deparser may normalize parentheses, but old branch clauses must
  // remain recognizable; preservation is also exercised with negative inserts.
  check(changed.includes('supplemental_creation_id IS NULL')&&changed.includes('supplemental_creation_id IS NOT NULL')&&old.startsWith('CHECK ('),`old ${key} has an independently gated supplemental branch`);
 }
 const admin=randomUUID(),sales=randomUUID(),teaw='9c1d670a-1d2a-4996-959c-33c243fd34d8';
 await query(`INSERT INTO auth.users(id) VALUES(${q(admin)}),(${q(sales)}),(${q(teaw)}) ON CONFLICT DO NOTHING;
  INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES(${q(admin)},'admin','SYNTHETIC APPEND ADMIN',true),(${q(sales)},'sales','SYNTHETIC APPEND SALES',true),(${q(teaw)},'sales','TEAW',true) ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC APPEND PROJECT',false);`);
 const payload={version:'source-bound-customer-creation-v1',datasetKey:'SYNTHETIC-SOURCE-APPEND',sourceSha256:hash('SYNTHETIC workbook'),reviewSha256:hash('SYNTHETIC independent confirmation'),leadReplayAllowed:false,businessStageWritesAllowed:false,
  records:[438,439,440,444,894,680].map((sourceRow,index)=>({sourceRow,sourceKey:hash(`SYNTHETIC source ${sourceRow}`),rowSha256:hash(`SYNTHETIC row ${sourceRow}`),customerCandidateKey:hash(`SYNTHETIC distinct customer ${sourceRow}`),interestCandidateKey:hash(`SYNTHETIC distinct interest ${sourceRow}`),
   customerName:sourceRow===680?'ไม่ทราบ':'SYNTHETIC SAME DISPLAY NAME',unknownName:sourceRow===680,ownerUserId:sourceRow===680?sales:teaw,projectName:'SYNTHETIC APPEND PROJECT',
   events:[{eventKey:'visit-1',kind:'visited',date:index===0?null:'2025-02-28',precision:index===0?'unknown':'day',evidenceRef:'SYNTHETIC historical source day'}]}))};
 const apply=p=>`SELECT sales_source_creation_private.apply_reviewed(${j(p)});`;
 const state=()=>query(`SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM sales_source_creation_private.batches b),
  'records',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_source_creation_private.records r),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY record_id,event_key) FROM sales_source_creation_private.events e),
  'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c WHERE supplemental_creation_id IS NOT NULL),'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i WHERE supplemental_creation_id IS NOT NULL),'permits',(SELECT count(*) FROM sales_source_creation_private.permits));`);
 const originalBusiness=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c WHERE supplemental_creation_id IS NULL),
  'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i WHERE supplemental_creation_id IS NULL),'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
  'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
  'visits',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.lead_visits v),'customersSource',(SELECT jsonb_agg(to_jsonb(c) ORDER BY batch_id,entity_key) FROM crm_external_private.customer_candidates c),
  'interestsSource',(SELECT jsonb_agg(to_jsonb(i) ORDER BY batch_id,entity_key) FROM crm_external_private.interest_candidates i));`);
 const original=await originalBusiness(),empty=await state();
 check(await query('SELECT count(*)>0 FROM public.sales_customers;')==='t','append trial starts with nonempty canonical CRM');
 const originalSettings=await query('SELECT jsonb_agg(to_jsonb(s)) FROM public.crm_settings s;');
 await deny('missing canonical settings singleton fails closed',session(`DELETE FROM public.crm_settings WHERE id; ${apply(payload)}`,admin),/SOURCE_CREATION_DISABLED_FLAGS_REQUIRED/);
 check(await query('SELECT jsonb_agg(to_jsonb(s)) FROM public.crm_settings s;')===originalSettings&&await state()===empty,'missing settings denial rolls back singleton deletion and all import state');
 for(const [label,actor,role] of [['Sales',sales,''],['missing actor',null,''],['browser Admin',admin,'authenticated'],['anonymous',admin,'anon']])
  await deny(`${label} denied private append`,session(apply(payload),actor,role));
 for(const table of ['batches','records','events','permits'])for(const role of ['anon','authenticated'])
  await deny(`${role} cannot read source creation ${table}`,session(`SELECT * FROM sales_source_creation_private.${table};`,admin,role));
 const mutations=[
  ['missing sixth source row',p=>{p.records.pop();}],
  ['unapproved source row',p=>{p.records[0].sourceRow=681;}],
  ['duplicate source row late',p=>{p.records.at(-1).sourceRow=438;p.records.at(-1).unknownName=false;}],
  ['NULL schema version',p=>{p.version=null;}],
  ['extra Lead binding forbidden',p=>{p.records[0].leadId=randomUUID();}],
  ['supplied customer UUID forbidden',p=>{p.records[0].customerId=randomUUID();}],
  ['unconfirmed replacement Sales',p=>{p.records[0].ownerUserId=sales;}],
  ['made-up project later in batch',p=>{p.records.at(-1).projectName='SYNTHETIC MISSING PROJECT';}],
  ['placeholder customer missing explicit identity decision',p=>{p.records.at(-1).unknownName=false;}],
  ['missing-name source forced into invented name',p=>{p.records.at(-1).customerName='SYNTHETIC INVENTED NAME';}],
  ['same customer candidate key later in batch',p=>{p.records.at(-1).customerCandidateKey=p.records[0].customerCandidateKey;}],
  ['same source key later in batch',p=>{p.records.at(-1).sourceKey=p.records[0].sourceKey;}],
  ['unknown date cannot become import date',p=>{p.records[0].events[0].precision='day';}],
  ['calendar-invalid final source day',p=>{p.records.at(-1).events[0].date='2025-02-29';}],
  ['operational booked event prohibited',p=>{p.records.at(-1).events[0].kind='booked';}],
  ['rental source event prohibited',p=>{p.records.at(-1).events[0].kind='rented';}],
  ['empty final history',p=>{p.records.at(-1).events=[];}],
  ['NULL history precision',p=>{p.records.at(-1).events[0].precision=null;}],
  ['extra bank cannot be manufactured',p=>{p.records[0].bankName='SYNTHETIC BANK';}],
 ];
 for(const [label,mutate] of mutations){const bad=structuredClone(payload);mutate(bad);await deny(label,session(apply(bad),admin));check(await state()===empty,`${label} atomically rolls back all allocated canonical identities and evidence`);}
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id=${q(teaw)};`);
 await deny('deactivated confirmed TEAW denied',session(apply(payload),admin));
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id=${q(teaw)};`);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id=${q(admin)};`);
 await deny('deactivated reviewer denied',session(apply(payload),admin));
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id=${q(admin)};`);
 // Existing branches still reject legacy_import with neither snapshot nor legacy
 // Lead nor supplemental provenance; retain existing live phone proof as well.
 await deny('original legacy origin still requires evidence',session(`INSERT INTO public.sales_customers(customer_name,record_origin,phone_data_status,lead_created_at,owner_user_id,created_by_user_id)
  VALUES('SYNTHETIC UNBOUND LEGACY','legacy_import','unknown_legacy',NULL,${q(teaw)},${q(admin)});`,admin));
 await deny('original live phone remains required',session(`INSERT INTO public.sales_customers(customer_name,owner_user_id,created_by_user_id) VALUES('SYNTHETIC NO PHONE',${q(teaw)},${q(admin)});`,admin));
 const result=JSON.parse(await query(session(apply(payload),admin))),after=await state();
 check(result.records===6&&result.bindings.length===6&&new Set(result.bindings.map(b=>b.customerId)).size===6&&new Set(result.bindings.map(b=>b.interestId)).size===6,'six distinct Customer and Interest UUIDs allocated only at successful apply');
 check(await query("SELECT count(*) FROM public.sales_customers WHERE supplemental_creation_id IS NOT NULL AND customer_name='SYNTHETIC SAME DISPLAY NAME';")==='5','five equal names stay separate source-bound identities');
 check(await query("SELECT count(*) FROM public.sales_customers WHERE supplemental_creation_id IS NOT NULL AND customer_name='ไม่ทราบ';")==='1','missing name stays explicit unknown display with independent source identity');
 check(await query("SELECT count(*) FROM public.sales_customers WHERE supplemental_creation_id IS NOT NULL AND (legacy_source_lead_id IS NOT NULL OR lead_created_at IS NOT NULL OR first_contacted_at IS NOT NULL OR phone IS NOT NULL OR phone_data_status<>'unknown_legacy' OR intake_status<>'legacy_unclassified');")==='0','new imported customers have no invented Lead phone intake date or contact');
 check(await query("SELECT count(*) FROM public.lead_project_interests WHERE supplemental_creation_id IS NOT NULL AND (interest_created_at IS NOT NULL OR activated_at IS NOT NULL OR activation_reason IS NOT NULL OR interested_plot_id IS NOT NULL OR workspace_state<>'central_interest' OR engagement_status<>'legacy_unclassified');")==='0','historical Interest remains unactivated without fake timestamp or stock');
 check(await query("SELECT count(*) FROM sales_source_creation_private.events WHERE event_day IS NULL AND precision='unknown';")==='1','unknown source day preserved outside operational Visit table');
 const replay=JSON.parse(await query(session(apply(payload),admin)));
 check(replay.replayed&&JSON.stringify(replay.bindings)===JSON.stringify(result.bindings)&&await state()===after,'exact replay returns original bindings without duplicates');
 const changed=structuredClone(payload);changed.records[0].customerName+=' CHANGED';
 await deny('changed replay rejected',session(apply(changed),admin));
 const second=structuredClone(payload);second.datasetKey+=' SECOND';
 await deny('same source identities cannot be recreated under another dataset',session(apply(second),admin));
 check(await state()===after,'conflicting replay creates no receipts or identities');
 await deny('supplemental Customer sealed against direct rewrite',session(`UPDATE public.sales_customers SET customer_name='SYNTHETIC CHANGED' WHERE id=${q(result.bindings[0].customerId)};`,admin));
 await deny('supplemental Interest sealed against direct activation',session(`UPDATE public.lead_project_interests SET workspace_state='project_active',activation_reason='legacy_import' WHERE id=${q(result.bindings[0].interestId)};`,admin));
 await deny('immutable provenance blocks deletion',session('DELETE FROM sales_source_creation_private.records;',admin));
 // Preserve existing canonical detail overlays: exact existing permit and guard,
 // not direct edits to sealed source Customer. Keep this fixture change rolled back.
 await query(`BEGIN; SET LOCAL "request.jwt.claim.sub"=${q(admin)};
  DO $$ DECLARE correction sales_private.customer_profile_corrections%ROWTYPE; BEGIN
   correction.customer_id:=${q(result.bindings[0].customerId)}; correction.name:='SYNTHETIC REVIEWED DETAIL';
   correction.phone:=NULL;correction.occupation:=NULL;correction.revision:=gen_random_uuid();correction.actor_user_id:=auth.uid();correction.reason:='SYNTHETIC detail compatibility';correction.recorded_at:=clock_timestamp();
   INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),'customer',correction.customer_id,NULL,to_jsonb(correction));
   INSERT INTO sales_private.customer_profile_corrections SELECT correction.*;
   DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
   IF sales_private.crm_effective_customer_name(correction.customer_id)<>'SYNTHETIC REVIEWED DETAIL' THEN RAISE EXCEPTION 'SYNTHETIC_DETAIL_COMPATIBILITY_FAILED'; END IF;
  END $$; ROLLBACK;`);
 cases.push('supplemental Customer works with unchanged canonical profile overlay guard and effective reader');
 // Real booking permit helpers over typed fixture release rows. The operational
 // flags/release/activation are rollback-only: this certifies the exact Interest
 // exception, not the full booking command, stock, or installation activation.
 const writer=read('sql/sales/external_booking_writer_draft.sql');
 const definition=name=>{const at=writer.indexOf(`CREATE FUNCTION crm_external_private.${name}(`),last=writer.indexOf('$$;',at);assert.ok(at>=0&&last>at);return writer.slice(at,last+3);};
 if(await query("SELECT to_regclass('crm_external_private.booking_writer_permits') IS NULL;")==='t') {
  const first=writer.indexOf('CREATE TABLE crm_external_private.booking_writer_releases'),last=writer.indexOf('CREATE TRIGGER booking_writer_release_immutable');
  assert.ok(first>=0&&last>first);await query(writer.slice(first,last));
 }
 for(const name of ['booking_writer_ready','begin_booking_write','end_booking_write','booking_interest_allowed'])
  if(await query(`SELECT to_regprocedure(${q(`crm_external_private.${name}(${name==='begin_booking_write'?'uuid,uuid,uuid,uuid,text':name==='booking_interest_allowed'?'jsonb,jsonb':''})`)}) IS NULL;`)==='t')await query(definition(name));
 await query('REVOKE ALL ON ALL TABLES IN SCHEMA crm_external_private FROM PUBLIC,anon,authenticated; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_external_private FROM PUBLIC,anon,authenticated;');
 const compat=result.bindings[0],compatOwner=payload.records.find(r=>r.sourceRow===compat.sourceRow).ownerUserId;
 const activate=`BEGIN; SET LOCAL "request.jwt.claim.sub"=${q(compatOwner)};
  UPDATE public.crm_settings SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true WHERE id;
  INSERT INTO crm_external_private.booking_writer_releases(batch_id,plan_digest,review_reference) SELECT batch_id,'SYNTHETIC permit review','SYNTHETIC exact helper compatibility' FROM crm_external_private.sales_cutover_receipts ORDER BY batch_id LIMIT 1 ON CONFLICT DO NOTHING;
  SELECT crm_external_private.begin_booking_write(${q(compatOwner)},${q(compat.customerId)},${q(compat.interestId)},${q(randomUUID())},'book');`;
 await query(`${activate} UPDATE public.lead_project_interests SET workspace_state='project_active',activated_at=clock_timestamp(),activation_reason='booking',lifecycle_revision=gen_random_uuid(),updated_at=clock_timestamp() WHERE id=${q(compat.interestId)};
  SELECT crm_external_private.end_booking_write(); ROLLBACK;`);
 cases.push('unchanged canonical booking helper exact permit allows supplemental Interest activation');
 await deny('booking permit cannot rewrite supplemental owner',`${activate} UPDATE public.lead_project_interests SET owner_user_id=${q(sales)} WHERE id=${q(compat.interestId)}; ROLLBACK;`,/SOURCE_CREATION_SEALED/);
 await deny('booking permit cannot rewrite supplemental provenance',`${activate} UPDATE public.lead_project_interests SET supplemental_creation_id=NULL WHERE id=${q(compat.interestId)}; ROLLBACK;`,/SOURCE_CREATION_SEALED/);
 check(await state()===after,'rollback-only compatibility checks preserve original imported rows and immutable records');
 const existing=await query('SELECT id FROM public.sales_customers WHERE external_snapshot_batch_id IS NOT NULL ORDER BY id LIMIT 1;');
 assert.ok(existing);
 await deny('original imported Customer seal retained',session(`UPDATE public.sales_customers SET customer_name='SYNTHETIC CHANGED' WHERE id=${q(existing)};`,admin),/EXTERNAL_CRM_HISTORY_SEALED/);
 check(await query("SELECT pg_get_functiondef('crm_external_private.guard_materialized_history()'::regprocedure);")===originalSeal,'original external source guard definition unchanged');
 check(await originalBusiness()===original,'existing canonical customers interests sales plots Leads Visits and snapshot candidates unchanged');
 check(await query('SELECT count(*) FROM sales_source_creation_private.permits;')==='0','success and all failures leave no reusable insert permit');
 return {cases,assertions:cases.length,actualCanonicalTables:true,actualExternalSourceGuardBody:true,sourceRowsSynthetic:true,realDatabaseWrites:false,
  accountSecurityLegacyInsertBranchTested:false,fullExternalInstallationTested:false,fullBookingCommandTested:false,
  exactBookingInterestPermitCompatibility:true,exactCustomerProfileOverlayCompatibility:true};
}
