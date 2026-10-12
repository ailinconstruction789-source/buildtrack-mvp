// Actual canonical guards/readers over synthetic prerequisites, owned loopback only.
// No real customer writes, Supabase Auth certification, or full cutover installation.
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { syntheticDraftBody } from './safety.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`, j=v=>`${q(JSON.stringify(v))}::jsonb`;
const admin='ca260000-0000-4000-8000-000000000001',sales='ca260000-0000-4000-8000-000000000002';
const inactive='ca260000-0000-4000-8000-000000000003';
const session=(sql,actor=admin,role='')=>`BEGIN; ${role?`SET LOCAL ROLE ${role};`:''} SET LOCAL "request.jwt.claim.sub"=${q(actor)}; ${sql} COMMIT;`;
export async function runCanonicalImportAdapter({query,root,report}){
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const read=p=>{const s=readFileSync(join(root,p),'utf8');report.sources[p]=createHash('sha256').update(s).digest('hex');return s;};
 read('scripts/sales-runtime/canonical-import-adapter.mjs');
 await query(syntheticDraftBody('sql/sales/22_customer_deal_details_draft.sql',read('sql/sales/22_customer_deal_details_draft.sql')));
 // Compile the original Excel projection and its exact adapter. Full upstream source fixture is NOT supplied here.
 const excel='sql/sales/excel_report_evidence_draft.sql';
 await query(syntheticDraftBody(excel,read(excel)));
 const definition=await query("SELECT pg_get_functiondef('crm_excel_private.evidence(text)'::regprocedure);");
 const path='sql/sales/26_reviewed_import_details_draft.sql',source=read(path);
 await query(definition.replace('DECLARE','-- SYNTHETIC unreviewed reader\nDECLARE'));
 await deny('unknown Excel reader refuses installation atomically',syntheticDraftBody(path,source),/IMPORT_DETAILS_READER_REVIEW_REQUIRED/);
 check(await query("SELECT to_regnamespace('sales_import_private') IS NULL;")==='t','failed reader review retains no importer schema');
 await query(definition);
 await query(syntheticDraftBody(path,source));
 check(await query("SELECT strpos(prosrc,'sales_import_private.expected_transfer_date(sale.id,')>0 FROM pg_proc WHERE oid='crm_excel_private.evidence(text)'::regprocedure;")==='t','actual Excel reader compiles with exact forecast getter adapter');
 await query(`INSERT INTO auth.users(id) VALUES('${admin}'),('${sales}'),('${inactive}');
  INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES('${admin}','admin','SYNTHETIC IMPORT ADMIN',true),('${sales}','sales','SYNTHETIC IMPORT SALES',true),('${inactive}','admin','SYNTHETIC INACTIVE IMPORT ADMIN',false);`);
 const target=JSON.parse(await query("SELECT jsonb_build_object('saleId',s.id) FROM public.sales s WHERE s.external_booking_id IS NOT NULL AND s.crm_stage='contracted' ORDER BY id LIMIT 1;"));
 assert.ok(target.saleId,'actual sealed imported target required');
 const capture=async()=>JSON.parse(await query(`SELECT jsonb_build_object('binding',jsonb_build_object('customerId',c.id,'interestId',i.id,'saleId',s.id,
  'customerOwnerId',c.owner_user_id,'interestOwnerId',i.owner_user_id,'customerRevision',c.lifecycle_revision,'interestRevision',i.lifecycle_revision),
  'before',jsonb_build_object('sale',to_jsonb(s),'details',(SELECT to_jsonb(d) FROM sales_private.deal_details_corrections d WHERE sale_id=s.id),
  'forecast',(SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=s.id)))
  FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id WHERE s.id=${q(target.saleId)}::uuid;`));
 const candidate=async(dataset='SYNTHETIC-DETAILS-1')=>({version:'reviewed-import-details-v1',datasetKey:dataset,sourceSha256:'a'.repeat(64),reviewSha256:'b'.repeat(64),
  businessStageWritesAllowed:false,leadReplayAllowed:false,records:[{sourceRow:706,sourceKey:'c'.repeat(64),rowSha256:'d'.repeat(64),...await capture(),
   patch:{salePriceSatang:522800000,expectedTransferDate:'2026-10-30',sourceStage:'contracted'}}]});
 const apply=p=>`SELECT sales_import_private.apply_reviewed_details(${j(p)});`;
 const state=()=>query(`SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM sales_import_private.detail_batches b),
  'details',(SELECT jsonb_agg(to_jsonb(d) ORDER BY sale_id) FROM sales_private.deal_details_corrections d),
  'forecasts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY sale_id) FROM sales_import_private.forecast_corrections f),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY batch_id,source_row) FROM sales_import_private.detail_events e),
  'permits',(SELECT count(*) FROM sales_private.customer_deal_details_permits)+(SELECT count(*) FROM sales_import_private.forecast_permits));`);
 const business=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
  'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
  'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
  'sources',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crm_external_private.prepared_booking_sales p),
  'cutover',(SELECT jsonb_agg(to_jsonb(r)) FROM crm_external_private.sales_cutover_receipts r));`);
 const guards=await query("SELECT md5(string_agg(prosrc,',' ORDER BY oid)) FROM pg_proc WHERE oid IN('crm_external_private.guard_cutover_sale()'::regprocedure,'sales_private.crm_customer_deal_details_guard()'::regprocedure);");
 const original=await business(),empty=await state(),p=await candidate();
 for(const [label,actor,role] of [['Sales',sales,''],['inactive Admin',inactive,''],['missing identity','',''],['browser Admin',admin,'authenticated']])
  await deny(`${label} cannot invoke private importer`,session(apply(p),actor,role),/IMPORT_DETAILS_FORBIDDEN|permission denied/);
 for(const table of ['detail_batches','detail_events','forecast_corrections','forecast_permits'])for(const role of ['anon','authenticated'])
  await deny(`${role} cannot read private ${table}`,session(`SELECT * FROM sales_import_private.${table};`,admin,role),/permission denied/);
 for(const [label,mutate,pattern] of [
  ['extra input',p=>{p.extra=true;},/IMPORT_DETAILS_INVALID/],
  ['NULL version',p=>{p.version=null;},/IMPORT_DETAILS_INVALID/],
  ['manufactured lifecycle permission',p=>{p.businessStageWritesAllowed=true;},/IMPORT_DETAILS_INVALID/],
  ['wrong Customer UUID',p=>{p.records[0].binding.customerId=randomUUID();},/IMPORT_DETAILS_STALE_BINDING/],
  ['changed source before image',p=>{p.records[0].before.sale.sale_price=1;},/IMPORT_DETAILS_STALE_BINDING/],
  ['stale Customer revision',p=>{p.records[0].binding.customerRevision=randomUUID();},/IMPORT_DETAILS_STALE_BINDING/],
  ['zero price',p=>{p.records[0].patch.salePriceSatang=0;},/IMPORT_DETAILS_INVALID/],
  ['fractional price',p=>{p.records[0].patch.salePriceSatang=1.5;},/IMPORT_DETAILS_INVALID/],
  ['invalid forecast after price correction',p=>{p.records[0].patch.expectedTransferDate='2026-02-30';},/IMPORT_DETAILS_INVALID/],
  ['timestamp passed as forecast',p=>{p.records[0].patch.expectedTransferDate='2026-10-30T00:00:00Z';},/IMPORT_DETAILS_INVALID/],
  ['booking status correction',p=>{p.records[0].patch.sourceStage='cancelled';},/IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED/],
  ['bank field cannot be guessed',p=>{p.records[0].patch.bankName='SYNTHETIC guessed bank';},/IMPORT_DETAILS_INVALID/],
  ['duplicate Sale target later in batch',p=>{p.records.push(structuredClone(p.records[0]));p.records[1].sourceRow=881;},/IMPORT_DETAILS_STALE_BINDING|duplicate key/]
 ]){const bad=structuredClone(p);mutate(bad);await deny(label,session(apply(bad)),pattern);check(await state()===empty,`${label} rolls back overlay batch events and permits`);}
 // Seed a canonical operational correction THROUGH the existing exact permit, keeping effective bank for import.
 const owner=p.records[0].binding.interestOwnerId;
 await query(session(`DO $$ DECLARE d sales_private.deal_details_corrections%ROWTYPE; BEGIN
  d.sale_id:=${q(target.saleId)}::uuid;d.sale_price:=2222222;d.bank_name:='SYNTHETIC EXISTING BANK';d.revision:=gen_random_uuid();d.actor_user_id:=auth.uid();d.reason:='SYNTHETIC operational before image';d.recorded_at:=clock_timestamp();
  INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),'deal',d.sale_id,NULL,to_jsonb(d));
  INSERT INTO sales_private.deal_details_corrections SELECT d.*;
  DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid(); END $$;`,owner));
 const withBank=await candidate(),priorBank=await state();
 await deny('stale overlay snapshot refuses overwriting newer operational edit',session(apply(p)),/IMPORT_DETAILS_STALE_BINDING/);
 check(await state()===priorBank,'stale overlay denial preserves newer effective bank and price');
 const result=JSON.parse(await query(session(apply(withBank))));
 const after=await state(),replay=JSON.parse(await query(session(apply(withBank))));
 check(result.records===1&&!result.replayed&&replay.replayed&&result.batchId===replay.batchId&&await state()===after,'exact replay creates one receipt and no duplicate correction');
 check(await query(`SELECT sales_private.crm_effective_sale_price(${q(target.saleId)}::uuid);`)==='5228000.00','actual canonical price getter reads reviewed correction');
 check(await query(`SELECT bank_name FROM sales_private.deal_details_corrections WHERE sale_id=${q(target.saleId)}::uuid;`)==='SYNTHETIC EXISTING BANK','unknown source bank preserves existing operational bank');
 check(await query(`SELECT sales_import_private.expected_transfer_date(${q(target.saleId)}::uuid,'2026-11-20');`)==='2026-10-30','per-sale column P forecast overrides older source day without timestamps');
 check(await query(`SELECT sales_import_private.expected_transfer_date('${randomUUID()}','2026-11-20');`)==='2026-11-20','no correction preserves original source forecast');
 const wrongReplay=structuredClone(withBank);wrongReplay.records[0].patch.salePriceSatang++;
 await deny('changed replay denied despite valid Customer binding',session(apply(wrongReplay)),/IMPORT_DETAILS_REPLAY_CONFLICT/);
 const preserve=await candidate('SYNTHETIC-NULL-PRESERVE');preserve.records[0].patch.salePriceSatang=null;preserve.records[0].patch.expectedTransferDate=null;
 await query(session(apply(preserve)));
 check(await query(`SELECT sales_private.crm_effective_sale_price(${q(target.saleId)}::uuid)::text||'/'||sales_import_private.expected_transfer_date(${q(target.saleId)}::uuid,NULL);`)==='5228000.00/2026-10-30','unknown price and forecast preserve effective values rather than clearing them');
 await deny('direct overlay update has no reusable import permit',session(`UPDATE sales_import_private.forecast_corrections SET expected_transfer_date='2026-10-31';`),/IMPORT_DETAILS_FORBIDDEN/);
 await deny('evidence receipt immutable',session('DELETE FROM sales_import_private.detail_events;'),/IMPORT_DETAILS_SEALED/);
 const disabled=await candidate('SYNTHETIC-DEACTIVATED');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id=${q(owner)}::uuid;`);
 await deny('deactivated owning Sales blocks import',session(apply(disabled)),/IMPORT_DETAILS_OWNER_CHANGED/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id=${q(owner)}::uuid;`);
 check(await business()===original,'source Customers Interests Sales plots Lead and immutable provenance unchanged');
 check(await query("SELECT md5(string_agg(prosrc,',' ORDER BY oid)) FROM pg_proc WHERE oid IN('crm_external_private.guard_cutover_sale()'::regprocedure,'sales_private.crm_customer_deal_details_guard()'::regprocedure);")===guards,'original canonical cutover and details guard bodies unchanged');
 check(await query("SELECT count(*) FROM sales_import_private.forecast_permits;")==='0'&&await query("SELECT count(*) FROM sales_private.customer_deal_details_permits;")==='0','success and failure leave no reusable permit');
 return {cases,assertions:cases.length,actualCanonicalGuardBodies:true,sourceRowsSynthetic:true,realDatabaseWrites:false,
  actualExcelAdapterCompiled:true,fullExcelEvidenceReadTested:false,fullExternalInstallationTested:false};
}
