// Offline router for the approved source plan. Never runs SQL, creates UUIDs, or writes application data.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractWorkbook,workspacePath } from './review-workbook.mjs';
import { prepareCustomerResolutionPlan } from './plan-customer-resolutions.mjs';
import { validateCombinedPlan } from '../sales-runtime/customer-combined-trial.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(JSON.stringify(v));
const requireValue=(v,code)=>{if(!v)throw new Error(code);};
export function prepareCanonicalAdapterPlan({base,resolution}){
 validateCombinedPlan(base);
 const {resolutionPlanDigest,...body}=resolution;
 requireValue(digest(body)===resolutionPlanDigest&&resolution.basePlanDigest===base.combinedPlanDigest
  &&resolution.canonicalImportReady===false&&resolution.businessWritesAllowed===false&&resolution.lostChangesAllowed===false,'SEALED_RESOLUTION_REQUIRED');
 requireValue(resolution.rows.length===base.rows.length&&new Set(resolution.rows.map(r=>r.sourceRow)).size===base.rows.length,'COMPLETE_SOURCE_COVERAGE_REQUIRED');
 const original=new Map(base.rows.map(r=>[r.sourceRow,r]));
 const rows=resolution.rows.map(r=>{
  const b=original.get(r.sourceRow);
  requireValue(b&&b.sourceKey===r.sourceKey&&b.rowSha256===r.rowSha256,'SOURCE_BINDING_CHANGED');
  let route;
  if(r.disposition==='skipped_rental')route='skip_rental';
  else if(r.disposition==='held')route='hold_identity';
  else if(r.customerCandidateKey)route='source_bound_creation_review';
  else if(r.unknownProjectDisplay||r.unknownBookingDisplay)route='unknown_history_evidence';
  else if(b.action==='propose_new_booking_for_existing_customer')route='historical_booking_review';
  else if(b.action==='propose_existing_booking_revision'&&b.sourceStage!==b.priorStage)route='historical_lifecycle_review';
  else if(b.action==='propose_existing_booking_revision')route='reviewed_details_candidate';
  else route='existing_history_evidence';
  const value={sourceRow:r.sourceRow,sourceKey:r.sourceKey,rowSha256:r.rowSha256,route,
   customerId:r.customerId,interestId:r.interestId,saleId:b.saleId,plotId:r.plotId,projectName:r.projectName,
   customerCandidateKey:r.customerCandidateKey,interestCandidateKey:r.interestCandidateKey,
   unknownNameDisplay:r.unknownNameDisplay,unknownProjectDisplay:r.unknownProjectDisplay,unknownBookingDisplay:r.unknownBookingDisplay,
   ownerUserId:r.ownerUserId,sourceStage:r.sourceStage,history:structuredClone(r.sourceHistory),
   patch:null,requiredChecks:[],executable:false};
  if(route==='reviewed_details_candidate'){
   requireValue(b.saleId&&r.customerId&&r.interestId&&b.sourceStage===b.priorStage,'EXISTING_SALE_REQUIRED');
   const satang=b.salePrice===null?null:Math.round(b.salePrice*100);
   requireValue(satang===null||Number.isSafeInteger(satang)&&satang>0&&satang<=99999999999&&Math.abs(satang/100-b.salePrice)<1e-7,'SOURCE_PRICE_INVALID');
   value.patch={salePriceSatang:satang,expectedTransferDate:b.expectedTransferDate,sourceStage:b.sourceStage};
   value.requiredChecks=['fresh_exact_sale_before_image','fresh_details_and_forecast_before_images','fresh_customer_interest_revisions_and_owners','active_admin_and_sales_owners','canonical_source_provenance'];
  }else if(route==='unknown_history_evidence'){
   requireValue(r.customerId&&b.saleId===null&&r.plotId===null,'UNKNOWN_HISTORY_CANNOT_CREATE_SALE');
   value.requiredChecks=['existing_customer_uuid_unmerged',r.unknownProjectDisplay?'no_interest_or_project_created':'exact_existing_interest_customer_binding','explicit_source_unknown_reason'];
  }else if(route==='source_bound_creation_review'){
   requireValue(r.customerId===null&&r.interestId===null&&r.customerCandidateKey&&r.interestCandidateKey,'SOURCE_CANDIDATE_NOT_PRODUCTION_UUID');
   value.requiredChecks=['separate_insert_only_provenance_guard','source_bound_uuid_allocation','fresh_confirmed_active_sales_owner','no_name_identity_merge'];
  }else if(route==='historical_lifecycle_review'||route==='historical_booking_review'){
   value.requiredChecks=['day_precision_lifecycle_importer','fresh_complete_occupancy','exact_before_image_and_idempotent_receipt','whole_row_atomic_apply'];
  }else if(route==='existing_history_evidence')value.requiredChecks=['durable_history_source_version_review','exact_customer_interest_sale_binding'];
  else value.requiredChecks=[route==='skip_rental'?'user_will_enter_rental_manually':'explicit_person_identity_confirmation'];
  return value;
 });
 const counts=Object.fromEntries([...new Set(rows.map(r=>r.route))].sort().map(route=>[route,rows.filter(r=>r.route===route).length]));
 const plan={version:'canonical-customer-adapter-plan-v1',sourceSha256:resolution.sourceSha256,resolutionPlanDigest,
  basePlanDigest:base.combinedPlanDigest,reviewSha256:resolution.confirmationDigest,counts,rows,
  freshCaptureIncluded:false,canonicalImportReady:false,businessWritesAllowed:false,lostChangesAllowed:false,productionChanged:false};
 return {...plan,adapterPlanDigest:digest(plan)};
}
// Evidence-only payload for SQL25. Explicit existing Customer bindings; no invented catalog or Sale UUIDs.
export function prepareUnknownHistoryPayload({base,resolution}){
 const plan=prepareCanonicalAdapterPlan({base,resolution});
 const original=new Map(base.rows.map(r=>[r.sourceRow,r]));
 return {version:'unknown-historical-evidence-v1',sourceSystem:'BuildTrack-approved-customer-workbook',
  datasetKey:`unknown-history-${plan.adapterPlanDigest}`,snapshotSha256:plan.sourceSha256,mappingReviewRef:`confirmation:${plan.reviewSha256}`,
  records:plan.rows.filter(r=>r.route==='unknown_history_evidence').map(r=>({sourceKey:r.sourceKey,rowNumber:r.sourceRow,rowSha256:r.rowSha256,
   customerKey:original.get(r.sourceRow).customerPartitionKey,customerId:r.customerId,interestId:r.interestId,saleId:null,
   reason:r.unknownProjectDisplay?'unknown_project':'unknown_booking',sourceStage:r.sourceStage,
   events:r.history.map((e,index)=>({eventKey:`${r.sourceKey}-${index+1}`,kind:e.kind,sequence:index+1,date:e.date,precision:e.precision,
    evidenceRef:`approved-source-row:${r.sourceRow}:${r.rowSha256}`}))})),businessWritesAllowed:false,leadRequired:false};
}
export function createCanonicalAdapterPlan({output}){
 requireValue(/^reports\/canonical-customer-adapter-plan-[\w-]+\.json$/.test(output),'UNUSED_REPORT_OUTPUT_REQUIRED');
 const options=JSON.parse(readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json')));
 const inputs=Object.fromEntries(['base','reference','reconciliation','catalog','confirmation','receipt'].map(k=>[k,JSON.parse(readFileSync(workspacePath(options[k])))]));
 const before=readFileSync(workspacePath(options.source));
 const extraction=extractWorkbook({python:options.python,source:workspacePath(options.source),sourceSha256:hash(before),inspectionDate:inputs.base.inspectionDate});
 const resolution=JSON.parse(readFileSync(workspacePath(options.output)));
 requireValue(JSON.stringify(prepareCustomerResolutionPlan({extraction,...inputs}))===JSON.stringify(resolution),'CURRENT_WORKBOOK_PLAN_CHANGED');
 const plan=prepareCanonicalAdapterPlan({base:inputs.base,resolution});
 requireValue(hash(readFileSync(workspacePath(options.source)))===hash(before),'WORKBOOK_CHANGED_DURING_READ');
 writeFileSync(workspacePath(output),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 return {output,counts:plan.counts,adapterPlanDigest:plan.adapterPlanDigest,sourceVerified:true,productionChanged:false};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2);requireValue(args.length===2&&args[0]==='--output','Usage: --output reports/canonical-customer-adapter-plan-DATE.json');
 console.log(JSON.stringify(createCanonicalAdapterPlan({output:args[1]})));
}
