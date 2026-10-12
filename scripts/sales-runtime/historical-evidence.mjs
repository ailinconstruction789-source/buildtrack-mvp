// Owned random loopback PostgreSQL only; no application env, live import or feature activation.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { syntheticDraftBody } from './safety.mjs';
const q = text => `'${String(text).replaceAll("'", "''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const admin='ed240000-0000-4000-8000-000000000001', sales='ed240000-0000-4000-8000-000000000002';
const owner='ed240000-0000-4000-8000-000000000003', inactive='ed240000-0000-4000-8000-000000000004';
const project='SYNTHETIC HISTORY LEDGER';
const session=(sql,actor=admin,role=false,app='')=>`BEGIN; ${role ? 'SET LOCAL ROLE authenticated;' : ''}
 SET LOCAL "request.jwt.claim.sub"=${q(actor)}; ${app ? `SET LOCAL application_name=${q(app)};` : ''} ${sql} COMMIT;`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runHistoricalEvidence({query,root,report,prepare}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[], check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const files=['sql/sales/22_customer_deal_details_draft.sql','sql/sales/23_rental_lifecycle_draft.sql','sql/sales/24_historical_evidence_ledger_draft.sql'];
 for(const path of files) {
  const source=readFileSync(join(root,path),'utf8'); report.sources[path]=createHash('sha256').update(source).digest('hex');
  await query(syntheticDraftBody(path,source));
 }
 for(const path of ['scripts/sales-runtime/historical-evidence.mjs','lib/sales/historicalTimelineLedger.ts','lib/sales/historicalTimelineImport.ts'])
  report.sources[path]=createHash('sha256').update(readFileSync(join(root,path))).digest('hex');
 await query(`INSERT INTO auth.users(id) VALUES('${admin}'),('${sales}'),('${owner}'),('${inactive}');
 INSERT INTO sales_private.crm_user_roles(user_id,role,is_active) VALUES('${admin}','admin',true),('${sales}','sales',true),('${owner}','owner',true),('${inactive}','admin',false);
 INSERT INTO public.projects(name,is_closed) VALUES(${q(project)},false);
 INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-HISTORY-1',${q(project)},false,'available'),('SYNTHETIC-HISTORY-2',${q(project)},false,'available');
 INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed,post_booking_enabled,rental_enabled)
 VALUES(true,true,true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=true,rental_enabled=true;`);
 const book=async n=>JSON.parse(await query(session(`SELECT public.crm_v2_booking_command('${randomUUID()}',${j({command:'book',reason:'SYNTHETIC history target',customerId:null,
  newCustomer:{name:`SYNTHETIC HISTORY ${n}`,phone:`089240000${n}`,channel:'phone',notes:'SYNTHETIC ONLY',assignedSalesUserId:null},
  projectName:project,expectedInterestRevision:null,plotId:`SYNTHETIC-HISTORY-${n}`,paymentMethod:'cash',bookingRoute:'without_visit',visitId:null,
  listPriceSatang:100000000,discountSatang:0,depositSatang:0,previousSaleId:null})});`,sales,true)));
 const first=await book(1),second=await book(2);
 const rentalTargets=[];
 for(const [index,programType] of ['program_a','program_b','program_c'].entries()) {
  const plotId=`SYNTHETIC-HISTORY-RENT-${index}`;
  await query(`INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES(${q(plotId)},${q(project)},false,'available');`);
  const customer=JSON.parse(await query(session(`SELECT public.crm_v2_create_customer('${randomUUID()}',${j({name:`SYNTHETIC HISTORY RENTAL ${index}`,phone:`090240000${index}`,channel:'phone',notes:'SYNTHETIC ONLY',interests:[{projectName:project,plotId:null}]})});`,sales,true)));
  const snapshot=JSON.parse(await query(session(`SELECT public.crm_v2_rental_context('${customer.customerId}',${q(project)});`,sales,true)));
  const payload={command:'start',customerId:snapshot.customer.id,interestId:snapshot.interest.id,projectName:project,
   expectedCustomerRevision:snapshot.customer.revision,expectedInterestRevision:snapshot.interest.revision,
   contractId:null,expectedContractRevision:null,reason:'SYNTHETIC HISTORY TARGET',plotId,programType,
   startDate:'2024-03-01',durationMonths:12,monthlyRentSatang:1200000,securityDepositSatang:2400000,advanceRentSatang:1200000,
   savingsPerMonthSatang:programType==='program_b'?500000:0,basePriceSatang:programType==='program_c'?200000000:null};
  const rental=JSON.parse(await query(session(`SELECT public.crm_v2_rental_command('${randomUUID()}',${j(payload)});`,sales,true)));
  rentalTargets.push({customerId:snapshot.customer.id,interestId:snapshot.interest.id,rentalId:rental.contractId,type:['A','B','C'][index]});
 }
 function input(target=first,datasetKey='synthetic-archive-1',recordKey='synthetic-record-1') {
  const rowSha256='a'.repeat(64), customerKey=`source-${target.customerId}`, dealKey=`deal-${target.saleId}`;
  return {manifest:{version:'historical-timeline-manifest-v1',sourceSystem:'SYNTHETIC-OFFICE',datasetKey,snapshotSha256:'b'.repeat(64),mappingReviewRef:'SYNTHETIC declared review',records:[{recordKey,rowNumber:2,rowSha256}]},
   records:[{recordKey,rowNumber:2,rowSha256,customerKey,dealKey,kind:'purchase',stage:'booked',rentalType:null,events:[
    {eventKey:'visit-1',kind:'visited',sequence:1,date:'2024-02-29',precision:'day',evidenceRef:'SYNTHETIC visit'},
    {eventKey:'booking-1',kind:'booked',sequence:2,date:null,precision:'unknown',evidenceRef:'SYNTHETIC booking day not recorded'}]}],
   bindings:[{recordKey,rowSha256,customerKey,dealKey,customerId:target.customerId,interestId:target.interestId,saleId:target.saleId,rentalId:null,evidenceRef:'SYNTHETIC UUID review'}]};
 }
 const candidate=prepare(input()), persist=value=>`SELECT sales_history_private.persist_evidence(${j(value)});`;
 const business=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
  'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
  'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
  'visits',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.lead_visits v),'rentals',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.rental_contracts r),
  'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.crm_audit_events a));`);
 const before=await business();
 for(const actor of [sales,owner,inactive]) await deny(`trusted ${actor===sales?'Sales':actor===owner?'Owner':'inactive Admin'} cannot import`,session(persist(candidate),actor),/HISTORICAL_LEDGER_FORBIDDEN/);
 await deny('missing identity cannot import',session(persist(candidate),''),/HISTORICAL_LEDGER_FORBIDDEN/);
 await deny('even browser Admin cannot call private importer',session(persist(candidate),admin,true),/permission denied/);
 for(const table of ['batches','records','events']) for(const role of ['anon','authenticated'])
  await deny(`${role} cannot directly read ${table}`,`BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM sales_history_private.${table}; COMMIT;`,/permission denied/);
 for(const [label,mutate] of [
  ['unknown input property',p=>{p.extra=true;}],['fake write permission',p=>{p.businessWritesAllowed=true;}],
  ['wrong customer identity',p=>{p.records[0].binding.customerId=second.customerId;}],
  ['wrong sale identity',p=>{p.records[0].binding.saleId=second.saleId;}],
  ['unmatched row hash',p=>{p.records[0].binding.rowSha256='c'.repeat(64);}],
  ['number used as UUID',p=>{p.records[0].binding.customerId=1;}],
  ['unknown date marked precise',p=>{p.records[0].source.events[1].precision='day';}],
  ['invalid date rollover',p=>{p.records[0].source.events[0].date='2024-02-30';}],
  ['duplicate event key',p=>{p.records[0].source.events[1].eventKey='visit-1';}],
  ['reversed sequence',p=>{p.records[0].source.events.reverse();}],
  ['transfer from booked source stage',p=>{p.records[0].source.events[1].kind='transferred';}],
 ]) {
  const changed=structuredClone(candidate); mutate(changed);
  await deny(label,session(persist(changed)),/HISTORICAL_LEDGER_|date|out of range|invalid input|duplicate key/);
  check(await query('SELECT count(*) FROM sales_history_private.batches;')==='0',`${label} rolls back the entire batch`);
 }
 const saved=JSON.parse(await query(session(persist(candidate))));
 check(!saved.replayed&&saved.records===1&&saved.events===2&&!saved.businessChanged,'first commit stores all evidence atomically');
 const events=JSON.parse(await query(`SELECT jsonb_agg(jsonb_build_object('kind',kind,'date',occurred_date,'precision',precision) ORDER BY sequence) FROM sales_history_private.events;`));
 check(events[0].date==='2024-02-29'&&events[1].date===null&&events[1].precision==='unknown','unknown day remains null, never recorded_at');
 const retry=JSON.parse(await query(session(persist(prepare(input())))));
 check(retry.replayed&&retry.batchId===saved.batchId,'exact retry returns committed batch');
 check(await query('SELECT count(*) FROM sales_history_private.events;')==='2','retry creates no duplicate history');
 for(const [index,target] of rentalTargets.entries()) {
  const raw=input({...target,saleId:null},`rental-${index}`,`rental-record-${index}`),row=raw.records[0],link=raw.bindings[0];
  row.kind='rental';row.stage='rental_active';row.rentalType=target.type;row.dealKey=`source-rental-${target.rentalId}`;
  row.events=[{eventKey:'start-1',kind:'rental_started',sequence:1,date:'2024-03-01',precision:'day',evidenceRef:'SYNTHETIC rental day'},
   {eventKey:'renew-1',kind:'rental_renewed',sequence:2,date:null,precision:'unknown',evidenceRef:'SYNTHETIC renewal unknown day'}];
  link.dealKey=row.dealKey;link.saleId=null;link.rentalId=target.rentalId;
  const value=prepare(raw),wrong=structuredClone(value);wrong.records[0].source.rentalType=target.type==='A'?'B':'A';
  await deny(`rental ${target.type} requires matching existing program`,session(persist(wrong)),/HISTORICAL_LEDGER_MAPPING_CONFLICT/);
  const receipt=JSON.parse(await query(session(persist(value))));
  check(receipt.records===1&&receipt.events===2&&!receipt.businessChanged,`rental ${target.type} persists evidence against exact Customer/Interest/Contract`);
  check(await query(`SELECT occurred_date IS NULL AND precision='unknown' FROM sales_history_private.events WHERE batch_id='${receipt.batchId}' AND event_key='renew-1';`)==='t',`rental ${target.type} preserves unknown renewal day`);
 }
 const changed=structuredClone(candidate);changed.records[0].source.events[0].evidenceRef='SYNTHETIC changed source';
 await deny('changed evidence cannot overwrite pinned source dataset',session(persist(changed)),/HISTORICAL_LEDGER_RECONCILIATION_REQUIRED/);
 const repeated=prepare(input(first,'different-dataset'));
 await deny('renaming dataset cannot duplicate a source record',session(persist(repeated)),/duplicate key/);
 const remapped=prepare(input(second,'other-dataset','other-record'));remapped.records[0].source.customerKey=candidate.records[0].source.customerKey;
 remapped.records[0].binding.customerKey=remapped.records[0].source.customerKey;
 await deny('source customer cannot silently map to a different existing UUID',session(persist(remapped)),/HISTORICAL_LEDGER_MAPPING_CONFLICT/);
 for(const table of ['batches','records','events']) for(const action of [`UPDATE sales_history_private.${table} SET ${table==='batches'?'mapping_review_ref=mapping_review_ref':table==='records'?'record_key=record_key':'event_key=event_key'}`,
   `DELETE FROM sales_history_private.${table}`,`TRUNCATE sales_history_private.${table} CASCADE`])
  await deny(`sealed ${table} rejects ${action.split(' ')[0]}`,action+';',/HISTORICAL_LEDGER_APPEND_ONLY/);
 check(await business()===before,'business entities, source Lead IDs, dates, statuses, visits and audit remain unchanged');
 const concurrent=prepare(input(second,'concurrent-archive','concurrent-record'));
 const results=await Promise.all([query(session(persist(concurrent))),query(session(persist(concurrent)))]);
 check(results.map(JSON.parse).filter(row=>row.replayed).length===1,'simultaneous identical imports commit exactly once');
 check(await query(`SELECT count(*) FROM sales_history_private.records WHERE sale_id='${second.saleId}';`)==='1','concurrent source membership has one durable record');
 // Different dataset names must not bypass the source-customer identity lock.
 const raceInputs=[first,second].map((target,index)=>{
  const raw=input(target,`identity-race-${index}`,`identity-race-row-${index}`);
  raw.manifest.sourceSystem='SYNTHETIC IDENTITY RACE';
  raw.records[0].customerKey='one-source-customer';raw.bindings[0].customerKey='one-source-customer';
  raw.records[0].kind='visit';raw.records[0].stage='visited';raw.records[0].dealKey=null;
  raw.bindings[0].saleId=null;raw.bindings[0].dealKey=null;raw.records[0].events[1].kind='visited';
  return prepare(raw);
 });
 const race=await Promise.allSettled(raceInputs.map(value=>query(session(persist(value)))));
 check(race.filter(row=>row.status==='fulfilled').length===1,'conflicting concurrent datasets accept exactly one source identity');
 check(race.some(row=>row.status==='rejected'&&/HISTORICAL_LEDGER_MAPPING_CONFLICT/.test(row.reason.message)),
  'conflicting concurrent dataset is held for explicit identity reconciliation');
 check(await query("SELECT count(DISTINCT customer_id) FROM sales_history_private.records WHERE source_system='SYNTHETIC IDENTITY RACE';")==='1',
  'one source identity cannot acquire two canonical customers across concurrent batches');
 // Force a database failure at the final event: receipt/record/earlier events must all roll back.
 await query(`CREATE FUNCTION sales_history_private.synthetic_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.evidence_ref='SYNTHETIC FORCE FAILURE' THEN RAISE EXCEPTION 'SYNTHETIC_HISTORY_FAILURE'; END IF; RETURN NEW; END; $$;
 REVOKE ALL ON FUNCTION sales_history_private.synthetic_failure() FROM PUBLIC,anon,authenticated;
 CREATE TRIGGER synthetic_failure BEFORE INSERT ON sales_history_private.events FOR EACH ROW EXECUTE FUNCTION sales_history_private.synthetic_failure();`);
 const failInput=input(first,'failure-archive','failure-record'); failInput.records[0].kind='visit';failInput.records[0].stage='visited';failInput.records[0].dealKey=null;
 failInput.bindings[0].saleId=null;failInput.bindings[0].dealKey=null;failInput.records[0].events[1].kind='visited';failInput.records[0].events[1].evidenceRef='SYNTHETIC FORCE FAILURE';
 await deny('last event failure rolls back all evidence',session(persist(prepare(failInput))),/SYNTHETIC_HISTORY_FAILURE/);
 check(await query("SELECT count(*) FROM sales_history_private.batches WHERE dataset_key='failure-archive';")==='0','failed batch has no durable receipt');
 check(await query("SELECT count(*) FROM sales_history_private.records WHERE record_key='failure-record';")==='0','failed batch has no partial source row');
 const visit=prepare(input(first,'visit-only','visit-record'));visit.records[0].source.kind='visit';visit.records[0].source.stage='visited';visit.records[0].source.dealKey=null;
 visit.records[0].binding.dealKey=null;visit.records[0].binding.saleId=null;visit.records[0].source.events[1].kind='visited';
 const visitReceipt=JSON.parse(await query(session(persist(visit))));
 check(visitReceipt.events===2&&!visitReceipt.businessChanged,'repeat visits persist as evidence without synthetic appointments or visit-completion actions');
 check(await query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sales_history_private' AND c.relkind='r' AND c.relrowsecurity;")==='3','all private evidence tables have RLS enabled');
 check(await query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sales_history_private' AND p.prosecdef;")==='0','all evidence functions use SECURITY INVOKER');
 // Observed lock wait: rights are checked under a shared staff-row lock before any source writes.
 const app='SYNTHETIC-history-rights-'+randomUUID();
 const blocker=query(`BEGIN; UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${admin}'; SELECT pg_sleep(1.5); COMMIT;`);
 let waiting;
 for(let n=0;n<30;n++){if(await query(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(1.5)%' AND pid<>pg_backend_pid() AND wait_event='PgSleep';`)!=='0')break;await delay(30);}
 waiting=query(session(persist(candidate),admin,false,app)); const outcome=waiting.then(()=>null,error=>error);
 let observed=false;
 for(let n=0;n<30;n++){if(await query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${q(app)} AND wait_event_type='Lock';`)==='1'){observed=true;break;}await delay(30);}
 await blocker;check(observed,'Admin revocation was observed while import waited on staff lock');
 const error=await outcome;check(error&&/HISTORICAL_LEDGER_FORBIDDEN/.test(error.message),'revoked Admin cannot replay or commit after waiting');
 check(await business()===before,'all import failure/retry/concurrency checks preserve business data');
 return {assertions:cases.length,cases,syntheticOnly:true,durableEvidenceOnly:true,businessChanged:false,concurrencyGroups:3};
}
