// Only the independently verified fresh-loopback runner supplies query.
// No connection, environment loader, production installer or real credentials.
import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';

export const loginDirectoryCutoverPath = 'supabase/migrations/20260928075605_login_directory_reviewed_cutover.sql';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
function settings(patch = {}) {
    const values = { release:'login_directory_v1_20260928', project:'kbthmdedilswdmmczfay',
        client:'f404377c4e5cef2088de1f4d1805164967608539', acceptance:'SYNTHETIC acceptance only',
        backup:'SYNTHETIC backup only', old_tabs_reviewed:'yes', ...patch };
    return Object.entries(values).map(([key,value]) => `SET buildtrack.directory_${key}=${literal(value)};`).join('\n');
}

export async function runLoginDirectoryCutover({ query, source }) {
    assertPlainSql(source);
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
    const cases=[];
    const denied=async (label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
    const check=async (label,sql)=>{assert.equal(await query(sql),'t',label);cases.push(label);};
    const snapshotSql=`SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.users u),
      'commands',(SELECT jsonb_agg(jsonb_build_array(oid,prosrc,proacl,prosecdef) ORDER BY oid) FROM pg_proc
        WHERE pronamespace IN ('public'::regnamespace,'account_security_private'::regnamespace)),
      'admins',(SELECT jsonb_agg(to_jsonb(a) ORDER BY auth_user_id) FROM account_security_private.reviewed_admins a));`;
    const before=await query(snapshotSql);
    await denied('no operator evidence cannot install',source,/LOGIN_DIRECTORY_CUTOVER_REVIEW_REQUIRED/);
    for(const patch of [{release:''},{project:'wrong-project'},{client:'9df9608'},
        {acceptance:''},{acceptance:'        '},{backup:''},{old_tabs_reviewed:'no'}]) {
        await denied(`reject ${Object.keys(patch)[0]} evidence`,settings(patch)+source,/LOGIN_DIRECTORY_CUTOVER_REVIEW_REQUIRED/);
    }
    await query('GRANT UPDATE(username) ON public.users TO anon;');
    await denied('unsafe column write stops cutover',settings()+source,/LOGIN_DIRECTORY_UNSAFE_ACCOUNT_WRITES/);
    await query('REVOKE UPDATE(username) ON public.users FROM anon;');
    await query('ALTER POLICY account_guard_no_client_update ON public.users USING (true);');
    await denied('same policy name with unsafe body is rejected',settings()+source,/LOGIN_DIRECTORY_UNSAFE_ACCOUNT_WRITES/);
    await query('ALTER POLICY account_guard_no_client_update ON public.users USING (false);');
    await query('GRANT SELECT ON public.users TO synthetic_guard_delegate; GRANT synthetic_guard_delegate TO anon;');
    await denied('inherited broad SELECT aborts and rolls back',settings()+source,/LOGIN_DIRECTORY_UNEXPECTED_INHERITED_READ_GRANT/);
    await check('failed postcheck restores policy and original reads',`SELECT has_table_privilege('anon','public.users','SELECT') AND NOT EXISTS
      (SELECT 1 FROM pg_policy WHERE polrelid='public.users'::regclass AND polname='login_name_public_read');`);
    await query('REVOKE synthetic_guard_delegate FROM anon; REVOKE SELECT ON public.users FROM synthetic_guard_delegate;');
    await query(settings()+source);
    assert.equal(await query(snapshotSql),before,'cutover must not change users, commands, presence or reviewed Admins');
    cases.push('users, function bodies/ACLs and reviewed Admin bindings preserved');
    await denied('reinstall cannot silently replace state',settings()+source,/LOGIN_DIRECTORY_ALREADY_CHANGED_REVIEW_REQUIRED/);
    return {assertions:cases.length,cases,productionChanged:false,realSupabaseAuthTested:false};
}
