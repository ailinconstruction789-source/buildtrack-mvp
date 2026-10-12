// Owned-loopback private relational rehearsal. NO production writer/auth certification.
import { createHash } from 'node:crypto';
import { readFileSync,statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { extractWorkbook,workspacePath } from '../sales-import/review-workbook.mjs';
import { prepareCustomerResolutionPlan,resolutionGroups } from '../sales-import/plan-customer-resolutions.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const json=v=>`${q(JSON.stringify(v))}::jsonb`;
const fixtureId=key=>key.slice(0,32).replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
export async function runCustomerResolutionTrial({query,root,report,planPath}){
  if(!/^reports\/customer-resolution-plan-[\w-]+\.json$/.test(planPath))throw new Error('PINNED_RESOLUTION_REPORT_REQUIRED');
  const path=workspacePath(planPath);
  if(statSync(path).size>12*1024*1024)throw new Error('RESOLUTION_PLAN_TOO_LARGE');
  const bytes=readFileSync(path),plan=JSON.parse(bytes);
  const optionsPath='reports/customer-resolution-plan-options-2026-10-10.json';
  const options=JSON.parse(readFileSync(workspacePath(optionsPath)));
  if(options.output!==planPath)throw new Error('PINNED_RESOLUTION_OPTIONS_REQUIRED');
  const keys=['base','reference','reconciliation','catalog','confirmation','receipt'];
  const inputs=Object.fromEntries(keys.map(k=>[k,JSON.parse(readFileSync(workspacePath(options[k])))]));
  const source=workspacePath(options.source),sourceBytes=readFileSync(source);
  const extraction=extractWorkbook({python:options.python,source,sourceSha256:hash(sourceBytes),inspectionDate:inputs.base.inspectionDate});
  if(!isDeepStrictEqual(prepareCustomerResolutionPlan({extraction,...inputs}),plan))throw new Error('RESOLUTION_PLAN_CHANGED');
  const paths=[planPath,optionsPath,options.source,...keys.map(k=>options[k]),'scripts/sales-import/plan-customer-resolutions.mjs',
    'scripts/sales-runtime/customer-resolution-trial.mjs','sql/sales/runtime/fixtures/customer-combined-trial.sql','sql/sales/runtime/fixtures/customer-resolution-trial.sql'];
  for(const f of paths)report.sources[f]=hash(readFileSync(workspacePath(f)));
  const checks=[],check=(ok,label)=>{if(!ok)throw new Error(`RESOLUTION_TRIAL_CHECK_FAILED: ${label}`);checks.push(label);};
  const deny=async(sql,label,reason)=>{let rejected=false;try{await query(sql);}catch(e){rejected=reason.test(e.message);}check(rejected,label);};
  const business=()=>query("SELECT jsonb_build_object('leads',(SELECT count(*) FROM public.leads),'sales',(SELECT count(*) FROM public.sales),'plots',(SELECT count(*) FROM public.plots));");
  const publicBefore=await business();
  await query(readFileSync(`${root}/sql/sales/runtime/fixtures/customer-combined-trial.sql`,'utf8'));
  await query(readFileSync(`${root}/sql/sales/runtime/fixtures/customer-resolution-trial.sql`,'utf8'));
  const base=inputs.base,b=base.baseline;
  await query(`BEGIN;
    INSERT INTO customer_combined_trial.roles SELECT (r->>'userId')::uuid,r->>'role',(r->>'isActive')::boolean FROM jsonb_array_elements(${json(b.roles)}) r;
    INSERT INTO customer_combined_trial.customers SELECT (r->>'id')::uuid,r->>'nameHash',(r->>'ownerUserId')::uuid FROM jsonb_array_elements(${json(b.customers)}) r;
    INSERT INTO customer_combined_trial.interests SELECT (r->>'id')::uuid,(r->>'customerId')::uuid,r->>'projectName',(r->>'ownerUserId')::uuid FROM jsonb_array_elements(${json(b.interests)}) r;
    INSERT INTO customer_combined_trial.plots SELECT r->>'id',r->>'projectName' FROM jsonb_array_elements(${json(b.plots)}) r;
    INSERT INTO customer_combined_trial.sales SELECT (r->>'id')::uuid,(r->>'customerId')::uuid,(r->>'interestId')::uuid,r->>'projectName',r->>'plotId',r->>'stage',
      777777,'2001-01-01'::date,'SYNTHETIC_BANK_SENTINEL',NULL FROM jsonb_array_elements(${json(b.sales)}) r; COMMIT;`);
  const tables=['customers','interests','sales','receipts','source_rows','history','resolution_receipts','resolution_rows','customer_events'];
  const snapshot=()=>query(`SELECT md5(jsonb_build_object(${tables.flatMap(t=>[q(t),`(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM customer_combined_trial.${t} r)`]).join(',')})::text);`);
  const apply=p=>`SELECT customer_combined_trial.apply_resolved_bundle(${json(base)},${json(p)});`;
  const before=await snapshot(),invalid=structuredClone(plan);
  invalid.rows.findLast(r=>r.disposition==='resolved_history_candidate').sourceHistory.at(-1).precision='INVALID_LAST_EVENT';
  await deny(apply(invalid),'late resolution history constraint rejects whole bundle',/violates check constraint "customer_events_check/);
  check(await snapshot()===before,'late failure rolls back base cancellations forecasts booking and six customer/interest candidates together');
  await query(`UPDATE customer_combined_trial.roles SET active=false WHERE id=${q(inputs.receipt.ownerUserId)}::uuid;`);
  await deny(apply(plan),'deactivated TEAW blocks bundle',/CANDIDATE BINDING OR ROLE CHANGED|RESOLVED OWNER ROLE CHANGED/);
  check(await snapshot()===before,'role change leaves no modeled business writes');
  await query(`UPDATE customer_combined_trial.roles SET active=true WHERE id=${q(inputs.receipt.ownerUserId)}::uuid;`);
  check(await query(apply(plan))==='applied_private_resolved_bundle','confirmed source-bound bundle applied');
  const actual=JSON.parse(await query(`SELECT jsonb_build_object(${tables.slice(0,3).concat(['resolution_rows','customer_events','history']).flatMap(t=>[q(t),`(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM customer_combined_trial.${t} r)`]).join(',')});`));
  const resolved=plan.rows.filter(r=>r.disposition==='resolved_history_candidate'),skipped=plan.rows.filter(r=>r.disposition==='skipped_rental');
  check(actual.customers.length===b.customers.length+6&&actual.interests.length===b.interests.length+6,'exactly six source-bound private customers and interests; no name deduplication');
  check(actual.sales.length===b.sales.length+base.counts.newBookingCandidates,'unknown booking and visit corrections create no extra sale');
  check(actual.resolution_rows.length===resolved.length&&actual.resolution_rows.every(r=>isDeepStrictEqual(r.payload,resolved.find(p=>p.sourceRow===r.source_row))),'all 24 resolution row payloads preserved exactly once');
  check(skipped.length===8&&skipped.every(r=>!actual.resolution_rows.some(a=>a.source_row===r.sourceRow)
    &&!actual.customer_events.some(a=>a.source_row===r.sourceRow)&&!actual.history.some(a=>a.source_row===r.sourceRow)),'all eight rental rows excluded from applied history');
  check(resolutionGroups.owner.every(n=>{
    const r=resolved.find(r=>r.sourceRow===n),c=actual.customers.find(c=>c.id===fixtureId(r.customerCandidateKey));
    return c.owner_id===inputs.receipt.ownerUserId&&c.name_hash===r.customerNameHash;
  }),'all five missing-owner candidates use exact confirmed active TEAW ID');
  const unknown=resolved.find(r=>r.sourceRow===680);
  check(actual.customers.find(c=>c.id===fixtureId(unknown.customerCandidateKey)).name_hash===hash('ไม่ทราบ')
    &&new Set(resolved.filter(r=>r.customerCandidateKey).map(r=>r.customerCandidateKey)).size===6,'unknown-name row has display fingerprint and unique source identity');
  check(resolutionGroups.unknownProject.every(n=>{
    const r=actual.resolution_rows.find(r=>r.source_row===n),events=actual.customer_events.filter(e=>e.source_row===n);
    return r.interest_id===null&&events.length>0&&events.every(e=>e.interest_id===null&&e.project_name===null);
  }),'ten unknown projects remain unbound customer history without fake project or interest');
  check(resolutionGroups.firstProject.every(n=>{
    const r=resolved.find(r=>r.sourceRow===n);return actual.customer_events.filter(e=>e.source_row===n).every(e=>e.interest_id===r.interestId&&e.project_name===r.projectName);
  }),'six first-project selections use exact reviewed existing interests');
  check(actual.customer_events.filter(e=>e.source_row===642).every(e=>e.plot_id==='ไอลิน 4-67'),'row 642 references exact AL4-67 visit plot');
  check(actual.customer_events.filter(e=>e.source_row===171).length===3
    &&actual.customer_events.filter(e=>e.source_row===171).every(e=>e.plot_id===null),'row 171 retains three lifecycle events with unknown plot and no invented sale');
  check(actual.customer_events.filter(e=>e.source_row===885).every(e=>e.occurred_day===null&&e.precision==='unknown'),'row 885 unknown visit day preserved without guessing');
  check(b.customers.every(c=>actual.customers.some(a=>a.id===c.id&&a.owner_id===c.ownerUserId&&a.name_hash===c.nameHash)),'all existing customer owners and name fingerprints preserved');
  check(b.interests.every(i=>actual.interests.some(a=>a.id===i.id&&a.customer_id===i.customerId&&a.owner_id===i.ownerUserId&&a.project_name===i.projectName)),'all existing interests and owners retained');
  const expected=resolved.flatMap(r=>r.sourceHistory.map((e,i)=>({source_row:r.sourceRow,sequence:i+1,kind:e.kind,occurred_day:e.date,precision:e.precision})));
  check(actual.customer_events.length===expected.length&&expected.every(e=>actual.customer_events.some(a=>Object.entries(e).every(([k,v])=>a[k]===v))),'all resolved known/unknown historical dates match source');
  check(actual.sales.every(s=>s.actual_timestamp===null),'no actual timestamps invented');
  const sales=new Map(actual.sales.map(s=>[s.id,s]));
  check(base.rows.filter(r=>r.disposition!=='held'&&r.saleId).every(r=>{
    const s=sales.get(r.saleId);return s.stage===r.sourceStage&&s.forecast===(r.expectedTransferDate??'2001-01-01')
      &&s.price===(r.salePrice??777777)&&s.bank==='SYNTHETIC_BANK_SENTINEL';
  }),'base per-sale stages prices forecasts and unknown preservation remain correct');
  const candidates=new Set(base.rows.filter(r=>r.disposition!=='held'&&r.saleId).map(r=>r.saleId));
  check(b.sales.filter(s=>!candidates.has(s.id)).every(s=>{
    const a=sales.get(s.id);return a.stage===s.stage&&a.forecast==='2001-01-01'&&a.price===777777&&a.bank==='SYNTHETIC_BANK_SENTINEL';
  }),'skipped or held existing sales keep all synthetic baseline fields');
  const after=await snapshot();
  check(await query(apply(plan))==='already_applied'&&await snapshot()===after,'exact bundle replay creates no duplicate customers interests sales or events');
  const altered=structuredClone(plan);altered.rows.find(r=>r.sourceRow===642).plotId='UNKNOWN';
  await deny(apply(altered),'changed resolution replay denied',/RESOLUTION REPLAY PAYLOAD CHANGED/);
  check(await snapshot()===after,'changed replay leaves all tables unchanged');
  for(const role of ['anon','authenticated']){
    await deny(`SET ROLE ${role}; SELECT * FROM customer_combined_trial.customer_events;`,`${role} cannot read private customer events`,/permission denied for schema customer_combined_trial/);
    await deny(`SET ROLE ${role}; ${apply(plan)}`,`${role} cannot invoke private bundle`,/permission denied for schema customer_combined_trial/);
  }
  check(await query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_combined_trial' AND c.relkind='r' AND NOT c.relrowsecurity;")==='0','all private model tables have RLS enabled');
  check(await business()===publicBefore,'no public business or Lead writes');
  check(readFileSync(source).equals(sourceBytes)&&readFileSync(path).equals(bytes),'source and pinned plan bytes unchanged during trial');
  return {model:'private relational rehearsal; not production import guard or authenticated-writer verification',assertions:checks.length,checks,
    counts:plan.counts,baseHistoryEvents:actual.history.length,resolvedHistoryEvents:expected.length,
    sourceSha256:plan.sourceSha256,resolutionPlanDigest:plan.resolutionPlanDigest,
    financialBaseline:'SYNTHETIC price/forecast/bank values; no live financial preservation certification',
    sourceBoundPrivateIDsAreProductionIDs:false,productionChanged:false,canonicalImportReady:false};
}
