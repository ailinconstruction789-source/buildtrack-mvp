// Pure node:test checks; never connects to a DB or fabricates a successful run.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {prepareReviewedInstallation} from './prepare-reviewed-installation.mjs';

const root=process.cwd();
const runs=join(root,'node_modules/.cache/buildtrack-sales-runtime/runs');
const failedPath=join(runs,'run-hU4kMx/report.json');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const isComplete=report=>report.status==='passed'&&report.stopped===true
 &&report.results?.ownerCommitted?.claimsUsed===false
 &&report.results?.postBookingActivated?.postBookingEnabled===true
 &&report.results?.postBookingActivationRestored?.exactOriginalSettingsRestored===true
 &&report.results?.canonicalWorkspaceRead?.passed>=15;
function findProof(){
 if(process.env.BUILDTRACK_REVIEWED_NATIVE_REPORT){
  const path=resolve(process.env.BUILDTRACK_REVIEWED_NATIVE_REPORT),report=read(path);
  assert.ok(isComplete(report),'Explicit native report must be a genuinely completed activation/read/recovery run');
  return {path,report};
 }
 if(!existsSync(runs))return null;
 const candidates=[];
 for(const dir of readdirSync(runs)){const path=join(runs,dir,'report.json');if(!existsSync(path))continue;
  const report=read(path);if(isComplete(report))candidates.push({path,report});}
 candidates.sort((a,b)=>String(b.report.finishedAt).localeCompare(String(a.report.finishedAt)));
 return candidates[0]??null;
}
const proof=findProof();
const base={root,reviewReference:'Human approved whole customer replacement; exact native proof',
 designatedReviewerId:'d6362433-0779-4947-ad69-ee9b88155660'};
const run=report=>prepareReviewedInstallation({...base,report});
const deepCase=(name,mutate,error)=>test(name,{skip:proof?false:'Awaiting genuine completed owned activation/read/recovery report'},()=>{
 const negative=structuredClone(proof.report);mutate(negative);
 assert.throws(()=>run(negative),error);
});

