// Pure SQL preparation tests. No database, runtime, Auth/session or workbook reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFullReplacementTransaction} from './full-customer-replacement.mjs';
function fixture(purpose='production-target'){
 const records=Array.from({length:958},(_,i)=>({sourceRow:i+2,customerId:null,interestId:null,saleId:null,history:[]}));
 return {capture:{purpose,capturedAt:'2026-10-11T00:00:00Z',customers:[],interests:[],sales:[],plots:[],details:[],forecast:[]},
  payload:{purpose,membership:{records},creation:{records:[]},unknown:{records:[]},details:{records:[]},lifecycle:{records:[]},expectedSales:[],preparedPayloadDigest:'a'.repeat(64)},
  source:{personalData:[]},retirementManifest:{records:[]},retirement:{records:Array.from({length:6},()=>({}))},
  flagRows:[{id:true,booking_enabled:false}],flags:{down:'UPDATE public.crm_settings SET booking_enabled=false WHERE id;',restore:''},reviewReference:'Pure reviewed SQL fixture'};
}
test('production target remains production target in the actual full capture query',()=>{
 const {mainSql,bodySql}=buildFullReplacementTransaction(fixture());
 assert.match(mainSql,/'purpose','production-target'/);assert.doesNotMatch(mainSql,/'purpose','owned-fixture'/);
 assert.ok(mainSql.startsWith('BEGIN;'));assert.ok(!bodySql.startsWith('BEGIN;'));
 assert.ok(!bodySql.includes('COMMIT;'));assert.match(bodySql,/SELECT value FROM full_replacement_result;$/);
 assert.doesNotMatch(mainSql,/request.jwt.claim|CREATE (?:SCHEMA|TABLE) auth|INSERT INTO auth\./);
});
test('owned native target is explicit and unsupported or mixed target purposes fail closed',()=>{
 assert.match(buildFullReplacementTransaction(fixture('owned-fixture')).mainSql,/'purpose','owned-fixture'/);
 const invalid=fixture('dev');assert.throws(()=>buildFullReplacementTransaction(invalid),/Explicit actual capture purpose required/);
 const mixed=fixture();mixed.payload.purpose='owned-fixture';assert.throws(()=>buildFullReplacementTransaction(mixed));
});
test('short cohort or short rental selection is refused by pure preparation',()=>{
 const short=fixture();short.payload.membership.records.pop();assert.throws(()=>buildFullReplacementTransaction(short));
 const rental=fixture();rental.retirement.records.pop();assert.throws(()=>buildFullReplacementTransaction(rental));
});
test('actual baseline and flags are rechecked under locks before any business write or journal insertion',()=>{
 const {bodySql}=buildFullReplacementTransaction(fixture());
 const locks=bodySql.indexOf('LOCK TABLE public.sales_customers');
 const captureGate=bodySql.indexOf('FULL_REPLACEMENT_CAPTURE_DRIFT');
 const flagsGate=bodySql.indexOf('FULL_REPLACEMENT_FLAGS_DRIFT');
 const journal=bodySql.indexOf('run_id:=sales_recovery_private.begin_run');
 const write=bodySql.indexOf('UPDATE public.crm_settings SET booking_enabled=false');
 assert.ok(locks>=0&&locks<captureGate&&captureGate<flagsGate&&flagsGate<journal&&journal<write);
 assert.doesNotMatch(bodySql.slice(0,journal),/INSERT INTO (?:public|sales_recovery_private)\./);
});
test('whole changes stay within one DO and only guarded existing writer APIs are used',()=>{
 const {mainSql}=buildFullReplacementTransaction(fixture());
 for(const fn of ['sales_source_creation_private.apply_reviewed','sales_unknown_history_private.persist_evidence','sales_import_private.apply_reviewed_details','sales_revision_private.apply','rental_source_retirement_private.apply','customer_source_membership_private.activate','sales_recovery_private.seal_run'])assert.ok(mainSql.includes(fn));
 assert.equal((mainSql.match(/COMMIT;/g)||[]).length,1);
 assert.ok(mainSql.indexOf('sales_recovery_private.seal_run')<mainSql.indexOf('COMMIT;'));
 assert.doesNotMatch(mainSql,/DISABLE TRIGGER|DROP TRIGGER|session_replication_role|UPDATE public\.sales SET|DELETE FROM public\.sales/);
});
test('intent remains sealed while lifecycle before-images refresh after the price and forecast phase',()=>{
 const {bodySql}=buildFullReplacementTransaction(fixture());
 assert.ok(bodySql.indexOf('sales_import_private.apply_reviewed_details')<bodySql.indexOf("ARRAY['records',ordinal::text,'before']"));
 assert.ok(bodySql.indexOf("ARRAY['records',ordinal::text,'before']")<bodySql.indexOf('revision_result:=sales_revision_private.apply'));
 assert.match(bodySql,/FULL_REPLACEMENT_EFFECTIVE_DEAL_PARITY/);
 assert.match(bodySql,/FULL_REPLACEMENT_ALL42_FORECAST_PARITY/);
 assert.match(bodySql,/FULL_REPLACEMENT_SOURCE_HISTORY_PARITY/);
 assert.match(bodySql,/FULL_REPLACEMENT_APPROVED_SOURCE_NAME_PARITY/);
});
test('caller-provided authority is separated from the transaction body and not invented by builder',()=>{
 const input=fixture();input.actorSql='SELECT private_owner_context_begin();';
 const {mainSql,bodySql}=buildFullReplacementTransaction(input);
 assert.ok(mainSql.startsWith('BEGIN;SELECT private_owner_context_begin();'));
 assert.ok(!bodySql.includes('private_owner_context_begin'));
 assert.doesNotMatch(bodySql,/request.jwt.claim|SET LOCAL ROLE authenticated/);
});
