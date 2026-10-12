import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wrapOwnerReplacementTransaction,metadataReadSql,prepareOwnerReplacementJob,
 prepareOwnerReplacementRestore,registerOwnerReplacementJob,installReplacementOwnerOperator,
 assertOwnerReplacementNativeBarriers,assertFinishedOwnerJobCannotReplay} from './full-replacement-owner-job.mjs';
const reviewer='10000000-0000-4000-8000-000000000001',jobId='20000000-0000-4000-8000-000000000002';
const payloadSha256='a'.repeat(64),runId='30000000-0000-4000-8000-000000000003';
const registered={jobId,payloadSha256};
const transaction="-- source fixture\nBEGIN; SET LOCAL timezone='UTC'; CREATE TEMP TABLE full_replacement_result(value jsonb); DO $x$ BEGIN x:='COMMIT; BEGIN;'; /* COMMIT; */ END; $x$; INSERT INTO full_replacement_result VALUES('{}'); COMMIT; SELECT value FROM full_replacement_result;";
test('owner wrapper preserves business SQL and locates the actual outer commit',()=>{
 const out=wrapOwnerReplacementTransaction({transactionSql:transaction,...registered});
 assert.equal(out.match(/SELECT sales_operator_private.begin_job/g).length,1);
 assert.equal(out.match(/PERFORM sales_operator_private.finish_job/g).length,1);
 assert.ok(out.indexOf('finish_job')>out.indexOf("INSERT INTO full_replacement_result"));
 assert.ok(out.endsWith('COMMIT; SELECT value FROM full_replacement_result;'));
 const restored=out.replace(/\nSELECT sales_operator_private.begin_job[^\n]*\n/,'').replace(/\nDO \$owner_job_finish\$[^\n]*\n/,'');
 assert.equal(restored,transaction);
 assert.match(out,/FROM pg_temp\."full_replacement_result"/);
});
test('wrapper refuses extra commits, writes after commit and result SQL injection',()=>{
 for(const sql of ['BEGIN; COMMIT; BEGIN; COMMIT;','BEGIN; SELECT 1; COMMIT; UPDATE public.sales SET a=1;','SELECT 1;','BEGIN; SELECT 1; ROLLBACK;'])assert.throws(()=>wrapOwnerReplacementTransaction({transactionSql:sql,...registered}));
 assert.throws(()=>wrapOwnerReplacementTransaction({transactionSql:transaction,...registered,resultRelation:'x); DELETE'}),/IDENTIFIER/);
});
test('owner helpers reject fake claims and Auth identity writes',()=>{
 for(const sql of ["BEGIN; SELECT set_config('request.jwt.claims','{}',true); COMMIT;",'BEGIN; INSERT INTO auth.sessions(id) VALUES(1); COMMIT;','BEGIN; CREATE OR REPLACE FUNCTION public.crm_v2_role() RETURNS text AS $$SELECT 1$$ LANGUAGE sql; COMMIT;'])assert.throws(()=>wrapOwnerReplacementTransaction({transactionSql:sql,...registered}),/IMPERSONATION/);
});
test('metadata reads unwrap the existing empty-actor transaction with quoted semicolons',()=>{
 const out=metadataReadSql("BEGIN; SELECT jsonb_build_object('x','BEGIN; COMMIT;'); COMMIT;",reviewer);
 assert.equal(out.match(/begin_metadata/g).length,1);assert.equal(out.match(/finish_metadata/g).length,1);
 assert.ok(out.includes("SELECT jsonb_build_object('x','BEGIN; COMMIT;');"));
 assert.throws(()=>metadataReadSql('WITH x AS (DELETE FROM public.sales RETURNING *) SELECT * FROM x;',reviewer),/READ_ONLY/);
 assert.throws(()=>metadataReadSql('BEGIN; SELECT 1; COMMIT; SELECT 2;',reviewer),/POST_COMMIT/);
});
const plan=()=>{const approved=JSON.parse(readFileSync('reports/full-customer-replacement-inputs-2026-10-10.json','utf8'));return {
 mainSql:transaction,payload:{preparedPayloadDigest:'d'.repeat(64),creation:{records:[]},unknown:{records:[]},details:{records:[]},lifecycle:{records:[]},membership:{sourceSha256:approved.sourceSha256,reviewSha256:approved.reviewSha256,adapterPlanDigest:approved.adapterPlanDigest,originalSourceBatchIds:['5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5'],records:Array.from({length:958},(_,n)=>({sourceRow:n+2}))}},retirementManifest:{records:[]},retirement:{records:[]}};};
