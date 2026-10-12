import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadRemainingSourceInputs,bindRemainingLifecycleInputs} from './prepare-remaining-canonical-inputs.mjs';
const input=loadRemainingSourceInputs();
const captured=()=>input.lifecycle.map(r=>({sourceRow:r.sourceRow,before:{
 customer:{id:r.customerId,merged_into_customer_id:null},interest:{id:r.interestId,customer_id:r.customerId,project_name:r.projectName},
 plot:{id:r.plotId,project_name:r.projectName},sale:r.saleId?{id:r.saleId,project_interest_id:r.interestId,plot_id:r.plotId,crm_stage:'booked'}:null,
 inventory:r.saleId?[{id:r.saleId,project_interest_id:r.interestId,plot_id:r.plotId,crm_stage:'booked'}]:[],details:null,forecast:null}}));
test('rechecks full actual workbook and all approved inputs, six source identities only',()=>{
 assert.deepEqual(input.creation.records.map(r=>r.sourceRow),[438,439,440,444,680,894]);
 assert.equal(new Set(input.creation.records.map(r=>r.customerCandidateKey)).size,6);
 assert.equal(new Set(input.creation.records.map(r=>r.interestCandidateKey)).size,6);
 assert(input.creation.records.every(r=>!('customerId' in r)&&!('interestId' in r)&&!('leadId' in r)));
});
test('missing owner uses confirmed TEAW; missing name explicit unknown on one independent source identity',()=>{
 assert(input.creation.records.filter(r=>r.sourceRow!==680).every(r=>r.ownerUserId==='9c1d670a-1d2a-4996-959c-33c243fd34d8'));
 const unknown=input.creation.records.find(r=>r.sourceRow===680);
 assert.equal(unknown.customerName,'ไม่ทราบ');assert.equal(unknown.unknownName,true);
 assert.equal(unknown.ownerUserId,'28a2248a-6636-4d5f-8aeb-1b588da0d48f');
});
test('saved manifest removes actual customer names and retains approved history and hashes',()=>{
 assert(input.redacted.creation.records.every(r=>!('customerName' in r)&&r.customerNameHash.length===64));
 assert.equal(input.redacted.rawPersonalDataIncluded,false);
 assert.equal(input.redacted.creation.records.find(r=>r.sourceRow===680).unknownNameDisplay,'ไม่ทราบ');
 assert.equal(input.redacted.coverage.skip_rental,8);assert.equal(input.redacted.coverage.hold_identity,13);
});
test('remaining lifecycle has exact cancellations and per-sale P forecast for new booking',()=>{
 assert.deepEqual(input.lifecycle.map(r=>[r.sourceRow,r.operation,r.salePriceSatang,r.expectedTransferDate]),[
 [926,'cancel',327400000,null],[944,'cancel',365000000,null],[964,'create_booking',264300000,'2026-10-30']]);
 assert.deepEqual(input.lifecycle[0].events.map(e=>[e.kind,e.date]),[['visited','2026-08-23'],['booked','2026-09-03'],['cancelled','2026-10-07']]);
 assert(input.lifecycle.every(r=>r.freshBeforeImage===null&&r.executable===false&&r.actualTimestamps===null));
});
test('binding uses exact UUIDs and full snapshots, new Sale UUID stays null until guarded apply',()=>{
 const p=bindRemainingLifecycleInputs({redacted:input.redacted,captures:captured()});
 assert.equal(p.records.length,3);assert.equal(p.records[2].binding.saleId,null);
 assert.deepEqual(p.records[2].history,input.lifecycle[2].events);
 assert.equal(p.records[2].patch.expectedTransferDate,'2026-10-30');
});
for(const [label,mutate,pattern] of [
 ['missing capture',c=>c.pop(),/COMPLETE_FRESH_CAPTURE/],
 ['duplicate capture',c=>c[2]=structuredClone(c[0]),/COMPLETE_FRESH_CAPTURE/],
 ['wrong Customer',c=>c[0].before.customer.id=c[1].before.customer.id,/CAPTURE_BINDING/],
 ['merged Customer',c=>c[0].before.customer.merged_into_customer_id=c[1].before.customer.id,/CAPTURE_BINDING/],
 ['wrong Interest project',c=>c[0].before.interest.project_name='not-approved',/CAPTURE_BINDING/],
 ['missing details before-image',c=>delete c[1].before.details,/COMPLETE_FRESH_CAPTURE/],
 ['missing full plot inventory',c=>c[0].before.inventory=[],/SALE_BEFORE_IMAGE/],
 ['unexpected new booking existing Sale',c=>c[2].before.sale=c[0].before.sale,/SALE_BEFORE_IMAGE/],
 ['stock entries from another plot',c=>c[0].before.inventory[0].plot_id='another',/PLOT_INVENTORY/],
 ['operationally advanced cancellation',c=>c[0].before.sale.crm_stage='contracted',/SALE_BEFORE_IMAGE/]
])test(label+' rejected before any SQL',()=>{const c=captured();mutate(c);assert.throws(()=>bindRemainingLifecycleInputs({redacted:input.redacted,captures:c}),pattern);});
test('altered source approval cannot be rebound',()=>{
 const p=structuredClone(input.redacted);p.lifecycle[0].salePriceSatang++;
 assert.throws(()=>bindRemainingLifecycleInputs({redacted:p,captures:captured()}),/SEALED_SOURCE_INPUTS/);
});
