// Actual private details/forecast writer on owned typed canonical fixtures.
// This is neither the 958-row whole activation nor a production import.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const q=v=>`'${String(v).replaceAll("'","''")}'`, j=v=>`${q(JSON.stringify(v))}::jsonb`;
const actor='ca280000-0000-4000-8000-000000000001';
const tx=(sql,role='',user=actor)=>`BEGIN; ${role?`SET LOCAL ROLE ${role};`:''} SET LOCAL "request.jwt.claim.sub"=${q(user)};${sql}COMMIT;`;

export async function runReviewedForecastImport({query,root,report}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const path='scripts/sales-runtime/reviewed-forecast-import.mjs';
 report.sources[path]=createHash('sha256').update(readFileSync(join(root,path))).digest('hex');
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const captured=JSON.parse(await query(`SELECT jsonb_build_object('sourceRow',(p.payload->>'source_row')::integer,
  'binding',jsonb_build_object('customerId',c.id,'interestId',i.id,'saleId',s.id,'customerOwnerId',c.owner_user_id,
   'interestOwnerId',i.owner_user_id,'customerRevision',c.lifecycle_revision,'interestRevision',i.lifecycle_revision),
  'before',jsonb_build_object('sale',to_jsonb(s),'details',(SELECT to_jsonb(d) FROM sales_private.deal_details_corrections d WHERE d.sale_id=s.id),
   'forecast',(SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE f.sale_id=s.id)))
 FROM public.sales s JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id
 JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id
 WHERE s.crm_stage='transferred' ORDER BY s.id LIMIT 1;`));
 assert.ok(captured?.binding,'a real completed-stage canonical fixture is required');
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const payload={version:'reviewed-import-details-v1',datasetKey:'SYNTHETIC-COMPLETED-P-FORECAST',sourceSha256:hash('SYNTHETIC workbook'),
  reviewSha256:hash('SYNTHETIC reviewed column P'),businessStageWritesAllowed:false,leadReplayAllowed:false,
  records:[{...captured,sourceKey:hash('SYNTHETIC reviewed source key'),rowSha256:hash('SYNTHETIC reviewed source cells'),
   patch:{salePriceSatang:null,expectedTransferDate:'2026-10-30',sourceStage:'transferred'}}]};
 const apply=p=>`SELECT sales_import_private.apply_reviewed_details(${j(p)});`;
 const publicState=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales_customers x),
  'interests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.lead_project_interests x),'sales',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales x),
  'plots',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.plots x),'settings',(SELECT jsonb_agg(to_jsonb(x)) FROM public.crm_settings x),
  'leads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.leads x),'deals',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sale_id) FROM sales_private.deal_details_corrections x));`);
 const privateState=()=>query(`SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_import_private.detail_batches x),
  'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY batch_id,source_row) FROM sales_import_private.detail_events x),
  'forecasts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sale_id) FROM sales_import_private.forecast_corrections x),
  'permits',(SELECT count(*) FROM sales_import_private.forecast_permits)+(SELECT count(*) FROM sales_private.customer_deal_details_permits));`);
 const beforePublic=await publicState(),beforePrivate=await privateState();
 for(const [label,mutate,pattern] of [
  ['completed price update remains forbidden',p=>{p.records[0].patch.salePriceSatang=100000000;},/IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED/],
  ['completed no-op without P evidence remains forbidden',p=>{p.records[0].patch.expectedTransferDate=null;},/IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED/],
  ['actual transfer timestamp cannot be supplied in forecast patch',p=>{p.records[0].patch.transferredAt='2026-10-30T00:00:00Z';},/IMPORT_DETAILS_INVALID/],
  ['invalid civil forecast is rejected',p=>{p.records[0].patch.expectedTransferDate='2026-02-30';},/IMPORT_DETAILS_INVALID/],
  ['unreviewed bank cannot be inferred with P',p=>{p.records[0].patch.bankName='SYNTHETIC BANK';},/IMPORT_DETAILS_INVALID/],
  ['changed Sale before-image cannot update forecast',p=>{p.records[0].before.sale.sale_price=1;},/IMPORT_DETAILS_STALE_BINDING/],
  ['changed lifecycle stage cannot update forecast',p=>{p.records[0].patch.sourceStage='cancelled';},/IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED/],
 ]) {const bad=structuredClone(payload);mutate(bad);await deny(label,tx(apply(bad)),pattern);
  check(await publicState()===beforePublic&&await privateState()===beforePrivate,`${label} leaves all canonical fields and forecast ledgers unchanged`);}
 await deny('browser Admin cannot invoke completed forecast writer',tx(apply(payload),'authenticated'),/permission denied/);
 await deny('Sales cannot invoke private completed forecast writer',tx(apply(payload),'',captured.binding.customerOwnerId),/IMPORT_DETAILS_FORBIDDEN/);
 await deny('late forecast receipt failure rolls back overlay',tx(`CREATE FUNCTION public.synthetic_forecast_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SYNTHETIC_FORECAST_RECEIPT_FAILURE';END;$$;
  CREATE TRIGGER synthetic_forecast_receipt_failure BEFORE INSERT ON sales_import_private.detail_events FOR EACH ROW EXECUTE FUNCTION public.synthetic_forecast_receipt_failure();${apply(payload)}`),/SYNTHETIC_FORECAST_RECEIPT_FAILURE/);
 check(await publicState()===beforePublic&&await privateState()===beforePrivate,'late failure restores the complete state and removes any permit');
 const result=JSON.parse(await query(tx(apply(payload))));
 check(result.records===1&&!result.replayed,'one completed forecast commits through the actual reviewed private writer');
 check(await publicState()===beforePublic,'P-only import preserves Customer Interest Sale money bank actual days stock Lead and flags byte-for-byte');
 check(await query(tx(`SELECT sales_import_private.expected_transfer_date(${q(captured.binding.saleId)}::uuid,NULL);`))==='2026-10-30','actual per-Sale getter returns imported P forecast');
 const afterPrivate=await privateState(),replay=JSON.parse(await query(tx(apply(payload))));
 check(replay.replayed&&await privateState()===afterPrivate,'same reviewed forecast replay retains original ledger without duplication');
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM sales_import_private.forecast_permits) AND NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits);')==='t','no reusable forecast or financial permit remains');
 return {assertions:cases.length,cases,scope:'one completed-stage owned fixture, actual SQL26 writer and getter; not all42 source imports',
  realDatabaseWrites:false,actualTransferDatesChanged:false,syntheticOnly:true};
}
