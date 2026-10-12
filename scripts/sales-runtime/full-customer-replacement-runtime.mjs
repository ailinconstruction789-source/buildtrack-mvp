// Actual business schema and captured approved-row rehearsal in a new owned DB only.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {syntheticDraftBody} from './safety.mjs';
import {buildLiveCatalogFixturePlan,restoreLiveCatalogFixture} from './live-catalog-fixture.mjs';
import {buildOwnedSyntheticAuthPlan} from './live-auth-fixture.mjs';
import {prepareFullReplacementRecovery} from './full-replacement-recovery.mjs';
import {installSourceMembership,runSourceMembershipSelectParity} from './source-membership.mjs';
import {reviewedReplacementRecoveryAdapters} from './replacement-recovery-adapters.mjs';
import {runFullCustomerReplacement,prepareFullReplacementExecution} from './full-customer-replacement.mjs';
import {installReplacementOwnerOperator,prepareOwnerReplacementJob,prepareOwnerReplacementRestore,assertOwnerReplacementNativeBarriers,assertFinishedOwnerJobCannotReplay,metadataReadSql} from './full-replacement-owner-job.mjs';
import {fullCanonicalCaptureQuery} from '../sales-import/prepare-full-canonical-payload.mjs';
import {runCanonicalWorkspaceReadChecks} from './canonical-workspace-read.mjs';
import {reviewedPostBookingActivationAdapter,postBookingActivationCommandSql,postBookingActivationRestoreSql} from './reviewed-post-booking-activation.mjs';
import {compactCaptureGuard,captureFingerprintReadSql} from './compact-capture-guard.mjs';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
export const fullReplacementFunctionCatalogSql=`SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'body',replace(p.prosrc,E'\\r\\n',E'\\n'),'md5',md5(replace(p.prosrc,E'\\r\\n',E'\\n')),'definition',replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n'),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN('information_schema','auth') AND p.prokind='f'));`;
export async function runFullReplacementRuntime({query,root,report,connection,command,executable,directory,environment,ownerJob=false}) {
 const read=path=>{const b=readFileSync(join(root,path));report.sources[path]=createHash('sha256').update(b).digest('hex');return b.toString('utf8');};
 const catalog=JSON.parse(read('node_modules/.cache/buildtrack-sales-runtime/live-catalog-complete-2026-10-11.json'));
 read('scripts/sales-runtime/compact-capture-guard.mjs');
 for(const path of ["scripts/sales-runtime/full-replacement-owner-job.mjs", "scripts/sales-runtime/full-replacement-recovery.mjs", "scripts/sales-runtime/replacement-operator-adapters.mjs", "scripts/sales-runtime/replacement-recovery-adapters.mjs", "scripts/sales-runtime/source-membership-adapters.mjs", "scripts/sales-runtime/canonical-workspace-read.mjs", "scripts/sales-runtime/reviewed-post-booking-activation.mjs", "scripts/sales-import/prepare-full-canonical-payload.mjs", "scripts/sales-import/prepare-rental-source-retirement.mjs"])read(path);
 const backup='.local-backups/customer-replacement-2026-10-11';
 const rowsByTable={...JSON.parse(read(backup+'/role-fixture-inputs.json'))};
 const tableFiles=readdirSync(join(root,backup,'tables')).filter(f=>f.endsWith('.json'));
 for(const file of tableFiles)rowsByTable[file.slice(0,-5)]=JSON.parse(read(backup+'/tables/'+file));
 assert.equal(tableFiles.length,31);assert.equal(rowsByTable['public.sales_customers'].length,959);
 assert.equal(rowsByTable['public.lead_project_interests'].length,956);assert.equal(rowsByTable['public.sales'].length,303);
 const roles=rowsByTable['sales_private.crm_user_roles'];
 const adminId=roles.find(r=>r.is_active&&r.role==='admin')?.user_id;assert.ok(adminId);
 const authIds=new Set(roles.map(r=>r.user_id));
 for(const table of catalog.tables)for(const fk of table.constraints??[])if(fk.type==='f'&&fk.refSchema==='auth'&&fk.refTable==='users'){
  const match=/FOREIGN KEY \(([^)]+)\)/.exec(fk.definition);assert.ok(match);
  for(const column of match[1].split(',').map(c=>c.trim().replaceAll('"','')))for(const row of rowsByTable[table.schema+'.'+table.name]??[])if(row[column])authIds.add(row[column]);
 }
 const sessions=[...authIds].map(userId=>({id:randomUUID(),userId,notAfter:null}));
 const auth=buildOwnedSyntheticAuthPlan({ownedUser:connection.user,users:[...authIds],sessions});
 const sessionId=sessions.find(s=>s.userId===adminId).id;
 await query('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;'+auth.bootstrapSql);
 const emptyDataTables=catalog.tables.map(t=>t.schema+'.'+t.name).filter(k=>!Object.hasOwn(rowsByTable,k));
 const plan=buildLiveCatalogFixturePlan({catalog,rowsByTable,ownedUser:connection.user,emptyDataTables,
  extensionSql:["CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql VOLATILE AS $$SELECT gen_random_uuid()$$;"]});
 if(!plan.ready)throw Error('Actual fixture prerequisites: '+plan.blockers.join('; '));
 report.results.actualCatalog=await restoreLiveCatalogFixture({query,connection,plan});
 report.results.actualCatalog.explicitEmptyFixtureTables=emptyDataTables;
 console.log(JSON.stringify({actualCatalogRestored:true,tables:plan.counts.tables,functions:plan.counts.functions,seedRows:plan.counts.sourceSeedRows}));
 const checkpoint=await prepareFullReplacementRecovery({query,command,executable,connection,directory,environment});
 const claims=auth.claimsSql({authUserId:adminId,sessionId});
 for(const path of ['sql/sales/20_sales_reports_read_draft.sql','sql/sales/21_post_booking_draft.sql','sql/sales/22_customer_deal_details_draft.sql',
  'sql/sales/25_unknown_historical_evidence_draft.sql','sql/sales/26_reviewed_import_details_draft.sql','sql/sales/28_historical_sale_revision_draft.sql',
  'sql/sales/27_source_bound_customer_creation_draft.sql','sql/sales/29_imported_history_projection_draft.sql','sql/sales/30_rental_source_retirement_draft.sql']){
  await query(syntheticDraftBody(path,read(path)).replace(/^([\s\S]*?\bBEGIN;)/,`$1\n${claims}`));
  console.log('Compiled actual-catalog composition: '+path);
 }
 report.results.membershipInstallation=await installSourceMembership({query,root,report,syntheticDraftBody});
 const recoveryPath='sql/sales/32_customer_replacement_recovery_draft.sql';
 await query(syntheticDraftBody(recoveryPath,read(recoveryPath)));
 const beforeRecoveryCatalog=JSON.parse(await query(fullReplacementFunctionCatalogSql));
 const recovery=reviewedReplacementRecoveryAdapters(root,beforeRecoveryCatalog);
 // The reviewed bundle already contains the complete guarded FK migration.
 // Its exact-source checks intentionally reject running that migration twice.
 assert.equal((recovery.sql.match(/DO \$recovery_sale_identity_fks\$/g)??[]).length,1);
 if(ownerJob){
  report.sources['sql/sales/33_customer_replacement_operator_draft.sql']=createHash('sha256').update(readFileSync(join(root,'sql/sales/33_customer_replacement_operator_draft.sql'))).digest('hex');
  report.results.ownerInstallation=await installReplacementOwnerOperator({query,root,captureCatalog:async()=>JSON.parse(await query(fullReplacementFunctionCatalogSql)),recoveryBundleSql:recovery.sql,designatedReviewerId:adminId});
 }else await query('BEGIN;'+claims+recovery.sql+'COMMIT;');
 report.results.recoveryAdapters={count:recovery.functions?.length??recovery.adapters?.length,scope:'owned actual-catalog native composition'};
 const membershipOperatorHashSql=`SELECT jsonb_object_agg(n.nspname::text||'.'||p.proname::text||'('||pg_get_function_identity_arguments(p.oid)||')',md5(replace(p.prosrc,E'\\r\\n',E'\\n'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('customer_source_membership_private','sales_operator_private') AND p.prokind='f';`;
 const beforeWorkspaceHashes=JSON.parse(await query(membershipOperatorHashSql));
 await query(syntheticDraftBody('sql/sales/34_canonical_workspace_read_draft.sql',read('sql/sales/34_canonical_workspace_read_draft.sql')));
 const afterWorkspaceHashes=JSON.parse(await query(membershipOperatorHashSql));
 assert.deepEqual(afterWorkspaceHashes,beforeWorkspaceHashes);
 report.results.workspaceInstallationPreservesOriginals={functions:Object.keys(beforeWorkspaceHashes).length,unchanged:true};
 if(ownerJob){
  const activation=reviewedPostBookingActivationAdapter(JSON.parse(await query(fullReplacementFunctionCatalogSql)));
  const path='sql/sales/35_reviewed_post_booking_activation_draft.sql';
  const installer=syntheticDraftBody(path,read(path)).replace(/COMMIT;\s*$/,activation.sql+'\nCOMMIT;');
  await query(installer);
  report.results.postBookingActivationInstallation={signature:activation.signature,beforeMd5:activation.beforeMd5,afterMd5:activation.afterMd5,adapterSql:activation.sql};
 }
 const nativeCapture=JSON.parse(await query(fullCanonicalCaptureQuery('owned-fixture')));
 writeFileSync(join(root,backup,'native-capture.json'),JSON.stringify(nativeCapture));
 const bindingParity={};
 for(const [key,table] of [['customers','sales_customers'],['interests','lead_project_interests'],['plots','plots']]){
  const original=new Map(rowsByTable['public.'+table].map(row=>[row.id,row]));
  const differences=[];
  for(const row of nativeCapture[key])for(const field of Object.keys(original.get(row.id)??{})){
   try{assert.deepEqual(row[field],original.get(row.id)[field]);}catch{differences.push({field,id:row.id});}
  }
  bindingParity[key]={rows:nativeCapture[key].length,fieldDifferences:differences};
 }
 report.results.captureBindingParity=bindingParity;
 console.log(JSON.stringify({captureBindingParity:bindingParity}));
 if(ownerJob){
  const plan=await prepareOwnerReplacementJob({query,prepareExecution:prepareFullReplacementExecution,root,report,designatedReviewerId:adminId,authorizationReference:'User explicitly approved completing whole replacement 2026-10-11; owned rehearsal only',reviewReference:'Approved958 whole owner job actual-catalog rehearsal 2026-10-11',purpose:'owned-fixture'});
  writeFileSync(join(root,backup,'native-owner-plan.json'),JSON.stringify(plan));
  report.results.ownerNativeBarriers=await assertOwnerReplacementNativeBarriers({query,designatedReviewerId:adminId,...plan});
  const fingerprint=JSON.parse(await query(captureFingerprintReadSql('owned-fixture')));
  const compact=compactCaptureGuard({plan,freshCapture:fingerprint.capture,captureSha256:fingerprint.captureSha256});
  report.results.compactCaptureGuard={...compact,sql:undefined,originalCharacters:plan.mainSql.length,compactCharacters:compact.sql.length};
  const committed=JSON.parse(await query(compact.sql));
  report.results.ownerReplayDenial=await assertFinishedOwnerJobCannotReplay({query,...plan});
  const counts=JSON.parse(await query("SELECT jsonb_build_object('rows',(SELECT count(*) FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id),'customers',(SELECT count(DISTINCT m.customer_id) FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id),'interests',(SELECT count(DISTINCT m.interest_id) FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id),'sales',(SELECT count(*) FROM customer_source_membership_private.sales),'activePlots',(SELECT count(DISTINCT plot_id) FROM customer_source_membership_private.sales WHERE crm_stage<>'cancelled'))"));
  assert.deepEqual(counts,{rows:958,customers:957,interests:948,sales:298,activePlots:213});
  const nativeRetained=JSON.parse(await query("SELECT jsonb_build_object('customers',(SELECT jsonb_agg(c.id ORDER BY c.id) FROM customer_source_membership_private.customers c WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.customer_id=c.id)),'interests',(SELECT jsonb_agg(i.id ORDER BY i.id) FROM customer_source_membership_private.interests i WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=i.id)))"));
  assert.deepEqual(nativeRetained,{customers:['ce66264b-a4ed-4067-9f19-9be35319203c'],interests:['686313f5-01f0-48dc-b9b1-5a0f95a4487a']});
  report.results.unrelatedNativeParentsRetained=nativeRetained;
  report.results.ownerCommitted={runId:committed.runId,jobId:plan.jobId,counts,claimsUsed:false,authority:'database_owner',designatedReviewerIsAuthenticated:false,productionChanged:false};
  const history=JSON.parse(String(await query('BEGIN;'+claims+"SELECT customer_source_membership_private.history('[]',NULL,NULL,NULL,NULL);COMMIT;")).trim().split(/\r?\n/).at(-1));
  assert.equal(history.length,958);
  await runSourceMembershipSelectParity({query,report,sessionIds:Object.fromEntries(sessions.map(s=>[s.userId,s.id]))});
  const activated=JSON.parse(await query(postBookingActivationCommandSql(committed.runId,'Owned958 post-booking activation rehearsal')));
  report.results.postBookingActivated=activated;
  await runCanonicalWorkspaceReadChecks({query,claims,report});
  const activationRestored=JSON.parse(await query(postBookingActivationRestoreSql(activated.releaseId,'Owned exact settings restoration before whole recovery')));
  assert.equal(activationRestored.exactOriginalSettingsRestored,true);
  report.results.postBookingActivationRestored=activationRestored;
  const restore=await prepareOwnerReplacementRestore({query,approvedApplyManifest:plan.manifest,recoveryRunId:committed.runId,authorizationReference:'Owned post-commit recovery rehearsal',reviewReference:'Owned958 whole committed restore'});
  const restored=JSON.parse(await query(restore.mainSql));assert.equal(restored.restored,true);
  report.results.ownerRestored={restored:true,physicalParentsRetained:restored.physicalParentsRetained,claimsUsed:false,jobId:restore.jobId};
  await runSourceMembershipSelectParity({query,report,sessionIds:Object.fromEntries(sessions.map(s=>[s.userId,s.id]))});
  report.results.fullReplacement={sourceRows:958,logicalRecovery:true,ownerAuthorityRehearsed:true,productionChanged:false};
 }else report.results.fullReplacement=await runFullCustomerReplacement({query,root,report,adminId,sessionId,reviewReference:'approved958 full actual-catalog rehearsal 2026-10-11'});
 report.results.fullSchemaRestore=await checkpoint.restoreAfterCommit();
 report.results.scope={actualApprovedRows:958,auth:'explicitly synthetic local sessions with actual captured helpers',construction:'captured full plots; unrelated construction tables explicitly empty fixture',productionWrites:false};
 return report.results.fullReplacement;
}
