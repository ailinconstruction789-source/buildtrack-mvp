// Actual read-only workbook parity plus negative decision tests; no database writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractWorkbook,workspacePath } from './review-workbook.mjs';
import { prepareCustomerResolutionPlan } from './plan-customer-resolutions.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const options=JSON.parse(readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json')));
const keys=['base','reference','reconciliation','catalog','confirmation','receipt'];
const original=Object.fromEntries(keys.map(k=>[k,JSON.parse(readFileSync(workspacePath(options[k])))]));
const sourceBytes=readFileSync(workspacePath(options.source));
original.extraction=extractWorkbook({python:options.python,source:workspacePath(options.source),sourceSha256:hash(sourceBytes),inspectionDate:original.base.inspectionDate});
const expected=JSON.parse(readFileSync(workspacePath(options.output)));
const row=n=>expected.rows.find(r=>r.sourceRow===n);
const sealReceipt=f=>{delete f.receipt.confirmationDigest;f.receipt.confirmationDigest=hash(JSON.stringify(f.receipt));};
test('actual current source reproduces every sealed resolution exactly',()=>assert.deepEqual(prepareCustomerResolutionPlan(original),expected));
test('all 979 rows accounted as 958 candidates 8 skipped rental 13 held',()=>{
  assert.equal(expected.counts.eligibleRows,958);assert.equal(expected.counts.skippedRentals,8);assert.equal(expected.counts.heldRows,13);
  assert.equal(new Set(expected.rows.map(r=>r.sourceRow)).size,979);
});
test('rentals skipped completely even where another new-row hold previously applied',()=>{
  assert.deepEqual(expected.rows.filter(r=>r.disposition==='skipped_rental').map(r=>r.sourceRow),[859,951,954,958,959,960,961,969]);
  assert.equal(row(969).actions[0],'user_will_enter_rental_manually');
});
test('Taew clarification applies exact TEAW account to only five missing-owner rows',()=>{
  for(const n of [438,439,440,444,894])assert.equal(row(n).ownerUserId,'9c1d670a-1d2a-4996-959c-33c243fd34d8');
  assert.equal(expected.rows.filter(r=>r.actions.includes('source_bound_customer_with_confirmed_owner')).length,5);
});
test('unknown name uses display only with separate source-bound identity and no production UUID',()=>{
  assert.equal(row(680).unknownNameDisplay,'ไม่ทราบ');assert.equal(row(680).customerId,null);
  assert.equal(new Set(expected.rows.filter(r=>r.customerCandidateKey).map(r=>r.customerCandidateKey)).size,6);
  assert.equal(expected.newCandidateIdsAreProductionIds,false);
});
test('ten unknown projects create no project or Interest identifier, including corrected row 275',()=>{
  const rows=expected.rows.filter(r=>r.unknownProjectDisplay);assert.equal(rows.length,10);assert(rows.every(r=>r.projectName===null&&r.interestId===null&&r.interestCandidateKey===null));
  assert.equal(row(275).unknownProjectDisplay,'ไม่ทราบ');assert.equal(row(27).unknownProjectDisplay,null);
});
test('first-project selections follow reviewed source order and use existing Interest IDs',()=>{
  assert.deepEqual([688,787,884,885,908,949].map(n=>row(n).projectName),['โยริว','ไอลิน 3','ไอลิน 4','ไอลิน6','ไอลิน 4','ไอลิน6']);
  assert([688,787,884,885,908,949].every(n=>row(n).interestId&&row(n).interestCandidateKey===null));
});
test('AL4-67 correction is a visit reference; unknown booking is historical evidence',()=>{
  assert.equal(row(642).plotId,'ไอลิน 4-67');assert.equal(row(642).sourceStage,'visited');
  assert.equal(row(171).unknownBookingDisplay,'ไม่ทราบ');assert.equal(row(171).plotId,null);
  assert.equal(row(171).sourceHistory.at(-1).kind,'cancelled');
});
test('unknown visit day remains unknown, source date-review issue retained',()=>{
  assert.equal(row(885).sourceHistory[0].date,null);assert.equal(row(885).sourceHistory[0].precision,'unknown');
  assert(row(885).sourceIssuesRetained.includes('VISIT_DATE_REVIEW'));
});
test('unproven new people remain held and no Lost or live write is allowed',()=>{
  assert.deepEqual(expected.rows.filter(r=>r.disposition==='held').map(r=>r.sourceRow),[967,968,970,971,972,973,974,975,976,977,978,979,980]);
  assert.equal(expected.businessWritesAllowed,false);assert.equal(expected.lostChangesAllowed,false);
});
test('file bytes differ while all approved source row hashes still match',()=>{
  assert.notEqual(expected.sourceSha256,expected.previousSourceSha256);assert.equal(expected.sourceContentContinuity.changedSourceRows,0);
});
test('altered cell content or extra customer row cannot inherit source approvals',()=>{
  const f=structuredClone(original);f.extraction.rows[0].values[15]='2030-01-01';assert.throws(()=>prepareCustomerResolutionPlan(f),/SOURCE_CONTENT_CHANGED/);
  const extra=structuredClone(original);extra.extraction.rows.find(r=>r.rowNumber===981).values=structuredClone(extra.extraction.rows[0].values);
  assert.throws(()=>prepareCustomerResolutionPlan(extra),/SOURCE_CONTENT_CHANGED/);
});
test('unconfirmed owner alias or wrong account rejected even if receipt resealed',()=>{
  for(const change of [r=>r.ownerAccountConfirmed=false,r=>r.ownerLogin='TAEW',r=>r.ownerUserId='ffffffff-ffff-4fff-8fff-ffffffffffff']){
    const f=structuredClone(original);change(f.receipt);sealReceipt(f);assert.throws(()=>prepareCustomerResolutionPlan(f));
  }
});
test('receipt cannot invent real unknown project/sale or change row scope to 27',()=>{
  for(const change of [r=>r.unknownProjectIsRealProject=true,r=>r.unknownBookingIsRealSale=true,r=>r.groups.unknownProject[9]=27]){
    const f=structuredClone(original);change(f.receipt);sealReceipt(f);assert.throws(()=>prepareCustomerResolutionPlan(f),/RESOLUTION_APPROVAL_REQUIRED/);
  }
});
test('stale reference data and unreviewed plot cannot pass pinned decisions',()=>{
  const f=structuredClone(original);f.reference.roles[0].isActive=false;assert.throws(()=>prepareCustomerResolutionPlan(f),/PINNED_REFERENCE_CHANGED/);
  const p=structuredClone(original);p.receipt.correctedPlotId='ไอลิน 4-97';sealReceipt(p);assert.throws(()=>prepareCustomerResolutionPlan(p),/EXACT_CORRECTED_PLOT_REQUIRED/);
});
test('read-only current workbook bytes unchanged after source checks',()=>assert(readFileSync(workspacePath(options.source)).equals(sourceBytes)));
