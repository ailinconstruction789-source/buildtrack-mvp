// Cross-adapter transaction tests in the existing owned loopback DB. Synthetic declarations only.
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const q=v=>`'${String(v).replaceAll("'","''")}'`, j=v=>`${q(JSON.stringify(v))}::jsonb`,pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function runImportAdapterAtomicity({query,root,report}){
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const path='scripts/sales-runtime/import-adapter-atomicity.mjs';report.sources[path]=createHash('sha256').update(readFileSync(join(root,path))).digest('hex');
 const cases=[],check=(v,label)=>{assert.ok(v,label);cases.push(label);},deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const actor=randomUUID();await query(`INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO sales_private.crm_user_roles(user_id,role,is_active) VALUES('${actor}','admin',true);`);
 const capture=async()=>JSON.parse(await query(`SELECT jsonb_build_object('binding',jsonb_build_object('customerId',c.id,'interestId',i.id,'saleId',s.id,'customerOwnerId',c.owner_user_id,'interestOwnerId',i.owner_user_id,'customerRevision',c.lifecycle_revision,'interestRevision',i.lifecycle_revision),
  'before',jsonb_build_object('sale',to_jsonb(s),'details',(SELECT to_jsonb(d) FROM sales_private.deal_details_corrections d WHERE sale_id=s.id),'forecast',(SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=s.id)))
  FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id WHERE s.external_booking_id IS NOT NULL AND s.crm_stage='contracted' ORDER BY s.id LIMIT 1;`));
 const detail={version:'reviewed-import-details-v1',datasetKey:'SYNTHETIC-CROSS-ADAPTER',sourceSha256:'a'.repeat(64),reviewSha256:'b'.repeat(64),businessStageWritesAllowed:false,leadReplayAllowed:false,
  records:[{sourceRow:706,sourceKey:'c'.repeat(64),rowSha256:'d'.repeat(64),...await capture(),patch:{salePriceSatang:600000000,expectedTransferDate:'2026-11-01',sourceStage:'contracted'}}]};
 const archive={version:'unknown-historical-evidence-v1',sourceSystem:'SYNTHETIC CROSS ADAPTER',datasetKey:'SYNTHETIC-ATOMIC',snapshotSha256:'a'.repeat(64),mappingReviewRef:'SYNTHETIC independently reviewed UUID',businessWritesAllowed:false,leadRequired:false,
  records:[{sourceKey:'e'.repeat(64),rowNumber:237,rowSha256:'f'.repeat(64),customerKey:'SYNTHETIC customer key',customerId:detail.records[0].binding.customerId,interestId:null,saleId:null,reason:'unknown_project',sourceStage:'visited',
   events:[{eventKey:'SYNTHETIC visit',kind:'visited',sequence:1,date:null,precision:'unknown',evidenceRef:'SYNTHETIC unknown visit day'}]}]};
 const detailSql=p=>`SELECT sales_import_private.apply_reviewed_details(${j(p)});`,archiveSql=p=>`SELECT sales_unknown_history_private.persist_evidence(${j(p)});`;
 const session=sql=>`BEGIN;SET LOCAL "request.jwt.claim.sub"='${actor}';${sql}COMMIT;`;
 const tables=[['sales_import_private','detail_batches'],['sales_import_private','detail_events'],['sales_import_private','forecast_corrections'],['sales_import_private','forecast_permits'],
  ['sales_private','deal_details_corrections'],['sales_private','customer_deal_details_permits'],['sales_unknown_history_private','batches'],['sales_unknown_history_private','records'],['sales_unknown_history_private','events'],['sales_unknown_history_private','insert_permits']];
 const state=()=>query(`SELECT md5(jsonb_build_object(${tables.flatMap(([s,t])=>[q(s+'.'+t),`(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${s}.${t} r)`]).join(',')})::text);`);
 const before=await state();
 const badArchive=structuredClone(archive);badArchive.records[0].customerId=randomUUID();
 await deny('late unknown history failure rolls back prior canonical details correction',session(detailSql(detail)+archiveSql(badArchive)),/UNKNOWN_HISTORY_MAPPING_CONFLICT/);
 check(await state()===before,'cross-adapter rollback retains old effective price forecast and both evidence receipts');
 const badDetail=structuredClone(detail);badDetail.records[0].patch.expectedTransferDate='2026-02-30';
 await deny('late price/forecast failure rolls back prior unknown history archive',session(archiveSql(archive)+detailSql(badDetail)),/IMPORT_DETAILS_INVALID/);
 check(await state()===before,'reverse-order rollback leaves no unknown-history batch');
 const saved=(await query(session(detailSql(detail)+archiveSql(archive)))).split(/\r?\n/).map(JSON.parse);
 check(saved.length===2&&saved.every(r=>!r.replayed),'both adapters commit in one explicit transaction');
 const committed=await state();
 const replay=(await query(session(detailSql(detail)+archiveSql(archive)))).split(/\r?\n/).map(JSON.parse);
 check(replay.every(r=>r.replayed)&&await state()===committed,'whole-bundle retry preserves one copy of both receipts');
 const changed=structuredClone(archive);changed.records[0].events[0].evidenceRef='SYNTHETIC changed evidence';
 await deny('changed evidence conflicts with whole-bundle retry',session(detailSql(detail)+archiveSql(changed)),/UNKNOWN_HISTORY_RECONCILIATION_REQUIRED/);
 check(await state()===committed,'failed changed replay preserves both committed adapters');
 const app='SYNTHETIC-import-rights-'+randomUUID();
 const blocker=query(`BEGIN;UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${actor}';SELECT pg_sleep(1.5);COMMIT;`);
 for(let n=0;n<40;n++){if(await query("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(1.5)%' AND pid<>pg_backend_pid() AND wait_event='PgSleep';")!=='0')break;await pause(25);}
 const waiting=query(session(`SET LOCAL application_name=${q(app)};${detailSql(detail)}`)).then(value=>({value}),error=>({error}));let observed=false;
 for(let n=0;n<40;n++){if(await query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${q(app)} AND wait_event_type='Lock';`)==='1'){observed=true;break;}await pause(25);}
 await blocker;const result=await waiting;
 check(observed&&result.error&&/IMPORT_DETAILS_FORBIDDEN/.test(result.error.message),'actual import-details retry waits and rejects Admin revocation');
 check(await state()===committed,'revocation produces no partial correction or receipt');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${actor}';GRANT USAGE ON SCHEMA sales_import_private TO authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA sales_import_private TO authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sales_import_private TO authenticated;`);
 await deny('broad browser grants cannot invoke importer',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"='${actor}';${detailSql(detail)}COMMIT;`,/IMPORT_DETAILS_FORBIDDEN|permission denied/);
 await deny('broad browser grants cannot mint forecast permit',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"='${actor}';INSERT INTO sales_import_private.forecast_permits VALUES(txid_current(),pg_backend_pid(),'${actor}','${detail.records[0].binding.saleId}',NULL,'{}');COMMIT;`,/IMPORT_DETAILS_FORBIDDEN|row-level security/);
 await deny('forecast permit table cannot be truncated',`BEGIN;SET LOCAL ROLE authenticated;TRUNCATE sales_import_private.forecast_permits;COMMIT;`,/IMPORT_DETAILS_SEALED/);
 await query('REVOKE ALL ON SCHEMA sales_import_private FROM PUBLIC,anon,authenticated;REVOKE ALL ON ALL TABLES IN SCHEMA sales_import_private FROM PUBLIC,anon,authenticated;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_import_private FROM PUBLIC,anon,authenticated;');
 check(await state()===committed,'broad-grant attacks leave both sealed adapters unchanged');
 return {cases,assertions:cases.length,syntheticOnly:true,atomicAcrossBothAdapters:true,realDatabaseWrites:false};
}
