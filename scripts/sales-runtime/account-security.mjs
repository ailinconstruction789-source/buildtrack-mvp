// Local account guard suite only. query is supplied by the verified fresh-cluster
// runner; this module opens no connection, reads no .env and accepts no DB URL.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';
import { loginDirectoryDraftPath, runLoginDirectory } from './login-directory.mjs';
import { loginDirectoryCutoverPath } from './login-directory-cutover.mjs';
import { trustedActorDraftPath, runTrustedActor } from './trusted-actor.mjs';
import { roleReviewDraftPath, runRoleReview } from './role-review.mjs';
import { crmRoleAlignmentPath, crmAlignmentFixturePath, crmAlignmentSalesPaths, runCrmRoleAlignment } from './crm-role-alignment.mjs';
import { workflowDraftPaths, workflowFacadePath, runCrmWorkflowIntegration } from './crm-workflow-integration.mjs';
import { crmAuthRevocationPath, runCrmAuthRevocation } from './crm-auth-revocation.mjs';
import { accountAccessReadPath, runAccountAccessRead } from './account-access-read.mjs';
import { accountAccessRestorePath, runAccountAccessRestore } from './account-access-restore.mjs';
import { accountPreflightPath, runAccountPreflight } from './account-preflight.mjs';
import { reviewedLegacyAccountFunctions } from './reviewed-legacy-accounts.mjs';
import { accountCutoverPath, runAccountCutover } from './account-cutover.mjs';
import { crmIdentityFoundationPath, runCrmIdentityFoundation } from './crm-identity-foundation.mjs';
import { prepareCrmStagedIntegration, verifyCrmStagedIntegration, stagedAdminMembershipSnapshotSql, assertStagedAdminMembershipsUnchanged } from './crm-staged-integration.mjs';
import { crmFoundationCandidatePath, runCrmFoundationCutover } from './crm-foundation-cutover.mjs';

export const accountDraftPath = 'sql/security/account_admin_guard_draft.sql';
export function accountTestBody(source) {
    assertPlainSql(source);
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: account administration guard needs reviewed identities and isolated verification';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) {
        throw new Error('Unexpected account draft wrapper');
    }
    return source.replace(wrapper, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}

const actorId = suffix => `a0250000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const sessionId = suffix => `b0250000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const claims = (actor = '1', patch = {}) => ({ sub: actorId(actor), session_id: sessionId(actor), role: 'authenticated', ...patch });
// Values here are only controlled synthetic constants. Quotes are still escaped.
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const request = (role, jwt, sql) => `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims',${literal(JSON.stringify(jwt))},true); ${sql}; COMMIT;`;

