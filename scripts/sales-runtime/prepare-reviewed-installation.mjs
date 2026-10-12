// Pure compilation of the exact schema composition proven in an owned runtime.
// Does not connect, deploy, authorize an Auth user, or import business rows.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value).digest('hex');
const paths=[
 'sql/sales/20_sales_reports_read_draft.sql',
 'sql/sales/21_post_booking_draft.sql',
 'sql/sales/22_customer_deal_details_draft.sql',
 'sql/sales/25_unknown_historical_evidence_draft.sql',
 'sql/sales/26_reviewed_import_details_draft.sql',
 'sql/sales/28_historical_sale_revision_draft.sql',
 'sql/sales/27_source_bound_customer_creation_draft.sql',
 'sql/sales/29_imported_history_projection_draft.sql',
 'sql/sales/30_rental_source_retirement_draft.sql',
];

/** The design source stays unchanged; only a separate reviewed artifact is executable. */
function reviewedBody(source) {
 // psql's line reader used for the native proof normalizes Windows newlines.
 // The HTTP migration endpoint does not; exact source literals must use the
 // same LF bytes as pg_get_functiondef/prosrc comparisons in the proof.
 source=source.replaceAll('\r\n','\n');
 const guards=[...source.matchAll(/DO \$draft_only\$[\s\S]*?\$draft_only\$;/g)];
 assert.equal(guards.length,1,'Exactly one explicit design sentinel is required');
 assert.match(guards[0][0],/RAISE EXCEPTION 'DESIGN ONLY:/);
 const withoutGuard=source.replace(guards[0][0],'-- Design sentinel cleared only in this reviewed installation artifact.');
 assert.equal((withoutGuard.match(/^BEGIN;\r?$/gm)??[]).length,1,'One outer draft transaction required');
 assert.match(withoutGuard,/\bROLLBACK;\s*$/);
 return withoutGuard.replace(/^BEGIN;\r?$/m,'').replace(/\bROLLBACK;\s*$/,'');
}

export function prepareReviewedInstallation({root,report,reviewReference,designatedReviewerId,databaseOwner}) {
 assert.equal(report.status,'passed','A completely successful owned native report is required');
 assert.equal(report.stopped,true,'Disposable runtime must be stopped');
 assert.match(reviewReference,/\S/);
 assert.match(designatedReviewerId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 const results=report.results;
 assert.deepEqual(results.ownerCommitted.counts,{rows:958,sales:298,customers:957,interests:948,activePlots:213});
 assert.equal(results.ownerCommitted.claimsUsed,false);
 assert.equal(results.ownerRestored.restored,true);
 assert.equal(results.ownerRestored.claimsUsed,false);
 assert.equal(results.ownerNativeBarriers.passed,4);
 assert.equal(results.ownerReplayDenial.passed,1);
 assert.equal(results.fullSchemaRestore.passed,true);
 assert.equal(results.postBookingActivated.postBookingEnabled,true);
 assert.equal(results.postBookingActivationRestored.exactOriginalSettingsRestored,true);
 assert.equal(results.canonicalWorkspaceRead.sales,298);
 assert.equal(results.canonicalWorkspaceRead.forecastDays,42);
 assert.equal(results.canonicalWorkspaceRead.customersIncludingNative,958);
 assert.ok(results.canonicalWorkspaceRead.passed>=15);
 assert.equal(results.sourceMembershipSelectParityPhases.length,2);
 for(const [index,phase] of results.sourceMembershipSelectParityPhases.entries()) {
  assert.ok(phase.passed>=18 && phase.cases.length>=18,'Actual-role checks must all pass');
  assert.equal(phase.authorityActive,index===0);
  assert.equal(phase.ownerRoleCovered,true);
  assert.deepEqual(new Set(phase.sessionsValidated),new Set(['admin','owner','sales']));
  assert.deepEqual(phase.missingSessionRoles,[]);
 }
 for(const [path,digest] of Object.entries(report.sources)) {
  if(path.startsWith('scripts/')||path.startsWith('sql/'))
   assert.equal(hash(readFileSync(join(root,path))),digest,'Attested source changed: '+path);
 }
 const sourceDigests={};
 const draft=path=>{
  const bytes=readFileSync(join(root,path));
  assert.equal(hash(bytes),report.sources[path],'Missing exact native source attestation: '+path);
  sourceDigests[path]=hash(bytes);return reviewedBody(bytes.toString('utf8'));
 };
 const membership=results.membershipInstallation;
 const owner=results.ownerInstallation;
 assert.equal(membership.entries.length,29);
 let membershipSql=membership.sql;
 if(databaseOwner!==undefined){
  // Preserve the exact body/hash/ACL checks while binding the reviewed owner
  // predicate to the independently verified target DB owner, never the
  // disposable runtime account.
  assert.equal(databaseOwner,'postgres','Verified Supabase DB owner required');
  const nativeOwner='runtime_'+report.database.replace(/^buildtrack_sales_runtime_/,'');
  assert.match(nativeOwner,/^runtime_[a-f0-9]{24}$/);
  assert.ok(membership.entries.every(entry=>entry.owner===nativeOwner));
  const predicate=`owner_name IS DISTINCT FROM ${q(nativeOwner)}`;
  assert.equal(membershipSql.split(predicate).length-1,29,'Exact owner predicates required');
  membershipSql=membershipSql.replaceAll(predicate,`owner_name IS DISTINCT FROM ${q(databaseOwner)}`);
  assert.doesNotMatch(membershipSql,/runtime_[a-f0-9]{24}/);
 }
 assert.equal(owner.authIdentitiesFabricated,false);
 for(const key of ['authority','recovery','full'])assert.match(owner.reviewedSql[key],/\S/);
 assert.equal((owner.reviewedSql.recovery.match(/DO \$recovery_sale_identity_fks\$/g)??[]).length,1);
 const parts=paths.map(draft);
 parts.push(draft('sql/sales/31_customer_source_membership_draft.sql'),membershipSql,
  draft('sql/sales/32_customer_replacement_recovery_draft.sql'),
  draft('sql/sales/33_customer_replacement_operator_draft.sql'),owner.reviewedSql.authority,
  `SELECT sales_operator_private.begin_metadata(${q(designatedReviewerId)}::uuid);`,
  owner.reviewedSql.recovery,'SELECT sales_operator_private.finish_metadata();',owner.reviewedSql.full,
  draft('sql/sales/34_canonical_workspace_read_draft.sql'),
  draft('sql/sales/35_reviewed_post_booking_activation_draft.sql'),results.postBookingActivationInstallation.adapterSql);
 const sql=`-- Reviewed installation only: ${reviewReference.replaceAll('\n',' ')}\n`+
  `-- Native proof: ${report.directory}; no business import or feature activation here.\n`+
  "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';\n"+parts.join('\n')+'\nCOMMIT;\n';
 assert.doesNotMatch(sql,/request\s*\.\s*jwt|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+auth\s*\./i);
 assert.doesNotMatch(sql,/DO \$draft_only\$|^ROLLBACK;\s*$/m);
 const installationParts=[...parts.slice(0,9),parts[9]+'\n'+parts[10],parts[11],parts.slice(12,18).join('\n'),parts[18],parts.slice(19).join('\n')]
  .map((body,index)=>({index,sql:"BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';\n"+body+'\nCOMMIT;'}));
 assert.equal(installationParts.length,14);
 return {sql,sha256:hash(sql),installationParts,sourceDigests,scope:'schema and exact-source adapters only',
  productionExecuted:false,authIdentityFabricated:false,nativeReportDirectory:report.directory};
}
