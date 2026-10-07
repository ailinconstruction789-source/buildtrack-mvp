// Appended only to the verified disposable account harness. No connection/env access.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { draftPaths, syntheticDraftBody } from './safety.mjs';
import { crmAlignmentSalesPaths } from './crm-role-alignment.mjs';
import { runWorkflowNotifications } from './crm-workflow-notifications.mjs';

export const workflowDraftPaths = Object.freeze(draftPaths.filter(path => !crmAlignmentSalesPaths.includes(path)));
export const workflowFacadePath = 'sql/sales/runtime/fixtures/customer-voices-facade.sql';
const uid = n => `a0250000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => uid(n).replace('a025', 'b025');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const request = (n, sql, readOnly = false) => `BEGIN${readOnly ? ' READ ONLY' : ''}; SET LOCAL ROLE authenticated;
 DO $$ BEGIN PERFORM set_config('request.jwt.claims',${json({ sub: uid(n), session_id: sid(n), user_metadata: { role: 'Admin' } })}::text,true); END $$;
 ${sql}; COMMIT;`;
const anonymous = sql => `BEGIN; SET LOCAL ROLE anon; ${sql}; COMMIT;`;
const rpc = (name, payload, id = randomUUID()) => `SELECT public.${name}('${id}',${json(payload)})`;

export async function runCrmWorkflowIntegration({ query, texts }) {
    const cases = [];
    const check = async (label, sql, expected = 't') => {
        assert.equal(await query(sql), expected, label); cases.push(label);
    };
    const deny = async (label, sql, pattern) => {
        await assert.rejects(query(sql), pattern); cases.push(label);
    };
    const truth = (label, value) => { assert.ok(value, label); cases.push(label); };
    const call = async (n, sql, readOnly = false) => JSON.parse(await query(request(n, sql, readOnly)));
    // Refuse use outside the owning harness even if a caller supplies a query function.
    await check('workflow runs only in owned synthetic database', `SELECT
      current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      AND current_setting('buildtrack.synthetic_runtime',true)='on'
      AND inet_server_addr()='127.0.0.1'::inet
      AND to_regprocedure('account_security_private.current_crm_role()') IS NOT NULL;`);
    for (const path of workflowDraftPaths) {
        if (path.endsWith('/18_booking_history_draft.sql')) {
            await query('ALTER TABLE public.sales ADD COLUMN sale_price numeric(15,2), ADD COLUMN booking_amount numeric(15,2);');
        }
        if (path.endsWith('/19_project_sales_read_draft.sql')) await query('ALTER TABLE public.plots ADD COLUMN plot_name text;');
        if (path.endsWith('/21_post_booking_draft.sql')) await query('ALTER TABLE public.sales ADD COLUMN transferred_at timestamptz;');
        if (path.endsWith('/26_customer_voices_draft.sql')) await query(texts.get(workflowFacadePath));
        await query(syntheticDraftBody(path, texts.get(path)));
    }
    await check('later drafts preserve trusted role facade', `SELECT NOT p.prosecdef AND position('account_security_private.current_crm_role' IN p.prosrc)>0
      FROM pg_proc p WHERE p.oid='public.crm_v2_role()'::regprocedure;`);
    await check('later feature switches default off', `SELECT NOT (booking_enabled OR booking_cutover_reviewed OR post_booking_enabled
      OR visits_enabled OR customer_voices_enabled OR notifications_enabled OR sla_worker_enabled OR sla_dispatcher_enabled OR sla_burst_enabled) FROM public.crm_settings;`);

    // Review through the actual private operator command, never direct projection writes.
    async function reviewStatement(n, role = 'Sales', enabled = true) {
        const row = JSON.parse(await query(`SELECT jsonb_build_object('revision',r.review_revision,'username',u.username,'email',a.email)
          FROM account_security_private.reviewed_roles r JOIN public.users u ON u.id=r.legacy_user_id
          JOIN auth.users a ON a.id=r.auth_user_id WHERE r.auth_user_id='${uid(n)}';`));
        return `SELECT account_security_private.review_account_role('${uid(n)}',${n},${literal(row.username)},${literal(row.email)},
          ${literal(role)},${enabled},false,${row.revision},'SYNTHETIC workflow integration','synthetic-operator','SYNTHETIC recovery drill');`;
    }
    const review = async (...args) => query(await reviewStatement(...args));
    await review(2); // previous alignment suite ends with Sales disabled
    await review(4); // independent second Sales; old Foreman label grants nothing
    await query(`UPDATE public.crm_settings SET booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=true,
      visits_enabled=true,customer_voices_enabled=true,project_interests_enabled=true,visit_sop_enabled=true,work_schedule_enabled=true,notifications_enabled=true,
      sla_preview_enabled=true,sla_processing_enabled=true,sla_cycle_enabled=true,sla_worker_enabled=true;
      INSERT INTO public.plots(id,project_name,plot_name,has_customer,sale_status)
      SELECT 'SYNTHETIC-INTEGRATION-'||n,'SYNTHETIC Integration','SYNTHETIC Plot '||n,false,'available' FROM generate_series(1,6) n;`);

    const bookPayload = n => ({ command: 'book', reason: 'SYNTHETIC confirmed booking', customerId: null,
        newCustomer: { name: `SYNTHETIC Workflow ${n}`, phone: `088970${String(n).padStart(4, '0')}`, channel: 'phone', notes: '', assignedSalesUserId: null },
        projectName: 'SYNTHETIC Integration', expectedInterestRevision: null, plotId: `SYNTHETIC-INTEGRATION-${n}`,
        paymentMethod: 'mortgage', bookingRoute: 'without_visit', visitId: null,
        listPriceSatang: 250000000, discountSatang: 500000, depositSatang: 100000, previousSaleId: null });
    const bookingSql = rpc('crm_v2_booking_command', bookPayload(1));
    const booking = await call(2, bookingSql);
    truth('reviewed Sales books using actual command', booking.saleId && !booking.replayed);
    truth('booking retry is exactly once', (await call(2, bookingSql)).replayed === true);
    await check('booking creates no duplicate legacy Lead', `SELECT count(*)=0 FROM public.leads;`);
    await check('booking retains Sales owner and price', `SELECT s.sale_price=2495000 AND s.closing_sales_user_id='${uid(2)}'
      AND c.owner_user_id='${uid(2)}' FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id
      JOIN public.sales_customers c ON c.id=i.customer_id WHERE s.id='${booking.saleId}';`);
    const cancelPayload = { command: 'cancel', reason: 'SYNTHETIC cancellation', customerId: booking.customerId,
        saleId: booking.saleId, expectedSaleRevision: booking.saleRevision, cancellationCategory: 'booking_cancelled' };
    const cancelSql = rpc('crm_v2_booking_command', cancelPayload);
    for (const n of [3, 4]) await deny(`role ${n} cannot cancel another Sales booking`, request(n, cancelSql), /CRM_BOOKING_FORBIDDEN/);
    await call(2, cancelSql);
    await check('cancel preserves booking evidence and releases stock', `SELECT s.crm_stage='cancelled' AND s.booked_at IS NOT NULL
      AND s.cancelled_at IS NOT NULL AND s.sale_price=2495000 AND NOT p.has_customer
      FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id='${booking.saleId}';`);

    const postBooking = await call(2, rpc('crm_v2_booking_command', bookPayload(2)));
    const postContextSql = `SELECT public.crm_v2_post_booking_context('${postBooking.saleId}')`;
    const makePost = async (command, extra) => {
        const context = await call(2, postContextSql, true);
        return { command, customerId: postBooking.customerId, saleId: postBooking.saleId,
            expectedSaleRevision: context.sale.revision, expectedInterestRevision: context.sale.interestRevision,
            reason: 'SYNTHETIC post booking reason', ...(command === 'confirm_transfer' ? {} : {
                evidenceNote: 'SYNTHETIC staff evidence', occurredAt: new Date().toISOString() }), ...extra };
    };
    const contractSql = rpc('crm_v2_post_booking_command', await makePost('advance', { nextStage: 'contracted' }));
    truth('post booking uses verified Sales', (await call(2, contractSql)).stage === 'contracted');
    await call(2, rpc('crm_v2_post_booking_command', await makePost('advance', { nextStage: 'document_prep' })));
    const loan = await call(2, rpc('crm_v2_post_booking_command', await makePost('submit_loan', { bankName: 'SYNTHETIC Bank' })));
    await call(2, rpc('crm_v2_post_booking_command', await makePost('loan_result', {
        loanAttemptId: loan.loanAttemptId, result: 'rejected', approvedAmountSatang: null })));
    const retryLoan = await call(2, rpc('crm_v2_post_booking_command', await makePost('submit_loan', { bankName: 'SYNTHETIC Bank second' })));
    truth('rejected loan resubmits as new attempt', retryLoan.loanAttemptId !== loan.loanAttemptId);
    await call(2, rpc('crm_v2_post_booking_command', await makePost('loan_result', {
        loanAttemptId: retryLoan.loanAttemptId, result: 'approved', approvedAmountSatang: 240000000 })));
    await call(2, rpc('crm_v2_post_booking_command', await makePost('advance', { nextStage: 'transfer_pending' })));
    const day = await query("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;");
    const transferSql = rpc('crm_v2_post_booking_command', await makePost('confirm_transfer', { transferDate: day }));
    await call(2, transferSql);
    await check('transfer records only date and retains both loan attempts', `SELECT crm_stage='transferred' AND crm_transfer_date='${day}'::date
      AND transferred_at IS NULL AND (SELECT count(*)=2 FROM public.loan_attempts WHERE sale_id='${postBooking.saleId}')
      FROM public.sales WHERE id='${postBooking.saleId}';`);

    // Real check-in -> bearer QR -> submitted survey; no fixture-created completed visits.
    const lead = await call(2, rpc('crm_v2_create_customer', { name: 'SYNTHETIC QR Customer', phone: '0889799999',
        channel: 'walk_in', notes: '', interests: [{ projectName: 'SYNTHETIC Integration', plotId: null }] }));
    const interest = JSON.parse(await query(`SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE customer_id='${lead.customerId}';`));
    const visitSql = rpc('crm_v2_visits_command', { command: 'check_in', customerId: lead.customerId, interestId: interest.id,
        expectedInterestRevision: interest.lifecycle_revision, reason: 'SYNTHETIC actual visit', occurredAt: new Date().toISOString(),
        appointmentId: null, expectedAppointmentRevision: null });
    const visit = await call(2, visitSql);
    const sopSql = rpc('crm_v2_record_visit_sop', { command: 'start', customerId: lead.customerId, interestId: interest.id,
        appointmentId: null, visitId: visit.visitId, expectedInterestRevision: interest.lifecycle_revision,
        occurredAt: new Date().toISOString(), reason: 'SYNTHETIC SOP start', plotId: 'SYNTHETIC-INTEGRATION-3' });
    for (const n of [1, 3, 4]) await deny(`role ${n} cannot perform assigned Sales SOP`, request(n, sopSql), /CRM_SOP_FORBIDDEN/);
    truth('assigned Sales starts actual SOP', (await call(2, sopSql)).command === 'start');
    const token = 'e'.repeat(64); // deterministic synthetic bearer, never a real credential
    const voicePayload = { command: 'issue', customerId: lead.customerId, interestId: interest.id, visitId: visit.visitId,
        expectedInterestRevision: interest.lifecycle_revision, expectedVisitRevision: visit.visitRevision, expectedTokenId: null,
        tokenHash: createHash('sha256').update(token).digest('hex'), reason: 'SYNTHETIC issue QR' };
    const voiceSql = rpc('crm_v2_customer_voices_command', voicePayload);
    await call(2, voiceSql);
    const voiceContextSql = `SELECT public.crm_v2_customer_voices_context('${lead.customerId}','${interest.id}','${visit.visitId}')`;
    truth('visit waits for Customer Voices', (await call(2, voiceContextSql, true)).visit.status === 'awaiting_voice');
    const openSql = `SELECT public.crm_v2_customer_voice_open('${token}')`;
    const opened = JSON.parse(await query(anonymous(openSql)));
    truth('public QR exposes only version and expiry', Object.keys(opened).sort().join(',') === 'expiresAt,formVersion');
    const answers = Object.fromEntries(['knowledge', 'problem_solving', 'service_mind', 'appearance', 'cleanliness', 'house_design', 'price', 'location'].map(key => [`score_${key}`, 4]));
    const submitSql = `SELECT public.crm_v2_customer_voice_submit('${token}','${randomUUID()}','customer_voices_v1',${json(answers)})`;

    const historySql = `SELECT jsonb_build_object(${[
        'public.sales_customers', 'public.lead_project_interests', 'public.sales', 'public.plots', 'public.loan_attempts',
        'public.lead_visits', 'public.lead_appointments', 'public.house_visit_checklist_runs', 'public.house_visit_checklist_items',
        'public.customer_voices', 'public.crm_audit_events', 'public.crm_sla_tasks', 'public.crm_next_actions', 'public.crm_notifications',
        'sales_private.booking_command_requests', 'sales_private.post_booking_events', 'sales_private.voice_staff_requests',
    ].map(table => `${literal(table)},(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t)`).join(',')});`;
    const before = await query(historySql);
    await review(2, 'Sales', false);
    for (const [label, sql, pattern] of [
        ['book replay', bookingSql, /CRM_BOOKING_FORBIDDEN/], ['cancel replay', cancelSql, /CRM_BOOKING_FORBIDDEN/],
        ['contract replay', contractSql, /CRM_POST_BOOKING_FORBIDDEN/], ['transfer replay', transferSql, /CRM_POST_BOOKING_FORBIDDEN/],
        ['check-in replay', visitSql, /CRM_VISITS_FORBIDDEN/], ['QR issue replay', voiceSql, /CRM_VOICE_FORBIDDEN/],
        ['SOP replay', sopSql, /CRM_SOP_FORBIDDEN/],
        ['notifications', 'SELECT public.crm_v2_notifications_snapshot()', /CRM_NOTIFICATION_FORBIDDEN/],
    ]) await deny(`revoked Sales denied ${label}`, request(2, sql), pattern);
    await deny('revoked owner prevents public QR open', anonymous(openSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    await deny('revoked owner prevents public QR submit', anonymous(submitSql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    await deny('Admin cannot issue QR for disabled owner', request(1, voiceSql), /CRM_VOICE_FORBIDDEN/);
    assert.equal(await query(historySql), before); cases.push('revocation and all denied commands preserve workflow history');
    await review(2);
    const submitted = JSON.parse(await query(anonymous(submitSql)));
    truth('restored owner permits actual customer submission', submitted.submitted === true && submitted.replayed === false);
    truth('customer submit retries exactly once', JSON.parse(await query(anonymous(submitSql))).replayed === true);
    for (const n of [1, 2, 3, 4]) {
        const context = await call(n, voiceContextSql, true);
        truth(`read-only survey visibility role ${n}`, context.visit.status === 'completed'
            && (n === 4 ? context.submission.answers === null : context.submission.answers.score_price === 4));
    }
    await check('survey optional fields remain unknown', `SELECT monthly_income IS NULL AND phone IS NULL AND purpose_relocate IS NULL
      FROM public.customer_voices WHERE visit_id='${visit.visitId}';`);
    const filters = { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false };
    const readers = [
        ['booking', `SELECT public.crm_v2_booking_context('${booking.customerId}')`],
        ['post booking', postContextSql], ['project sales', "SELECT public.crm_v2_project_sales('SYNTHETIC Integration')"],
        ['reports', 'SELECT public.crm_v2_sales_report()'], ['central search', `SELECT public.crm_v2_central_search(${json(filters)})`],
        ['visits', `SELECT public.crm_v2_visits_context('${lead.customerId}','${interest.id}')`],
        ['project interests', `SELECT public.crm_v2_project_interests_context('${lead.customerId}')`],
        ['SOP', `SELECT public.crm_v2_visit_sop_context('${lead.customerId}','${interest.id}',NULL,'${visit.visitId}')`],
        ['Customer Voices', voiceContextSql], ['notifications', 'SELECT public.crm_v2_notifications_snapshot()'],
    ];
    for (const [label, sql] of readers) truth(`${label} works in read-only authenticated request`, !!await call(2, sql, true));
    await review(2, 'Owner');
    for (const [label, sql] of [['booking', bookingSql], ['post booking', contractSql], ['Visit', visitSql], ['SOP', sopSql], ['QR', voiceSql]]) {
        await deny(`Sales changed to Owner cannot replay ${label}`, request(2, sql), /CRM_\w*FORBIDDEN/);
    }
    await review(2, 'Sales', false);
    for (const [label, sql] of readers) await deny(`revoked identity cannot read ${label}`, request(2, sql, true), /CRM_\w*FORBIDDEN/);
    await review(2);
    await runWorkflowNotifications({ query, check, deny, truth, call, review, request, rpc, uid });
    // Both orderings are observed with independent backends; no timing-only claim
    // that a simultaneous Promise happened to exercise a lock/recheck path.
    const settled = promise => promise.then(value => ({ value }), error => ({ error }));
    const waitState = async (app, condition) => {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${literal(app)} AND ${condition});`) === 't') return;
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error(`Workflow concurrency backend not observed: ${app}`);
    };
    async function overlap(heldSql, waitingSql) {
        const token = randomUUID().slice(0, 8), heldName = `workflow_hold_${token}`, waitingName = `workflow_wait_${token}`;
        const named = (sql, name) => sql.replace('BEGIN;', `BEGIN; SET LOCAL application_name=${literal(name)};`);
        const held = settled(query(named(heldSql.replace('COMMIT;', 'SELECT pg_sleep(4); COMMIT;'), heldName)));
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
    const racingBook = rpc('crm_v2_booking_command', bookPayload(5));
    const revoke = await reviewStatement(2, 'Sales', false);
    const revokedAfter = await overlap(request(2, racingBook), `BEGIN; ${revoke} COMMIT;`);
    truth('in-flight booking finishes before waiting revocation', !revokedAfter.error);
    await deny('booking replay after committed revoke is rejected', request(2, racingBook), /CRM_BOOKING_FORBIDDEN/);
    await review(2);
    const revokeFirst = await reviewStatement(2, 'Sales', false);
    const afterRevoke = await overlap(`BEGIN; ${revokeFirst} COMMIT;`, request(2, rpc('crm_v2_booking_command', bookPayload(6))));
    truth('booking waits for revocation then rejects stale session', /CRM_BOOKING_FORBIDDEN/.test(afterRevoke.error?.message ?? ''));
    await check('revoke-first leaves no partial customer or occupied stock', `SELECT NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE phone='0889700006')
      AND NOT has_customer FROM public.plots WHERE id='SYNTHETIC-INTEGRATION-6';`);
    await review(2);
    return { assertions: cases.length, cases, compiledDrafts: workflowDraftPaths.length,
        productionChanged: false, realSupabaseAuthTested: false, realPostgrestTested: false };
}
