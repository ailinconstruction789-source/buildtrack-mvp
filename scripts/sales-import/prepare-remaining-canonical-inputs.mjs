// Offline, source-verified adapter inputs. Names stay in memory; saved output is redacted.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractWorkbook,prepareWorkbookDraft,workspacePath } from './review-workbook.mjs';
import { prepareCustomerResolutionPlan } from './plan-customer-resolutions.mjs';
import { prepareCanonicalAdapterPlan } from './prepare-canonical-adapter-plan.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(JSON.stringify(v));
const check=(ok,code)=>{if(!ok)throw new Error(code);};
export function prepareRemainingSourceInputs({base,resolution,extraction}){
 const plan=prepareCanonicalAdapterPlan({base,resolution});
 check(extraction.sha256===plan.sourceSha256,'CURRENT_SOURCE_REQUIRED');
 const {draft}=prepareWorkbookDraft(extraction,base.inspectionDate);
 const raw=new Map(extraction.rows.map(r=>[r.rowNumber,r]));
 check(draft.entries.length===base.rows.length&&base.rows.every(r=>digest(raw.get(r.sourceRow))===r.rowSha256),'SOURCE_ROWS_CHANGED');
 const entries=new Map(draft.entries.map(e=>[e.sourceRow,e]));
 const original=new Map(base.rows.map(r=>[r.sourceRow,r]));
 const decisions=new Map(resolution.rows.map(r=>[r.sourceRow,r]));
 const records=plan.rows.filter(r=>r.route==='source_bound_creation_review').map(r=>{
  const d=decisions.get(r.sourceRow),e=entries.get(r.sourceRow);
  const name=d.unknownNameDisplay??e.proposal.customerName;
  check(typeof name==='string'&&name.length>0&&hash(name)===d.customerNameHash,'CONFIRMED_SOURCE_NAME_REQUIRED');
  check(r.history.every(e=>e.kind==='visited'),'CREATION_VISIT_ONLY');
  return {sourceRow:r.sourceRow,sourceKey:r.sourceKey,rowSha256:r.rowSha256,customerCandidateKey:r.customerCandidateKey,
   interestCandidateKey:r.interestCandidateKey,customerName:name,unknownName:d.unknownNameDisplay!==null,
   ownerUserId:r.ownerUserId,projectName:r.projectName,events:r.history.map((e,i)=>({eventKey:`${r.sourceKey}-${i+1}`,
    kind:e.kind,date:e.date,precision:e.precision,evidenceRef:`approved-source-row:${r.sourceRow}:${r.rowSha256}`}))};
 });
 check(JSON.stringify(records.map(r=>r.sourceRow))===JSON.stringify([438,439,440,444,680,894]),'SIX_CONFIRMED_CREATIONS_REQUIRED');
 const creation={version:'source-bound-customer-creation-v1',datasetKey:`source-creations-${plan.adapterPlanDigest}`,
  sourceSha256:plan.sourceSha256,reviewSha256:plan.reviewSha256,leadReplayAllowed:false,businessStageWritesAllowed:false,records};
 const lifecycle=plan.rows.filter(r=>['historical_lifecycle_review','historical_booking_review'].includes(r.route)).map(r=>{
  const b=original.get(r.sourceRow),satang=b.salePrice===null?null:Math.round(b.salePrice*100);
  check(satang===null||Number.isSafeInteger(satang)&&satang>0&&satang<=99999999999&&Math.abs(satang/100-b.salePrice)<1e-7,'SOURCE_PRICE_INVALID');
  return {sourceRow:r.sourceRow,sourceKey:r.sourceKey,rowSha256:r.rowSha256,
   operation:r.route==='historical_booking_review'?'create_booking':'cancel',customerId:r.customerId,interestId:r.interestId,saleId:r.saleId,
   newBookingCandidateKey:b.newBookingCandidateKey??null,plotId:r.plotId,projectName:r.projectName,
   sourceOwnerUserId:r.ownerUserId,sourceStage:r.sourceStage,priorStage:b.priorStage,
   salePriceSatang:satang,expectedTransferDate:b.expectedTransferDate,events:structuredClone(r.history),
   bankPolicy:'preserve_existing_no_inference',actualTimestamps:null,freshBeforeImage:null,executable:false};
 });
 check(JSON.stringify(lifecycle.map(r=>r.sourceRow))===JSON.stringify([926,944,964]),'THREE_CONFIRMED_LIFECYCLE_ROWS_REQUIRED');
 const redacted={version:'remaining-canonical-source-inputs-v1',sourceSha256:plan.sourceSha256,
  adapterPlanDigest:plan.adapterPlanDigest,resolutionPlanDigest:resolution.resolutionPlanDigest,reviewSha256:plan.reviewSha256,
  coverage:plan.counts,creation:{...creation,records:records.map(({customerName,...r})=>({...r,customerNameHash:hash(customerName),unknownNameDisplay:r.unknownName?'ไม่ทราบ':null}))},
  lifecycle,freshCaptureIncluded:false,canonicalImportReady:false,productionChanged:false,businessWritesAllowed:false,lostChangesAllowed:false,
  rawPersonalDataIncluded:false,uuidAllocation:'inside_guarded_apply_only',identityMergePolicy:'source_keys_only_never_names'};
 return {creation,lifecycle,redacted:{...redacted,inputDigest:digest(redacted)}};
}
export function loadRemainingSourceInputs(){
 const options=JSON.parse(readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json')));
 const keys=['base','reference','reconciliation','catalog','confirmation','receipt'];
 const bytes=new Map(keys.map(k=>[k,readFileSync(workspacePath(options[k]))]));
 const inputs=Object.fromEntries(keys.map(k=>[k,JSON.parse(bytes.get(k))]));
 const before=readFileSync(workspacePath(options.source));
 const extraction=extractWorkbook({python:options.python,source:workspacePath(options.source),sourceSha256:hash(before),inspectionDate:inputs.base.inspectionDate});
 const resolutionBytes=readFileSync(workspacePath(options.output)),resolution=JSON.parse(resolutionBytes);
 check(JSON.stringify(prepareCustomerResolutionPlan({extraction,...inputs}))===JSON.stringify(resolution),'CURRENT_APPROVED_RESOLUTION_REQUIRED');
 const result=prepareRemainingSourceInputs({base:inputs.base,resolution,extraction});
 check(readFileSync(workspacePath(options.source)).equals(before)&&keys.every(k=>readFileSync(workspacePath(options[k])).equals(bytes.get(k)))
  &&readFileSync(workspacePath(options.output)).equals(resolutionBytes),'INPUT_CHANGED_DURING_READ');
 return result;
}
// Complete captured canonical rows are supplied by a separately reviewed
// read-only capture. This function never queries a DB or fills missing fields.
export function bindRemainingLifecycleInputs({redacted,captures}){
 const {inputDigest,...body}=redacted;
 check(digest(body)===inputDigest&&redacted.freshCaptureIncluded===false&&redacted.businessWritesAllowed===false,'SEALED_SOURCE_INPUTS_REQUIRED');
 check(Array.isArray(captures)&&captures.length===3&&new Set(captures.map(c=>c.sourceRow)).size===3,'COMPLETE_FRESH_CAPTURE_REQUIRED');
 const byRow=new Map(captures.map(c=>[c.sourceRow,c]));
 const records=redacted.lifecycle.map(r=>{
  const capture=byRow.get(r.sourceRow),before=capture?.before;
  check(before&&['customer','interest','sale','plot','inventory','details','forecast'].every(k=>Object.hasOwn(before,k)),'COMPLETE_FRESH_CAPTURE_REQUIRED');
  const c=before.customer,i=before.interest,p=before.plot,s=before.sale;
  check(c?.id===r.customerId&&c.merged_into_customer_id==null&&i?.id===r.interestId&&i.customer_id===c.id
   &&i.project_name===r.projectName&&p?.id===r.plotId&&p.project_name===r.projectName,'CAPTURE_BINDING_CHANGED');
  check(Array.isArray(before.inventory)&&before.inventory.every(x=>x.plot_id===r.plotId)
   &&new Set(before.inventory.map(x=>x.id)).size===before.inventory.length
   &&JSON.stringify(before.inventory.map(x=>x.id))===JSON.stringify(before.inventory.map(x=>x.id).sort()),'COMPLETE_SORTED_PLOT_INVENTORY_REQUIRED');
  check(r.operation==='cancel'?s?.id===r.saleId&&s.project_interest_id===i.id&&s.plot_id===p.id&&s.crm_stage==='booked'
   &&before.inventory.some(x=>x.id===s.id&&JSON.stringify(x)===JSON.stringify(s)):s===null&&before.details===null&&before.forecast===null,'SALE_BEFORE_IMAGE_CHANGED');
  return {sourceRow:r.sourceRow,sourceKey:r.sourceKey,rowSha256:r.rowSha256,operation:r.operation,
   binding:{saleId:r.saleId,customerId:r.customerId,interestId:r.interestId,plotId:r.plotId},before:structuredClone(before),
   history:structuredClone(r.events),patch:{bookedDate:r.events.find(e=>e.kind==='booked')?.date??null,
    cancelledDate:r.events.find(e=>e.kind==='cancelled')?.date??null,expectedTransferDate:r.expectedTransferDate,
    salePriceSatang:r.salePriceSatang,closingSalesId:r.sourceOwnerUserId}};
 });
 return {version:'reviewed-historical-sale-revision-v1',datasetKey:`source-lifecycle-${redacted.adapterPlanDigest}`,
  sourceSha256:redacted.sourceSha256,reviewSha256:redacted.reviewSha256,leadReplayAllowed:false,records};
}
export function saveRemainingSourceInputs(output){
 check(/^reports\/remaining-canonical-source-inputs-[\w-]+\.json$/.test(output),'UNUSED_REDACTED_REPORT_REQUIRED');
 const {redacted}=loadRemainingSourceInputs();
 writeFileSync(workspacePath(output),JSON.stringify(redacted,null,2)+'\n',{flag:'wx',mode:0o600});
 return {output,sourceVerified:true,creationRows:redacted.creation.records.length,lifecycleRows:redacted.lifecycle.length,inputDigest:redacted.inputDigest,productionChanged:false};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2);check(args.length===2&&args[0]==='--output','Usage: --output reports/remaining-canonical-source-inputs-DATE.json');
 console.log(JSON.stringify(saveRemainingSourceInputs(args[1])));
}