test('rejects actual unsuccessful native report without relabeling its evidence',{skip:!existsSync(failedPath)},()=>{
 const report=read(failedPath);assert.notEqual(report.status,'passed');
 assert.throws(()=>run(report),/completely successful owned native report/);
 assert.equal(report.stopped,true,'Original failed runtime remained stopped');
});
deepCase('refuses a still-running runtime even when prior proof was successful',r=>{r.stopped=false;},/Disposable runtime must be stopped/);
deepCase('refuses a report with unsuccessful completion',r=>{r.status='failed';},/completely successful owned native report/);
deepCase('refuses incomplete business restoration',r=>{r.results.ownerRestored.restored=false;},/AssertionError/);
deepCase('refuses failed whole-schema restoration',r=>{r.results.fullSchemaRestore.passed=false;},/AssertionError/);
deepCase('refuses any fabricated Auth authority during the apply',r=>{r.results.ownerCommitted.claimsUsed=true;},/AssertionError/);
deepCase('refuses any fabricated Auth authority during recovery',r=>{r.results.ownerRestored.claimsUsed=true;},/AssertionError/);
deepCase('refuses an installer with fabricated Auth identities',r=>{r.results.ownerInstallation.authIdentitiesFabricated=true;},/AssertionError/);
deepCase('refuses missing reviewed post-booking activation',r=>{r.results.postBookingActivated.postBookingEnabled=false;},/AssertionError/);
deepCase('refuses missing exact post-booking settings restoration',r=>{r.results.postBookingActivationRestored.exactOriginalSettingsRestored=false;},/AssertionError/);
deepCase('refuses incomplete canonical read assertion coverage',r=>{r.results.canonicalWorkspaceRead.passed=14;},/AssertionError/);
deepCase('refuses truncation of 298 canonical deals',r=>{r.results.canonicalWorkspaceRead.sales=297;},/AssertionError/);
deepCase('refuses missing approved 42 source forecast days',r=>{r.results.canonicalWorkspaceRead.forecastDays=41;},/AssertionError/);
deepCase('refuses dropped native/customer identities',r=>{r.results.canonicalWorkspaceRead.customersIncludingNative=957;},/AssertionError/);
deepCase('refuses missing authenticated role parity after recovery',r=>{r.results.sourceMembershipSelectParityPhases.pop();},/AssertionError/);
deepCase('refuses incomplete actual authenticated role coverage',r=>{r.results.sourceMembershipSelectParityPhases[0].sessionsValidated=['admin','sales'];},/AssertionError/);
deepCase('refuses missing genuine authenticated role sessions',r=>{r.results.sourceMembershipSelectParityPhases[0].missingSessionRoles=['owner'];},/AssertionError/);
deepCase('refuses a drifted SQL source attestation',r=>{r.sources['sql/sales/35_reviewed_post_booking_activation_draft.sql']='0'.repeat(64);},/Attested source changed|Missing exact native source attestation/);
deepCase('refuses a drifted runtime source attestation',r=>{r.sources['scripts/sales-runtime/full-customer-replacement-runtime.mjs']='0'.repeat(64);},/Attested source changed/);
deepCase('refuses an incomplete membership adapter set',r=>{r.results.membershipInstallation.entries.pop();},/AssertionError/);
deepCase('refuses absent exact operator authority adapter',r=>{r.results.ownerInstallation.reviewedSql.authority='';},/AssertionError/);
deepCase('refuses unreviewed owner barriers',r=>{r.results.ownerNativeBarriers.passed=3;},/AssertionError/);
deepCase('refuses absent finished-owner replay denial',r=>{r.results.ownerReplayDenial.passed=0;},/AssertionError/);
deepCase('refuses a duplicate recovery identity anchor',r=>{r.results.ownerInstallation.reviewedSql.recovery+='\nDO $recovery_sale_identity_fks$';},/AssertionError/);
deepCase('refuses wrong whole source cardinality',r=>{r.results.ownerCommitted.counts.rows=957;},/AssertionError/);
deepCase('refuses fewer than 18 passing actual-role cases',r=>{r.results.sourceMembershipSelectParityPhases[0].passed=17;},/Actual-role checks must all pass/);
deepCase('refuses incomplete actual-role case evidence',r=>{r.results.sourceMembershipSelectParityPhases[1].cases=r.results.sourceMembershipSelectParityPhases[1].cases.slice(0,17);},/Actual-role checks must all pass/);
deepCase('requires membership authority active during the first role parity phase',r=>{r.results.sourceMembershipSelectParityPhases[0].authorityActive=false;},/AssertionError/);
deepCase('requires membership authority restored during the second role parity phase',r=>{r.results.sourceMembershipSelectParityPhases[1].authorityActive=true;},/AssertionError/);
deepCase('requires actual Owner role coverage during activation parity',r=>{r.results.sourceMembershipSelectParityPhases[0].ownerRoleCovered=false;},/AssertionError/);
deepCase('requires actual Owner role coverage after restoration',r=>{r.results.sourceMembershipSelectParityPhases[1].ownerRoleCovered=false;},/AssertionError/);

const productionCase=(name,mutate,error)=>test(name,{skip:proof?false:'Awaiting genuine completed owned activation/read/recovery report'},()=>{
 const negative=structuredClone(proof.report),options={...base,report:negative,databaseOwner:'postgres'};mutate(negative,options);
 assert.throws(()=>prepareReviewedInstallation(options),error);
});
productionCase('rejects unknown target database owner',(_r,options)=>{options.databaseOwner='unknown_owner';},/Verified Supabase DB owner required/);
productionCase('rejects an empty target database owner',(_r,options)=>{options.databaseOwner='';},/Verified Supabase DB owner required/);
productionCase('rejects missing attested native owner identity',r=>{r.database='not_a_native_runtime';},/AssertionError/);
productionCase('rejects drifted adapter entry owner',r=>{r.results.membershipInstallation.entries[0].owner='some_other_role';},/AssertionError/);
productionCase('requires all exact 29 original owner predicates',r=>{
 const owner='runtime_'+r.database.replace(/^buildtrack_sales_runtime_/,'');
 r.results.membershipInstallation.sql=r.results.membershipInstallation.sql.replace("owner_name IS DISTINCT FROM '"+owner+"'",'owner_name IS DISTINCT FROM current_user');
},/Exact owner predicates required/);
productionCase('rejects an additional unreviewed owner predicate',r=>{
 const owner='runtime_'+r.database.replace(/^buildtrack_sales_runtime_/,'');
 r.results.membershipInstallation.sql+="\n-- owner_name IS DISTINCT FROM '"+owner+"'";
},/Exact owner predicates required/);
productionCase('rejects residual native runtime identity after owner predicate binding',r=>{
 const owner='runtime_'+r.database.replace(/^buildtrack_sales_runtime_/,'');
 r.results.membershipInstallation.sql+='\n-- residual '+owner;
},/AssertionError/);

