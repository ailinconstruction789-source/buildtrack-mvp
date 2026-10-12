// Actual public Excel + history function bodies on typed synthetic prerequisites.
// No database connection, credentials, application flags or live source read here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {syntheticDraftBody} from './safety.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const hash=v=>createHash('sha256').update(v).digest('hex');
const actor='cb310000-0000-4000-8000-000000000001',owner='cb310000-0000-4000-8000-000000000003',admin='ca280000-0000-4000-8000-000000000001';
const request=(sql,id=actor,role='authenticated',readOnly=true)=>`BEGIN${readOnly?' READ ONLY':''}; ${role?`SET LOCAL ROLE ${role};`:''} SET LOCAL "request.jwt.claim.sub"=${q(id)}; ${sql} COMMIT;`;
// Must run before27 adds the immutable external Interest insert guard. Typed
// setup only; never disable a seal or pretend to verify old account evidence.
export async function prepareImportedHistorySharedInterest({query,report}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 assert.equal(await query("SELECT to_regprocedure('crm_external_private.guard_materialized_history()') IS NULL;"),'t');
 const source=JSON.parse(await query("SELECT jsonb_build_object('customerId',c.id,'saleId',s.id,'batchId',c.external_snapshot_batch_id,'customerKey',c.external_customer_key,'firstInterestId',i.id) FROM public.sales s JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id WHERE (p.payload->>'source_row')::integer=2;"));
 assert.ok(source?.customerId);const interestId=randomUUID(),key='SYNTHETIC SHARED SOURCE INTEREST';
 await query(`INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC SHARED SOURCE PROJECT',false);
 INSERT INTO crm_external_private.interest_candidates(batch_id,entity_key) VALUES('${source.batchId}',${q(key)});
 INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,interest_created_at,engagement_status,external_snapshot_batch_id,external_interest_key)
 VALUES('${interestId}','${source.customerId}','SYNTHETIC SHARED SOURCE PROJECT','${actor}','${actor}',NULL,'legacy_unclassified','${source.batchId}',${q(key)});`);
 report.syntheticSharedHistoryInterest={...source,interestId,sourceRow:2};
}
export async function runImportedHistoryProjection({query,root,report,parseHistory,parseExcel}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const read=p=>{const source=readFileSync(join(root,p),'utf8');report.sources[p]=hash(source);return source;};
 read('scripts/sales-runtime/imported-history-projection.mjs');
 // These typed upstream tables only support the unchanged reader's dependency
 // contract. Original staging materialization/security setup is not recreated.
 await query(`INSERT INTO crm_external_private.booking_writer_releases(batch_id,plan_digest,review_reference) SELECT batch_id,'SYNTHETIC complete reader review','SYNTHETIC loopback fixture release' FROM crm_external_private.sales_cutover_receipts ON CONFLICT DO NOTHING;
 CREATE TABLE crm_external_private.snapshot_batches(id uuid PRIMARY KEY,feed text UNIQUE,source_sha256 text,plan_digest text,payload jsonb);
 CREATE TABLE crm_external_private.source_records(batch_id uuid,payload jsonb,source_row integer,entity_key text,customer_key text,disposition text,PRIMARY KEY(batch_id,source_row));
 INSERT INTO crm_external_private.snapshot_batches SELECT batch_id,'customer-sheet',${q(hash('SYNTHETIC original workbook'))},plan_digest,'{}'::jsonb FROM crm_external_private.booking_writer_releases;
 UPDATE public.crm_settings SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=true WHERE id;
 UPDATE crm_external_private.interest_candidates ic SET customer_key=c.external_customer_key,project_label=i.project_name,payload=jsonb_build_object('sourceRows',coalesce((SELECT jsonb_agg((p.payload->>'source_row')::integer ORDER BY p.id) FROM crm_external_private.prepared_booking_sales p WHERE p.payload->>'interest_id'=i.id::text),'[]')) FROM public.lead_project_interests i JOIN public.sales_customers c ON c.id=i.customer_id WHERE ic.batch_id=i.external_snapshot_batch_id AND ic.entity_key=i.external_interest_key;
 UPDATE crm_external_private.interest_candidates SET payload=jsonb_build_object('sourceRows',jsonb_build_array(2)) WHERE entity_key='SYNTHETIC SHARED SOURCE INTEREST';
 INSERT INTO crm_external_private.source_records(batch_id,payload,source_row,entity_key,customer_key,disposition)
 SELECT p.batch_id,jsonb_build_object('rowDigest',${q(hash('SYNTHETIC immutable source cells'))},'reviewedHistory',jsonb_build_object('visitHistoryDate','2024-01-01','expectedTransferDate',NULL,'projectLabels',jsonb_build_array(i.project_name))),
 (p.payload->>'source_row')::integer,md5(p.id::text)||md5(p.id::text),c.external_customer_key,'mapped_for_review'
 FROM crm_external_private.prepared_booking_sales p JOIN public.lead_project_interests i ON i.id=(p.payload->>'interest_id')::uuid JOIN public.sales_customers c ON c.id=i.customer_id;
 INSERT INTO crm_external_private.source_records(batch_id,payload,source_row,entity_key,customer_key,disposition)
 SELECT (SELECT id FROM crm_external_private.snapshot_batches),jsonb_build_object('rowDigest',r.row_sha256,'reviewedHistory',jsonb_build_object('projectLabels',jsonb_build_array(i.project_name),'visitHistoryDate',NULL)),r.source_row,r.source_key,'SYNTHETIC HELD '||r.source_row,'admin_review'
 FROM sales_source_creation_private.records r JOIN public.lead_project_interests i ON i.id=r.interest_id;
 INSERT INTO crm_external_private.source_records(batch_id,payload,source_row,entity_key,customer_key,disposition)
 SELECT c.external_snapshot_batch_id,jsonb_build_object('rowDigest',e.row_sha256,'reviewedHistory',jsonb_build_object('visitHistoryDate','2024-01-01','expectedTransferDate',NULL,'projectLabels',jsonb_build_array(i.project_name))),e.source_row,e.source_key,c.external_customer_key,'mapped_for_review'
 FROM sales_revision_private.events e JOIN public.sales_customers c ON c.id=e.customer_id JOIN public.lead_project_interests i ON i.id=e.interest_id WHERE e.source_row=964;
 UPDATE crm_external_private.interest_candidates ic SET payload=jsonb_set(ic.payload,'{sourceRows}',(ic.payload->'sourceRows')||jsonb_build_array(964)) FROM sales_revision_private.events e JOIN public.lead_project_interests i ON i.id=e.interest_id WHERE e.source_row=964 AND ic.entity_key=i.external_interest_key AND ic.batch_id=i.external_snapshot_batch_id;
 INSERT INTO crm_external_private.interest_candidates(batch_id,entity_key,customer_key,project_label,payload)
 SELECT s.batch_id,'SYNTHETIC HELD INTEREST '||r.source_row,s.customer_key,i.project_name,jsonb_build_object('sourceRows',jsonb_build_array(r.source_row)) FROM sales_source_creation_private.records r JOIN public.lead_project_interests i ON i.id=r.interest_id JOIN crm_external_private.source_records s ON s.source_row=r.source_row;
 ALTER TABLE public.lead_visits ADD COLUMN IF NOT EXISTS completed_voice_id uuid;`);
 if(await query("SELECT to_regnamespace('sales_unknown_history_private') IS NULL;")==='t') {
  const path='sql/sales/25_unknown_historical_evidence_draft.sql';await query(syntheticDraftBody(path,read(path)));
 }
 const pending=report.syntheticHistoricalPendingDeals;
 assert.equal(pending?.length,2);
 const unknownRows=[237,238,239,249,250,256,257,263,274,275].map((rowNumber,index)=>({sourceKey:hash(`SYNTHETIC projected unknown ${rowNumber}`),rowNumber,rowSha256:hash(`SYNTHETIC cells ${rowNumber}`),customerKey:'SYNTHETIC confirmed separate source identity',customerId:pending[0].customerId,interestId:null,saleId:null,reason:'unknown_project',sourceStage:'visited',events:[{eventKey:'visit-1',kind:'visited',sequence:1,date:index===0?null:'2023-09-18',precision:index===0?'unknown':'day',evidenceRef:'SYNTHETIC source day'}]}));
 unknownRows.push({sourceKey:hash('SYNTHETIC projected unknown 171'),rowNumber:171,rowSha256:hash('SYNTHETIC cells 171'),customerKey:'SYNTHETIC confirmed separate source identity',customerId:pending[0].customerId,interestId:pending[0].interestId,saleId:null,reason:'unknown_booking',sourceStage:'cancelled',events:[{eventKey:'visit-1',kind:'visited',sequence:1,date:'2023-03-14',precision:'day',evidenceRef:'SYNTHETIC visit'},{eventKey:'book-1',kind:'booked',sequence:2,date:null,precision:'unknown',evidenceRef:'SYNTHETIC unknown booking day'},{eventKey:'cancel-1',kind:'cancelled',sequence:3,date:'2024-07-25',precision:'day',evidenceRef:'SYNTHETIC cancellation'}]});
 const unknownPayload={version:'unknown-historical-evidence-v1',sourceSystem:'SYNTHETIC PROJECTED GAP',datasetKey:'SYNTHETIC PROJECTION UNKNOWN',snapshotSha256:hash('SYNTHETIC gap snapshot'),mappingReviewRef:'SYNTHETIC reviewed exact IDs',records:unknownRows,businessWritesAllowed:false,leadRequired:false};
 await query(request(`SELECT sales_unknown_history_private.persist_evidence(${j(unknownPayload)});`,admin,'',false));
 const originalDefinition=await query("SELECT pg_get_functiondef('crm_excel_private.evidence(text)'::regprocedure);");
 const path='sql/sales/29_imported_history_projection_draft.sql',sql=syntheticDraftBody(path,read(path));
 await query(originalDefinition.replace('DECLARE','-- SYNTHETIC unreviewed body\nDECLARE'));
 await deny('unknown upstream Excel body rejects projection installation atomically',sql,/CRM_CUSTOMER_HISTORY_EXCEL_REVIEW_REQUIRED/);
 check(await query("SELECT to_regnamespace('sales_history_read_private') IS NULL;")==='t','failed installation leaves no history function schema or grants');
 await query(originalDefinition);await query(sql);
 const otherInterest=randomUUID();
 await query(`INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC OTHER INTEREST',false);
 INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id) VALUES('${otherInterest}','${pending[0].customerId}','SYNTHETIC OTHER INTEREST','${actor}','${actor}');`);
 const state=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales_customers x),'interests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.lead_project_interests x),'sales',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales x),'plots',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.plots x),'sources',(SELECT jsonb_agg(to_jsonb(x) ORDER BY batch_id,source_row) FROM crm_external_private.source_records x),'creation',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_source_creation_private.records x),'revision',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_revision_private.events x),'unknown',(SELECT jsonb_agg(to_jsonb(x) ORDER BY batch_id,source_key) FROM sales_unknown_history_private.records x),'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.crm_audit_events x));`);
 const before=await state();
 const history=async(customerId,interestId=null,saleId=null,page=0,id=actor)=>{
  const result=JSON.parse(await query(request(`SELECT public.crm_v2_customer_history(${q(customerId)}::uuid,${interestId?`${q(interestId)}::uuid`:'NULL'},${saleId?`${q(saleId)}::uuid`:'NULL'},${page});`,id)));
  if(parseHistory)parseHistory(result,{customerId,interestId,saleId,page});return result;
 };
 for(const user of [actor,owner,admin]) {
  const result=await history(pending[0].customerId,null,null,0,user);
  check(result.actor.userId===user&&result.readOnly&&result.contractVersion==='historical_customer_evidence_v1',`${user===actor?'Sales':user===owner?'Owner':'Admin'} team-read gets precise actor and read-only contract`);
 }
 const whole=await history(pending[0].customerId);
 check(whole.records.filter(r=>unknownRows.some(u=>u.rowNumber===r.sourceRow)).length===11,'all eleven gap rows survive in Customer history without fake Sale or Lead');
 check(whole.records.filter(r=>r.projectName===null).length===10,'ten unknown projects stay explicitly null');
 check((await history(pending[0].customerId,otherInterest)).records.length===0,'second Interest of same Customer cannot borrow first Interest visit or cancellation history');
 const shared=report.syntheticSharedHistoryInterest;assert.ok(shared?.interestId);
 const sharedWhole=await history(shared.customerId),sharedRecord=sharedWhole.records.find(r=>r.sourceRow===2);
 check(sharedRecord?.projectName===null&&sharedRecord.interestId===null&&sharedRecord.saleId===null,'multi-project same-source Customer record keeps ambiguous project Interest and Sale all null');
 check(sharedRecord.projectNames.length===2&&sharedRecord.projectNames.includes('SYNTHETIC HISTORICAL DEALS')&&sharedRecord.projectNames.includes('SYNTHETIC SHARED SOURCE PROJECT'),'known multi-project source membership remains explicit and is not mislabeled unknown');
 const secondScope=await history(shared.customerId,shared.interestId);
 check(secondScope.records.length===1&&secondScope.records[0].projectName==='SYNTHETIC SHARED SOURCE PROJECT'&&secondScope.records[0].interestId===shared.interestId&&secondScope.records[0].saleId===null,'explicit second Interest retains its own shared-source visit without borrowing first Sale');
 const firstSale=await history(shared.customerId,null,shared.saleId);
 check(firstSale.records.length===1&&firstSale.records[0].saleId===shared.saleId&&firstSale.records[0].interestId===shared.firstInterestId,'Sale-only scope filters membership before grouping shared source row');
 const unknown=whole.records.find(r=>r.sourceRow===171);
 check(unknown?.events.find(e=>e.kind==='booked')?.date===null&&unknown.events.find(e=>e.kind==='booked').precision==='unknown','row 171 preserves unknown booking civil day');
 const scoped=await history(pending[0].customerId,pending[0].interestId,pending[0].saleId);
 check(scoped.records.length===1&&scoped.records[0].sourceRow===926&&scoped.records[0].saleId===pending[0].saleId,'Sale scope returns exactly selected cancellation lineage');
 check(scoped.records[0].events.find(e=>e.kind==='visited')?.date==='2024-01-30'&&scoped.records[0].events.find(e=>e.kind==='cancelled')?.date==='2026-10-07','approved revised visit and cancellation days override old source visit');
 check(scoped.records[0].key===await query(`SELECT external_snapshot_batch_id::text||':926' FROM public.sales_customers WHERE id=${q(pending[0].customerId)};`),'revision uses original batch:row dedup lineage');
 const created=JSON.parse(await query('SELECT jsonb_agg(jsonb_build_object(\'customerId\',customer_id,\'interestId\',interest_id,\'sourceRow\',source_row) ORDER BY source_row) FROM sales_source_creation_private.records;'));
 for(const row of created) {
  const result=await history(row.customerId,row.interestId);
  check(result.records.length===1&&result.records[0].sourceRow===row.sourceRow&&result.records[0].key.startsWith('source:'),`new source row ${row.sourceRow} retains separate identity and visited evidence`);
 }
 const newBooking=JSON.parse(await query("SELECT jsonb_build_object('customerId',customer_id,'interestId',interest_id,'saleId',sale_id) FROM sales_revision_private.events WHERE source_row=964;"));
 const booked=await history(newBooking.customerId,newBooking.interestId,newBooking.saleId);
 check(booked.records.length===1&&booked.records[0].events.find(e=>e.kind==='booked')?.date==='2026-09-29','independent row 964 booking has its own sale-scoped timeline');
 check(booked.records[0].saleId!==scoped.records[0].saleId&&booked.records[0].customerId===scoped.records[0].customerId,'reused explicit Customer identity keeps two independent Sale histories');
 const loadExcel=async projectName=>{
  const value=JSON.parse(await query(request(`SELECT public.crm_v2_excel_evidence(${q(projectName)});`)));
  const salePages=[];
  for(let page=0;page<200;page++){
   const snapshot=JSON.parse(await query(request(`SELECT public.crm_v2_project_sales(${q(projectName)},'all','',${page});`)));
   salePages.push({page:snapshot.page,hasMore:snapshot.hasMore,rows:snapshot.rows});if(!snapshot.hasMore)break;
  }
  if(parseExcel)parseExcel(value,{projectName,actor:value.actor,salePages});return value;
 };
 const excel=await loadExcel('SYNTHETIC HISTORICAL DEALS');
 check(excel.forecasts.find(f=>f.saleId===newBooking.saleId)?.expectedTransferDate==='2026-10-30','actual original public Excel RPC projects new 964 forecast through existing getter');
 check(excel.legacyVisits.filter(v=>v.key===scoped.records[0].key).length===1&&excel.legacyVisits.find(v=>v.key===scoped.records[0].key).visitDate==='2024-01-30','Excel overrides approved revised visit without duplicate source counting');
 check(excel.unassignedLegacyVisits.length===9&&excel.unknownUnassignedLegacyDates===1,'Excel keeps all ten unknown-project visits in all-project evidence only');
 check(new Set(excel.unassignedLegacyVisits.map(v=>v.key)).size===9&&excel.unassignedLegacyVisits.every(v=>v.visitDate==='2023-09-18'),'same-customer same-day visits remain nine distinct source rows without name/day deduplication');
 const appendExcel=await loadExcel('SYNTHETIC APPEND PROJECT');
 check(appendExcel.legacyVisits.length===5&&appendExcel.unknownLegacyDates===1,'six creation rows contribute five known and one unknown visits');
 const originalHeld=JSON.parse(await query(request("SELECT sales_history_read_private.original_excel('SYNTHETIC APPEND PROJECT');",actor,'')));
 check(originalHeld.pendingLegacyRows===6&&originalHeld.pendingLegacyKeys.length===6,'preserved complete original Excel reader actually counts all six held source rows');
 check(appendExcel.pendingLegacyRows===0,'resolved held rows leave no duplicate pending source count');
 const sharedExcel=await loadExcel('SYNTHETIC SHARED SOURCE PROJECT');
 check(sharedExcel.legacyVisits.length===1&&sharedExcel.legacyVisits[0].key===firstSale.records[0].key&&excel.legacyVisits.some(v=>v.key===firstSale.records[0].key),'same source row in two registered projects retains one stable global dedup key');
 // Exercise native SQL pagination, not a mocked response. This transaction
 // changes only typed upstream fixture provenance and always rolls back.
 const extraSourceRows=Array.from({length:51},(_,index)=>index+100);
 const extraRows=extraSourceRows.map(sourceRow=>`('${shared.batchId}',${j({rowDigest:hash(`SYNTHETIC PAGE cells ${sourceRow}`),reviewedHistory:{visitHistoryDate:'2024-01-01',expectedTransferDate:null,projectLabels:['SYNTHETIC HISTORICAL DEALS']}})},${sourceRow},${q(hash(`SYNTHETIC PAGE source ${sourceRow}`))},${q(shared.customerKey)},'mapped_for_review')`).join(',');
 const paged=JSON.parse(await query(`BEGIN; SET LOCAL "request.jwt.claim.sub"=${q(actor)};
 INSERT INTO crm_external_private.source_records(batch_id,payload,source_row,entity_key,customer_key,disposition) VALUES ${extraRows};
 UPDATE crm_external_private.interest_candidates SET payload=jsonb_set(payload,'{sourceRows}',(payload->'sourceRows')||${j(extraSourceRows)}) WHERE batch_id='${shared.batchId}' AND entity_key=(SELECT external_interest_key FROM public.lead_project_interests WHERE id='${shared.firstInterestId}');
 SET LOCAL ROLE authenticated;
 SELECT jsonb_build_object('first',public.crm_v2_customer_history('${shared.customerId}','${shared.firstInterestId}',NULL,0),'second',public.crm_v2_customer_history('${shared.customerId}','${shared.firstInterestId}',NULL,1)); ROLLBACK;`));
 if(parseHistory)for(const [page,value] of [paged.first,paged.second].entries())parseHistory(value,{customerId:shared.customerId,interestId:shared.firstInterestId,saleId:null,page});
 check(paged.first.records.length===50&&paged.first.hasMore===true,'native SQL page zero returns exactly fifty rows and hasMore for fifty-two source records');
 check(paged.second.records.length===2&&paged.second.hasMore===false,'native SQL page one returns the final two source records and terminates');
 const pagedRecords=[...paged.first.records,...paged.second.records];
 check(pagedRecords.length===52&&new Set(pagedRecords.map(r=>r.key)).size===52&&extraSourceRows.every(row=>pagedRecords.some(r=>r.sourceRow===row))&&pagedRecords.some(r=>r.sourceRow===2),'native pagination preserves all fifty-one extra source rows plus original with no duplicates or losses');
 check(await state()===before,'rollback-only native pagination fixture leaves every canonical and source row unchanged');
 // Repeated display/read requests cannot mutate business or provenance state.
 check(JSON.stringify(await history(pending[0].customerId))===JSON.stringify(whole),'repeat history read returns byte-identical stable data');
 check(await state()===before,'all reads preserve canonical business source archive and audit rows byte-for-byte');
 for(const [label,sql,pattern] of [
  ['cross-customer Interest',`SELECT public.crm_v2_customer_history('${pending[0].customerId}','${pending[1].interestId}',NULL,0);`,/CRM_CUSTOMER_HISTORY_SCOPE_INVALID/],
  ['cross-customer Sale',`SELECT public.crm_v2_customer_history('${pending[0].customerId}',NULL,'${pending[1].saleId}',0);`,/CRM_CUSTOMER_HISTORY_SCOPE_INVALID/],
  ['negative page',`SELECT public.crm_v2_customer_history('${pending[0].customerId}',NULL,NULL,-1);`,/CRM_CUSTOMER_HISTORY_INVALID_INPUT/],
  ['missing Customer',`SELECT public.crm_v2_customer_history('${randomUUID()}',NULL,NULL,0);`,/CRM_CUSTOMER_HISTORY_NOT_FOUND/]
 ])await deny(label,request(sql),pattern);
 const empty=await history(pending[0].customerId,null,null,1);check(empty.records.length===0&&!empty.hasMore,'history page beyond last row is empty and stable');
 await deny('anonymous cannot call history RPC',request(`SELECT public.crm_v2_customer_history('${pending[0].customerId}');`,'','anon'),/permission denied/);
 await deny('missing authenticated actor fails closed',request(`SELECT public.crm_v2_customer_history('${pending[0].customerId}');`,''),/CRM_CUSTOMER_HISTORY_FORBIDDEN/);
 await deny('private all-customer history helper has no browser grant',request('SELECT sales_history_read_private.records();'),/permission denied/);
 await deny('private preserved original Excel helper has no browser grant',request("SELECT sales_history_read_private.original_excel('SYNTHETIC HISTORICAL DEALS');"),/permission denied/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${actor}';`);
 await deny('inactive actor cannot read scoped history',request(`SELECT public.crm_v2_customer_history('${pending[0].customerId}');`),/CRM_CUSTOMER_HISTORY_FORBIDDEN/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${actor}';`);
 await deny('disabled capabilities refuse history reads',request(`UPDATE public.crm_settings SET booking_enabled=false WHERE id; SET LOCAL ROLE authenticated; SELECT public.crm_v2_customer_history('${pending[0].customerId}');`,actor,'',false),/CRM_CUSTOMER_HISTORY_SETUP_REQUIRED/);
 const sourceBatch=await query('SELECT id FROM crm_external_private.snapshot_batches;');
 await deny('mismatched snapshot and release cannot silently erase scoped evidence',request(`UPDATE crm_external_private.snapshot_batches SET plan_digest='SYNTHETIC UNREVIEWED PLAN' WHERE id='${sourceBatch}'; SET LOCAL ROLE authenticated; SELECT public.crm_v2_customer_history('${pending[0].customerId}');`,actor,'',false),/CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED/);
 await deny('missing original source row cannot silently erase selected Sale evidence',request(`DELETE FROM crm_external_private.source_records WHERE source_row=926; SET LOCAL ROLE authenticated; SELECT public.crm_v2_customer_history('${pending[0].customerId}',NULL,'${pending[0].saleId}',0);`,actor,'',false),/CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED/);
 await deny('upstream invalid original source day is not concealed by wrapper',request(`UPDATE crm_external_private.source_records SET payload=jsonb_set(payload,'{reviewedHistory,visitHistoryDate}','"2026-02-30"') WHERE source_row=2; SET LOCAL ROLE authenticated; SELECT public.crm_v2_excel_evidence('SYNTHETIC HISTORICAL DEALS');`,actor,'',false),/CRM_EXCEL_EVIDENCE_DATE_INVALID/);
 await deny('removed release refuses both projections',request(`DELETE FROM crm_external_private.booking_writer_releases WHERE batch_id='${sourceBatch}'; SET LOCAL ROLE authenticated; SELECT public.crm_v2_excel_evidence('SYNTHETIC HISTORICAL DEALS');`,actor,'',false),/CRM_EXCEL_EVIDENCE_SETUP_REQUIRED/);
 check(await state()===before,'negative role capability and upstream integrity trials roll back all changed fixture state');
 return {cases,assertions:cases.length,actualPublicExcelRpc:true,actualHistoricalProjection:true,syntheticOnly:true,realDatabaseWrites:false,fullExternalInstallationTested:false,operationalAuthCertified:false};
}
