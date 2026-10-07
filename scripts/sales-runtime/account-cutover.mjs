// Only called inside the owned fresh loopback PostgreSQL runner. No network/env.
import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';
export const accountCutoverPath = 'supabase/migrations/20260925103516_account_guard_reviewed_cutover.sql';
const adminId = 'a0250000-0000-4000-8000-000000000001';
const literal = value => `'${String(value).replaceAll("'","''")}'`;
function operatorSettings(patch = {}) {
    const settings = { release:'account_guard_v1_20260925',project:'kbthmdedilswdmmczfay',
        client:'buildtrack.account-commands.v1',backup:'SYNTHETIC backup evidence only',admin:adminId,...patch };
    return Object.entries(settings).map(([key,value]) => `SET buildtrack.account_cutover_${key}=${literal(value)};`).join('\n');
}
export async function runAccountCutover({query,source,legacy}) {
    assertPlainSql(source);
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
    const cases=[];
    async function check(label,sql,expected='t') { assert.equal(await query(sql),expected,label);cases.push(label); }
    async function denied(label,sql,pattern) { await assert.rejects(query(sql),pattern);cases.push(label); }
    await denied('unattended migration cannot install',source,/ACCOUNT_CUTOVER_REVIEW_REQUIRED/);
    await check('unattended attempt creates no schema',"SELECT to_regnamespace('account_security_private') IS NULL;");
    for(const patch of [{release:'not-approved'},{project:'different-project'},{client:'legacy'},{backup:''}]) {
        await denied(`missing review gate ${Object.keys(patch)[0]}`,operatorSettings(patch)+source,/ACCOUNT_CUTOVER_REVIEW_REQUIRED/);
    }
    for(const admin of ['', 'not-a-uuid']) await denied('invalid reviewed UUID rejected',operatorSettings({admin})+source,/ACCOUNT_CUTOVER_ADMIN_REQUIRED/);
    // Rename only the synthetic fixture. Never use this setup on a real database.
    await query(`UPDATE public.users SET username='Admin' WHERE id=1;
      UPDATE auth.users SET email='admin@buildtrack.local' WHERE id='${adminId}';`);
    await denied('name alone cannot bind a different Auth identity',operatorSettings({admin:'a0250000-0000-4000-8000-000000000002'})+source,/ACCOUNT_CUTOVER_ADMIN_BINDING_CHANGED/);
    await query(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${adminId}';`);
    await denied('banned Admin cannot be bootstrapped',operatorSettings()+source,/ACCOUNT_CUTOVER_ADMIN_BINDING_CHANGED/);
    await query(`UPDATE auth.users SET banned_until=NULL WHERE id='${adminId}';`);
    await query(legacy.sql.replace('UPDATE auth.users','-- synthetic body drift\n    UPDATE auth.users'));
    await denied('unreviewed legacy body aborts before moving functions',operatorSettings()+source,/ACCOUNT_CUTOVER_BODY_CHANGED/);
    await query(legacy.sql);
    // Fail after all DDL/ACL work and the bootstrap INSERT, not only at preflight.
    assert.equal(source.split('GET DIAGNOSTICS v_count=ROW_COUNT;').length,2);
    await denied('late failure rolls back entire installation',operatorSettings()+source.replace(
        'GET DIAGNOSTICS v_count=ROW_COUNT;',"RAISE EXCEPTION 'SYNTHETIC_CUTOVER_ABORT'; GET DIAGNOSTICS v_count=ROW_COUNT;"),/SYNTHETIC_CUTOVER_ABORT/);
    await check('failed transaction restored original schema and ACL',`SELECT to_regnamespace('account_security_private') IS NULL
      AND has_table_privilege('authenticated','public.users','INSERT')
      AND (SELECT prosecdef FROM pg_proc WHERE oid='public.admin_create_user(text,text)'::regprocedure);`);
    await query(operatorSettings()+source);
    await check('one independently bound Admin enabled',`SELECT count(*)=1 AND bool_and(auth_user_id='${adminId}'::uuid AND legacy_user_id=1 AND enabled)
      FROM account_security_private.reviewed_admins;`);
    await check('existing staff data preserved',"SELECT count(*)=4 FROM public.users;");
    await check('all public command facades are invoker',`SELECT count(*)=4 AND bool_and(NOT prosecdef) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname IN ('admin_create_user','admin_delete_user','admin_change_username','admin_change_user_password');`);
    await check('capability describes atomic contract',"SELECT public.app_account_command_capabilities()=jsonb_build_object('contract','buildtrack.account-commands.v1','atomicForeman',true);");
    await check('direct account writes closed',"SELECT NOT has_table_privilege('authenticated','public.users','INSERT,UPDATE,DELETE') AND NOT has_table_privilege('anon','public.users','INSERT,UPDATE,DELETE');");
    const claims={sub:adminId,session_id:'b0250000-0000-4000-8000-000000000001',role:'authenticated'};
    const asAdmin=sql=>`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',${literal(JSON.stringify(claims))},true); ${sql}; COMMIT;`;
    await query(asAdmin("SELECT public.admin_create_user('cutover_synthetic_foreman','Foreman')"));
    await check('bootstrapped Admin uses atomic Foreman command',`SELECT EXISTS(SELECT 1 FROM public.foremen WHERE name='cutover_synthetic_foreman')
      AND EXISTS(SELECT 1 FROM public.users WHERE username='cutover_synthetic_foreman') AND EXISTS(SELECT 1 FROM auth.users WHERE email='cutover_synthetic_foreman@buildtrack.local');`);
    await query(asAdmin("SELECT public.admin_delete_user('cutover_synthetic_foreman')"));
    await check('atomic delete leaves no account or membership',`SELECT NOT EXISTS(SELECT 1 FROM public.foremen WHERE name='cutover_synthetic_foreman')
      AND NOT EXISTS(SELECT 1 FROM public.users WHERE username='cutover_synthetic_foreman') AND NOT EXISTS(SELECT 1 FROM auth.users WHERE email='cutover_synthetic_foreman@buildtrack.local');`);
    await denied('single approved Admin cannot be deleted by account command',asAdmin("SELECT public.admin_delete_user('Admin')"),/foreign key constraint/);
    await denied('reinstall cannot reset existing identities',operatorSettings()+source,/ACCOUNT_GUARD_SCHEMA_ALREADY_EXISTS/);
    // Restore original synthetic labels and empty membership for the existing
    // full authorization suite, which independently tests unreviewed Admin denial.
    await query(`DELETE FROM account_security_private.reviewed_admins;
      UPDATE public.users SET username='guard_admin' WHERE id=1;
      UPDATE auth.users SET email='guard_admin@buildtrack.local' WHERE id='${adminId}';`);
    return {assertions:cases.length,cases,productionChanged:false,realSupabaseAuthTested:false};
}
