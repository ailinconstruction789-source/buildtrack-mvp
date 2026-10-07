// Catalog report verification inside the owned disposable cluster only.
import assert from 'node:assert/strict';
import {assertPlainSql} from './safety.mjs';
export const accountPreflightPath='sql/security/account_security_preflight_read_only.sql';
export function assertAccountPreflightSource(source) {
  assertPlainSql(source);
  // Not a general SQL sandbox: this checks the reviewed report's fixed envelope.
  const sql=source.replace(/--[^\r\n]*/g,'').trim();
  const tokens=sql.replace(/'(?:''|[^'])*'/g,"''");
  if(!/^BEGIN READ ONLY;/.test(sql) || !/ROLLBACK;\s*$/.test(sql)
    || tokens.split(';').filter(part=>part.trim()).length!==5
    || /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|DO|CALL|COPY|COMMIT|EXECUTE|set_config|pg_sleep|pg_notify|dblink)\b/i.test(tokens)
    || /\b(?:public|auth|sales_private|account_security_private)\s*\./i.test(tokens)
    || !sql.includes("SET LOCAL statement_timeout = '15s';") || !sql.includes("SET LOCAL lock_timeout = '2s';")) {
    throw new Error('Unexpected catalog-only read-only report');
  }
  return source;
}
const safeShape=report=>{
  assert.equal(report.reportVersion,'account-security-preflight-v1');
  assert.equal(report.scope,'catalog_only_no_business_rows');assert.equal(report.readOnly,true);
  assert.equal(report.deploymentApproval,'NOT_GRANTED');
  assert.equal(report.dataApiExposure,'UNKNOWN_VERIFY_DASHBOARD_AND_POSTGREST_CONFIGURATION');
  // These synthetic row values exist in the fixture but must never be selected.
  assert.doesNotMatch(JSON.stringify(report),/guard_admin@|guard_sales@|SYNTHETIC role integration|encrypted_password"\s*:/);
  return report;
};
export async function runAccountPreflight({query,source,stage}) {
  const cases=[];const check=(label,value)=>{assert.ok(value,label);cases.push(`${stage}: ${label}`);};
  check('owned synthetic loopback cluster only',(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"))==='t');
  assertAccountPreflightSource(source);
  const read=async()=>safeShape(JSON.parse(await query(source)));
  const report=await read();
  check('catalog report runs as read-only and never grants deployment approval',report.readOnly && report.deploymentApproval==='NOT_GRANTED');
  const relation=(data,name)=>data.relations.find(row=>row.name===name);
  if(stage==='empty') {
    check('absent Auth/account schemas are reported instead of raising',report.missingBaseRelations.length===3 && report.missingBaseColumns.length===12);
    check('missing client roles require review, not zero-privilege success',report.rolesPresent.length===0);
    check('absent functions are explicit',report.expectedFunctions.every(row=>!row.matchingSignatureExists && row.overloadCount===0));
  } else if(stage==='legacy') {
    check('base account prerequisites exist',report.missingBaseRelations.length===0 && report.missingBaseColumns.length===0);
    check('recognizes four legacy RPC signatures',report.expectedFunctions.filter(row=>row.name.startsWith('admin_')).every(row=>row.matchingSignatureExists && row.overloadCount===1));
    check('detects legacy Auth-writing function body hint without exposing body',report.functions.some(row=>row.authWriteHint));
    check('detects legacy broad account grants',relation(report,'public.users').privileges.some(row=>row.role==='anon' && row.tableWrite && row.tableSelect));
    check('records permissive true policy as a hint, not effective RLS verdict',report.policies.some(row=>row.name==='legacy_open_users' && row.literalTrueUsing && row.literalTrueCheck));
    check('new private objects remain absent',report.installationPath==='initial_install_candidate_needs_review' && !relation(report,'account_security_private.reviewed_roles').exists);
  } else if(stage==='prepared' || stage==='crm_staged') {
    check('existing namespace requires an upgrade review',report.installationPath==='existing_namespace_manual_upgrade_review_required');
    check('every expected public facade matches selected cutover scope',report.expectedFunctions.every(row=>
      stage==='crm_staged' && row.name==='app_touch_current_user'
        ? !row.matchingSignatureExists && row.overloadCount===0
        : row.matchingSignatureExists && row.overloadCount===1));
    check('all private security tables have RLS and no client table/column writes',report.relations.filter(row=>row.name.startsWith('account_security_private.')).every(row=>row.exists && row.rls
      && row.privileges.filter(role=>['anon','authenticated','service_role'].includes(role.role)).every(role=>!role.tableSelect&&!role.anyColumnSelect&&!role.tableWrite&&!role.columnWrite)));
    const accountColumns=report.columns.filter(row=>row.relation==='public.users');
    check('anonymous directory grants are username-only',accountColumns.every(row=>row.anonSelect===(row.name==='username')));
    check('Auth suspension trigger is enabled',report.triggers.some(row=>row.name==='buildtrack_crm_auth_revocation' && row.enabled==='O'));
    const restored=report.functions.find(row=>row.schema==='public' && row.name==='app_restore_sales_account_access');
    check('restore facade invoker/authenticated-only',!restored.securityDefiner && restored.execute.every(row=>row.allowed===(row.role==='authenticated')));
    check('reports operator-only primitive without exposing its body',report.functions.some(row=>row.name==='review_account_role' && row.definitionHash && !row.execute.some(role=>role.allowed)));
    // Demonstrate useful diagnostics with reversible local-only catalog drift.
    await query("GRANT SELECT(role),UPDATE(role) ON public.users TO anon;");
    const granted=await read();
    check('column grants are detected even with table grant absent',relation(granted,'public.users').privileges.some(row=>row.role==='anon' && !row.tableWrite && row.columnWrite)
      && granted.columns.some(row=>row.relation==='public.users'&&row.name==='role'&&row.anonSelect));
    await query('REVOKE SELECT(role),UPDATE(role) ON public.users FROM anon;');
    await query("CREATE FUNCTION public.app_current_actor(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';");
    check('unexpected overload detected',(await read()).expectedFunctions.some(row=>row.name==='app_current_actor' && row.overloadCount===2));
    await query('DROP FUNCTION public.app_current_actor(text);');
    await query("CREATE POLICY synthetic_metadata_probe ON public.users FOR SELECT TO authenticated USING ((auth.jwt()->'user_metadata'->>'role')='Admin');");
    check('editable metadata policy hint detected',(await read()).policies.some(row=>row.name==='synthetic_metadata_probe'&&row.metadataAuthorizationHint));
    await query('DROP POLICY synthetic_metadata_probe ON public.users;');
    await query('ALTER TABLE account_security_private.sales_restore_receipts DISABLE ROW LEVEL SECURITY;');
    check('disabled private RLS is visible',relation(await read(),'account_security_private.sales_restore_receipts').rls===false);
    await query('ALTER TABLE account_security_private.sales_restore_receipts ENABLE ROW LEVEL SECURITY;');
    const final=await read();
    const withoutTime=({generatedAt,...rest})=>{void generatedAt;return rest;};
    check('all diagnostic drift removed; repeated report changes no catalog',JSON.stringify(withoutTime(final))===JSON.stringify(withoutTime(report)));
  } else throw new Error('Unknown preflight fixture stage');
  // Keep the suite output small. Full catalog JSON is produced only by the SQL
  // report itself, not duplicated three times in every account regression run.
  return {assertions:cases.length,cases,catalogSummary:{installationPath:report.installationPath,
    deploymentApproval:report.deploymentApproval,relationsPresent:report.relations.filter(row=>row.exists).length,
    functionsInspected:report.functions.length,policiesInspected:report.policies.length,triggersInspected:report.triggers.length},productionChanged:false};
}