test('preparation registers exact JSONB digest and forwards no synthetic identity',async()=>{
 const calls=[];let seen;
 const query=async sql=>{calls.push(sql);if(sql.includes('preview_state'))return 'b'.repeat(64);if(sql.includes('register_job'))return JSON.stringify(registered);return '{"fixture":true}';};
 const result=await prepareOwnerReplacementJob({query,prepareExecution:async input=>{seen=input;assert.equal(input.actorSql,'');await input.query('BEGIN; SELECT 1; COMMIT;');return plan();},root:'.',designatedReviewerId:reviewer,reviewReference:'source review',authorizationReference:'User approved replacement',purpose:'owned-fixture'});
 assert.equal(seen.purpose,'owned-fixture');assert.equal(calls.length,3);assert.match(calls[0],/begin_metadata/);
 assert.match(calls[2],/sales_operator_private\.digest\(/);assert.equal(result.manifest.payloads.membership.records.length,958);
 assert.equal(result.operationalIdentitySynthetic,false);assert.equal(result.executed,false);assert.equal(result.rawPersonalDataIncluded,true);
 assert.match(result.mainSql,/begin_job/);assert.match(result.mainSql,/finish_job/);
});
test('registration refuses invalid returned job identity',async()=>{
 await assert.rejects(()=>registerOwnerReplacementJob({query:async()=>JSON.stringify({jobId:'wrong',payloadSha256}),manifest:{}}),/REGISTRATION_RESULT/);
});
test('compensation gets a distinct approved restore manifest and atomic owner receipt',async()=>{
 const apply=(await prepareOwnerReplacementJob({query:async sql=>sql.includes('preview_state')?'b'.repeat(64):JSON.stringify(registered),prepareExecution:async()=>plan(),designatedReviewerId:reviewer,authorizationReference:'Approved apply',reviewReference:'Apply'})).manifest;
 const queries=[];
 const result=await prepareOwnerReplacementRestore({query:async sql=>{queries.push(sql);return sql.includes('preview_state')?'c'.repeat(64):JSON.stringify(registered);},approvedApplyManifest:apply,recoveryRunId:runId,authorizationReference:'Approved compensation rehearsal',reviewReference:'Restore'});
 assert.equal(result.manifest.mode,'restore');assert.equal(result.manifest.beforeStateHash,'c'.repeat(64));assert.equal(result.manifest.recoveryRunId,runId);
 assert.match(result.mainSql,/restore_run/);assert.match(result.mainSql,/finish_job/);assert.equal(result.executed,false);assert.equal(queries.length,2);
});
test('production installation never strips a design sentinel implicitly',async()=>{
 let calls=0;await assert.rejects(()=>installReplacementOwnerOperator({query:async()=>{calls++;},captureCatalog:async()=>({functions:[]}),recoveryBundleSql:'SELECT 1;',designatedReviewerId:reviewer,purpose:'production-owner'}),/PRODUCTION_REVIEWED_INSTALL/);assert.equal(calls,0);
});
test('native negatives are isolated, expect the specific SQL33 failure and prove parity',async()=>{
 const calls=[];const query=async sql=>{calls.push(sql);if(sql.includes("current_database() ~"))return 't';if(sql.includes('preview_state'))return 'b'.repeat(64);if(sql.includes('SET LOCAL ROLE'))throw Error('permission denied for schema sales_operator_private');if(sql.includes('begin_metadata'))throw Error('CUSTOMER_OPERATOR_SCOPE_FORBIDDEN');if(sql.includes("apply_reviewed('{}'"))throw Error('CUSTOMER_OPERATOR_EXACT_PAYLOAD_REQUIRED');throw Error('CUSTOMER_OPERATOR_WHOLE_TRANSACTION_NOT_FINISHED');};
 const result=await assertOwnerReplacementNativeBarriers({query,designatedReviewerId:reviewer,...registered});assert.equal(result.passed,4);assert.equal(result.beforeStateHash,result.afterStateHash);
 await assert.rejects(()=>assertOwnerReplacementNativeBarriers({query:async()=> 'f',designatedReviewerId:reviewer,...registered}),/OWNED_LOOPBACK/);
 assert.equal(calls.length,7);
});
test('finished owner job cannot be replayed or silently treated as a second write',async()=>{
 const result=await assertFinishedOwnerJobCannotReplay({query:async sql=>{if(sql.includes('current_database'))return 't';throw Error('CUSTOMER_OPERATOR_JOB_REPLAY_OR_DRIFT');},...registered});assert.equal(result.passed,1);
 await assert.rejects(()=>assertFinishedOwnerJobCannotReplay({query:async sql=>sql.includes('current_database')?'t':'',...registered}),/REPLAY_MUST_FAIL/);
});
