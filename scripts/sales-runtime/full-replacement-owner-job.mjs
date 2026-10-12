// Owner execution keeps the original whole replacement transaction intact.
// SQL33 records database authority separately from the designated reviewer.
// These helpers do not authenticate a human or fabricate Auth/JWT identities.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertPlainSql,syntheticDraftBody} from './safety.mjs';
import {reviewedReplacementOperatorAdapters,buildReplacementOperatorManifest,
 buildReplacementOperatorRestoreManifest,replacementOperatorManifestSql} from './replacement-operator-adapters.mjs';

const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=(v,code)=>{if(!v)throw Error(code);};
const parse=v=>{if(typeof v!=='string')return v;const lines=v.trim().split(/\r?\n/).filter(Boolean);return JSON.parse(lines.at(-1));};
const identifier=v=>{need(typeof v==='string'&&/^[a-z_][a-z_0-9]*$/.test(v),'OWNER_RESULT_IDENTIFIER_REQUIRED');return '"'+v+'"';};

// This lexer locates top-level statements, excluding semicolons inside a DO
// body, comments, strings, quoted identifiers and nested block comments.
function statements(source){
 assertPlainSql(source);const masked=source.split('');let at=0;
 const hide=(a,b)=>{for(let i=a;i<b;i++)if(masked[i]!=='\n')masked[i]=' ';};
 while(at<source.length){
  const start=at;
  if(source.startsWith('--',at)){at=source.indexOf('\n',at+2);if(at<0)at=source.length;hide(start,at);continue;}
  if(source.startsWith('/*',at)){let depth=1;at+=2;while(depth){if(source.startsWith('/*',at)){depth++;at+=2;}else if(source.startsWith('*/',at)){depth--;at+=2;}else at++;}hide(start,at);continue;}
  if(source[at]==="'"||source[at]==='"'){
   const mark=source[at++],escaped=mark==="'"&&/[eE]/.test(source[start-1]??'')&&!/[\w$]/.test(source[start-2]??'');
   while(at<source.length){if(escaped&&source[at]==='\\')at+=2;else if(source[at]===mark){at++;if(source[at]===mark)at++;else break;}else at++;}hide(start,at);continue;
  }
  const tag=source.slice(at).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
  if(tag){at=source.indexOf(tag,at+tag.length)+tag.length;hide(start,at);continue;}
  at++;
 }
 const code=masked.join(''),out=[];let start=0;
 for(let i=0;i<=code.length;i++)if(i===code.length||code[i]===';'){
  const text=code.slice(start,i).trim();if(text)out.push({start,end:i===code.length?i:i+1,text});start=i+1;
 }
 return out;
}
function noIdentityImpersonation(sql){
 // Root supplies reviewed repository SQL; this is a misuse check, not an
 // arbitrary SQL sandbox. Never forward old synthetic claim wrappers.
 need(!/request\s*\.\s*jwt|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+auth\s*\.|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:auth\s*\.|public\s*\.\s*crm_v2_role)/i.test(sql),'OWNER_AUTH_IMPERSONATION_FORBIDDEN');
}
function unwrapTransaction(sql){
 noIdentityImpersonation(sql);const parts=statements(sql);
 const isBegin=p=>/^BEGIN(?:\s+(?:WORK|TRANSACTION))?$/i.test(p.text);
 const isCommit=p=>/^COMMIT(?:\s+(?:WORK|TRANSACTION))?$/i.test(p.text);
 const controls=parts.filter(p=>/^(?:BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i.test(p.text));
 need(parts.length&&isBegin(parts[0])&&controls.length===2&&isCommit(controls[1]),'OWNER_SINGLE_TRANSACTION_REQUIRED');
 const begin=parts[0],commit=controls[1];
 need(parts.filter(p=>p.start>=commit.end).every(p=>/^SELECT\b/i.test(p.text)),'OWNER_POST_COMMIT_READ_ONLY_REQUIRED');
 return {body:sql.slice(begin.end,commit.start),tail:sql.slice(commit.end),begin,commit};
}

/** Existing root-generated transaction stays byte-for-byte inside the owner
 * envelope, including all business handlers, before-images and parity checks.
 */
export function wrapOwnerReplacementTransaction({transactionSql,jobId,payloadSha256,resultRelation='full_replacement_result',resultColumn='value'}){
 need(uuid(jobId)&&sha(payloadSha256),'OWNER_REGISTERED_JOB_REQUIRED');
 const {begin,commit}=unwrapTransaction(transactionSql);
 const run=`(SELECT (${identifier(resultColumn)}->>'runId')::uuid FROM pg_temp.${identifier(resultRelation)})`;
 return transactionSql.slice(0,begin.end)+`\nSELECT sales_operator_private.begin_job(${q(jobId)}::uuid,${q(payloadSha256)});\n`
  +transactionSql.slice(begin.end,commit.start)+`\nDO $owner_job_finish$ BEGIN PERFORM sales_operator_private.finish_job(${q(jobId)}::uuid,${run}); END; $owner_job_finish$;\n`+transactionSql.slice(commit.start);
}

export function metadataReadSql(sql,designatedReviewerId){
 need(uuid(designatedReviewerId),'OWNER_DESIGNATED_REVIEWER_REQUIRED');noIdentityImpersonation(sql);
 let body=sql;const first=statements(sql)[0];if(first&&/^BEGIN\b/i.test(first.text)){const wrapped=unwrapTransaction(sql);need(!wrapped.tail.trim(),'OWNER_METADATA_NO_POST_COMMIT_QUERY');body=wrapped.body;}
 const parts=statements(body);need(parts.length&&parts.every(p=>/^(?:SELECT|WITH)\b/i.test(p.text)),'OWNER_METADATA_READ_ONLY_REQUIRED');
 need(!/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|SET)\b/i.test(parts.map(p=>p.text).join('\n')),'OWNER_METADATA_READ_ONLY_REQUIRED');
 // Keep the actual read as the last result-bearing statement. MCP returns
 // only the last SELECT result, whereas psql suppresses void results.
 return `BEGIN; DO $metadata_begin$ BEGIN PERFORM sales_operator_private.begin_metadata(${q(designatedReviewerId)}::uuid); END; $metadata_begin$;\n${body}\nDO $metadata_finish$ BEGIN PERFORM sales_operator_private.finish_metadata(); END; $metadata_finish$; COMMIT;`;
}

