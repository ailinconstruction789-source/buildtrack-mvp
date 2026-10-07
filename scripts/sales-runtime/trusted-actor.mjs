import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';
export const trustedActorDraftPath = 'sql/security/trusted_actor_draft.sql';
export function trustedActorTestBody(source) {
    assertPlainSql(source);
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: trusted actor needs reviewed roles and complete authorization cutover';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) throw new Error('Unexpected trusted actor draft wrapper');
    return source.replace(wrapper,'BEGIN;').replace(/\bROLLBACK;\s*$/,'COMMIT;');
}
const id = n => `a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid = n => id(n).replace('a025','b025');
const request = (n,sql,role='authenticated') => `BEGIN; SET LOCAL ROLE ${role};
 DO $$ BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify({sub:id(n),session_id:sid(n),user_metadata:{role:'Admin'},app_metadata:{role:'Admin'}})}',true); END $$;
 ${sql}; COMMIT;`;

export async function runTrustedActor({ query,source }) {
    let assertions=0; const cases=[];
    async function check(label,sql,expected='t') { assert.equal(await query(sql),expected,label); assertions++;cases.push(label); }
    async function denied(label,sql,pattern=/permission denied|APP_ACTOR_REQUIRED|ACCOUNT_ADMIN_REQUIRED/) {
        await assert.rejects(query(sql),pattern); assertions++;cases.push(label);
    }
    // Synthetic representation of the previously audited unsafe presence RPC.
    await query("CREATE FUNCTION public.update_user_last_seen(p_username text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.users SET last_seen_at=now() WHERE username=p_username; $$;");
    await denied('raw draft cannot run',source,/DESIGN ONLY: trusted actor/);
    await query(trustedActorTestBody(source));
    await denied('old Admin label and allowlist alone cannot log in',request(1,'SELECT public.app_current_actor()'));
    await check('no automatic role seed','SELECT count(*) FROM account_security_private.reviewed_roles;','0');
    const roles=['Admin','Sales','Owner','Foreman','Site Engineer','QC','Project Planner','Procurement','Store'];
    for (let n=1;n<=roles.length;n++) {
        if(n>4) await query(`INSERT INTO auth.users(id,email) VALUES ('${id(n)}','guard_role_${n}@buildtrack.local');
          INSERT INTO auth.sessions(id,user_id) VALUES ('${sid(n)}','${id(n)}');
          INSERT INTO public.users(id,username,role) VALUES (${n},'guard_role_${n}','Admin');`);
        await query(`INSERT INTO account_security_private.reviewed_roles(auth_user_id,legacy_user_id,role,enabled,review_reference)
          VALUES ('${id(n)}',${n},'${roles[n-1]}',true,'SYNTHETIC REVIEW ONLY');`);
        await check(`trusted role ${roles[n-1]} independent of editable metadata`,request(n,"SELECT public.app_current_actor()->>'role'"),roles[n-1]);
        await check(`caller-only identity ${n}`,request(n,`SELECT (public.app_current_actor()->>'authUserId')='${id(n)}'`));
        await check(`account capability ${n}`,request(n,"SELECT public.app_current_actor()->>'canManageAccounts'"),n===1?'true':'false');
    }
    await denied('anonymous cannot read actor',request(1,'SELECT public.app_current_actor()','anon'));
    await denied('role directory not readable',request(2,'SELECT * FROM account_security_private.reviewed_roles'));
    await denied('role directory not writable',request(2,"UPDATE account_security_private.reviewed_roles SET role='Admin'"));
    await denied('cannot request another identity',request(2,`SELECT public.app_current_actor('${id(1)}')`),/does not exist/);
    await query("UPDATE account_security_private.reviewed_roles SET role='Sales' WHERE legacy_user_id=1;");
    await denied('demoted admin cannot use stale allowlist',request(1,"SELECT public.admin_create_user('not_allowed','Admin')"));
    await check('demotion changes returned role immediately',request(1,"SELECT public.app_current_actor()->>'role'"),'Sales');
    await query("UPDATE account_security_private.reviewed_roles SET role='Admin' WHERE legacy_user_id=1;");
    await query('UPDATE account_security_private.reviewed_admins SET enabled=false;');
    await check('unapproved account-admin capability is false',request(1,"SELECT public.app_current_actor()->>'canManageAccounts'"),'false');
    await denied('disabled account-admin capability blocks command',request(1,"SELECT public.admin_delete_user('guard_sales')"));
    await query('UPDATE account_security_private.reviewed_admins SET enabled=true,legacy_user_id=2;');
    await check('mismatched admin binding cannot grant capability',request(1,"SELECT public.app_current_actor()->>'canManageAccounts'"),'false');
    await query('UPDATE account_security_private.reviewed_admins SET legacy_user_id=1;');
    for(const [label,change,restore] of [
        ['disabled role','UPDATE account_security_private.reviewed_roles SET enabled=false WHERE legacy_user_id=2','UPDATE account_security_private.reviewed_roles SET enabled=true WHERE legacy_user_id=2'],
        ['banned user',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${id(2)}'`,`UPDATE auth.users SET banned_until=NULL WHERE id='${id(2)}'`],
        ['deleted user',`UPDATE auth.users SET deleted_at=now() WHERE id='${id(2)}'`,`UPDATE auth.users SET deleted_at=NULL WHERE id='${id(2)}'`],
        ['anonymous Auth user',`UPDATE auth.users SET is_anonymous=true WHERE id='${id(2)}'`,`UPDATE auth.users SET is_anonymous=false WHERE id='${id(2)}'`],
        ['expired session',`UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${sid(2)}'`,`UPDATE auth.sessions SET not_after=NULL WHERE id='${sid(2)}'`],
    ]) { await query(`${change};`); await denied(label,request(2,'SELECT public.app_current_actor()')); await denied(`${label} cannot touch presence`,request(2,'SELECT public.app_touch_current_user()')); await query(`${restore};`); }
    await query(`DELETE FROM auth.sessions WHERE id='${sid(2)}';`);
    await denied('removed session cannot read actor',request(2,'SELECT public.app_current_actor()'));
    await query(`INSERT INTO auth.sessions(id,user_id) VALUES ('${sid(2)}','${id(2)}'); UPDATE public.users SET last_seen_at=NULL;`);
    await query(request(2,'SELECT public.app_touch_current_user()'));
    await check('presence touches exactly caller binding',"SELECT count(*)=1 AND bool_and(id=2) FROM public.users WHERE last_seen_at IS NOT NULL;");
    await denied('old RPC cannot touch someone else',request(2,"SELECT public.update_user_last_seen('guard_admin')"));
    await denied('anon old RPC cannot touch anyone',request(2,"SELECT public.update_user_last_seen('guard_sales')",'anon'));
    await query(request(2,"SELECT public.update_user_last_seen('guard_sales')"));
    await check('old RPC accepts own name only',"SELECT count(*)=1 FROM public.users WHERE last_seen_at IS NOT NULL;");
    await query(request(1,"SELECT public.admin_change_username('guard_sales','guard_sales_new')"));
    await check('role follows stable id after rename',request(2,"SELECT public.app_current_actor()->>'username'"),'guard_sales_new');
    await query(request(1,"SELECT public.admin_change_user_password('guard_sales_new','9876')"));
    await check('approved admin command still works',"SELECT encrypted_password IS NOT NULL FROM auth.users WHERE email='guard_sales_new@buildtrack.local';");
    await check('public actor/presence facades are invoker',"SELECT count(*)=3 AND bool_and(NOT prosecdef) FROM pg_proc WHERE oid IN ('public.app_current_actor()'::regprocedure,'public.app_touch_current_user()'::regprocedure,'public.update_user_last_seen(text)'::regprocedure);");
    await denied('role constraints reject unexpected role',"UPDATE account_security_private.reviewed_roles SET role='superadmin' WHERE legacy_user_id=2;",/check constraint/);
    return {assertions,cases,productionChanged:false,realSupabaseAuthTested:false};
}
