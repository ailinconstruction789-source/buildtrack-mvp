// Pure validation/occupancy tests; no database connection or workbook content output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateCombinedPlan } from './customer-combined-trial.mjs';
import { holdOccupiedPlots } from '../sales-import/plan-combined-customers.mjs';
const captured = JSON.parse(readFileSync(new URL('../../reports/customer-combined-plan-2026-10-10.json',import.meta.url)));
const seal = plan => { delete plan.combinedPlanDigest; plan.combinedPlanDigest=createHash('sha256').update(JSON.stringify(plan)).digest('hex'); return plan; };
const clone = () => structuredClone(captured);
test('pinned redacted actual combined plan validates and covers every source row', () => {
  assert.equal(validateCombinedPlan(captured),captured);
  assert.deepEqual(captured.counts,{sourceRows:979,candidates:934,heldRows:45,existingBookingRevisions:7,newBookingCandidates:1,bankUpdates:0,syntheticLeads:0});
});
test('rejects changed digest and any attempt to authorize real writes', () => {
  const changed=clone();changed.rows[0].salePrice=1;assert.throws(()=>validateCombinedPlan(changed));
  for(const field of ['businessWritesAllowed','canonicalImportReady','productionChanged','lostChangesAllowed']){
    const p=clone();p[field]=true;assert.throws(()=>validateCombinedPlan(seal(p)));
  }
});
test('rejects extra personal fields even with recalculated seal',()=>{
  const p=clone();p.rows[0].customerName='SYNTHETIC_PERSON';assert.throws(()=>validateCombinedPlan(seal(p)));
});
test('rejects blank-price clear policy or bank inferred from source notes',()=>{
  for(const change of [r=>r.pricePolicy='clear',r=>r.structuredBank='SYNTHETIC_BANK',r=>r.actualTimestamps='2026-10-10T00:00:00Z']){
    const p=clone();change(p.rows[0]);assert.throws(()=>validateCombinedPlan(seal(p)));
  }
});
test('rejects actual history with future or manufactured precision',()=>{
  for(const event of [{kind:'visited',date:'2030-01-01',precision:'day'},{kind:'visited',date:null,precision:'day'},{kind:'visited',date:'2026-02-30',precision:'day'}]){
    const p=clone();p.rows[0].sourceHistory=[event];assert.throws(()=>validateCombinedPlan(seal(p)));
  }
});
test('rejects candidate linked to a different customer, interest or plot',()=>{
  for(const field of ['customerId','interestId','plotId']){
    const p=clone(),r=p.rows.find(r=>r.disposition!=='held'&&r.saleId);r[field]=field==='plotId'?'UNREVIEWED_PLOT':'ffffffff-ffff-4fff-8fff-ffffffffffff';
    assert.throws(()=>validateCombinedPlan(seal(p)));
  }
});
test('rejects a candidate assigned to construction role or inactive Sales',()=>{
  for(const change of [r=>r.role='construction',r=>r.isActive=false]){
    const p=clone(),r=p.rows.find(r=>r.disposition!=='held');change(p.baseline.roles.find(x=>x.userId===r.sourceSalesOwnerUserId));
    assert.throws(()=>validateCombinedPlan(seal(p)));
  }
});
test('rejects source coverage or confirmed identity partitions becoming incomplete',()=>{
  const p=clone();p.identityPartitions.pop();assert.throws(()=>validateCombinedPlan(seal(p)));
  const duplicate=clone();duplicate.rows.push(structuredClone(duplicate.rows[0]));assert.throws(()=>validateCombinedPlan(seal(duplicate)));
});
test('new booking requires existing customer and interest, never a production sale ID',()=>{
  const r=captured.rows.find(r=>r.sourceRow===964);assert.equal(r.saleId,null);assert(r.customerId&&r.interestId&&r.newBookingCandidateKey);
  const p=clone();p.rows.find(r=>r.sourceRow===964).newBookingCandidateKey='f'.repeat(64);assert.throws(()=>validateCombinedPlan(seal(p)));
});
test('held rental and unproven rows remain held, N001 retains two separate sales',()=>{
  assert.equal(captured.rows.find(r=>r.sourceRow===958).disposition,'held');
  assert(captured.rows.filter(r=>r.sourceRow>=967).every(r=>r.disposition==='held'));
  const a=captured.rows.find(r=>r.sourceRow===3),b=captured.rows.find(r=>r.sourceRow===193);
  assert.equal(a.customerId,b.customerId);assert.notEqual(a.saleId,b.saleId);assert.equal(a.sourceStage,'transferred');assert.equal(b.sourceStage,'cancelled');
});
const candidate = (id,plotId,sourceStage='booked') => ({saleId:null,newBookingCandidateKey:id,plotId,sourceStage,holds:[],disposition:'relational_rehearsal_candidate'});
test('synthetic occupancy: transferred and held active bookings still occupy a plot',()=>{
  for(const stage of ['transferred','booked']){
    const rows=[candidate('new','P')];holdOccupiedPlots(rows,[{id:'old',plotId:'P',stage}]);assert.equal(rows[0].disposition,'held');
  }
});
test('synthetic occupancy: cancelled booking releases its plot, another source cancellation frees it atomically',()=>{
  const rows=[candidate('new','P')];holdOccupiedPlots(rows,[{id:'old',plotId:'P',stage:'cancelled'}]);assert.equal(rows[0].disposition,'relational_rehearsal_candidate');
  const cancel={...candidate(null,'P','cancelled'),saleId:'old'};
  const two=[cancel,candidate('new','P')];holdOccupiedPlots(two,[{id:'old',plotId:'P',stage:'booked'}]);assert(two.every(r=>r.disposition!=='held'));
});
test('synthetic occupancy: cancellation that is held cannot free a plot',()=>{
  const rows=[{...candidate(null,'P','cancelled'),saleId:'old',disposition:'held',holds:['EVIDENCE_REQUIRED']},candidate('new','P')];
  holdOccupiedPlots(rows,[{id:'old',plotId:'P',stage:'booked'}]);assert.equal(rows[1].disposition,'held');
});
test('synthetic occupancy: two competing bookings held and duplicate sale targets rejected',()=>{
  const rows=[candidate('a','P'),candidate('b','P')];holdOccupiedPlots(rows,[]);assert(rows.every(r=>r.disposition==='held'));
  const duplicate=[{...candidate(null,'P'),saleId:'same'},{...candidate(null,'Q'),saleId:'same'}];
  assert.throws(()=>holdOccupiedPlots(duplicate,[]),/DUPLICATE_BOOKING_TARGET/);
});