const ownedSql="SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet AND current_user=session_user;";
export async function assertOwnedOwnerFixture(query){need(String(await query(ownedSql)).trim()==='t','OWNER_NATIVE_OWNED_LOOPBACK_REQUIRED');}

/** SQL32 must already exist. Its generated recovery bundle contains the FK
 * anchor migration and is applied exactly once here, under metadata context.
 * Production installation requires an explicitly reviewed executable SQL33;
 * this module never removes a draft sentinel for a production connection.
 */
export async function installReplacementOwnerOperator({query,captureCatalog,recoveryBundleSql,designatedReviewerId,root,purpose='owned-native',operatorInstallSql}){
 need(typeof query==='function'&&typeof captureCatalog==='function'&&uuid(designatedReviewerId),'OWNER_INSTALL_CALLBACKS_REQUIRED');
 need(['owned-native','production-owner'].includes(purpose),'OWNER_INSTALL_PURPOSE_REQUIRED');
 need(typeof recoveryBundleSql==='string'&&recoveryBundleSql.trim(),'OWNER_RECOVERY_BUNDLE_REQUIRED');assertPlainSql(recoveryBundleSql);noIdentityImpersonation(recoveryBundleSql);
 need(!statements(recoveryBundleSql).some(p=>/^(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(p.text)),'OWNER_RECOVERY_BODY_ONLY_REQUIRED');
 if(purpose==='owned-native'){
  await assertOwnedOwnerFixture(query);
  operatorInstallSql??=syntheticDraftBody('sql/sales/33_customer_replacement_operator_draft.sql',readFileSync(join(root,'sql/sales/33_customer_replacement_operator_draft.sql'),'utf8'));
 }else need(typeof operatorInstallSql==='string'&&operatorInstallSql.trim(),'OWNER_PRODUCTION_REVIEWED_INSTALL_SQL_REQUIRED');
 assertPlainSql(operatorInstallSql);noIdentityImpersonation(operatorInstallSql);
 await query(operatorInstallSql);
 const authority=reviewedReplacementOperatorAdapters(await captureCatalog(),{phase:'authority'});
 need(authority.functions.length===1,'OWNER_EXACT_AUTHORITY_ADAPTER_REQUIRED');
 await query('BEGIN;'+authority.sql+'COMMIT;');
 await query(`BEGIN; SELECT sales_operator_private.begin_metadata(${q(designatedReviewerId)}::uuid);\n${recoveryBundleSql}\nSELECT sales_operator_private.finish_metadata(); COMMIT;`);
 const full=reviewedReplacementOperatorAdapters(await captureCatalog(),{authorityAdapter:authority.functions[0]});
 await query('BEGIN;'+full.sql+'COMMIT;');
 await query('SELECT sales_operator_private.assert_catalog();');
 return {authorityAdapter:authority.functions[0],adapters:full.functions,authorityCatalogSha256:authority.catalogSha256,
  finalCatalogSha256:full.catalogSha256,purpose,authIdentitiesFabricated:false,executed:true,reviewedSql:{authority:authority.sql,recovery:recoveryBundleSql,full:full.sql}};
}

export async function registerOwnerReplacementJob({query,manifest}){
 const literal=replacementOperatorManifestSql(manifest);
 const result=parse(await query(`WITH registered AS (SELECT sales_operator_private.register_job(${literal},sales_operator_private.digest(${literal})) AS id)
 SELECT jsonb_build_object('jobId',id,'payloadSha256',sales_operator_private.digest(${literal})) FROM registered;`));
 need(uuid(result?.jobId)&&sha(result?.payloadSha256),'OWNER_JOB_REGISTRATION_RESULT_REQUIRED');return result;
}

/** Preparation is read-only except for immutable operator job registration.
 * The whole PII-bearing plan is returned in memory; save only to ignored local
 * backup packets. Execution is the caller's separate, explicit query(mainSql).
 */
export async function prepareOwnerReplacementJob({query,prepareExecution,root,report,source,reviewReference,designatedReviewerId,authorizationReference,purpose='production-target'}){
 need(typeof query==='function'&&typeof prepareExecution==='function'&&uuid(designatedReviewerId),'OWNER_PREPARATION_CALLBACKS_REQUIRED');
 const metadataQuery=sql=>query(metadataReadSql(sql,designatedReviewerId));
 const plan=await prepareExecution({query:metadataQuery,root,report,source,reviewReference,actorSql:'',purpose});
 need(typeof plan.mainSql==='string'&&plan.payload&&plan.retirementManifest&&plan.retirement,'OWNER_WHOLE_PREPARATION_REQUIRED');
 const beforeStateHash=String(await query(`SELECT sales_operator_private.preview_state(${q(designatedReviewerId)}::uuid);`)).trim();
 const manifest=buildReplacementOperatorManifest({preparedPayload:plan.payload,rentalManifest:plan.retirementManifest,rentalPayload:plan.retirement,
  beforeStateHash,designatedReviewerId,authorizationReference,reviewReference});
 const registration=await registerOwnerReplacementJob({query,manifest});
 return {...plan,manifest,...registration,mainSql:wrapOwnerReplacementTransaction({transactionSql:plan.mainSql,...registration}),
  rawPersonalDataIncluded:true,saveOnlyToIgnoredPrivatePacket:true,operationalIdentitySynthetic:false,executed:false};
}

export async function prepareOwnerReplacementRestore({query,approvedApplyManifest,recoveryRunId,authorizationReference,reviewReference}){
 need(typeof query==='function','OWNER_QUERY_REQUIRED');
 const reviewer=approvedApplyManifest?.designatedReviewerId;need(uuid(reviewer),'OWNER_DESIGNATED_REVIEWER_REQUIRED');
 const beforeStateHash=String(await query(`SELECT sales_operator_private.preview_state(${q(reviewer)}::uuid);`)).trim();
 const manifest=buildReplacementOperatorRestoreManifest({approvedApplyManifest,beforeStateHash,recoveryRunId,authorizationReference,reviewReference});
 const registration=await registerOwnerReplacementJob({query,manifest});
 const mainSql=`BEGIN; SELECT sales_operator_private.begin_job(${q(registration.jobId)}::uuid,${q(registration.payloadSha256)});
 CREATE TEMP TABLE owner_restore_result(value jsonb) ON COMMIT PRESERVE ROWS;
 INSERT INTO owner_restore_result SELECT sales_recovery_private.restore_run(${q(recoveryRunId)}::uuid,${q(reviewReference)});
 DO $owner_job_finish$ BEGIN PERFORM sales_operator_private.finish_job(${q(registration.jobId)}::uuid,${q(recoveryRunId)}::uuid); END; $owner_job_finish$;
 COMMIT; SELECT value FROM owner_restore_result;`;
 return {manifest,...registration,mainSql,rawPersonalDataIncluded:true,saveOnlyToIgnoredPrivatePacket:true,executed:false};
}

/** Only disposable owned native runtimes may exercise denied transactions.
 * Supply a fully prepared but not yet executed registered job. Never use this
 * helper against production, and never broaden its context to allow replay.
 */
export async function assertOwnerReplacementNativeBarriers({query,designatedReviewerId,jobId,payloadSha256}){
 await assertOwnedOwnerFixture(query);need(uuid(designatedReviewerId)&&uuid(jobId)&&sha(payloadSha256),'OWNER_NATIVE_JOB_REQUIRED');
 const before=String(await query(`SELECT sales_operator_private.preview_state(${q(designatedReviewerId)}::uuid);`)).trim();need(sha(before),'OWNER_NATIVE_STATE_REQUIRED');
 const cases=[];
 const denied=async(sql,pattern,label)=>{let error;try{await query(sql);}catch(e){error=e;}need(error&&pattern.test(String(error.message??error)),'OWNER_EXPECTED_NATIVE_REJECTION:'+label);cases.push(label);};
 await denied(`BEGIN; SET LOCAL ROLE authenticated; SELECT sales_operator_private.begin_metadata(${q(designatedReviewerId)}::uuid); COMMIT;`,/permission denied|DB_OWNER_REQUIRED/i,'Application role cannot begin an owner context');
 await denied(`BEGIN; SELECT sales_operator_private.begin_metadata(${q(designatedReviewerId)}::uuid); SELECT sales_source_creation_private.apply_reviewed('{}'::jsonb); SELECT sales_operator_private.finish_metadata(); COMMIT;`,/CUSTOMER_OPERATOR_SCOPE_FORBIDDEN/,'Metadata context cannot invoke approved import');
 await denied(`BEGIN; SELECT sales_operator_private.begin_job(${q(jobId)}::uuid,${q(payloadSha256)}); COMMIT;`,/CUSTOMER_OPERATOR_WHOLE_TRANSACTION_NOT_FINISHED/,'Unfinished owner job cannot commit');
 await denied(`BEGIN; SELECT sales_operator_private.begin_job(${q(jobId)}::uuid,${q(payloadSha256)}); SELECT sales_source_creation_private.apply_reviewed('{}'::jsonb); COMMIT;`,/CUSTOMER_OPERATOR_EXACT_PAYLOAD_REQUIRED/,'Changed payload fails exact approved job scope');
 const after=String(await query(`SELECT sales_operator_private.preview_state(${q(designatedReviewerId)}::uuid);`)).trim();need(after===before,'OWNER_NEGATIVE_BUSINESS_STATE_CHANGED');
 return {cases,passed:cases.length,beforeStateHash:before,afterStateHash:after,productionChanged:false};
}

export async function assertFinishedOwnerJobCannotReplay({query,jobId,payloadSha256}){
 await assertOwnedOwnerFixture(query);need(uuid(jobId)&&sha(payloadSha256),'OWNER_NATIVE_JOB_REQUIRED');let error;
 try{await query(`BEGIN; SELECT sales_operator_private.begin_job(${q(jobId)}::uuid,${q(payloadSha256)}); COMMIT;`);}catch(e){error=e;}
 need(error&&/CUSTOMER_OPERATOR_JOB_REPLAY_OR_DRIFT/.test(String(error.message??error)),'OWNER_FINISHED_JOB_REPLAY_MUST_FAIL');
 return {passed:1,cases:['Finished immutable owner job cannot replay'],productionChanged:false};
}
