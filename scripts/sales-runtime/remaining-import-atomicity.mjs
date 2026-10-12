// Whole-transaction composition of new adapters; synthetic inputs only, owned runner.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const hash=v=>createHash('sha256').update(v).digest('hex');
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
export async function runRemainingImportAtomicity({query,root,report}){
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 report.sources['scripts/sales-runtime/remaining-import-atomicity.mjs']=hash(readFileSync(join(root,'scripts/sales-runtime/remaining-import-atomicity.mjs')));
 const fixture=report.syntheticHistoricalRevisionFixture;
 assert(fixture?.adminId&&fixture?.payload,'synthetic fresh revision fixture required');
 const creation=JSON.parse(await query('SELECT payload FROM sales_source_creation_private.batches ORDER BY recorded_at LIMIT 1;'));
 creation.datasetKey='SYNTHETIC-ATOMIC-REMAINING-CREATION';
 for(const r of creation.records){
  r.sourceKey=hash(`SYNTHETIC atomic source ${r.sourceRow}`);
  r.customerCandidateKey=hash(`SYNTHETIC atomic customer ${r.sourceRow}`);
  r.interestCandidateKey=hash(`SYNTHETIC atomic interest ${r.sourceRow}`);
 }
 const lifecycle=structuredClone(fixture.payload);
 lifecycle.datasetKey='SYNTHETIC-ATOMIC-REMAINING-LIFECYCLE';
 // SQL27 adds nullable provenance columns. Capture complete rows AFTER all
 // adapters install; never carry a now-incomplete before-image across DDL.
 for(const r of lifecycle.records){
  const b=r.binding,saleSql=b.saleId===null?'NULL::uuid':`${q(b.saleId)}::uuid`;
  r.before=JSON.parse(await query(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=${q(b.customerId)}::uuid),
   'interest',(SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=${q(b.interestId)}::uuid),
   'sale',(SELECT to_jsonb(s) FROM public.sales s WHERE id=${saleSql}),'plot',(SELECT to_jsonb(p) FROM public.plots p WHERE id=${q(b.plotId)}),
   'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.sales s WHERE plot_id=${q(b.plotId)}),
   'details',(SELECT to_jsonb(d) FROM sales_private.deal_details_corrections d WHERE sale_id=${saleSql}),
   'forecast',(SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=${saleSql}));`));
 }
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const applyCreation=p=>`SELECT sales_source_creation_private.apply_reviewed(${j(p)});`;
 const applyLifecycle=p=>`SELECT sales_revision_private.apply(${j(p)});`;
 const transaction=sql=>`BEGIN; SET LOCAL "request.jwt.claim.sub"=${q(fixture.adminId)}; ${sql} COMMIT;`;
 const state=()=>query(`SELECT jsonb_build_object(
  'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
  'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),
  'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
  'creationBatches',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_source_creation_private.batches x),
  'creationRecords',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_source_creation_private.records x),
  'creationEvents',(SELECT jsonb_agg(to_jsonb(x) ORDER BY record_id,event_key) FROM sales_source_creation_private.events x),
  'revisionBatches',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_revision_private.batches x),
  'revisionEvents',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_revision_private.events x),
  'permits',(SELECT count(*) FROM sales_source_creation_private.permits)+(SELECT count(*) FROM sales_revision_private.permits)+(SELECT count(*) FROM sales_private.booking_write_permits));`);
 const before=await state(),badLifecycle=structuredClone(lifecycle),badCreation=structuredClone(creation);
 badLifecycle.records.at(-1).before.plot.has_customer=true;
 await assert.rejects(query(transaction(applyCreation(creation)+applyLifecycle(badLifecycle))),/HISTORICAL_REVISION_STALE/);
 cases.push('late historical stale-state error rejects combined transaction');
 check(await state()===before,'late lifecycle error rolls back all six new Customers Interests events and permits');
 badCreation.records.at(-1).projectName='SYNTHETIC ATOMIC MISSING PROJECT';
 await assert.rejects(query(transaction(applyLifecycle(lifecycle)+applyCreation(badCreation))),/SOURCE_CREATION_PROJECT_CHANGED/);
 cases.push('late creation error rejects reversed combined transaction');
 check(await state()===before,'late creation error rolls back new Sale stock booking history and provenance');
 const output=await query(transaction(applyCreation(creation)+applyLifecycle(lifecycle)));
 check(output.split(/\r?\n/).filter(x=>x.startsWith('{')).length===2,'one transaction commits both guarded adapters');
 const committed=await state(),replay=await query(transaction(applyCreation(creation)+applyLifecycle(lifecycle)));
 check(replay.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse).every(x=>x.replayed),'combined replay reuses original immutable bindings');
 check(await state()===committed,'combined replay leaves all records byte-for-byte unchanged');
 check(await query('SELECT (SELECT count(*) FROM sales_source_creation_private.permits)+(SELECT count(*) FROM sales_revision_private.permits)+(SELECT count(*) FROM sales_private.booking_write_permits);')==='0','no reusable permit remains after combined success or failure');
 return {cases,assertions:cases.length,syntheticOnly:true,realDatabaseWrites:false,wholeTransactionAcrossBothNewAdapters:true};
}