export async function runAccountSecurity({ query, root, report, stagedCrm = false, sealedFoundation = false }) {
    assert.equal(typeof stagedCrm,'boolean','Explicit staged test mode required');
    assert.equal(typeof sealedFoundation,'boolean');
    assert.ok(!(stagedCrm && sealedFoundation),'Choose one isolated installation path');
    const sources = [accountDraftPath, accountCutoverPath, loginDirectoryDraftPath, trustedActorDraftPath, roleReviewDraftPath, crmRoleAlignmentPath, crmAlignmentFixturePath, ...crmAlignmentSalesPaths, ...workflowDraftPaths, workflowFacadePath, crmAuthRevocationPath, accountAccessReadPath, accountAccessRestorePath, accountPreflightPath, 'sql/security/runtime/account_guard_fixture.sql', 'fix_auth_users.sql', 'sync_auth_users.sql', 'scripts/sales-runtime/reviewed-legacy-accounts.mjs', 'scripts/sales-runtime/account-cutover.mjs'];
    sources.push(loginDirectoryCutoverPath, 'scripts/sales-runtime/login-directory-cutover.mjs');
    sources.push(crmIdentityFoundationPath, 'scripts/sales-runtime/crm-identity-foundation.mjs');
    sources.push('scripts/sales-runtime/crm-staged-integration.mjs');
    if (sealedFoundation) sources.push(crmFoundationCandidatePath,'scripts/sales-runtime/crm-foundation-cutover.mjs','sync_plot_sales_status.sql');
    const texts = new Map(sources.map(path => [path, readFileSync(join(root,path),'utf8')]));
    const hash = text => createHash('sha256').update(text).digest('hex');
    for (const [path,text] of texts) report.sources[path] = hash(text);
    const preflightEmpty=await runAccountPreflight({query,source:texts.get(accountPreflightPath),stage:'empty'});
    await query(texts.get('sql/security/runtime/account_guard_fixture.sql'));
    // Compile reviewed live-equivalent bodies, never old migration DML/trigger drops.
    const legacy = reviewedLegacyAccountFunctions(texts);
    await query(legacy.sql);
    const compiledHashes = JSON.parse(await query(`SELECT json_object_agg(proname,md5(prosrc)) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname IN ('admin_create_user','admin_delete_user','admin_change_username','admin_change_user_password');`));
    assert.deepEqual(compiledHashes, legacy.normalizedHashes, 'Compiled body differs from reviewed live snapshot after CRLF normalization');
    report.reviewedLegacyBodyHashes = legacy.hashes;
    report.compiledLegacyNormalizedHashes = compiledHashes;
    const preflightLegacy=await runAccountPreflight({query,source:texts.get(accountPreflightPath),stage:'legacy'});
    // Draft must be unusable as-is, with all DDL rolled back on error.
    await assert.rejects(query(texts.get(accountDraftPath)), /DESIGN ONLY: account administration/);
    assert.equal(await query("SELECT to_regnamespace('account_security_private') IS NULL;"),'t');
    const accountCutover = await runAccountCutover({query,source:texts.get(accountCutoverPath),legacy});
    await query(`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM service_role,synthetic_guard_delegate;
      ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM service_role,synthetic_guard_delegate;`);

    let assertions = 2;
    const cases = [];
    async function deny(label, role, jwt, sql, pattern = /permission denied|ACCOUNT_ADMIN_REQUIRED/i) {
        await assert.rejects(query(request(role,jwt,sql)),pattern);
        assertions++; cases.push(label);
    }
    async function check(label, sql, expected = 't') {
        assert.equal((await query(sql)).replaceAll('\r\n','\n'),expected,label); assertions++; cases.push(label);
    }
    const commands = [
        "SELECT public.admin_create_user('guard_unauthorized','Admin')",
        "SELECT public.admin_delete_user('guard_sales')",
        "SELECT public.admin_change_username('guard_sales','guard_unauthorized')",
        "SELECT public.admin_change_user_password('guard_sales','9876')",
    ];
    await check('inherited and service default grants removed from original commands', `SELECT bool_and(
      NOT has_function_privilege(r,p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated','service_role','synthetic_guard_delegate']) r
      WHERE n.nspname='account_security_private' AND p.proname IN
        ('admin_create_user','admin_delete_user','admin_change_username','admin_change_user_password','mutate_account_with_foreman');`);
    await check('default grants cannot read or approve Admin membership', `SELECT bool_and(NOT
      has_table_privilege(r,'account_security_private.reviewed_admins','SELECT,INSERT,UPDATE,DELETE'))
      FROM unnest(ARRAY['anon','authenticated','service_role','synthetic_guard_delegate']) r;`);
    await deny('service role cannot invoke account facade','service_role',{},commands[0]);
    await deny('private atomic helper is not a second public entry point','authenticated',claims(),
      "SELECT account_security_private.mutate_account_with_foreman('create','injected','Admin')");
    // No automatic trusting of a legacy Admin label.
    await deny('unreviewed legacy Admin denied','authenticated',claims(),commands[0]);
    await query(`INSERT INTO account_security_private.reviewed_admins(auth_user_id,legacy_user_id,enabled,review_reference)
      VALUES ('${actorId('1')}',1,true,'SYNTHETIC ONLY - reviewed by test harness');`);
    for (const [index,sql] of commands.entries()) {
        await deny(`anon command ${index}`,'anon',{},sql);
        for (const actor of ['2','3','4']) await deny(`non-admin ${actor} command ${index}`,'authenticated',claims(actor),sql);
        await deny(`forged metadata command ${index}`,'authenticated',claims('2',{ user_metadata: { role:'Admin' }, app_metadata:{role:'Admin'} }),sql);
    }
    for (const [label,jwt] of [
        ['no identity',{}], ['missing session',claims('1',{session_id:null})],
        ['invalid session',claims('1',{session_id:'not-a-uuid'})],
        ['other users session',claims('1',{session_id:sessionId('2')})],
        ['nonexistent session',claims('1',{session_id:sessionId('99')})],
    ]) await deny(label,'authenticated',jwt,commands[0]);
    for (const [label,change,restore] of [
        ['disabled membership','UPDATE account_security_private.reviewed_admins SET enabled=false','UPDATE account_security_private.reviewed_admins SET enabled=true'],
        ['banned account',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${actorId('1')}'`,`UPDATE auth.users SET banned_until=NULL WHERE id='${actorId('1')}'`],
        ['deleted account',`UPDATE auth.users SET deleted_at=now() WHERE id='${actorId('1')}'`,`UPDATE auth.users SET deleted_at=NULL WHERE id='${actorId('1')}'`],
        ['anonymous auth account',`UPDATE auth.users SET is_anonymous=true WHERE id='${actorId('1')}'`,`UPDATE auth.users SET is_anonymous=false WHERE id='${actorId('1')}'`],
        ['expired session',`UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${sessionId('1')}'`,`UPDATE auth.sessions SET not_after=NULL WHERE id='${sessionId('1')}'`],
    ]) {
        await query(`${change};`); await deny(label,'authenticated',claims(),commands[0]); await query(`${restore};`);
    }
    await query(`DELETE FROM auth.sessions WHERE id='${sessionId('1')}';`);
    await deny('removed session with old JWT','authenticated',claims(),commands[0]);
    await query(`INSERT INTO auth.sessions(id,user_id) VALUES ('${sessionId('1')}','${actorId('1')}');`);
    await check('denied commands left data unchanged',"SELECT count(*)=4 AND bool_and(username LIKE 'guard_%') FROM public.users;");
    await check('denied reset did not alter credentials',"SELECT bool_and(encrypted_password IS NULL) FROM auth.users;");
    for (const role of ['anon','authenticated']) {
        for (const sql of ["INSERT INTO public.users(username,role) VALUES ('injected','Admin')",
            "UPDATE public.users SET role='Admin' WHERE id=2", "DELETE FROM public.users WHERE id=2", 'TRUNCATE public.users']) {
            await deny(`direct write denied ${role} ${sql.split(' ')[0]}`,role,claims('2'),sql);
        }
        await deny(`trusted list unreadable ${role}`,role,claims(), 'SELECT * FROM account_security_private.reviewed_admins');
        await deny(`trusted list not writable ${role}`,role,claims(), `UPDATE account_security_private.reviewed_admins SET enabled=true`);
        for (const sql of commands) await deny(`legacy body unreachable ${role}`,role,claims(),sql.replace('public.','account_security_private.'));
    }
    await deny('dispatcher checks role even if called directly','authenticated',claims('2'),"SELECT account_security_private.execute_account_command('create','injected','Admin')");
    await deny('invalid action cannot inject SQL','authenticated',claims(),"SELECT account_security_private.execute_account_command('create; DROP TABLE users','injected','Admin')",/ACCOUNT_COMMAND_INVALID/);
    await check('no client write ACLs including column grants',`SELECT bool_and(NOT has_table_privilege(r,'public.users','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT has_any_column_privilege(r,'public.users','INSERT,UPDATE,REFERENCES')) FROM unnest(ARRAY['anon','authenticated']) r;`);
    await check('login dropdown still reads legacy list',request('anon',{},'SELECT count(*) FROM public.users'),'{}\n4');
    // Defense in depth: broad legacy policy remains, even accidental later grants
    // cannot bypass the restrictive INSERT/UPDATE/DELETE policies.
    await query('GRANT INSERT,UPDATE,DELETE ON public.users TO anon,authenticated;');
    await deny('restrictive insert survives regrant','authenticated',claims('2'),"INSERT INTO public.users(username,role) VALUES ('injected','Admin')",/row-level security/);
    await check('restrictive update survives regrant',request('authenticated',claims('2'),"WITH changed AS (UPDATE public.users SET role='Admin' WHERE id=2 RETURNING id) SELECT count(*) FROM changed"),`${JSON.stringify(claims('2'))}\n0`);
    await check('restrictive delete survives regrant',request('anon',{},'WITH changed AS (DELETE FROM public.users WHERE id=2 RETURNING id) SELECT count(*) FROM changed'),'{}\n0');
    await query('REVOKE INSERT,UPDATE,DELETE ON public.users FROM anon,authenticated;');

    await deny('failed legacy create rolls back earlier Auth insert','authenticated',claims(),"SELECT public.admin_create_user('guard_failed',NULL)",/null value in column "role"/);
    await check('failed command left no Auth or directory orphan',"SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE email='guard_failed@buildtrack.local') AND NOT EXISTS(SELECT 1 FROM public.users WHERE username='guard_failed');");
    await query(`ALTER TABLE public.foremen ADD CONSTRAINT synthetic_foreman_failure CHECK(name <> 'guard_atomic_fail');`);
    await deny('Foreman failure rolls back Auth and directory creation','authenticated',claims(),
      "SELECT public.admin_create_user('guard_atomic_fail','Foreman')",/synthetic_foreman_failure/);
    await check('no partial Foreman create',`SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE email='guard_atomic_fail@buildtrack.local')
      AND NOT EXISTS(SELECT 1 FROM public.users WHERE username='guard_atomic_fail') AND NOT EXISTS(SELECT 1 FROM public.foremen WHERE name='guard_atomic_fail');`);
    await query('ALTER TABLE public.foremen DROP CONSTRAINT synthetic_foreman_failure;');
    await query(request('authenticated',claims(),"SELECT public.admin_create_user('guard_target','Foreman')"));
    await check('reviewed Admin creates target',"SELECT count(*)=1 FROM auth.users u JOIN public.users p ON p.username='guard_target' AND u.email='guard_target@buildtrack.local';");
    await check('same command creates exactly one Foreman',"SELECT count(*)=1 FROM public.foremen WHERE name='guard_target';");
    await deny('existing name cannot be adopted or duplicated','authenticated',claims(),
      "SELECT public.admin_create_user('guard_target','Sales')",/ACCOUNT_NAME_CONFLICT/);
    await query("INSERT INTO public.foremen(name) VALUES ('guard_orphan');");
    await deny('orphaned Foreman requires review rather than silent adoption','authenticated',claims(),
      "SELECT public.admin_create_user('guard_orphan','Foreman')",/ACCOUNT_NAME_CONFLICT/);
    await check('orphan conflict leaves no new account',"SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE email='guard_orphan@buildtrack.local');");
    await query(request('authenticated',claims(),"SELECT public.admin_change_user_password('guard_target','9876')"));
    await check('reviewed Admin reset executes original credential body',"SELECT encrypted_password=extensions.crypt('9876BT!',encrypted_password) FROM auth.users WHERE email='guard_target@buildtrack.local';");
    await query(request('authenticated',claims(),"SELECT public.admin_change_username('guard_target','guard_renamed')"));
    await check('rename retains construction references',`SELECT
      EXISTS(SELECT 1 FROM auth.users WHERE email='guard_renamed@buildtrack.local')
      AND EXISTS(SELECT 1 FROM public.users WHERE username='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.foremen WHERE name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.task_updates WHERE user_name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.defects WHERE reported_by='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.assignments WHERE user_name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.task_material_requests WHERE requested_by='guard_renamed');`);
    await query(`CREATE TABLE public.synthetic_account_restrict(user_id integer REFERENCES public.users(id) ON DELETE RESTRICT);
      INSERT INTO public.synthetic_account_restrict SELECT id FROM public.users WHERE username='guard_renamed';`);
    await deny('blocked delete rolls back Foreman and Auth removal','authenticated',claims(),
      "SELECT public.admin_delete_user('guard_renamed')",/foreign key constraint/);
    await check('failed delete preserves all three records',`SELECT EXISTS(SELECT 1 FROM public.foremen WHERE name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.users WHERE username='guard_renamed') AND EXISTS(SELECT 1 FROM auth.users WHERE email='guard_renamed@buildtrack.local');`);
    await query('DROP TABLE public.synthetic_account_restrict;');
    await query(request('authenticated',claims(),"SELECT public.admin_delete_user('guard_renamed')"));
    await check('reviewed Admin deletes ordinary account',"SELECT NOT EXISTS(SELECT 1 FROM public.users WHERE username='guard_renamed') AND NOT EXISTS(SELECT 1 FROM auth.users WHERE email='guard_renamed@buildtrack.local');");
    await check('delete removes Foreman membership but preserves construction history',`SELECT
      NOT EXISTS(SELECT 1 FROM public.foremen WHERE name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.task_updates WHERE user_name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.defects WHERE reported_by='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.assignments WHERE user_name='guard_renamed')
      AND EXISTS(SELECT 1 FROM public.task_material_requests WHERE requested_by='guard_renamed');`);
    await deny('reviewed Admin cannot be deleted by legacy command','authenticated',claims(),"SELECT public.admin_delete_user('guard_admin')",/foreign key constraint/);
    await check('protected Admin still exists',`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${actorId('1')}');`);
    await check('public RPCs are invoker with pinned path',`SELECT count(*)=4 AND bool_and(NOT p.prosecdef AND p.proconfig IS NOT NULL)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('admin_create_user','admin_delete_user','admin_change_username','admin_change_user_password');`);
    await assert.rejects(query(accountTestBody(texts.get(accountDraftPath))),/ACCOUNT_GUARD_SCHEMA_ALREADY_EXISTS/); assertions++;
    const loginDirectory = await runLoginDirectory({ query, source: texts.get(loginDirectoryDraftPath), cutoverSource: texts.get(loginDirectoryCutoverPath) });
    if (sealedFoundation) {
        const crmFoundationCutover = await runCrmFoundationCutover({query,source:texts.get(crmFoundationCandidatePath),plotSyncSource:texts.get('sync_plot_sales_status.sql')});
        for (const [path,text] of texts) assert.equal(hash(readFileSync(join(root,path),'utf8')),hash(text),`Source changed: ${path}`);
        return {assertions,cases,accountCutover,loginDirectory,crmFoundationCutover,productionChanged:false,realSupabaseAuthTested:false,sourceFilesUnchanged:true};
    }
    // Alternative staged path is fully rolled back before the original full-cutover suite.
    const crmIdentityFoundation = await runCrmIdentityFoundation({ query, source: texts.get(crmIdentityFoundationPath) });
    const stagedSetup = stagedCrm
        ? await prepareCrmStagedIntegration({ query, source: texts.get(crmIdentityFoundationPath) }) : null;
    const trustedActor = stagedCrm ? null : await runTrustedActor({ query, source: texts.get(trustedActorDraftPath) });
    const roleReview = await runRoleReview({ query, source: texts.get(roleReviewDraftPath) });
    const crmRoleAlignment = await runCrmRoleAlignment({ query, texts });
    const crmWorkflowIntegration = await runCrmWorkflowIntegration({ query, texts });
    const crmAuthRevocation = await runCrmAuthRevocation({ query, source: texts.get(crmAuthRevocationPath) });
    const accountAccessRead = await runAccountAccessRead({ query, source: texts.get(accountAccessReadPath) });
    const adminBeforeRestore = stagedCrm ? await query(stagedAdminMembershipSnapshotSql) : null;
    const accountAccessRestore = await runAccountAccessRestore({ query, source: texts.get(accountAccessRestorePath) });
    let stagedIntegration = null;
    if (stagedCrm) {
        assertStagedAdminMembershipsUnchanged(adminBeforeRestore,await query(stagedAdminMembershipSnapshotSql));
        stagedIntegration = await verifyCrmStagedIntegration({query,baseline:stagedSetup.baseline});
        stagedIntegration.assertions += stagedSetup.assertions + 1;
        stagedIntegration.cases.push(...stagedSetup.cases,'Sales restoration preserves management permissions and active Admin records');
    }
    const preflightPrepared=await runAccountPreflight({query,source:texts.get(accountPreflightPath),stage:stagedCrm?'crm_staged':'prepared'});
    const accountPreflight={assertions:preflightEmpty.assertions+preflightLegacy.assertions+preflightPrepared.assertions,
      empty:preflightEmpty,legacy:preflightLegacy,prepared:preflightPrepared};
    for (const [path,text] of texts) assert.equal(hash(readFileSync(join(root,path),'utf8')),hash(text),`Source changed: ${path}`);
    return { assertions, cases, accountCutover, loginDirectory, crmIdentityFoundation, trustedActor, stagedIntegration, roleReview, crmRoleAlignment, crmWorkflowIntegration, crmAuthRevocation, accountAccessRead, accountAccessRestore, accountPreflight, realSupabaseAuthTested:false, productionChanged:false, sourceFilesUnchanged:true };
}
