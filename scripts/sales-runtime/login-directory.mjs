import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';
import { runLoginDirectoryCutover } from './login-directory-cutover.mjs';

export const loginDirectoryDraftPath = 'sql/security/login_directory_draft.sql';
export function loginDirectoryTestBody(source) {
    assertPlainSql(source);
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: login directory requires frontend cutover and reviewed account guards';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) throw new Error('Unexpected login directory draft wrapper');
    return source.replace(wrapper,'BEGIN;').replace(/\bROLLBACK;\s*$/,'COMMIT;');
}

/** Only the existing, independently verified disposable runner supplies query. */
export async function runLoginDirectory({ query, source, cutoverSource }) {
    let assertions = 0;
    const cases = [];
    const request = (role, sql) => `BEGIN; SET LOCAL ROLE ${role}; ${sql}; COMMIT;`;
    async function check(label, sql, expected = 't') {
        assert.equal(await query(sql),expected,label); assertions++; cases.push(label);
    }
    async function deny(label, sql) {
        await assert.rejects(query(request('anon',sql)),/permission denied/); assertions++; cases.push(label);
    }
    await assert.rejects(query(source), /DESIGN ONLY: login directory/); assertions++;
    // Reproduce otherwise hidden explicit column/PUBLIC grants, then prove removal.
    await query('GRANT SELECT(role,last_seen_at) ON public.users TO PUBLIC,anon;');
    const cutover = cutoverSource ? await runLoginDirectoryCutover({ query, source: cutoverSource }) : null;
    if (!cutoverSource) await query(loginDirectoryTestBody(source));
    await check('public names remain available in username order',request('anon',"SELECT string_agg(username,',' ORDER BY username) FROM public.users"),'guard_admin,guard_foreman,guard_owner,guard_sales');
    await check('exact count for paged name reader',request('anon','SELECT count(*) FROM public.users'),'4');
    for (const column of ['id','role','created_at','last_seen_at']) await deny(`hidden column ${column}`,`SELECT ${column} FROM public.users`);
    await deny('wildcard blocked','SELECT * FROM public.users');
    await deny('whole row JSON blocked','SELECT to_jsonb(u) FROM public.users u');
    await deny('cannot filter names by a hidden role',"SELECT username FROM public.users WHERE role='Admin'");
    await deny('cannot sort names by hidden activity','SELECT username FROM public.users ORDER BY last_seen_at');
    await deny('no username edits',"UPDATE public.users SET username='injected' WHERE username='guard_sales'");
    await deny('no account creation',"INSERT INTO public.users(username,role) VALUES ('injected','Admin')");
    await deny('no account deletion',"DELETE FROM public.users WHERE username='guard_sales'");
    await deny('cannot invoke guarded account administration',"SELECT public.admin_create_user('injected','Admin')");
    await check('authenticated staff read remains compatible',request('authenticated',"SELECT count(*) FROM (SELECT id,username,role,created_at,last_seen_at FROM public.users ORDER BY role,username) u"),'4');
    await query('ALTER TABLE public.users ADD COLUMN synthetic_private_note text;');
    await deny('new private columns not exposed automatically','SELECT synthetic_private_note FROM public.users');
    await check('still only username has anonymous SELECT',`SELECT bool_and(has_column_privilege('anon','public.users',attnum,'SELECT') = (attname='username'))
      FROM pg_attribute WHERE attrelid='public.users'::regclass AND attnum>0 AND NOT attisdropped;`);
    // New names/renames/deletes are visible directly: no duplicated list or sync job.
    await query("INSERT INTO public.users(username,role) VALUES ('guard_directory_change','Sales');");
    await check('new account appears immediately',request('anon',"SELECT count(*) FROM public.users WHERE username='guard_directory_change'"),'1');
    await query("UPDATE public.users SET username='guard_directory_renamed' WHERE username='guard_directory_change';");
    await check('renamed account appears immediately',request('anon',"SELECT count(*) FROM public.users WHERE username='guard_directory_renamed'"),'1');
    await query("DELETE FROM public.users WHERE username='guard_directory_renamed';");
    await check('deleted account disappears immediately',request('anon',"SELECT count(*) FROM public.users WHERE username='guard_directory_renamed'"),'0');
    return { assertions, cases, cutover, realSupabaseAuthTested:false, productionChanged:false };
}
