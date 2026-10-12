import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {createFileSqlBridge,prepareProductionBridge,applyProductionBridge} from '../production-replacement-bridge.mjs';
const runId='18000000-0000-4000-8000-000000000001',jobId='18000000-0000-4000-8000-000000000002',recoveryId='18000000-0000-4000-8000-000000000003';
const sha=value=>createHash('sha256').update(value).digest('hex');
function owned(t){const base=mkdtempSync(join(tmpdir(),'buildtrack-bridge-test-'));const resolved=realpathSync(base);t.after(()=>{const rel=relative(realpathSync(tmpdir()),resolved);assert.ok(rel&&!rel.startsWith('..')&&resolved.includes('buildtrack-bridge-test-'));rmSync(resolved,{recursive:true,force:true});});return resolved;}
function respond(meta,result,{error,hash}={}){writeFileSync(meta.responsePath,JSON.stringify({requestId:meta.requestId,requestSha256:hash??meta.requestSha256,status:error?'error':'ok',...(error?{code:error,message:'Private name and SQL must never be logged'}:{result})}));}
const plan=()=>({executed:false,operationalIdentitySynthetic:false,jobId,payloadSha256:'a'.repeat(64),mainSql:'BEGIN; SELECT 1; COMMIT;',manifest:{review:'owned fixture'},payload:{membership:{records:Array.from({length:958},(_,sourceRow)=>({sourceRow}))}}});
test('sequential correlated requests preserve scalar and JSON results without executing SQL',async t=>{
 const notifications=[],query=createFileSqlBridge({directory:join(owned(t),'queries'),notify:meta=>{notifications.push(meta);respond(meta,meta.requestId==='001'?'t':{count:958});}});
 assert.equal(await query('SELECT true;'),'t');assert.deepEqual(await query('SELECT 958;'),{count:958});
 assert.equal(notifications.length,2);assert.ok(notifications.every(value=>!Object.hasOwn(value,'sql')));
 assert.equal(JSON.parse(readFileSync(notifications[0].requestPath,'utf8')).sql,'SELECT true;');
});
test('rejects mismatched response hash rather than substituting stale data',async t=>{
 const query=createFileSqlBridge({directory:join(owned(t),'queries'),notify:meta=>respond(meta,'old',{hash:'b'.repeat(64)})});
 await assert.rejects(query('SELECT 1;'),/BRIDGE_RESPONSE_CORRELATION_REQUIRED/);
});
test('explicit remote failure exposes safe code only',async t=>{
 const query=createFileSqlBridge({directory:join(owned(t),'queries'),notify:meta=>respond(meta,null,{error:'FULL_REPLACEMENT_CAPTURE_DRIFT'})});
 await assert.rejects(query('SELECT 1;'),error=>error.message==='FULL_REPLACEMENT_CAPTURE_DRIFT'&&!error.message.includes('Private'));
});
test('response requires explicit success or failure',async t=>{
 const query=createFileSqlBridge({directory:join(owned(t),'queries'),notify:meta=>writeFileSync(meta.responsePath,JSON.stringify({requestId:meta.requestId,requestSha256:meta.requestSha256,result:1}))});
 await assert.rejects(query('SELECT 1;'),/BRIDGE_RESPONSE_STATUS_REQUIRED/);
});
test('finite timeout leaves original request for explicit outcome investigation',async t=>{
 let requestPath;const query=createFileSqlBridge({directory:join(owned(t),'queries'),timeoutMs:15,pollMs:5,notify:meta=>{requestPath=meta.requestPath;}});
 await assert.rejects(query('SELECT 1;'),/BRIDGE_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN/);assert.ok(existsSync(requestPath));
});
test('concurrent calls are rejected before publishing another SQL request',async t=>{
 let meta;const query=createFileSqlBridge({directory:join(owned(t),'queries'),timeoutMs:1000,notify:value=>{meta=value;}});
 const first=query('SELECT 1;');await assert.rejects(query('SELECT 2;'),/BRIDGE_SEQUENTIAL_REQUESTS_REQUIRED/);respond(meta,1);assert.equal(await first,1);
});
test('prepare stores full plan privately and emits only digest paths and counts',async t=>{
 const root=owned(t),notifications=[];
 const summary=await prepareProductionBridge({root,runId,designatedReviewerId:jobId,authorizationReference:'Owned user approval fixture',reviewReference:'Owned review',notify:metadata=>notifications.push(metadata),prepare:async options=>{assert.equal(options.purpose,'production-target');assert.equal(options.designatedReviewerId,jobId);return plan();}});
 assert.equal(summary.executed,false);assert.equal(summary.sourceRows,958);assert.equal(summary.planSha256,sha(readFileSync(summary.planPath)));
 assert.ok(!JSON.stringify(notifications).includes('membership'));assert.ok(!JSON.stringify(notifications).includes('BEGIN'));
});
test('apply requires exact persisted plan digest before any request or intent',async t=>{
 const root=owned(t);await prepareProductionBridge({root,runId,designatedReviewerId:jobId,authorizationReference:'Owned approval',reviewReference:'Owned review',prepare:async()=>plan()});
 await assert.rejects(applyProductionBridge({root,runId,confirmPlanSha256:'b'.repeat(64)}),/BRIDGE_PLAN_DIGEST_MISMATCH/);
 assert.equal(existsSync(join(root,'.local-backups/customer-replacement-2026-10-11/bridge',runId,'apply-intent.json')),false);
});
test('even an explicitly hashed plan cannot introduce synthetic JWT or Auth writes',async t=>{
 const root=owned(t),prepared=await prepareProductionBridge({root,runId,designatedReviewerId:jobId,authorizationReference:'Owned approval',reviewReference:'Owned review',prepare:async()=>plan()});
 const changed=plan();changed.mainSql="BEGIN; SET LOCAL request.jwt.claims='{}'; COMMIT;";
 const content=JSON.stringify(changed);writeFileSync(prepared.planPath,content);
 await assert.rejects(applyProductionBridge({root,runId,confirmPlanSha256:sha(content)}),/BRIDGE_SYNTHETIC_IDENTITY_FORBIDDEN/);
 assert.equal(existsSync(join(root,'.local-backups/customer-replacement-2026-10-11/bridge',runId,'apply-intent.json')),false);
});
test('apply publishes exactly one atomic query and blocks any repeated application',async t=>{
 const root=owned(t),prepared=await prepareProductionBridge({root,runId,designatedReviewerId:jobId,authorizationReference:'Owned approval',reviewReference:'Owned review',prepare:async()=>plan()});
 let calls=0;const result=await applyProductionBridge({root,runId,confirmPlanSha256:prepared.planSha256,notify:meta=>{if(meta.status==='request_ready'){calls++;respond(meta,{runId:recoveryId});}}});
 assert.equal(calls,1);assert.equal(result.postVerificationRequired,true);assert.equal(result.recoveryRunId,recoveryId);
 await assert.rejects(applyProductionBridge({root,runId,confirmPlanSha256:prepared.planSha256}),error=>error.code==='EEXIST');
});
test('timed-out apply cannot retry automatically or erase durable intent',async t=>{
 const root=owned(t),prepared=await prepareProductionBridge({root,runId,designatedReviewerId:jobId,authorizationReference:'Owned approval',reviewReference:'Owned review',prepare:async()=>plan()});
 await assert.rejects(applyProductionBridge({root,runId,confirmPlanSha256:prepared.planSha256,timeoutMs:10}),/BRIDGE_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN/);
 await assert.rejects(applyProductionBridge({root,runId,confirmPlanSha256:prepared.planSha256}),error=>error.code==='EEXIST');
 const intent=JSON.parse(readFileSync(join(root,'.local-backups/customer-replacement-2026-10-11/bridge',runId,'apply-intent.json'),'utf8'));
 assert.equal(intent.state,'outcome_unknown_until_correlated_response');
});