test('compiles only the genuine attested successful composition and leaves drafts intact',{
 skip:proof?false:'No genuine passed post-booking native proof yet; no successful fixture fabricated'},()=>{
 const draftPath=join(root,'sql/sales/35_reviewed_post_booking_activation_draft.sql');
 const before=readFileSync(draftPath,'utf8');
 const artifact=run(proof.report);
 assert.match(artifact.sha256,/^[a-f0-9]{64}$/);
 assert.equal(artifact.productionExecuted,false);
 assert.equal(artifact.authIdentityFabricated,false);
 assert.equal(artifact.nativeReportDirectory,proof.report.directory);
 assert.equal(artifact.scope,'schema and exact-source adapters only');
 assert.ok(artifact.sql.includes('CREATE SCHEMA sales_activation_private'),'Reviewed activation schema included');
 assert.ok(artifact.sql.includes('crm_v2_workspace_project_sales'),'Canonical project workspace RPC included');
 assert.ok(artifact.sql.includes('crm_v2_workspace_central_search'),'Canonical central workspace RPC included');
 assert.ok(artifact.sql.includes('sales_operator_private.begin_metadata'),'Genuine owner metadata context included');
 assert.equal(/request\s*\.\s*jwt|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+auth\s*\./i.test(artifact.sql),false,'No fabricated Auth SQL');
 assert.equal(/DO \$draft_only\$|^ROLLBACK;\s*$/m.test(artifact.sql),false,'Separate reviewed artifact is executable');
 assert.equal(readFileSync(draftPath,'utf8'),before);
 assert.match(before,/RAISE EXCEPTION 'DESIGN ONLY:/);
});

test('production owner binding changes only the exact 29 reviewed owner predicates',{
 skip:proof?false:'No genuine passed post-booking native proof yet'},()=>{
 const native=run(proof.report),production=prepareReviewedInstallation({...base,report:proof.report,databaseOwner:'postgres'});
 const nativeOwner='runtime_'+proof.report.database.replace(/^buildtrack_sales_runtime_/,'');
 const before="owner_name IS DISTINCT FROM '"+nativeOwner+"'",after="owner_name IS DISTINCT FROM 'postgres'";
 assert.equal(native.sql.split(before).length-1,29);
 assert.equal(production.sql.split(after).length-1,29);
 assert.ok(production.sql===native.sql.replaceAll(before,after),'All hash/body/security/config/current_user guards remain byte-identical');
 assert.equal(/runtime_[a-f0-9]{24}/.test(production.sql),false,'No disposable owner identity remains in production SQL');
 assert.equal(production.sql.includes('\r'),false,'Compiled HTTP installer uses the exact LF convention proved by psql');
 assert.equal(production.installationParts.length,14);
 const prefix="BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';\n";
 const partBodies=production.installationParts.map((part,index)=>{
  assert.equal(part.index,index);
  assert.ok(part.sql.startsWith(prefix),'Each part has a transaction and fixed reviewed settings');
  assert.ok(part.sql.endsWith('\nCOMMIT;'),'Each part commits independently');
  assert.equal(part.sql.includes('\r'),false,'Split installer preserves LF source literals');
  assert.equal(/DO \$draft_only\$|^ROLLBACK;\s*$/m.test(part.sql),false,'Each split body is independently reviewed');
  return part.sql.slice(prefix.length,-'\nCOMMIT;'.length);
 });
 const fullBody=production.sql.slice(production.sql.indexOf(prefix)+prefix.length,-'\nCOMMIT;\n'.length);
 assert.ok(partBodies.join('\n')===fullBody,'All 14 parts reproduce the same exact whole composition in order');
 assert.ok(production.installationParts[9].sql.includes('CREATE SCHEMA customer_source_membership_private'),'Membership and its exact adapters install together');
 assert.ok(production.installationParts[11].sql.includes('sales_operator_private.begin_metadata'),'Authority and recovery metadata context install together');
 assert.ok(production.installationParts[13].sql.includes('CREATE SCHEMA sales_activation_private'),'Activation schema and seal adapter install together');
});
