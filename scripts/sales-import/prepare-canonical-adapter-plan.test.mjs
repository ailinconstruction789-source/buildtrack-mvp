import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareCanonicalAdapterPlan,prepareUnknownHistoryPayload } from './prepare-canonical-adapter-plan.mjs';
const base=JSON.parse(readFileSync('reports/customer-combined-plan-2026-10-10.json'));
const resolution=JSON.parse(readFileSync('reports/customer-resolution-plan-2026-10-10.json'));
const plan=prepareCanonicalAdapterPlan({base,resolution}),rows=route=>plan.rows.filter(r=>r.route===route).map(r=>r.sourceRow);
const reseal=p=>{delete p.resolutionPlanDigest;p.resolutionPlanDigest=createHash('sha256').update(JSON.stringify(p)).digest('hex');};
test('all979 source rows routed once; no ready/executable claim',()=>{
 assert.equal(plan.rows.length,979);assert.equal(new Set(plan.rows.map(r=>r.sourceRow)).size,979);
 assert(plan.rows.every(r=>r.executable===false));assert.equal(plan.canonicalImportReady,false);assert.equal(plan.freshCaptureIncluded,false);
});
test('five existing unchanged-stage sales map to exact price and P-date patches',()=>{
 assert.deepEqual(rows('reviewed_details_candidate'),[706,881,937,939,952]);
 assert.deepEqual(plan.rows.filter(r=>r.patch).map(r=>r.patch.salePriceSatang),[522800000,279300000,318200000,418400000,208000000]);
 assert.deepEqual(plan.rows.filter(r=>r.patch).map(r=>r.patch.expectedTransferDate),['2026-10-30','2026-10-29','2026-10-30','2026-10-30','2026-10-30']);
 assert(plan.rows.filter(r=>r.patch).every(r=>!('bankName' in r.patch)&&r.requiredChecks.includes('fresh_exact_sale_before_image')));
});
test('both historical cancellations held from details importer, new booking separate',()=>{
 assert.deepEqual(rows('historical_lifecycle_review'),[926,944]);assert.deepEqual(rows('historical_booking_review'),[964]);
 assert([926,944,964].every(n=>plan.rows.find(r=>r.sourceRow===n).patch===null));
});
test('unknown history binds existing Customers without fake sale or unknown project',()=>{
 assert.deepEqual(rows('unknown_history_evidence'),[171,237,238,239,249,250,256,257,263,274,275]);
 assert(plan.rows.filter(r=>r.route==='unknown_history_evidence').every(r=>r.customerId&&r.saleId===null&&r.plotId===null));
 assert(plan.rows.filter(r=>r.unknownProjectDisplay).every(r=>r.projectName===null&&r.interestId===null));
});
test('SQL25 payload preserves all 13 actual source events across 11 rows with explicit UUIDs',()=>{
 const p=prepareUnknownHistoryPayload({base,resolution});assert.equal(p.records.length,11);
 assert.equal(p.records.reduce((n,r)=>n+r.events.length,0),13);
 assert.deepEqual(p.records.find(r=>r.rowNumber===171).events.map(e=>[e.kind,e.date]),[['visited','2023-03-14'],['booked','2023-03-14'],['cancelled','2024-07-25']]);
 assert.equal(p.snapshotSha256,resolution.sourceSha256);assert.equal(p.businessWritesAllowed,false);
 assert(p.records.every(r=>r.saleId===null&&r.customerId));
});
test('six candidate source keys remain keys, never generated production UUIDs',()=>{
 assert.deepEqual(rows('source_bound_creation_review'),[438,439,440,444,680,894]);
 assert(plan.rows.filter(r=>r.route==='source_bound_creation_review').every(r=>r.customerCandidateKey&&r.customerId===null&&r.interestId===null));
});
test('eight rentals skipped, thirteen unproven people held with no patch',()=>{
 assert.deepEqual(rows('skip_rental'),[859,951,954,958,959,960,961,969]);
 assert.deepEqual(rows('hold_identity'),[967,968,970,971,972,973,974,975,976,977,978,979,980]);
});
test('changed sealed decision rejected',()=>{
 const p=structuredClone(resolution);p.rows[0].customerId=null;
 assert.throws(()=>prepareCanonicalAdapterPlan({base,resolution:p}),/SEALED_RESOLUTION_REQUIRED/);
});
test('row coverage loss rejected even with new outer seal',()=>{
 const p=structuredClone(resolution);p.rows.pop();reseal(p);
 assert.throws(()=>prepareCanonicalAdapterPlan({base,resolution:p}),/COMPLETE_SOURCE_COVERAGE_REQUIRED/);
});
test('source row hash change rejected even with new outer seal',()=>{
 const p=structuredClone(resolution);p.rows[0].rowSha256='0'.repeat(64);reseal(p);
 assert.throws(()=>prepareCanonicalAdapterPlan({base,resolution:p}),/SOURCE_BINDING_CHANGED/);
});
