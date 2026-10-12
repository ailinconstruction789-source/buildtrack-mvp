// Filesystem handoff only. Root executes each reviewed SQL request through its
// authorized database tool and supplies a correlated explicit response.
import {mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareOwnerReplacementJob} from './full-replacement-owner-job.mjs';
import {prepareFullReplacementExecution} from './full-customer-replacement.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value,code) => {if (!value) throw Error(code);};
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,100}$/.test(value) ? value : 'BRIDGE_REMOTE_QUERY_FAILED';
const write = (path,value) => writeFileSync(path,JSON.stringify(value),{flag:'wx',mode:0o600});
const wait = milliseconds => new Promise(resolveWait=>setTimeout(resolveWait,milliseconds));
function assertNoSyntheticIdentity(sql) {
  need(!/request\s*\.\s*jwt|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+auth\s*\.|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:auth\s*\.|public\s*\.\s*crm_v2_role)/i.test(sql),'BRIDGE_SYNTHETIC_IDENTITY_FORBIDDEN');
}

/** Sequential request producer. No SQL execution, connection or credentials. */
export function createFileSqlBridge({directory,timeoutMs=600000,pollMs=100,notify=()=>{},signal}) {
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=3600000,'BRIDGE_TIMEOUT_REQUIRED');
  need(Number.isSafeInteger(pollMs)&&pollMs>0&&pollMs<=1000,'BRIDGE_POLL_REQUIRED');
  mkdirSync(directory,{recursive:true});
  need(readdirSync(directory).length===0,'BRIDGE_NEW_REQUEST_DIRECTORY_REQUIRED');
  let ordinal=0,pending=false;
  return async sql => {
    need(typeof sql==='string'&&sql.trim(),'BRIDGE_SQL_REQUIRED');
    need(!pending,'BRIDGE_SEQUENTIAL_REQUESTS_REQUIRED');pending=true;
    try {
      ordinal++; const requestId=String(ordinal).padStart(3,'0'),requestSha256=hash(sql);
      const requestPath=join(directory,`request-${requestId}.json`),responsePath=join(directory,`response-${requestId}.json`);
      write(requestPath,{requestId,requestSha256,sql});
      notify({status:'request_ready',requestId,requestSha256,requestPath,responsePath});
      const deadline=Date.now()+timeoutMs;
      while(!existsSync(responsePath)) {
        need(!signal?.aborted,'BRIDGE_ABORTED_OUTCOME_UNKNOWN');
        need(Date.now()<deadline,'BRIDGE_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN');
        await wait(Math.min(pollMs,Math.max(1,deadline-Date.now())));
      }
      let response;
      try {response=JSON.parse(readFileSync(responsePath,'utf8'));}catch {throw Error('BRIDGE_RESPONSE_INVALID_JSON');}
      need(response&&response.requestId===requestId&&response.requestSha256===requestSha256,'BRIDGE_RESPONSE_CORRELATION_REQUIRED');
      need(['ok','error'].includes(response.status),'BRIDGE_RESPONSE_STATUS_REQUIRED');
      if(response.status==='error')throw Error(safeCode(response.code));
      need(Object.hasOwn(response,'result'),'BRIDGE_RESPONSE_RESULT_REQUIRED');
      return response.result;
    } finally {pending=false;}
  };
}

function scopedRunDirectory(root,runId) {
  need(uuid(runId),'BRIDGE_RUN_UUID_REQUIRED');
  const workspace=realpathSync(root),base=resolve(workspace,'.local-backups/customer-replacement-2026-10-11/bridge');
  mkdirSync(base,{recursive:true});
  const resolvedBase=realpathSync(base),rel=relative(workspace,resolvedBase);
  need(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'BRIDGE_PRIVATE_PATH_SCOPE_REQUIRED');
  const ignorePath=join(base,'.gitignore');
  if(!existsSync(ignorePath))writeFileSync(ignorePath,'*\n',{flag:'wx',mode:0o600});
  need(readFileSync(ignorePath,'utf8').trim()==='*','BRIDGE_PRIVATE_IGNORE_REQUIRED');
  const directory=join(base,runId);mkdirSync(directory,{recursive:true});
  need(realpathSync(directory)===directory,'BRIDGE_PRIVATE_PATH_SCOPE_REQUIRED');
  return directory;
}

