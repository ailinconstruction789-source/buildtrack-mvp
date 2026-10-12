// Read-only actual-source parity and receipt checks; not synthetic fixture tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractWorkbook,workspacePath } from './review-workbook.mjs';
import { prepareCombinedCustomerPlan } from './plan-combined-customers.mjs';
import { prepareTransferForecastPlan } from './plan-transfer-forecasts.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const options=JSON.parse(readFileSync(workspacePath('reports/customer-combined-plan-options-2026-10-10.json')));
const keys=['plan','reconciliation','confirmation','plotConfirmation','revisionConfirmation','reference','catalog','forecastPlan'];
const original=Object.fromEntries(keys.map(key=>[key,JSON.parse(readFileSync(workspacePath(options[key])))]));
original.extraction=extractWorkbook({python:options.python,source:workspacePath(options.source),sourceSha256:original.plan.sourceSha256,inspectionDate:original.plan.inspectionDate});
const saved=JSON.parse(readFileSync(workspacePath(options.output)));
test('all actual rows reproduce the sealed combined plan exactly',()=>{
  assert.deepEqual(prepareCombinedCustomerPlan(original),saved);
});
test('all seven existing approved revisions and one new proposal use exact confirmed IDs',()=>{
  const rows=saved.rows.filter(r=>r.disposition!=='held'&&r.action==='propose_existing_booking_revision');
  assert.deepEqual(rows.map(r=>r.sourceRow),[706,881,926,937,939,944,952]);
  assert.deepEqual(saved.rows.filter(r=>r.disposition!=='held'&&r.newBookingCandidateKey).map(r=>r.sourceRow),[964]);
});
test('all physical P forecasts and unknown prices preserve their stated policies',()=>{
  assert.equal(saved.rows.filter(r=>r.expectedTransferDate!==null).length,46);
  assert(saved.rows.every(r=>r.forecastPolicy===(r.expectedTransferDate===null?'unknown_preserve_existing':'per_booking_forecast')));
  assert(saved.rows.filter(r=>r.salePrice===null).every(r=>r.pricePolicy==='unknown_preserve_existing'));
});
test('an altered forecast plan cannot be reused',()=>{
  const f=structuredClone(original);f.forecastPlan.rows[0].expectedTransferDate='2030-01-01';assert.throws(()=>prepareCombinedCustomerPlan(f),/FORECAST_PLAN_CHANGED/);
});
test('changed source content or confirmation seal cannot pass as the approved workbook',()=>{
  const f=structuredClone(original);f.extraction.rows[0].values[15]='2030-01-01';assert.throws(()=>prepareCombinedCustomerPlan(f),/SOURCE_ROW_CHANGED/);
  const altered=structuredClone(original);altered.revisionConfirmation.mappings[0].sourceSalePrice=1;assert.throws(()=>prepareCombinedCustomerPlan(altered),/PINNED_INPUT_DIGEST_REQUIRED/);
});
test('distinct confirmed people cannot share a canonical Customer ID',()=>{
  const f=structuredClone(original),parts=f.reconciliation.partitions.filter(p=>p.proposedCustomerId);
  parts[1].proposedCustomerId=parts[0].proposedCustomerId;
  delete f.reconciliation.reconciliationDigest;f.reconciliation.reconciliationDigest=digest(f.reconciliation);
  f.forecastPlan=prepareTransferForecastPlan(f);
  assert.throws(()=>prepareCombinedCustomerPlan(f),/DISTINCT_PEOPLE_SHARE_CUSTOMER/);
});
test('read-only actual source bytes remain identical after the checks',()=>{
  assert.equal(createHash('sha256').update(readFileSync(workspacePath(options.source))).digest('hex'),original.plan.sourceSha256);
});
