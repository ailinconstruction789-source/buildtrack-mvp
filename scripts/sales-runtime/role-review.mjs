// Invoked only by the fresh local cluster harness. No connections/env/real users.
import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';
export const roleReviewDraftPath = 'sql/security/role_review_draft.sql';
export function roleReviewTestBody(source) {
    assertPlainSql(source);
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: role review needs approved identities and cross-module cutover';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) throw new Error('Unexpected role review draft wrapper');
    return source.replace(wrapper,'BEGIN;').replace(/\bROLLBACK;\s*$/,'COMMIT;');
}
const uid = n => `a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const lit = value => value === null ? 'NULL' : `'${String(value).replaceAll("'","''")}'`;
const names = {1:'guard_admin',2:'guard_sales_new',3:'guard_owner',4:'guard_foreman'};
function review(n,patch={}) {
    const v = {authId:uid(n),legacyId:n,username:names[n]??`guard_role_${n}`,email:`${names[n]??`guard_role_${n}`}@buildtrack.local`,
        role:'Sales',enabled:true,manage:false,revision:0,evidence:'SYNTHETIC reviewed identity',reviewer:'synthetic-operator',recovery:null,...patch};
    return `account_security_private.review_account_role(${[v.authId,v.legacyId,v.username,v.email,v.role,v.enabled,v.manage,v.revision,v.evidence,v.reviewer,v.recovery].map(lit).join(',')})`;
}
const asClient = (role,sql) => `BEGIN; SET LOCAL ROLE ${role}; ${sql}; COMMIT;`;
export async function runRoleReview({query,source}) {
    let assertions=0;const cases=[];
    async function check(label,sql,expected='t') { assert.equal((await query(sql)).replaceAll('\r\n','\n'),expected,label);assertions++;cases.push(label); }
    async function denied(label,sql,pattern=/ROLE_REVIEW_|permission denied/) {await assert.rejects(query(sql),pattern);assertions++;cases.push(label);}
    // service_role is created in the fresh fixture, also exercising phase-1 ACLs.
    await denied('raw draft cannot run',source,/DESIGN ONLY: role review/);
    await query(roleReviewTestBody(source));
    await check('no role seed or review history created',`SELECT (SELECT count(*)=9 FROM account_security_private.reviewed_roles)
      AND (SELECT count(*)=0 FROM account_security_private.role_review_events);`);
    for(const role of ['anon','authenticated','service_role']) {
        await denied(`${role} cannot approve itself`,asClient(role,`SELECT ${review(2,{role:'Admin',manage:true,recovery:'SYNTHETIC recovery drill'})}`));
        await denied(`${role} cannot read review history`,asClient(role,'SELECT * FROM account_security_private.role_review_events'));
        await denied(`${role} cannot write review history`,asClient(role,'DELETE FROM account_security_private.role_review_events'));
    }
    const signature='account_security_private.review_account_role(uuid,integer,text,text,text,boolean,boolean,bigint,text,text,text)';
    await query(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
    await denied('accidental EXECUTE does not elevate caller',asClient('authenticated',`SELECT ${review(2)}`),/ROLE_REVIEW_OPERATOR_REQUIRED/);
    await query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated;`);
    for(const [label,patch,error] of [
        ['stale review',{revision:1},'STALE_REVISION'],['changed username',{username:'old-name'},'IDENTITY_CHANGED'],
        ['changed email',{email:'wrong@buildtrack.local'},'IDENTITY_CHANGED'],['different legacy binding',{legacyId:3},'BINDING_CONFLICT'],
        ['unknown role',{role:'superadmin'},'INVALID_INPUT'],['null enable',{enabled:null},'INVALID_INPUT'],
        ['non-Admin capability',{manage:true},'INVALID_INPUT'],['missing evidence',{evidence:''},'INVALID_INPUT'],
        ['missing reviewer',{reviewer:null},'INVALID_INPUT'],['missing recovery proof',{role:'Admin',manage:true},'RECOVERY_EVIDENCE_REQUIRED'],
    ]) await denied(label,`SELECT ${review(2,patch)};`,new RegExp(`ROLE_REVIEW_${error}`));
    await denied('snapshot isolation cannot use stale last-Admin count',`BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT ${review(2)}; COMMIT;`,/READ_COMMITTED_REQUIRED/);
    await denied('cannot disable final Admin',`SELECT ${review(1,{role:'Admin',enabled:false})};`,/LAST_ADMIN_REQUIRED/);
    await denied('cannot demote final Admin',`SELECT ${review(1)};`,/LAST_ADMIN_REQUIRED/);
    await denied('cannot remove final account-management capability',`SELECT ${review(1,{role:'Admin'})};`,/LAST_ADMIN_REQUIRED/);
    await check('denied requests did not alter registry or audit',`SELECT
      (SELECT enabled AND role='Admin' AND review_revision=0 FROM account_security_private.reviewed_roles WHERE legacy_user_id=1)
      AND (SELECT enabled FROM account_security_private.reviewed_admins WHERE legacy_user_id=1)
      AND (SELECT count(*)=0 FROM account_security_private.role_review_events);`);
    const approve1 = review(1,{role:'Admin',manage:true,recovery:'SYNTHETIC recovery drill'});
    await check('empty registries bootstrap explicitly with recovery evidence',`BEGIN;
      DELETE FROM account_security_private.reviewed_admins; DELETE FROM account_security_private.reviewed_roles;
      DO $$ BEGIN PERFORM ${approve1}; END $$;
      SELECT (SELECT count(*)=1 FROM account_security_private.reviewed_roles)
        AND (SELECT count(*)=1 FROM account_security_private.reviewed_admins)
        AND (SELECT previous_state IS NULL FROM account_security_private.role_review_events);
      ROLLBACK;`);
    await check('recovery works without an existing Admin session',`BEGIN;
      UPDATE account_security_private.reviewed_admins SET enabled=false;
      UPDATE account_security_private.reviewed_roles SET enabled=false;
      DELETE FROM auth.sessions;
      DO $$ BEGIN PERFORM ${approve1}; END $$;
      SELECT enabled FROM account_security_private.reviewed_admins WHERE legacy_user_id=1; ROLLBACK;`);
    for(const condition of ["banned_until=now()+interval '1 day'","deleted_at=now()","is_anonymous=true"]) {
        await denied(`cannot enable unavailable account ${condition.split('=')[0]}`,`BEGIN; UPDATE auth.users SET ${condition} WHERE id='${uid(2)}'; SELECT ${review(2)}; COMMIT;`,/ACCOUNT_UNAVAILABLE/);
    }
    await check('all nine trusted roles can be explicitly reviewed',`BEGIN;
      DO $$ DECLARE v_role text; v_version bigint:=0; BEGIN
        FOREACH v_role IN ARRAY ARRAY['Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store'] LOOP
          v_version:=account_security_private.review_account_role('${uid(2)}',2,'guard_sales_new','guard_sales_new@buildtrack.local',
            v_role,true,false,v_version,'SYNTHETIC role check','synthetic-operator',NULL);
        END LOOP;
      END $$;
      SELECT review_revision=9 AND role='Store' FROM account_security_private.reviewed_roles WHERE legacy_user_id=2; ROLLBACK;`);
    await check('review leaves legacy role and Auth metadata untouched',`BEGIN;
      DO $$ BEGIN PERFORM ${review(2,{role:'Owner'})}; END $$;
      SELECT (SELECT role='Sales' FROM public.users WHERE id=2)
        AND (SELECT raw_user_meta_data->>'role'='Sales' FROM auth.users WHERE id='${uid(2)}'); ROLLBACK;`);
    await check('explicitly add second approved Admin',`SELECT ${review(2,{role:'Admin',manage:true,recovery:'SYNTHETIC second recovery drill'})};`,'1');
    await denied('banned backup does not count as available Admin',`BEGIN;
      UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${uid(2)}';
      SELECT ${review(1,{enabled:false})}; COMMIT;`,/LAST_ADMIN_REQUIRED/);
    await check('audit contains before/after and operator, not credential/email copies',`SELECT
      previous_state->>'role'='Sales' AND next_state->>'role'='Admin'
      AND next_state->>'canManageAccounts'='true' AND executed_by=current_user
      AND recovery_reference IS NOT NULL AND NOT (next_state ? 'email')
      FROM account_security_private.role_review_events;`);
    for(const sql of ["UPDATE account_security_private.role_review_events SET review_reference='overwrite'",'DELETE FROM account_security_private.role_review_events','TRUNCATE account_security_private.role_review_events'])
        await denied('history mutation rejected',`${sql};`,/HISTORY_APPEND_ONLY/);
    // Separate query calls open independent sessions in the verified local runner.
    const race=await Promise.allSettled([
        query(`BEGIN; SELECT ${review(1,{enabled:false})}; SELECT pg_sleep(0.2); COMMIT;`),
        query(`BEGIN; SELECT ${review(2,{enabled:false,revision:1})}; COMMIT;`),
    ]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(race.filter(r=>r.status==='rejected'&&/LAST_ADMIN_REQUIRED/.test(r.reason.message)).length,1);
    assertions++;cases.push('concurrent revocations preserve one Admin');
    await check('exactly one active approved Admin survives',`SELECT count(*)=1 FROM account_security_private.reviewed_roles r
      JOIN account_security_private.reviewed_admins a USING(auth_user_id,legacy_user_id) WHERE r.enabled AND a.enabled AND r.role='Admin';`);
    await check('failed concurrent revocation creates no audit event',`SELECT count(*)=2 FROM account_security_private.role_review_events;`);
    const sameAccount=await Promise.allSettled([query(`SELECT ${review(3)};`),query(`SELECT ${review(3)};`)]);
    assert.equal(sameAccount.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(sameAccount.filter(r=>r.status==='rejected'&&/STALE_REVISION/.test(r.reason.message)).length,1);
    assertions++;cases.push('same-revision concurrent review cannot overwrite newer decision');
    await check('review history survives legacy account deletion',`BEGIN;
      DELETE FROM public.users WHERE id=3;
      SELECT EXISTS(SELECT 1 FROM account_security_private.role_review_events WHERE legacy_user_id=3)
        AND NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles WHERE legacy_user_id=3); ROLLBACK;`);
    await denied('independent CRM registry blocks partial role cutover',`BEGIN;
      CREATE SCHEMA sales_private; CREATE TABLE sales_private.crm_user_roles(user_id uuid);
      SELECT ${review(4)}; COMMIT;`,/CRM_ALIGNMENT_REQUIRED/);
    await check('review function is owner-only invoker',`SELECT NOT prosecdef AND proconfig IS NOT NULL
      AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE')
      FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
    await denied('rerun cannot reset revision/history',roleReviewTestBody(source),/ROLE_REVIEW_ALREADY_EXISTS/);
    return {assertions,cases,productionChanged:false,realSupabaseAuthTested:false};
}