export async function prepareProductionBridge({root,runId,designatedReviewerId,authorizationReference,reviewReference,timeoutMs,notify=()=>{},prepare=prepareOwnerReplacementJob}) {
  need(uuid(designatedReviewerId),'BRIDGE_REVIEWER_UUID_REQUIRED');
  need(typeof authorizationReference==='string'&&authorizationReference.trim()&&typeof reviewReference==='string'&&reviewReference.trim(),'BRIDGE_REVIEW_REFERENCES_REQUIRED');
  const directory=scopedRunDirectory(root,runId);
  need(!existsSync(join(directory,'plan.json')),'BRIDGE_PLAN_ALREADY_PREPARED');
  const query=createFileSqlBridge({directory:join(directory,'prepare'),timeoutMs,notify});
  const report={sources:{},results:{}};
  const plan=await prepare({query,prepareExecution:prepareFullReplacementExecution,root,report,designatedReviewerId,authorizationReference,reviewReference,purpose:'production-target'});
  need(plan?.executed===false&&plan.operationalIdentitySynthetic===false&&plan.payload?.membership?.records?.length===958&&uuid(plan.jobId)&&digest(plan.payloadSha256)&&typeof plan.mainSql==='string','BRIDGE_COMPLETE_REGISTERED_PLAN_REQUIRED');
  assertNoSyntheticIdentity(plan.mainSql);
  const planText=JSON.stringify(plan),planSha256=hash(planText),planPath=join(directory,'plan.json'),manifestPath=join(directory,'manifest.json');
  writeFileSync(planPath,planText,{flag:'wx',mode:0o600});write(manifestPath,plan.manifest);
  write(join(directory,'preparation-report.json'),report);
  const summary={status:'prepared',runId,jobId:plan.jobId,payloadSha256:plan.payloadSha256,planSha256,planPath,manifestPath,sourceRows:958,executed:false};
  write(join(directory,'prepared.json'),summary);notify(summary);return summary;
}

export async function applyProductionBridge({root,runId,confirmPlanSha256,timeoutMs,notify=()=>{}}) {
  need(digest(confirmPlanSha256),'BRIDGE_EXPLICIT_PLAN_SHA256_REQUIRED');
  const directory=scopedRunDirectory(root,runId),planPath=join(directory,'plan.json'),bytes=readFileSync(planPath);
  need(hash(bytes)===confirmPlanSha256,'BRIDGE_PLAN_DIGEST_MISMATCH');
  let plan;try {plan=JSON.parse(bytes.toString('utf8'));}catch {throw Error('BRIDGE_PLAN_JSON_REQUIRED');}
  need(plan?.executed===false&&plan.operationalIdentitySynthetic===false&&plan.payload?.membership?.records?.length===958&&uuid(plan.jobId)&&digest(plan.payloadSha256)&&typeof plan.mainSql==='string','BRIDGE_COMPLETE_REGISTERED_PLAN_REQUIRED');
  assertNoSyntheticIdentity(plan.mainSql);
  // This exclusive durable intent remains after errors and timeouts. Root must
  // inspect the immutable job/journal before making any further decision.
  write(join(directory,'apply-intent.json'),{runId,jobId:plan.jobId,planSha256:confirmPlanSha256,querySha256:hash(plan.mainSql),state:'outcome_unknown_until_correlated_response'});
  const query=createFileSqlBridge({directory:join(directory,'apply'),timeoutMs,notify});
  const result=await query(plan.mainSql);write(join(directory,'apply-result.json'),result);
  const value=typeof result==='string'?JSON.parse(result.trim().split(/\r?\n/).at(-1)):result;
  need(uuid(value?.runId),'BRIDGE_COMMIT_JOURNAL_RESULT_REQUIRED');
  const summary={status:'commit_response_received',runId,jobId:plan.jobId,recoveryRunId:value.runId,planSha256:confirmPlanSha256,resultPath:join(directory,'apply-result.json'),postVerificationRequired:true};
  write(join(directory,'applied.json'),summary);notify(summary);return summary;
}

function argumentsOf(argv) {
  const mode=argv.shift();need(['prepare','apply'].includes(mode),'BRIDGE_MODE_REQUIRED');
  const allowed=mode==='prepare'?['run-id','reviewer-id','authorization-reference','review-reference','timeout-ms']:['run-id','confirm-plan-sha256','timeout-ms'];
  const args={};while(argv.length){const option=argv.shift();need(option?.startsWith('--')&&allowed.includes(option.slice(2))&&!Object.hasOwn(args,option.slice(2))&&argv.length,'BRIDGE_ARGUMENT_REQUIRED');args[option.slice(2)]=argv.shift();}
  const timeoutMs=args['timeout-ms']===undefined?600000:Number(args['timeout-ms']);
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=3600000,'BRIDGE_TIMEOUT_REQUIRED');return {mode,args,timeoutMs};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {mode,args,timeoutMs}=argumentsOf(process.argv.slice(2)),root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
    const common={root,runId:args['run-id'],timeoutMs,notify:metadata=>process.stdout.write(JSON.stringify(metadata)+'\n')};
    if(mode==='prepare')await prepareProductionBridge({...common,designatedReviewerId:args['reviewer-id'],authorizationReference:args['authorization-reference'],reviewReference:args['review-reference']});
    else await applyProductionBridge({...common,confirmPlanSha256:args['confirm-plan-sha256']});
  } catch(error) {
    process.stderr.write(JSON.stringify({status:'failed',code:safeCode(error?.message),automaticRetry:false,automaticRestore:false})+'\n');process.exitCode=1;
  }
}
