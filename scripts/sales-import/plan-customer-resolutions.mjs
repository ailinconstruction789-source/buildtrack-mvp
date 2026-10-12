// Offline source-bound decisions. No real IDs manufactured, no live database writer.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractWorkbook,prepareWorkbookDraft,workspacePath } from './review-workbook.mjs';
import { validateCombinedPlan } from '../sales-runtime/customer-combined-trial.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const check=(ok,code)=>{if(!ok)throw new Error(code);};
export const resolutionGroups={owner:[438,439,440,444,894],unknownName:[680],unknownProject:[237,238,239,249,250,256,257,263,274,275],
  firstProject:[688,787,884,885,908,949],correctPlot:[642],unknownBooking:[171]};
export function prepareCustomerResolutionPlan({base,extraction,reference,reconciliation,catalog,confirmation,receipt}){
  validateCombinedPlan(base);
  const {confirmationDigest,...receiptBody}=receipt;
  check(receipt.version==='customer-resolution-confirmation-v1'&&digest(receiptBody)===confirmationDigest&&receipt.basePlanDigest===base.combinedPlanDigest
    &&receipt.sourceSha256===extraction.sha256&&receipt.previousSourceSha256===base.sourceSha256
    &&receipt.businessWritesAllowed===false&&receipt.lostChangesAllowed===false
    &&receipt.ownerAccountConfirmed===true&&receipt.unknownDisplay==='ไม่ทราบ'
    &&receipt.skipAllRentalRows===true&&receipt.unknownDatePolicy==='unknown_no_guess'&&receipt.row275Confirmed===true
    &&receipt.unknownProjectIsRealProject===false&&receipt.unknownBookingIsRealSale===false&&receipt.unknownNameIsIdentityMergeKey===false
    &&JSON.stringify(receipt.groups)===JSON.stringify(resolutionGroups),'RESOLUTION_APPROVAL_REQUIRED');
  const {reconciliationDigest,...reconciliationBody}=reconciliation;
  const {confirmationDigest:oldConfirmationDigest,...oldConfirmationBody}=confirmation;
  check(digest(reference)===receipt.referenceDigest&&digest(catalog)===base.catalogDigest
    &&digest(reconciliationBody)===reconciliationDigest&&reconciliationDigest===base.reconciliationDigest&&reconciliation.referenceDigest===digest(reference)
    &&digest(oldConfirmationBody)===oldConfirmationDigest&&oldConfirmationDigest===base.confirmationDigest,'PINNED_REFERENCE_CHANGED');
  const {draft}=prepareWorkbookDraft(extraction,base.inspectionDate);
  const raw=new Map(extraction.rows.map(r=>[r.rowNumber,r]));
  check(draft.entries.length===base.rows.length&&draft.entries.every(e=>base.rows.some(r=>r.sourceRow===e.sourceRow))
    &&base.rows.every(r=>digest(raw.get(r.sourceRow))===r.rowSha256),'SOURCE_CONTENT_CHANGED');
  const roles=reference.roles.filter(r=>r.userId===receipt.ownerUserId&&r.displayName===receipt.ownerLogin&&r.role==='sales'&&r.isActive);
  check(roles.length===1&&receipt.ownerLogin==='TEAW','ACTIVE_CONFIRMED_OWNER_REQUIRED');
  const correction=catalog.plots.filter(p=>p.id===receipt.correctedPlotId&&p.projectName==='ไอลิน 4'&&p.plotName==='67');
  check(correction.length===1,'EXACT_CORRECTED_PLOT_REQUIRED');
  const entries=new Map(draft.entries.map(e=>[e.sourceRow,e]));
  const bindings=new Map(reconciliation.rows.map(r=>[r.sourceRow,r]));
  const prior=new Map(reference.rows.map(r=>[`${r.batchId}:${r.sourceRow}`,r]));
  const changed=new Set(Object.values(resolutionGroups).flat());
  const rows=base.rows.map(original=>{
    const row=structuredClone(original),n=row.sourceRow,b=bindings.get(n),entry=entries.get(n);
    const old=prior.get(`${b.priorBatchId}:${b.priorSourceRow}`);
    const decision={sourceRow:n,sourceKey:row.sourceKey,rowSha256:row.rowSha256,
      disposition:row.disposition==='held'?'held':'base_candidate',holds:[...row.holds],
      customerId:row.customerId,customerCandidateKey:null,customerNameHash:null,unknownNameDisplay:null,
      interestId:row.interestId,interestCandidateKey:null,projectName:row.projectName,unknownProjectDisplay:null,
      plotId:row.plotId,unknownBookingDisplay:null,ownerUserId:row.sourceSalesOwnerUserId,
      sourceStage:row.sourceStage,sourceHistory:row.sourceHistory,sourceIssuesRetained:row.sourceIssuesRetained,
      actions:[],canonicalWritesAllowed:false,leadReplayAllowed:false};
    if(entry.issues.includes('PAYMENT_METHOD_REVIEW')){
      decision.disposition='skipped_rental';decision.holds=[];decision.actions=['user_will_enter_rental_manually'];return decision;
    }
    if(!changed.has(n))return decision;
    check(row.disposition==='held'&&old&&!old.customerMergedIntoId,'EXPECTED_HELD_SOURCE_BINDING_REQUIRED');
    if(resolutionGroups.owner.includes(n)){
      check(entry.issues.includes('SALES_OWNER_MISSING')&&!row.customerId&&b.confirmedProjects.length===1,'OWNER_OVERRIDE_SCOPE_INVALID');
      decision.ownerUserId=receipt.ownerUserId;decision.customerCandidateKey=row.customerPartitionKey;
      decision.customerNameHash=hash(entry.proposal.customerName);decision.projectName=b.confirmedProjects[0];
      decision.actions.push('source_bound_customer_with_confirmed_owner');
    }
    if(resolutionGroups.unknownName.includes(n)){
      check(entry.issues.includes('CUSTOMER_NAME_MISSING')&&!row.customerId&&b.confirmedProjects.length===1,'NAME_OVERRIDE_SCOPE_INVALID');
      decision.customerCandidateKey=row.customerPartitionKey;decision.customerNameHash=hash(receipt.unknownDisplay);
      decision.unknownNameDisplay=receipt.unknownDisplay;decision.projectName=b.confirmedProjects[0];
      decision.actions.push('source_bound_unknown_name_customer_no_name_matching');
    }
    if(resolutionGroups.unknownProject.includes(n)){
      check(row.customerId&&b.confirmedProjects.length===0&&row.sourceStage==='visited','UNKNOWN_PROJECT_SCOPE_INVALID');
      decision.interestId=null;decision.projectName=null;decision.unknownProjectDisplay=receipt.unknownDisplay;
      decision.actions.push('customer_history_without_invented_project');
    }
    if(resolutionGroups.firstProject.includes(n)){
      check(b.confirmedProjects.length>1&&row.customerId&&row.sourceStage==='visited','FIRST_PROJECT_SCOPE_INVALID');
      const sourceLabels=entry.proposal.projectLabels;
      check(sourceLabels.length>1,'ORDERED_SOURCE_PROJECTS_REQUIRED');
      // Reconciliation preserves reviewed source-project order. Store the exact first-source label fingerprint too.
      decision.firstSourceProjectLabelHash=hash(sourceLabels[0]);
      const mappings=confirmation.projectMappings.filter(m=>m.sourceLabel===sourceLabels[0]&&m.confirmed);
      check(mappings.length===1&&mappings[0].proposedProjectName===b.confirmedProjects[0],'FIRST_SOURCE_PROJECT_MAPPING_REQUIRED');
      const project=mappings[0].proposedProjectName,matches=old.interests.filter(i=>i.projectName===project);
      check(matches.length===1,'EXACT_FIRST_INTEREST_REQUIRED');
      decision.projectName=project;decision.interestId=matches[0].id;
      decision.actions.push('use_reviewed_first_project_interest');
      if(entry.issues.includes('VISIT_DATE_REVIEW')){
        check(decision.sourceHistory.every(e=>e.kind!=='visited'||e.date===null&&e.precision==='unknown'),'UNKNOWN_DATE_POLICY_REQUIRED');
        decision.actions.push('retain_unknown_visit_day_no_guess');
      }
    }
    if(resolutionGroups.correctPlot.includes(n)){
      check(row.sourceStage==='visited'&&b.confirmedProjects[0]===correction[0].projectName&&row.customerId&&row.interestId,'PLOT_OVERRIDE_SCOPE_INVALID');
      decision.plotId=correction[0].id;decision.actions.push('correct_visit_plot_reference_only');
    }
    if(resolutionGroups.unknownBooking.includes(n)){
      check(row.sourceStage==='cancelled'&&row.customerId&&row.interestId&&!row.saleId,'UNKNOWN_BOOKING_SCOPE_INVALID');
      decision.plotId=null;decision.unknownBookingDisplay=receipt.unknownDisplay;
      decision.actions.push('retain_cancelled_history_without_invented_sale_or_plot');
    }
    if(decision.customerCandidateKey){
      check(catalog.projects.some(p=>p.name===decision.projectName),'KNOWN_PROJECT_REQUIRED');
      decision.interestId=null;decision.interestCandidateKey=digest([decision.customerCandidateKey,'interest',decision.projectName]);
    }else check(old.customerId===decision.customerId&&base.baseline.customers.some(c=>c.id===decision.customerId),'EXACT_EXISTING_CUSTOMER_REQUIRED');
    check(reference.roles.some(r=>r.userId===decision.ownerUserId&&r.role==='sales'&&r.isActive),'ACTIVE_SALES_OWNER_REQUIRED');
    if(decision.interestId)check(old.interests.some(i=>i.id===decision.interestId&&i.projectName===decision.projectName),'EXACT_EXISTING_INTEREST_REQUIRED');
    decision.disposition='resolved_history_candidate';decision.holds=[];
    return decision;
  });
  const result={version:'customer-resolution-plan-v1',sourceSha256:extraction.sha256,previousSourceSha256:base.sourceSha256,
    sourceContentContinuity:{sourceRowsCompared:base.rows.length,changedSourceRows:0,allRowHashesMatch:true},
    basePlanDigest:base.combinedPlanDigest,confirmationDigest,referenceDigest:receipt.referenceDigest,
    groups:resolutionGroups,rows,counts:{sourceRows:rows.length,baseCandidates:rows.filter(r=>r.disposition==='base_candidate').length,
      resolvedHistoryCandidates:rows.filter(r=>r.disposition==='resolved_history_candidate').length,
      eligibleRows:rows.filter(r=>['base_candidate','resolved_history_candidate'].includes(r.disposition)).length,
      skippedRentals:rows.filter(r=>r.disposition==='skipped_rental').length,heldRows:rows.filter(r=>r.disposition==='held').length,
      sourceBoundNewCustomerCandidates:rows.filter(r=>r.disposition==='resolved_history_candidate'&&r.customerCandidateKey).length,
      sourceBoundNewInterestCandidates:rows.filter(r=>r.disposition==='resolved_history_candidate'&&r.interestCandidateKey).length},
    newCandidateIdsAreProductionIds:false,trialOnly:true,canonicalImportReady:false,businessWritesAllowed:false,lostChangesAllowed:false,
    productionChanged:false,customerNamesIncluded:false,phoneValuesIncluded:false};
  result.resolutionPlanDigest=digest(result);return result;
}
export function planCustomerResolutionFile(options){
  const keys=['base','reference','reconciliation','catalog','confirmation','receipt'];
  const inputs=Object.fromEntries(keys.map(k=>[k,{path:workspacePath(options[k]),bytes:readFileSync(workspacePath(options[k]))}]));
  const parsed=Object.fromEntries(keys.map(k=>[k,JSON.parse(inputs[k].bytes)]));
  const source=workspacePath(options.source),sha=hash(readFileSync(source));
  const extraction=extractWorkbook({python:options.python,source,sourceSha256:sha,inspectionDate:parsed.base.inspectionDate});
  const result=prepareCustomerResolutionPlan({extraction,...parsed});
  check(hash(readFileSync(source))===sha&&Object.values(inputs).every(i=>readFileSync(i.path).equals(i.bytes)),'INPUT_CHANGED_DURING_REVIEW');
  check(/^reports\/customer-resolution-plan-[\w-]+\.json$/.test(options.output),'UNUSED_REPORT_PATH_REQUIRED');
  writeFileSync(workspacePath(options.output),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{check(process.argv.length===3,'OPTIONS_REQUIRED');const p=planCustomerResolutionFile(JSON.parse(readFileSync(workspacePath(process.argv[2]))));
    process.stdout.write(JSON.stringify({status:'resolution_plan_created',counts:p.counts,digest:p.resolutionPlanDigest})+'\n');
  }catch(e){process.stderr.write(`RESOLUTION_PLAN_FAILED: ${/^[A-Z_]+$/.test(e.message)?e.message:'CHECK_PINNED_INPUTS'}\n`);process.exitCode=1;}
}
