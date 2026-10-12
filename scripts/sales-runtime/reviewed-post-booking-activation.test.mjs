// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reviewedPostBookingActivationAdapter,reviewedPostBookingActivationSql,reviewedPostBookingActivationDraftPath,
 postBookingActivationCommandSql,postBookingActivationRestoreSql} from './reviewed-post-booking-activation.mjs';
const root=process.cwd(),q=v=>"'"+v.replaceAll("'","''")+"'";
const adapterSource=readFileSync('sql/sales/deployment/central_visits_adapter.sql','utf8').replaceAll('\r\n','\n');
const definition=adapterSource.match(/CREATE OR REPLACE FUNCTION crm_external_private\.reject_unreviewed_activation\(\)[\s\S]*?\$\$;/)[0];
const body=definition.match(/AS \$\$([\s\S]*?)\$\$;/)[1];
const catalog=()=>({functions:[{schema:'crm_external_private',name:'reject_unreviewed_activation',body,definition,
 md5:createHash('md5').update(body).digest('hex'),owner:'runtime_fixture',config:['search_path=""'],securityDefiner:false,args:''}]});
const draft=readFileSync(reviewedPostBookingActivationDraftPath,'utf8').replaceAll('\r\n','\n');
const installer=draft.replace(/^BEGIN;\n/m,'').replace("DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: reviewed post-booking activation requires whole replacement proof'; END; $draft_only$;\n",'').replace(/^ROLLBACK;\s*$/m,'').trim();
const id='12345678-1234-1234-1234-123456789abc';
describe('reviewed post-booking activation',()=>{
 it('only appends one fallback and preserves every original byte after removing that hook',()=>{
  const a=reviewedPostBookingActivationAdapter(catalog());
  expect(a.beforeMd5).toBe('d9679ba1d8fa229c754033144ec0bf42');
  expect(a.afterMd5).toBe('6a792536781db79ac1e9ad7e48932797');
  const hook="    IF allowed IS DISTINCT FROM true AND TG_OP='UPDATE' THEN\n      allowed:=sales_activation_private.settings_allowed(to_jsonb(OLD),to_jsonb(NEW));\n    END IF;\n";
  expect(a.adaptedBody.replace(hook,'')).toBe(a.originalBody);
  expect(a.adaptedBody.split(hook)).toHaveLength(2);
  expect(a.sql).toContain(q(a.originalBody));
  expect(a.sql).toContain('pg_get_userbyid(proowner)=current_user');
  expect(a.sql).toContain('NOT prosecdef');
 });
 it.each(['body','hash','config','definer','arguments','duplicate'])('refuses unreviewed source/catalog %s drift',kind=>{
  const c=catalog(),f=c.functions[0];
  if(kind==='body')f.body=f.body.replace('booking_activation_allowed','other_gate');
  if(kind==='hash')f.md5='0'.repeat(32);
  if(kind==='config')f.config=['search_path=public'];
  if(kind==='definer')f.securityDefiner=true;
  if(kind==='arguments')f.args='p_value jsonb';
  if(kind==='duplicate')c.functions.push({...f});
  expect(()=>reviewedPostBookingActivationAdapter(c)).toThrow(/POST_BOOKING_ACTIVATION_/);
 });
 it('accepts LF-normalized catalog input without changing authority',()=>{
  const c=catalog();c.functions[0].body=body.replaceAll('\n','\r\n');
  c.functions[0].definition=definition.replaceAll('\n','\r\n');
  c.functions[0].md5=createHash('md5').update(c.functions[0].body).digest('hex');
  expect(reviewedPostBookingActivationAdapter(c).afterMd5).toBe('6a792536781db79ac1e9ad7e48932797');
 });
 it('requires an exact separately reviewed installer and keeps the source sentinel',()=>{
  expect(()=>reviewedPostBookingActivationSql({root,catalog:catalog()})).toThrow(/REVIEWED_INSTALLER/);
  expect(()=>reviewedPostBookingActivationSql({root,catalog:catalog(),reviewedInstallSql:draft})).toThrow(/REVIEWED_INSTALLER/);
  expect(()=>reviewedPostBookingActivationSql({root,catalog:catalog(),reviewedInstallSql:installer+'\nGRANT ALL ON SCHEMA sales_activation_private TO authenticated;'})).toThrow(/REVIEWED_INSTALLER/);
  const ready=reviewedPostBookingActivationSql({root,catalog:catalog(),reviewedInstallSql:installer});
  expect(ready.sql.startsWith('BEGIN;')).toBe(true);expect(ready.sql.endsWith('COMMIT;')).toBe(true);
  expect(draft).toContain("RAISE EXCEPTION 'DESIGN ONLY:");
 });
 it('writes explicit reviewed IDs and safely quotes references without claims',()=>{
  const apply=postBookingActivationCommandSql(id,"Human approved ' whole replacement");
  expect(apply).toContain("'Human approved '' whole replacement'");
  expect(postBookingActivationRestoreSql(id,'Restore reviewed')).toContain('sales_activation_private.restore');
  expect(apply).not.toMatch(/set_config|request\.jwt|auth\.uid|auth\.sessions/);
  expect(()=>postBookingActivationCommandSql('not-id','yes')).toThrow();
  expect(()=>postBookingActivationRestoreSql(id,'')).toThrow();
 });
 it('pins full source, original archive and completed genuine owner job',()=>{
  for(const evidence of ['<>958','<>957','<>948','<>298','<>965',"job.manifest->>'mode'='apply'",'NOT receipt.reviewer_is_authenticated_actor',
   'receipt.executed_by_db_role=current_user','receipt.session_db_role=session_user','sales_recovery_private.recoveries',
   "r.payload->>'sourceSha256'='7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'",
   "source_sha256='9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23'"])
   expect(draft).toContain(evidence);
 });
 it('distinguishes the prepared membership cohort key from the recovery run key',()=>{
  const digest='379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506';
  const preparer=readFileSync('scripts/sales-import/prepare-full-canonical-payload.mjs','utf8');
  expect(preparer).toContain('datasetKey: `full-cohort-${manifest.adapterPlanDigest}`');
  expect(draft).toContain("WHERE h.id AND r.dataset_key='full-cohort-"+digest+"'");
  expect(draft).toContain("WHERE r.id=p_run AND r.dataset_key='full-replacement-"+digest+"'");
 });
 it('limits the permit to the exact settings pair, PID, transaction and DB owner',()=>{
  for(const evidence of ["p_old-'post_booking_enabled'=p_new-'post_booking_enabled'",'p.transaction_id=txid_current()',
   'p.backend_pid=pg_backend_pid()','p.operator_role=current_user','p.old_settings=p_old AND p.new_settings=p_new',
   'current_user IS DISTINCT FROM session_user','pg_get_userbyid(relowner)',"AND j.value IS DISTINCT FROM 'false'::jsonb"])
   expect(draft).toContain(evidence);
  expect(draft).not.toMatch(/GRANT|SET ROLE|DISABLE TRIGGER|set_config|request\.jwt/);
 });
 it('requires exact CRM settings restoration before core recovery',()=>{
  expect(draft).toContain("after_state->'public'->'crm_settings'=jsonb_build_array(before_row)");
  expect(draft).toContain('before_row IS DISTINCT FROM release.after_settings');
  expect(draft).toContain('IS DISTINCT FROM release.before_settings');
  expect(draft).toContain('SET post_booking_enabled=false');
  expect(draft).toContain('INSERT INTO sales_activation_private.restorations');
 });
 it('leaves the activation trigger and restrictive private ACL intact',()=>{
  expect(draft).toContain("tgenabled='O' AND tgtype=23");
  expect(draft).toContain('tgnargs=0 AND tgqual IS NULL');
  expect(draft).toContain('ENABLE ROW LEVEL SECURITY');
  expect(draft).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_activation_private FROM PUBLIC,anon,authenticated,service_role');
  expect(draft).toContain('POST_BOOKING_ACTIVATION_LEDGER_IMMUTABLE');
  expect(draft).toContain("'crm_external_private.source_records','immutable_history',58");
  expect(draft).toContain('POST_BOOKING_ACTIVATION_IMMUTABLE_SOURCE_REQUIRED');
  expect(draft).toContain("has_schema_privilege(actor.name,'sales_activation_private','USAGE')");
 });
});
