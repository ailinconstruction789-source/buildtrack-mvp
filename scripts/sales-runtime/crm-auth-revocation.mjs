// No connections/env: only the verified disposable account harness supplies query.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';

export const crmAuthRevocationPath = 'sql/security/crm_auth_revocation_draft.sql';
export function crmAuthRevocationTestBody(source) {
    assertPlainSql(source);
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: CRM Auth revocation requires isolated Auth verification and approved cutover';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) throw new Error('Unexpected CRM Auth revocation draft wrapper');
    return source.replace(wrapper, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}
const uid = n => `a0250000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => uid(n).replace('a025', 'b025');
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${lit(JSON.stringify(value))}::jsonb`;
const request = (n, sql, readOnly = false) => `BEGIN${readOnly ? ' READ ONLY' : ''}; SET LOCAL ROLE authenticated;
 DO $$ BEGIN PERFORM set_config('request.jwt.claims',${json({ sub: uid(n), session_id: sid(n), user_metadata: { role: 'Admin' } })}::text,true); END $$;
 ${sql}; COMMIT;`;
const anon = sql => `BEGIN; SET LOCAL ROLE anon; ${sql}; COMMIT;`;
const rpc = (name, payload, id = randomUUID()) => `SELECT public.${name}('${id}',${json(payload)})`;
const worker = () => `BEGIN; SET LOCAL ROLE buildtrack_sales_sla_worker; SELECT sales_private.crm_first_contact_worker_cycle('${randomUUID()}'); COMMIT;`;

export async function runCrmAuthRevocation({ query, source }) {
    const cases = [];
    const check = async (label, sql, expected = 't') => { assert.equal(await query(sql), expected, label); cases.push(label); };
    const truth = (label, value) => { assert.ok(value, label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    const call = async (n, sql, readOnly = false) => JSON.parse(await query(request(n, sql, readOnly)));
    await check('Auth revocation suite requires owned loopback fixture', `SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;`);
    async function reviewSql(n = 2, role = 'Sales', enabled = true) {
        const row = JSON.parse(await query(`SELECT jsonb_build_object('revision',r.review_revision,'username',u.username,'email',a.email)
          FROM account_security_private.reviewed_roles r JOIN public.users u ON u.id=r.legacy_user_id
          JOIN auth.users a ON a.id=r.auth_user_id WHERE r.auth_user_id='${uid(n)}';`));
        return `SELECT account_security_private.review_account_role('${uid(n)}',${n},${lit(row.username)},${lit(row.email)},
          '${role}',${enabled},false,${row.revision},'SYNTHETIC Auth integration','synthetic-reviewer','SYNTHETIC recovery drill');`;
    }
    const review = async (...args) => query(await reviewSql(...args));
    // Limited stand-in for Auth service writes: no access to private CRM/Auth
    // secrets. Not a claim that this reproduces actual Supabase Auth permissions.
    await query(`CREATE ROLE synthetic_auth_operator NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA auth TO synthetic_auth_operator;
      GRANT SELECT(id),UPDATE(banned_until,deleted_at,is_anonymous,raw_user_meta_data) ON auth.users TO synthetic_auth_operator;`);
    const authUpdate = (set, n = 2) => `BEGIN; SET LOCAL ROLE synthetic_auth_operator;
      UPDATE auth.users SET ${set} WHERE id='${uid(n)}'; COMMIT;`;
    const directorySql = `SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(public.crm_v2_central_snapshot()->'salesOwners') x WHERE x->>'userId'='${uid(2)}')`;
    const baseLead = { name: 'SYNTHETIC Auth QR', phone: '0879600001', channel: 'phone', notes: '',
        interests: [{ projectName: 'SYNTHETIC Integration', plotId: null }] };
    const lead = await call(2, rpc('crm_v2_create_customer', baseLead));
    const interest = JSON.parse(await query(`SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE customer_id='${lead.customerId}';`));
    const makeVisit = () => rpc('crm_v2_visits_command', { command: 'check_in', customerId: lead.customerId, interestId: interest.id,
        expectedInterestRevision: interest.lifecycle_revision, reason: 'SYNTHETIC Auth Visit', occurredAt: new Date().toISOString(),
        appointmentId: null, expectedAppointmentRevision: null });
    const visit = await call(2, makeVisit());
    const token = '9'.repeat(64);
    const voicePayload = { command: 'issue', customerId: lead.customerId, interestId: interest.id, visitId: visit.visitId,
        expectedInterestRevision: interest.lifecycle_revision, expectedVisitRevision: visit.visitRevision, expectedTokenId: null,
        tokenHash: createHash('sha256').update(token).digest('hex'), reason: 'SYNTHETIC Auth QR issue' };
    const voiceSql = rpc('crm_v2_customer_voices_command', voicePayload);
    await call(2, voiceSql);
    const openSql = `SELECT public.crm_v2_customer_voice_open('${token}')`;
    const answers = Object.fromEntries(['knowledge', 'problem_solving', 'service_mind', 'appearance', 'cleanliness', 'house_design', 'price', 'location'].map(key => [`score_${key}`, 4]));
    const submitSql = `SELECT public.crm_v2_customer_voice_submit('${token}','${randomUUID()}','customer_voices_v1',${json(answers)})`;
    const adminLeadSql = rpc('crm_v2_create_customer', { ...baseLead, phone: '0879600002', interests: [], assignedSalesUserId: uid(2) });

    // Reproduce the 3c gap before installing the new guarded companion, entirely
    // in synthetic data. Actor reader rejects a ban but target readers still pass.
    await query(authUpdate("banned_until=clock_timestamp()+interval '1 day'"));
    await check('baseline banned caller already denied', request(2, "SELECT public.crm_v2_role()=''") );
    await check('baseline gap reproduced: banned owner remains selectable', request(1, directorySql, true));
    truth('baseline gap reproduced: public QR still opens for banned owner', JSON.parse(await query(anon(openSql))).formVersion === 'customer_voices_v1');
    await deny('new Auth draft unusable as-is', source, /DESIGN ONLY: CRM Auth revocation/);
    await check('raw guard leaves no new objects', "SELECT to_regclass('account_security_private.crm_auth_suspensions') IS NULL;");
    await query(crmAuthRevocationTestBody(source));
    await check('install quarantines existing banned projection', `SELECT NOT is_active FROM sales_private.crm_user_roles WHERE user_id='${uid(2)}';`);
    await check('install records current reviewed revision without PII', `SELECT count(*)=1 AND bool_and(s.reason='auth_banned' AND s.review_revision=r.review_revision)
      FROM account_security_private.crm_auth_suspensions s JOIN account_security_private.reviewed_roles r ON r.auth_user_id=s.auth_user_id WHERE s.auth_user_id='${uid(2)}';`);
    await check('banned owner removed from assignment directory', request(1, directorySql, true), 'f');
    await deny('Admin cannot assign new Lead to banned owner', request(1, adminLeadSql), /CRM_SALES_OWNER_REQUIRED/);
    await deny('public QR open now denies banned owner', anon(openSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    await deny('public QR submit now denies banned owner', anon(submitSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    await deny('operator cannot approve still-banned identity', await reviewSql(), /ROLE_REVIEW_ACCOUNT_UNAVAILABLE/);
    await query(authUpdate('banned_until=NULL'));
    await check('unban does not restore CRM authority', request(2, "SELECT public.crm_v2_role()=''") );
    await deny('direct is_active toggle cannot bypass required new review', `UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${uid(2)}';`, /CRM_ROLE_TRUSTED_REVIEW_REQUIRED/);
    await deny('unbanned but unreviewed QR remains closed', anon(openSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    await review();
    await check('fresh reviewed revision restores CRM', request(2, "SELECT public.crm_v2_role()='sales'") );
    truth('fresh review restores valid unexpired QR', JSON.parse(await query(anon(openSql))).formVersion === 'customer_voices_v1');
    await query(authUpdate("banned_until=clock_timestamp()+interval '1 day'"));
    const repeatCount = await query('SELECT count(*) FROM account_security_private.crm_auth_suspensions;');
    await query(authUpdate("banned_until=clock_timestamp()+interval '2 days'"));
    await check('repeated ban preserves one suspension per reviewed revision', 'SELECT count(*) FROM account_security_private.crm_auth_suspensions;', repeatCount);
    await query(authUpdate("banned_until=clock_timestamp()-interval '1 second'"));
    await check('expired ban timestamp does not auto-restore CRM', request(2, "SELECT public.crm_v2_role()=''") );
    await review();
    const projectionBefore = await query(`SELECT to_jsonb(c) FROM sales_private.crm_user_roles c WHERE user_id='${uid(2)}';`);
    const auditBefore = await query('SELECT count(*) FROM account_security_private.crm_auth_suspensions;');
    // Auth sign-out must revoke the caller's session but not disable ownership,
    // customer bearer QR, other staff assignments or background work.
    await query(`DELETE FROM auth.sessions WHERE user_id='${uid(2)}';`);
    await check('signed-out caller loses its old session', request(2, "SELECT public.crm_v2_role()=''") );
    await check('sign-out preserves owner eligibility', request(1, directorySql, true));
    truth('sign-out keeps customer QR usable', JSON.parse(await query(anon(openSql))).formVersion === 'customer_voices_v1');
    await query(worker());
    await check('sign-out does not hold owner work', `SELECT accountability_state='ready' FROM public.crm_sla_tasks WHERE id='d0250000-0000-4000-8000-000000000002';`);
    await check('sign-out leaves projection unchanged', `SELECT to_jsonb(c)::text FROM sales_private.crm_user_roles c WHERE user_id='${uid(2)}';`, projectionBefore);
    await check('sign-out creates no ban evidence', 'SELECT count(*) FROM account_security_private.crm_auth_suspensions;', auditBefore);
    await query(`INSERT INTO auth.sessions(id,user_id) VALUES('${sid(2)}','${uid(2)}');`);

    // Compare business data separately from permissions/SLA: worker withdrawal is
    // expected, but banning itself must not change any customer/booking history.
    const historySql = `SELECT jsonb_build_object(${['public.sales_customers','public.lead_project_interests','public.sales','public.plots',
        'public.lead_visits','public.customer_voices','public.loan_attempts','public.lead_activities','public.crm_next_actions',
        'public.crm_sla_tasks','public.crm_notifications','public.crm_audit_events']
        .map(table => `${lit(table)},(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t)`).join(',')});`;
    for (const [label, set, clear, reason] of [
        ['ban', "banned_until=clock_timestamp()+interval '1 day'", 'banned_until=NULL', 'auth_banned'],
        ['soft deletion', 'deleted_at=clock_timestamp()', 'deleted_at=NULL', 'auth_deleted'],
        ['anonymous conversion', 'is_anonymous=true', 'is_anonymous=false', 'auth_anonymous'],
    ]) {
        const before = await query(historySql);
        await query(authUpdate(set));
        await check(`${label} trigger suspends active projection`, `SELECT NOT is_active FROM sales_private.crm_user_roles WHERE user_id='${uid(2)}';`);
        await check(`${label} appends matching reviewed-revision evidence`, `SELECT s.reason='${reason}' FROM account_security_private.crm_auth_suspensions s
          JOIN account_security_private.reviewed_roles r ON r.auth_user_id=s.auth_user_id AND r.review_revision=s.review_revision WHERE s.auth_user_id='${uid(2)}';`);
        await check(`${label} preserves all business history`, historySql, before);
        await deny(`${label} denies Admin QR issue replay`, request(1, voiceSql), /CRM_VOICE_FORBIDDEN/);
        await deny(`${label} denies customer QR submit`, anon(submitSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
        await query(worker());
        await check(`${label} worker holds disabled owner`, `SELECT accountability_state='needs_owner' AND status='open'
          AND evaluation_snapshot#>>'{processingReview,reason}'='OWNER_NOT_READY' FROM public.crm_sla_tasks WHERE id='d0250000-0000-4000-8000-000000000002';`);
        await check(`${label} worker withdraws owner notifications`, `SELECT NOT EXISTS(SELECT 1 FROM public.crm_notifications WHERE recipient_user_id='${uid(2)}' AND withdrawn_at IS NULL);`);
        await query(authUpdate(clear));
        await check(`${label} clearing flag cannot auto-restore`, request(2, "SELECT public.crm_v2_role()=''") );
        await review();
        await check(`${label} reviewed recovery succeeds`, request(2, "SELECT public.crm_v2_role()='sales'") );
    }
    const suspendedCount = await query('SELECT count(*) FROM account_security_private.crm_auth_suspensions;');
    await query(authUpdate("raw_user_meta_data='{\"role\":\"Admin\"}'::jsonb"));
    await check('metadata update cannot change verified role', request(2, "SELECT public.crm_v2_role()='sales'") );
    await check('ordinary metadata update does not suspend account', 'SELECT count(*) FROM account_security_private.crm_auth_suspensions;', suspendedCount);
    await query(`BEGIN; SET LOCAL ROLE synthetic_auth_operator; UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${uid(2)}'; ROLLBACK;`);
    await check('rolled-back Auth update leaves CRM active', request(2, "SELECT public.crm_v2_role()='sales'") );
    await check('rolled-back Auth update appends no suspension', 'SELECT count(*) FROM account_security_private.crm_auth_suspensions;', suspendedCount);

    for (const role of ['anon','authenticated','service_role','synthetic_auth_operator','buildtrack_sales_sla_worker']) {
        await deny(`${role} cannot read private suspension history`, `BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM account_security_private.crm_auth_suspensions; COMMIT;`, /permission denied/);
        await deny(`${role} cannot invoke private suspension trigger directly`, `BEGIN; SET LOCAL ROLE ${role}; SELECT account_security_private.suspend_crm_on_auth_change(); COMMIT;`, /permission denied/);
    }
    for (const verb of ["UPDATE account_security_private.crm_auth_suspensions SET reason='auth_deleted'", 'DELETE FROM account_security_private.crm_auth_suspensions','TRUNCATE account_security_private.crm_auth_suspensions']) {
        await deny('suspension audit cannot be rewritten or removed', `${verb};`, /CRM_AUTH_SUSPENSION_APPEND_ONLY/);
    }
    await deny('client cannot ban through direct Auth write', request(2, `UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${uid(4)}'`), /permission denied/);
    await deny('removing a linked Auth identity cannot erase Sales history', `DELETE FROM auth.users WHERE id='${uid(2)}';`, /foreign key constraint/);
    await check('rejected hard delete leaves caller usable', request(2, "SELECT public.crm_v2_role()='sales'") );
    await deny('review refuses disabled Auth suspension trigger', `BEGIN; ALTER TABLE auth.users DISABLE TRIGGER buildtrack_crm_auth_revocation;
      ${await reviewSql()} COMMIT;`, /ROLE_REVIEW_CRM_AUTH_ALIGNMENT_REQUIRED/);
    // Observe independent waiting backends for Auth changes versus QR submission
    // and operator review. Auth-trigger code must never take canonical row locks.
    const settled = promise => promise.then(value => ({ value }), error => ({ error }));
    const waitState = async (name, condition) => {
        const deadline = Date.now() + 3500;
        while (Date.now() < deadline) {
            if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${lit(name)} AND ${condition});`) === 't') return;
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error(`Auth concurrency backend not observed: ${name}`);
    };
    async function overlap(heldSql, waitingSql) {
        const token = randomUUID().slice(0, 8), heldName = `auth_hold_${token}`, waitingName = `auth_wait_${token}`;
        const named = (sql, name) => sql.replace('BEGIN;', `BEGIN; SET LOCAL application_name=${lit(name)};`);
        const held = settled(query(named(heldSql.replace('COMMIT;', 'SELECT pg_sleep(5); COMMIT;'), heldName)));
        let waiting;
        try {
            await waitState(heldName, "wait_event='PgSleep'");
            waiting = settled(query(named(waitingSql, waitingName)));
            await waitState(waitingName, "wait_event_type='Lock'");
        } catch (error) { await held; if (waiting) await waiting; throw error; }
        const results = await Promise.all([held, waiting]);
        if (results[0].error) throw results[0].error;
        return results[1];
    }
    const banSql = () => authUpdate("banned_until=clock_timestamp()+interval '1 day'");
    const bannedAfterSubmission = await overlap(anon(submitSql), banSql());
    truth('in-flight QR completes before waiting Auth ban commits', !bannedAfterSubmission.error);
    await check('Auth ban keeps completed survey history', `SELECT status='completed' FROM public.lead_visits WHERE id='${visit.visitId}';`);
    await deny('QR receipt replay after Auth ban is denied', anon(submitSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    await query(authUpdate('banned_until=NULL')); await review();
    const visit2 = await call(2, makeVisit());
    const token2 = '8'.repeat(64);
    await call(2, rpc('crm_v2_customer_voices_command', { ...voicePayload, visitId: visit2.visitId,
        expectedVisitRevision: visit2.visitRevision, tokenHash: createHash('sha256').update(token2).digest('hex') }));
    const submit2 = `SELECT public.crm_v2_customer_voice_submit('${token2}','${randomUUID()}','customer_voices_v1',${json(answers)})`;
    const rejectedSubmission = await overlap(banSql(), anon(submit2));
    truth('QR waits for Auth ban then refuses stale owner', /CRM_VOICE_TOKEN_UNAVAILABLE/.test(rejectedSubmission.error?.message ?? ''));
    await check('ban-first writes no partial survey', `SELECT v.status='awaiting_voice' AND NOT EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id=v.id)
      FROM public.lead_visits v WHERE v.id='${visit2.visitId}';`);
    await query(authUpdate('banned_until=NULL')); await review();
    const reviewBeforeBan = await overlap(`BEGIN; ${await reviewSql()} COMMIT;`, banSql());
    truth('Auth ban waits for reviewed approval without deadlock', !reviewBeforeBan.error);
    await check('ban after approval suspends the newly reviewed revision', `SELECT NOT c.is_active AND s.review_revision=r.review_revision
      FROM sales_private.crm_user_roles c JOIN account_security_private.reviewed_roles r ON r.auth_user_id=c.user_id
      JOIN account_security_private.crm_auth_suspensions s ON s.auth_user_id=c.user_id AND s.review_revision=r.review_revision WHERE c.user_id='${uid(2)}';`);
    await query(authUpdate('banned_until=NULL')); await review();
    const approvalAfterBan = await overlap(banSql(), `BEGIN; ${await reviewSql()} COMMIT;`);
    truth('approval waiting on Auth ban rejects unavailable account without deadlock', /ROLE_REVIEW_ACCOUNT_UNAVAILABLE/.test(approvalAfterBan.error?.message ?? ''));
    await query(authUpdate('banned_until=NULL')); await review();
    await deny('companion cannot be applied twice', crmAuthRevocationTestBody(source), /CRM_AUTH_REVOCATION_ALREADY_EXISTS/);
    return { assertions: cases.length, cases, productionChanged: false, realSupabaseAuthTested: false,
        authWritesSyntheticOnly: true, requiresReviewedRecovery: true };
}
