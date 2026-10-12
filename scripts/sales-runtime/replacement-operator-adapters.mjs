// Exact post-32 private adapters for an explicitly registered DB-owner job.
// No SQL execution, Auth writes, storage, credentials or public role overrides.
import {createHash} from 'node:crypto';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const md5=v=>createHash('md5').update(v).digest('hex');
const lf=v=>v.replaceAll('\r\n','\n');
const requireValue=(v,code)=>{if(!v)throw new Error(code);};
const pinned={sourceSha256:'7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd',originalArchiveSha256:'9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23',reviewSha256:'de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802',inputDigest:'c24b45f03a5a8cf2854f893136b8c6e54656839e0db1a867fd27a177ba73f581',adapterPlanDigest:'379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506',sourceBatchId:'5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5'};
const isUuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const schemas=new Set(['sales_unknown_history_private','sales_import_private','sales_source_creation_private','sales_revision_private','rental_source_retirement_private','customer_source_membership_private','sales_recovery_private']);
const payloadEntries={
 'sales_unknown_history_private.persist_evidence':['unknown','p_payload'],
 'sales_import_private.apply_reviewed_details':['details','p_payload'],
 'sales_source_creation_private.apply_reviewed':['creation','p_payload'],
 'sales_revision_private.apply':['lifecycle','p_payload'],
 'rental_source_retirement_private.register_review':['rentalManifest','m'],
 'rental_source_retirement_private.apply':['rental','p_payload'],
 'customer_source_membership_private.activate':['membership','p_payload'],
};
const journalEntries={
 'sales_recovery_private.begin_run':['begin','NULL','p_review'],
 'sales_recovery_private.seal_run':['seal','p_run','p_review'],
 'sales_recovery_private.restore_run':['restore','p_run','p_review'],
};
/** Preserve comments/quoted literals; substitutions affect executable calls only. */
function codeMask(source){
 const chars=source.split('');let at=0;
 const hide=(start,end)=>{for(let n=start;n<end;n++)if(chars[n]!=='\n')chars[n]=' ';};
 while(at<source.length){
  const start=at;
  if(source.startsWith('--',at)){at=source.indexOf('\n',at+2);if(at<0)at=source.length;hide(start,at);continue;}
  if(source.startsWith('/*',at)){let depth=1;at+=2;while(at<source.length&&depth){if(source.startsWith('/*',at)){depth++;at+=2;}else if(source.startsWith('*/',at)){depth--;at+=2;}else at++;}requireValue(!depth,'OPERATOR_UNTERMINATED_COMMENT');hide(start,at);continue;}
  if(source[at]==="'"||source[at]==='"'){
   const mark=source[at++];let done=false;const escaped=mark==="'"&&/[eE]/.test(source[start-1]??'')&&!/[\w$]/.test(source[start-2]??'');
   while(at<source.length){if(escaped&&source[at]==='\\')at+=2;else if(source[at]===mark){at++;if(source[at]===mark)at++;else{done=true;break;}}else at++;}
   requireValue(done,'OPERATOR_UNTERMINATED_LITERAL');hide(start,at);continue;
  }
  const tag=source.slice(at).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
  if(tag){const end=source.indexOf(tag,at+tag.length);requireValue(end>=0,'OPERATOR_UNTERMINATED_DOLLAR_LITERAL');at=end+tag.length;hide(start,at);continue;}
  at++;
 }
 return chars.join('');
}
export function rewritePrivateOperatorCalls(source){
 const mask=codeMask(source),matches=[...mask.matchAll(/\b(?:auth\s*\.\s*uid|public\s*\.\s*crm_v2_role)\s*\(\s*\)/gi)];
 let result=source;
 for(const match of matches.reverse())result=result.slice(0,match.index)+(match[0].toLowerCase().startsWith('auth')?'sales_operator_private.actor()':'sales_operator_private.operator_role()')+result.slice(match.index+match[0].length);
 return {body:result,changes:matches.length};
}
const inject=(body,line)=>{const at=/\bBEGIN\b/i.exec(codeMask(body));requireValue(at,'OPERATOR_ENTRYPOINT_OUTER_BEGIN_REQUIRED');return body.slice(0,at.index+at[0].length)+'\n '+line+body.slice(at.index+at[0].length);};
const once=(body,old,next,code)=>{requireValue(body.split(old).length===2,code);return body.replace(old,next);};
function signatureOf(fn){
 if(fn.signature)return fn.signature;
 const args=fn.identityArgs??fn.identityArguments??fn.args;
 requireValue(typeof args==='string','OPERATOR_IDENTITY_ARGUMENTS_REQUIRED');
 const types=args.trim()?args.split(',').map(arg=>arg.trim().replace(/^(?:IN|OUT|INOUT|VARIADIC)\s+/i,'').replace(/^(?:"[^"]+"|\w+)\s+(?=\S)/,'')).join(','):'';
 return `${fn.schema}.${fn.name}(${types})`;
}

export function reviewedReplacementOperatorAdapters(catalog,{phase='full',authorityAdapter=null}={}){
 requireValue(catalog&&Array.isArray(catalog.functions),'OPERATOR_POST_RECOVERY_CATALOG_REQUIRED');
 requireValue(['authority','full'].includes(phase),'OPERATOR_ADAPTER_PHASE_REQUIRED');
 const selected=catalog.functions.filter(fn=>phase==='authority'?fn.schema==='sales_recovery_private'&&fn.name==='operator':schemas.has(fn.schema)||(fn.schema==='sales_private'&&fn.name==='crm_customer_deal_details_guard'));
 const byName=new Map();for(const fn of selected){const name=fn.schema+'.'+fn.name;requireValue(!byName.has(name),'OPERATOR_OVERLOADED_FUNCTION_REQUIRES_REVIEW:'+name);byName.set(name,fn);}
 for(const name of phase==='authority'?['sales_recovery_private.operator']:[...Object.keys(payloadEntries),...Object.keys(journalEntries),'sales_recovery_private.operator','sales_recovery_private.assert_adapters','sales_recovery_private.adapter_matches','sales_private.crm_customer_deal_details_guard'])
  requireValue(byName.has(name),'OPERATOR_REQUIRED_PRIVATE_PATH_MISSING:'+name);
 let sql='-- Exact private DB-owner adapters; actual Auth is unchanged outside a registered owner job.\n';const entries=[];
 for(const fn of selected){
  const name=fn.schema+'.'+fn.name,source=lf(fn.body??fn.prosrc??''),signature=signatureOf(fn);
  requireValue(source.length&&typeof fn.definition==='string'&&lf(fn.definition).includes(source)&&typeof fn.owner==='string'
   &&typeof fn.securityDefiner==='boolean'&&(fn.config===null||Array.isArray(fn.config))
   &&[md5(source),md5(fn.body??fn.prosrc??'')].includes(fn.md5),'OPERATOR_VERIFIED_CATALOG_REQUIRED:'+name);
  if(source.includes('sales_operator_private.')){
   requireValue(phase==='full'&&name==='sales_recovery_private.operator'&&authorityAdapter?.signature===signature
    &&authorityAdapter.afterMd5===md5(source)&&authorityAdapter.securityDefiner===fn.securityDefiner
    &&JSON.stringify(authorityAdapter.settings)===JSON.stringify(fn.config),'OPERATOR_ALREADY_ADAPTED_CATALOG');
   continue;
  }
  let next=rewritePrivateOperatorCalls(source).body;
  if(payloadEntries[name]){const [scope,arg]=payloadEntries[name];next=inject(next,`PERFORM sales_operator_private.authorize_payload('${scope}',${arg});`);}
  if(journalEntries[name]){const [kind,run,review]=journalEntries[name];next=inject(next,`PERFORM sales_operator_private.authorize_journal('${kind}',${run},${review});`);}
  if(name==='sales_recovery_private.assert_adapters')next=once(next,"a.after_md5 IS DISTINCT FROM\n   (SELECT md5(replace(prosrc,E'\\r\\n',E'\\n')) FROM pg_proc WHERE oid=to_regprocedure(a.signature))",
   "NOT sales_operator_private.adapter_matches(a.signature,a.after_md5,\n   (SELECT md5(replace(prosrc,E'\\r\\n',E'\\n')) FROM pg_proc WHERE oid=to_regprocedure(a.signature)))",'OPERATOR_RECOVERY_CATALOG_MATCHER_REQUIRED');
  if(name==='sales_recovery_private.adapter_matches')next=once(next,'a.after_md5=p_current_md5','sales_operator_private.adapter_matches(p_signature,a.after_md5,p_current_md5)','OPERATOR_RECOVERY_CHAIN_MATCHER_REQUIRED');
  if(next===source)continue;
  const beforeMd5=md5(source),afterMd5=md5(next),settings=fn.config===null?'NULL::text[]':'ARRAY['+fn.config.map(q).join(',')+']::text[]';
  sql+=`DO $operator_adapter_${entries.length}$\nDECLARE definition text;body text;\nBEGIN\n PERFORM sales_operator_private.require_owner();\n SELECT replace(pg_get_functiondef(oid),E'\\r\\n',E'\\n'),replace(prosrc,E'\\r\\n',E'\\n') INTO definition,body FROM pg_proc WHERE oid=${q(signature)}::regprocedure;\n IF body IS DISTINCT FROM ${q(source)} OR md5(body) IS DISTINCT FROM '${beforeMd5}'\n  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=${q(signature)}::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=${fn.securityDefiner} AND proconfig IS NOT DISTINCT FROM ${settings})\n  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1\n THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;\n EXECUTE replace(definition,body,${q(next)});\n INSERT INTO sales_operator_private.adapters VALUES(${q(signature)},'${beforeMd5}','${afterMd5}',${settings},${fn.securityDefiner});\nEND;\n$operator_adapter_${entries.length}$;\n`;
  entries.push({signature,beforeMd5,afterMd5,settings:fn.config,securityDefiner:fn.securityDefiner});
 }
 return {version:'reviewed-replacement-operator-adapters-v1',phase,sql,functions:entries,catalogSha256:createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),productionChanged:false,executed:false};
}

/** Pure preparation; caller keeps this PII-bearing manifest in an ignored backup.
 * preparedPayload is the existing source-verified full canonical preparation.
 * SQL uses JSONB serialization for its stored SHA; do not substitute JS JSON SHA.
 */
export function buildReplacementOperatorManifest({preparedPayload,rentalManifest,rentalPayload,beforeStateHash,designatedReviewerId,authorizationReference,reviewReference}){
 requireValue(preparedPayload&&preparedPayload.membership?.records?.length===958,'OPERATOR_WHOLE_PREPARED_PAYLOAD_REQUIRED');
 for(const name of ['sourceSha256','reviewSha256','adapterPlanDigest'])requireValue(preparedPayload.membership[name]===pinned[name],'OPERATOR_APPROVED_SOURCE_PIN_REQUIRED');
 requireValue(JSON.stringify(preparedPayload.membership.originalSourceBatchIds)===JSON.stringify([pinned.sourceBatchId]),'OPERATOR_APPROVED_BATCH_PIN_REQUIRED');
 requireValue(/^[a-f0-9]{64}$/.test(beforeStateHash??'')&&/^[a-f0-9]{64}$/.test(preparedPayload.preparedPayloadDigest??'')&&isUuid(designatedReviewerId),'OPERATOR_REVIEW_AND_STATE_REQUIRED');
 requireValue(typeof authorizationReference==='string'&&authorizationReference.trim().length>0&&authorizationReference.length<=1000&&typeof reviewReference==='string'&&reviewReference.trim().length>0&&reviewReference.length<=1000,'OPERATOR_EXPLICIT_AUTHORIZATION_REFERENCE_REQUIRED');
 const payloads={creation:preparedPayload.creation,unknown:preparedPayload.unknown,details:preparedPayload.details,lifecycle:preparedPayload.lifecycle,membership:preparedPayload.membership,rentalManifest,rental:rentalPayload};
 requireValue(Object.values(payloads).every(v=>v&&typeof v==='object'&&!Array.isArray(v)),'OPERATOR_ALL_EXACT_IMPORT_PAYLOADS_REQUIRED');
 return {version:'approved-whole-replacement-operator-v1',mode:'apply',datasetKey:'full-replacement-'+pinned.adapterPlanDigest,...pinned,approvedSourceCount:958,preparedPayloadDigest:preparedPayload.preparedPayloadDigest,beforeStateHash,designatedReviewerId,authorizationReference,reviewReference,recoveryRunId:null,payloads:structuredClone(payloads)};
}
export function buildReplacementOperatorRestoreManifest({approvedApplyManifest,beforeStateHash,recoveryRunId,authorizationReference,reviewReference}){
 requireValue(approvedApplyManifest?.version==='approved-whole-replacement-operator-v1'&&approvedApplyManifest.mode==='apply'&&approvedApplyManifest.approvedSourceCount===958,'OPERATOR_ORIGINAL_APPROVED_JOB_REQUIRED');
 for(const [name,value]of Object.entries(pinned))requireValue(approvedApplyManifest[name]===value,'OPERATOR_APPROVED_SOURCE_PIN_REQUIRED');
 requireValue(/^[a-f0-9]{64}$/.test(beforeStateHash??'')&&isUuid(recoveryRunId),'OPERATOR_RECOVERY_STATE_REQUIRED');
 requireValue(typeof authorizationReference==='string'&&authorizationReference.trim()&&authorizationReference.length<=1000&&typeof reviewReference==='string'&&reviewReference.trim()&&reviewReference.length<=1000,'OPERATOR_EXPLICIT_AUTHORIZATION_REFERENCE_REQUIRED');
 return {...structuredClone(approvedApplyManifest),mode:'restore',beforeStateHash,recoveryRunId,authorizationReference,reviewReference,payloads:{}};
}
export function replacementOperatorManifestSql(manifest){return `${q(JSON.stringify(manifest))}::jsonb`;}
