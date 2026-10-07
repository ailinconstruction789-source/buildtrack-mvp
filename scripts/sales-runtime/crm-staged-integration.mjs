// Test-only alternative to the global trusted-actor cutover. No remote adapter,
// production seeds or deployment SQL; invoked only in a fresh owned cluster.
import assert from 'node:assert/strict';
import { crmIdentityFoundationTestBody } from './crm-identity-foundation.mjs';

const uid = n => `a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid = n => uid(n).replace('a025','b025');
const caller = (n,sql) => `BEGIN; SET LOCAL ROLE authenticated;
  DO $$ BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify({sub:uid(n),session_id:sid(n)})}',true); END $$;
  ${sql}; ROLLBACK;`;
const localIdentity = `SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$'
  AND current_user ~ '^runtime_[a-f0-9]+$'
  AND current_setting('buildtrack.synthetic_runtime',true)='on'
  AND inet_server_addr()='127.0.0.1'::inet;`;
const sharedFunctions = `SELECT jsonb_object_agg(p.oid::text,
  md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','account_security_private') AND p.prokind='f'`;

// Review history of an already-disabled former manager can legitimately change.
// Preserve every identity/enabled bit, plus ALL fields of active managers.
export const stagedAdminMembershipSnapshotSql = `SELECT jsonb_build_object(
  'memberships',(SELECT jsonb_agg(jsonb_build_object('authUserId',auth_user_id,
    'legacyUserId',legacy_user_id,'enabled',enabled) ORDER BY auth_user_id)
    FROM account_security_private.reviewed_admins),
  'activeRecords',(SELECT jsonb_agg(to_jsonb(a) ORDER BY auth_user_id)
    FROM account_security_private.reviewed_admins a WHERE enabled));`;
export function assertStagedAdminMembershipsUnchanged(before,after) {
    assert.deepEqual(JSON.parse(after),JSON.parse(before),'Sales restoration must preserve management permissions and active Admin records');
}

export async function prepareCrmStagedIntegration({query,source}) {
    assert.equal(await query(localIdentity),'t','Owned local database required');
    // Reproduce the existing presence signature and behavior, not a security fix.
    await query(`CREATE FUNCTION public.update_user_last_seen(p_username text)
      RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
      UPDATE public.users SET last_seen_at=now() WHERE username=p_username; $$;`);
    const baseline = JSON.parse(await query(sharedFunctions));
    await query(`BEGIN; ${crmIdentityFoundationTestBody(source)} COMMIT;`);
    assert.equal(await query('SELECT count(*)=0 FROM account_security_private.reviewed_roles;'),'t');
    // Match ONLY the synthetic fixtures expected by the existing downstream
    // adversarial tests. This is not the approved real-world 9-person roster.
    const roles=['Admin','Sales','Owner','Foreman','Site Engineer','QC','Project Planner','Procurement','Store'];
    for(let n=1;n<=roles.length;n++) {
        if(n>4) await query(`INSERT INTO auth.users(id,email) VALUES ('${uid(n)}','guard_role_${n}@buildtrack.local');
          INSERT INTO auth.sessions(id,user_id) VALUES ('${sid(n)}','${uid(n)}');
          INSERT INTO public.users(id,username,role) VALUES (${n},'guard_role_${n}','${roles[n-1]}');`);
        await query(`INSERT INTO account_security_private.reviewed_roles
          (auth_user_id,legacy_user_id,role,enabled,review_reference)
          VALUES('${uid(n)}',${n},'${roles[n-1]}',true,'SYNTHETIC staged compatibility fixture');`);
    }
    // Later suites use the renamed identity from the old actor tests. Exercise
    // the installed account guard rather than updating the two names directly.
    await query(caller(1,"DO $$ BEGIN PERFORM public.admin_change_username('guard_sales','guard_sales_new'); END $$")
        .replace(/ROLLBACK;$/,'COMMIT;'));
    return {baseline, assertions:2, cases:['owned local target verified','staged registry has no automatic seed'],
        globalTrustedActorInstalled:false,productionChanged:false};
}

export async function verifyCrmStagedIntegration({query,baseline}) {
    assert.equal(await query(localIdentity),'t','Owned local database required');
    const cases=[];
    const check=async(label,sql)=>{assert.equal(await query(sql),'t',label);cases.push(label);};
    const after = JSON.parse(await query(sharedFunctions));
    for(const [oid,hash] of Object.entries(baseline)) assert.equal(after[oid],hash,`Pre-existing shared function changed: ${oid}`);
    cases.push('all pre-existing shared function definitions owners and ACLs preserved through complete staged chain');
    await check('global presence replacement was never installed',"SELECT to_regprocedure('public.app_touch_current_user()') IS NULL;");
    await check('only the original Admin remains enabled for account management',`SELECT count(*)=1 AND bool_and(legacy_user_id=1)
      FROM account_security_private.reviewed_admins WHERE enabled;`);
    await check('legacy account command remains usable after CRM restoration',caller(1,
      "DO $$ BEGIN PERFORM public.admin_change_user_password('guard_sales_new','8765'); END $$; SELECT true"));
    await check('unreviewed employee still uses legacy presence but gets no CRM role',caller(10,
      "DO $$ BEGIN PERFORM public.update_user_last_seen('guard_unreviewed'); END $$; SELECT public.crm_v2_role()='' AND (SELECT last_seen_at IS NOT NULL FROM public.users WHERE id=10)"));
    await check('no implicit canonical role for unreviewed employee',`SELECT NOT EXISTS(
      SELECT 1 FROM account_security_private.reviewed_roles WHERE auth_user_id='${uid(10)}');`);
    await check('legacy presence unchanged even when staged role is disabled',`BEGIN;
      UPDATE account_security_private.reviewed_roles SET enabled=false WHERE legacy_user_id=4;
      SET LOCAL ROLE authenticated;
      DO $$ BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify({sub:uid(4),session_id:sid(4)})}',true);
        PERFORM public.update_user_last_seen('guard_foreman'); END $$;
      SELECT last_seen_at IS NOT NULL FROM public.users WHERE id=4; ROLLBACK;`);
    await check('directory still exposes only usernames before login',`SELECT
      has_column_privilege('anon','public.users','username','SELECT')
      AND NOT has_table_privilege('anon','public.users','SELECT')
      AND NOT has_column_privilege('anon','public.users','role','SELECT');`);
    return {assertions:cases.length,cases,productionChanged:false,realSupabaseAuthTested:false,
        sharedCommandsPreserved:true,globalTrustedActorInstalled:false};
}
