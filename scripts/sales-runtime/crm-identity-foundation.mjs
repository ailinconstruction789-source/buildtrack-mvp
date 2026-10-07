// Disposable PostgreSQL only. No remote connection, credentials or installer.
import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';

export const crmIdentityFoundationPath = 'sql/security/crm_identity_foundation_draft.sql';
export function crmIdentityFoundationTestBody(source) {
    assertPlainSql(source);
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: staged CRM identity requires separate deployment review';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM|COMMIT)\b/i.test(source)) {
        throw new Error('Unexpected CRM identity foundation draft wrapper');
    }
    // Fragment used ONLY inside a test transaction ending in ROLLBACK.
    return source.replace(wrapper, '').replace(/\bROLLBACK;\s*$/, '');
}
const id = n => `a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid = n => id(n).replace('a025','b025');
const claims = (n, patch = {}) => ({ sub:id(n), session_id:sid(n), ...patch });
const asCaller = (n, sql, patch = {}, role = 'authenticated') => `SET LOCAL ROLE ${role};
    DO $$ BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify(claims(n,patch))}',true); END $$;
    ${sql}; RESET ROLE;`;
const seed = (n = 2, role = 'Sales') => `INSERT INTO account_security_private.reviewed_roles
    (auth_user_id,legacy_user_id,role,enabled,review_reference)
    VALUES ('${id(n)}',${n},'${role}',true,'SYNTHETIC LOCAL REVIEW');`;

export async function runCrmIdentityFoundation({query,source}) {
    // Defense against calling this helper with a real project's query function.
    assert.equal(await query(`SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      AND current_user ~ '^runtime_[a-f0-9]+$'
      AND inet_server_addr() = '127.0.0.1'::inet;`), 't', 'Owned local database required');
    let assertions = 0; const cases = [];
    const body = crmIdentityFoundationTestBody(source);
    // The fixture deliberately models the existing legacy RPC, not a security fix.
    const presence = `CREATE FUNCTION public.update_user_last_seen(p_username text)
      RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
      UPDATE public.users SET last_seen_at=now() WHERE username=p_username; $$;`;
    const snapshot = `SELECT md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text,'|' ORDER BY p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','account_security_private') AND p.prokind='f'
        AND p.proname NOT IN ('current_actor','app_current_actor')`;
    const base = `BEGIN; ${presence}
      CREATE TEMP TABLE staged_shared_snapshot AS ${snapshot}; ${body}`;
    async function check(label, sql) {
        assert.equal(await query(`${base}\n${sql}\nROLLBACK;`), 't', label);
        assertions++; cases.push(label);
    }
    async function deny(label, sql, pattern = /permission denied|APP_ACTOR_REQUIRED/) {
        await assert.rejects(query(`${base}\n${sql}\nROLLBACK;`), pattern);
        assertions++; cases.push(label);
    }
    await assert.rejects(query(source), /DESIGN ONLY: staged CRM identity/);
    assertions++; cases.push('raw draft cannot execute');
    await check('all existing function definitions, owners and ACLs unchanged',
        `SELECT (${snapshot})=(SELECT md5 FROM staged_shared_snapshot);`);
    await check('registry empty and RLS enabled', `SELECT
      NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles)
      AND (SELECT relrowsecurity FROM pg_class WHERE oid='account_security_private.reviewed_roles'::regclass);`);
    await check('no CRM schema, feature settings, or presence replacement', `SELECT
      to_regnamespace('sales_private') IS NULL AND to_regclass('public.crm_settings') IS NULL
      AND to_regprocedure('public.app_touch_current_user()') IS NULL;`);
    await check('username dropdown remains readable', asCaller(2,
        'SELECT count(username)=4 FROM public.users', {}, 'anon'));
    await deny('signed-out role read still denied', asCaller(2,'SELECT role FROM public.users',{},'anon'));
    await check('staff directory remains readable', asCaller(4,'SELECT count(role)=4 FROM public.users'));
    await check('existing Admin command works with empty staged registry', asCaller(1,
        "DO $$ BEGIN PERFORM public.admin_change_user_password('guard_sales','9876'); END $$")
        + `SELECT encrypted_password IS NOT NULL FROM auth.users WHERE id='${id(2)}';`);
    await check('unreviewed Foreman presence works unchanged', asCaller(4,
        "DO $$ BEGIN PERFORM public.update_user_last_seen('guard_foreman'); END $$")
        + 'SELECT last_seen_at IS NOT NULL FROM public.users WHERE id=4;');
    await deny('unreviewed legacy Admin gains no new actor access',asCaller(1,'SELECT public.app_current_actor()'));
    await check('reviewed Sales receives own trusted role not forged metadata',seed()+asCaller(2,
        "SELECT public.app_current_actor()->>'role'='Sales' AND (public.app_current_actor()->>'canManageAccounts')::boolean=false",
        {user_metadata:{role:'Admin'},app_metadata:{role:'Admin'}}));
    for (const role of ['anon','authenticated','service_role']) {
        await deny(`registry read denied ${role}`,seed()+asCaller(2,'SELECT * FROM account_security_private.reviewed_roles',{},role));
        await deny(`registry write denied ${role}`,seed()+asCaller(2,"UPDATE account_security_private.reviewed_roles SET role='Admin'",{},role));
    }
    for (const role of ['anon','service_role']) {
        await deny(`actor endpoint denied ${role}`,seed()+asCaller(2,'SELECT public.app_current_actor()',{},role));
    }
    for (const [label,patch] of [
        ['missing session',{session_id:null}], ['invalid session',{session_id:'bad'}],
        ['other session',{session_id:sid(1)}], ['missing user',{sub:null}],
    ]) await deny(label,seed()+asCaller(2,'SELECT public.app_current_actor()',patch));
    for (const [label,change] of [
        ['disabled review','UPDATE account_security_private.reviewed_roles SET enabled=false;'],
        ['banned',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${id(2)}';`],
        ['deleted',`UPDATE auth.users SET deleted_at=now() WHERE id='${id(2)}';`],
        ['anonymous Auth',`UPDATE auth.users SET is_anonymous=true WHERE id='${id(2)}';`],
        ['expired session',`UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${sid(2)}';`],
        ['removed session',`DELETE FROM auth.sessions WHERE id='${sid(2)}';`],
    ]) await deny(label,seed()+change+asCaller(2,'SELECT public.app_current_actor()'));
    await deny('rerun cannot overwrite staged foundation',body,/CRM_IDENTITY_EXISTING_STAGE_REVIEW_REQUIRED/);
    assert.equal(await query(`SELECT to_regclass('account_security_private.reviewed_roles') IS NULL
      AND to_regprocedure('public.app_current_actor()') IS NULL
      AND to_regprocedure('public.update_user_last_seen(text)') IS NULL;`),'t');
    assertions++; cases.push('all staged tests rolled back before original suite');
    return {assertions,cases,productionChanged:false,realSupabaseAuthTested:false,stagedObjectsRolledBack:true};
}
