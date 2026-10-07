// Additive local-only rehearsal on the exact installed import + booking chain.
// No connection settings, application env, live rows or standalone foundation replay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assembleCentralVisitsCandidate, centralVisitsCandidatePath, centralVisitsHeader, centralVisitsFooter, centralVisitsParts } from './central-visits-candidate.mjs';

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const owner = 'a0290000-0000-4000-8000-000000000201';
const other = 'a0290000-0000-4000-8000-000000000202';
const admin = 'a0250000-0000-4000-8000-000000000001';
const sessions = { [owner]: 'b0290000-0000-4000-8000-000000000201', [other]: 'b0290000-0000-4000-8000-000000000202', [admin]: 'b0250000-0000-4000-8000-000000000001' };
const request = (actor, sql, prefix = '') => `BEGIN; ${prefix} SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims"=${json({ sub: actor, session_id: sessions[actor], role: 'authenticated' }).replace(/::jsonb$/, '')}; ${sql} COMMIT;`;
const anonymous = sql => `BEGIN; SET LOCAL ROLE anon; ${sql} COMMIT;`;
const timestamp = () => new Date().toISOString();

export async function runCentralVisitsCandidateRuntime({ query, root, report, parsers, reviewedPackage = false }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND session_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    const load = path => { const source = readFileSync(join(root, path), 'utf8'); report.sources[path] = createHash('sha256').update(source).digest('hex'); return source; };
    const paths = [centralVisitsCandidatePath, centralVisitsHeader, ...centralVisitsParts, centralVisitsFooter];
    const sources = new Map(paths.map(path => [path, load(path)]));
    const candidate = sources.get(centralVisitsCandidatePath).replaceAll('\r\n', '\n');
    assert.equal(candidate, assembleCentralVisitsCandidate(sources));
    cases.push('saved additive candidate equals reviewed sources without reinstalling SQL04 or SQL05');
    const reviewed = `SET buildtrack.central_visits_release='local_synthetic_v1';\n${candidate}`;
    if (!reviewedPackage) {
        await deny('candidate refuses unattended install', candidate, /CENTRAL_VISITS_|VISIT_WORKFLOW_/);
        await deny('late candidate failure rolls back new tables and flags', reviewed.replace(/COMMIT;\s*$/, "DO $late$ BEGIN RAISE EXCEPTION 'SYNTHETIC_VISITS_LATE_FAILURE'; END; $late$; COMMIT;"), /SYNTHETIC_VISITS_LATE_FAILURE/);
    }
    await check('failed addition leaves booking enabled and visit schema absent', `SELECT
      to_regclass('sales_private.visits_command_requests') IS NULL
      AND to_regprocedure('public.crm_v2_visits_command(uuid,jsonb)') IS NULL
      AND (SELECT booking_enabled FROM public.crm_settings WHERE id);`);
    const protectedState = `SELECT jsonb_build_object(
      'customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales_customers x),
      'interests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.lead_project_interests x),
      'sales',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales x),
      'plots',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.plots x),
      'legacyLeads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.leads x),
      'legacyVoices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_voices x WHERE visit_id IS NULL),
      'source',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM crm_external_private.snapshot_batches x),
      'sla',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.crm_sla_tasks x),
      'activities',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.lead_activities x));`;
    const baseline = await query(protectedState);
    let reviewedInstall;
    if (reviewedPackage) {
        const { runReviewedVisitInstall } = await import('./central-visits-reviewed-install-runtime.mjs');
        reviewedInstall = await runReviewedVisitInstall({ query, root, report });
    } else await query(reviewed);
    assert.equal(await query(protectedState), baseline);
    cases.push('installation leaves imported identity history bookings plots legacy data and SLA unchanged');
    await check('installed visit features are all off', 'SELECT NOT visits_enabled AND NOT visit_sop_enabled AND NOT customer_voices_enabled FROM public.crm_settings WHERE id;');
    await check('sealed installation still permits existing legacy survey reads', request(owner, 'SELECT count(*)=1 AND bool_and(visit_id IS NULL) FROM public.customer_voices;'));
    const signatures = ['crm_v2_visits_command(uuid,jsonb)', 'crm_v2_record_visit_sop(uuid,jsonb)',
        'crm_v2_customer_voices_command(uuid,jsonb)', 'crm_v2_visit_follow_up_command(uuid,jsonb)',
        'crm_v2_customer_voice_open(text)', 'crm_v2_customer_voice_submit(text,uuid,text,jsonb)'];
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await check(`new executable grants sealed before activation for ${role}`, `SELECT ${signatures.map(signature => `NOT has_function_privilege('${role}','public.${signature}','EXECUTE')`).join(' AND ')};`);
    }
    const activate = "SELECT crm_external_private.enable_visit_workflow(id,plan_digest,'SYNTHETIC local visit workflow') FROM crm_external_private.snapshot_batches;";
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`activation helper inaccessible to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${activate} ROLLBACK;`, /permission denied/);
    }
    let reviewedActivation;
    if (reviewedPackage) {
        const { runReviewedVisitActivation } = await import('./central-visits-activate-reviewed-runtime.mjs');
        reviewedActivation = await runReviewedVisitActivation({ query, root, report, releaseDigest: reviewedInstall.releaseDigest });
    } else await query(`SET buildtrack.central_visits_release='local_synthetic_v1'; ${activate}`);
    await check('only reviewed visit feature flags become enabled', 'SELECT visits_enabled AND visit_sop_enabled AND customer_voices_enabled AND voice_token_ttl_hours=24 FROM public.crm_settings WHERE id;');
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await check(`general work lifecycle and direct action storage remain sealed for ${role}`, `SELECT
          NOT has_function_privilege('${role}','public.crm_v2_record_lead_work(uuid,jsonb)','EXECUTE')
          AND NOT has_function_privilege('${role}','public.crm_v2_change_lead_lifecycle(uuid,jsonb)','EXECUTE')
          AND NOT has_table_privilege('${role}','public.crm_next_actions','INSERT,UPDATE,DELETE');`);
    }
    const importedInterests = JSON.parse(await query(`SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.lead_project_interests i
      WHERE owner_user_id='${owner}' AND project_name='PROJECT K' AND external_snapshot_batch_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM public.sales s WHERE s.project_interest_id=i.id AND s.external_source_stage='booked');`));
    assert.equal(importedInterests.length, 1, 'requires exactly one imported booked-source interest; never choose an arbitrary row');
    const [interest] = importedInterests;
    assert.equal(interest.engagement_status, 'legacy_unclassified');
    const customerId = interest.customer_id;
    const scope = { customerId, interestId: interest.id, expectedInterestRevision: interest.lifecycle_revision };
    const visitPayload = (command, extra = {}) => ({ command, ...scope, occurredAt: timestamp(), reason: 'SYNTHETIC real new appointment', ...extra });
    const call = (name, payload, id = randomUUID()) => `SELECT public.${name}('${id}',${json(payload)});`;
    const rpc = async (actor, name, payload, id) => JSON.parse(await query(request(actor, call(name, payload, id))));
    const schedulePayload = visitPayload('schedule', { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: null });
    await deny('other Sales cannot schedule against imported interest', request(other, call('crm_v2_visits_command', schedulePayload)), /CRM_VISITS_FORBIDDEN/);
    const scheduled = await rpc(owner, 'crm_v2_visits_command', schedulePayload);
    cases.push('current Sales schedules new appointment for imported legacy_unclassified identity');
    const sopScope = { ...scope, appointmentId: scheduled.appointmentId, visitId: null };
    const sopPayload = (command, extra = {}) => ({ command, ...sopScope, occurredAt: timestamp(), reason: 'SYNTHETIC actual Sales SOP', ...extra });
    const started = await rpc(owner, 'crm_v2_record_visit_sop', sopPayload('start', { plotId: 'K-9' }));
    let run = started;
    const sopSnapshot = async () => JSON.parse(await query(request(owner, `SELECT public.crm_v2_visit_sop_context('${customerId}','${interest.id}','${scheduled.appointmentId}',NULL,0);`)));
    const answersFor = async stage => JSON.parse(await query(`SELECT jsonb_agg(jsonb_build_object('key',item_key,'result','done','reason',NULL) ORDER BY ordinal) FROM sales_private.crm_sop_template() WHERE stage='${stage}';`));
    const stageA = await answersFor('stage_a');
    const badSkip = structuredClone(stageA); badSkip[0] = { ...badSkip[0], result: 'skipped' };
    const stagePayload = (stage, answers) => sopPayload('complete_stage', { runId: run.runId, expectedRunRevision: run.runRevision, stage, answers,
        recap: stage === 'stage_a' ? null : { feedback: 'SYNTHETIC feedback', objections: 'SYNTHETIC no objection', departedAt: timestamp() } });
    await deny('SOP skip without reason is refused', request(owner, call('crm_v2_record_visit_sop', stagePayload('stage_a', badSkip))), /CRM_SOP_INVALID_INPUT/);
    stageA[0] = { ...stageA[0], result: 'skipped', reason: 'SYNTHETIC not applicable to this visit' };
    run = await rpc(owner, 'crm_v2_record_visit_sop', stagePayload('stage_a', stageA));
    assert.equal(run.stage, 'stage_b');
    await deny('SOP tour cannot begin without actual check-in', request(owner, call('crm_v2_record_visit_sop', sopPayload('start_tour', { runId: run.runId, expectedRunRevision: run.runRevision }))), /CRM_SOP_VISIT_REQUIRED/);
    const checked = await rpc(owner, 'crm_v2_visits_command', visitPayload('check_in', { appointmentId: scheduled.appointmentId, expectedAppointmentRevision: scheduled.appointmentRevision }));
    await check('actual check-in does not complete Visit before Voice', `SELECT status='awaiting_voice' AND completed_voice_id IS NULL FROM public.lead_visits WHERE id='${checked.visitId}';`);
    run = await rpc(owner, 'crm_v2_record_visit_sop', sopPayload('start_tour', { runId: run.runId, expectedRunRevision: run.runRevision }));
    assert.equal(run.stage, 'stage_c');
    const stageC = await answersFor('stage_c');
    await deny('SOP closing requires future next action', request(owner, call('crm_v2_record_visit_sop', stagePayload('stage_c', stageC))), /CRM_SOP_NEXT_ACTION_REQUIRED/);
    const nextPayload = { command: 'set_next_action', customerId, interestId: interest.id, expectedActionId: null,
        nextAction: { action: 'SYNTHETIC call after visit', dueAt: new Date(Date.now() + 86400000).toISOString() }, reason: 'SYNTHETIC agreed follow-up' };
    for (const actor of [other, admin]) await deny(`only current Sales can set next action, denied ${actor === admin ? 'Admin' : 'other Sales'}`, request(actor, call('crm_v2_visit_follow_up_command', nextPayload)), /CRM_WORK_FORBIDDEN/);
    await deny('narrow next-action API refuses general record_attempt', request(owner, call('crm_v2_visit_follow_up_command', { ...nextPayload, command: 'record_attempt' })), /CRM_WORK_INVALID_INPUT/);
    await deny('narrow next-action API refuses customer-wide scope', request(owner, call('crm_v2_visit_follow_up_command', { ...nextPayload, interestId: null })), /CRM_WORK_INVALID_INPUT/);
    await deny('original general work RPC remains inaccessible', request(owner, call('crm_v2_record_lead_work', nextPayload)), /permission denied/);
    const nextRequest = randomUUID();
    const next = await rpc(owner, 'crm_v2_visit_follow_up_command', nextPayload, nextRequest);
    assert.equal((await rpc(owner, 'crm_v2_visit_follow_up_command', nextPayload, nextRequest)).replayed, true);
    assert.equal(next.activityId, null);
    cases.push('current Sales sets one next action and identical retry is idempotent without fabricated contact');
    await deny('next action replay still checks current session', request(owner, call('crm_v2_visit_follow_up_command', nextPayload, nextRequest), `DELETE FROM auth.sessions WHERE id='${sessions[owner]}';`), /CRM_WORK_FORBIDDEN/);
    run = await rpc(owner, 'crm_v2_record_visit_sop', stagePayload('stage_c', stageC));
    assert.equal(run.stage, 'completed');
    const completedSop = await sopSnapshot();
    parsers.sop(completedSop, { customerId, interestId: interest.id, appointmentId: scheduled.appointmentId, visitId: null, eventPage: 0 });
    assert.equal(completedSop.run.nextAction, nextPayload.nextAction.action);
    await check('completed SOP records future follow-up but Visit still awaits Voice', `SELECT r.next_action_id='${next.nextActionId}' AND r.current_stage='completed' AND v.status='awaiting_voice'
      FROM public.house_visit_checklist_runs r JOIN public.lead_visits v ON v.id=r.visit_id WHERE r.id='${run.runId}';`);
    const rawToken = 'a'.repeat(64);
    const voicePayload = { command: 'issue', ...scope, visitId: checked.visitId, expectedVisitRevision: checked.visitRevision, expectedTokenId: null,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'), reason: 'SYNTHETIC customer fills own QR' };
    await rpc(owner, 'crm_v2_customer_voices_command', voicePayload);
    await check('QR lifetime is 24 hours and bearer is stored only as a hash', `SELECT expires_at-created_at=interval '24 hours'
      AND token_hash='${voicePayload.tokenHash}' AND token_hash<>'${rawToken}' FROM sales_private.visit_submission_tokens WHERE visit_id='${checked.visitId}';`);
    const open = JSON.parse(await query(anonymous(`SELECT public.crm_v2_customer_voice_open('${rawToken}');`)));
    assert.deepEqual(Object.keys(open).sort(), ['expiresAt', 'formVersion']);
    const answers = Object.fromEntries(['knowledge', 'problem_solving', 'service_mind', 'appearance', 'cleanliness', 'house_design', 'price', 'location'].map(key => [`score_${key}`, 4]));
    const voiceRequest = randomUUID();
    const submit = (values = answers, id = voiceRequest) => `SELECT public.crm_v2_customer_voice_submit('${rawToken}','${id}','customer_voices_v1',${json(values)});`;
    const missingScore = { ...answers }; delete missingScore.score_price;
    await deny('missing eighth score cannot complete Visit', anonymous(submit(missingScore)), /CRM_VOICE_INVALID_INPUT/);
    const concurrentSubmissions = await Promise.all([query(anonymous(submit())), query(anonymous(submit()))]);
    assert.deepEqual(concurrentSubmissions.map(value => JSON.parse(value).replayed).sort(), [false, true]);
    assert.deepEqual(JSON.parse(await query(anonymous(submit()))), { submitted: true, replayed: true });
    cases.push('anonymous QR submission completes Visit once; exact retry replays without personal data response');
    await deny('consumed QR cannot accept a different response', anonymous(submit({ ...answers, score_price: 5 })), /CRM_VOICE_IDEMPOTENCY_CONFLICT/);
    await check('one Voice links exact Visit without invented optional personal answers', `SELECT count(*)=1 AND bool_and(v.status='completed' AND v.completed_voice_id=c.id
      AND c.lead_id IS NULL AND c.monthly_income IS NULL AND c.phone IS NULL AND c.purpose_relocate IS NULL)
      FROM public.lead_visits v JOIN public.customer_voices c ON c.visit_id=v.id WHERE v.id='${checked.visitId}';`);
    const visitRead = JSON.parse(await query(request(owner, `SELECT public.crm_v2_visits_context('${customerId}','${interest.id}',0,0,0);`)));
    parsers.visits(visitRead, { customerId, interestId: interest.id, appointmentPage: 0, visitPage: 0, eventPage: 0 });
    const voiceRead = JSON.parse(await query(request(owner, `SELECT public.crm_v2_customer_voices_context('${customerId}','${interest.id}','${checked.visitId}');`)));
    parsers.voice(voiceRead, { customerId, interestId: interest.id, visitId: checked.visitId });
    const otherVoice = JSON.parse(await query(request(other, `SELECT public.crm_v2_customer_voices_context('${customerId}','${interest.id}','${checked.visitId}');`)));
    assert.equal(otherVoice.submission.answers, null);
    await check('other Sales cannot read new personal Voice answers through legacy table grants', request(other, 'SELECT count(*)=1 AND bool_and(visit_id IS NULL) FROM public.customer_voices;'));
    for (const actor of [owner, other, admin]) {
        const followUp = JSON.parse(await query(request(actor, `SELECT public.crm_v2_visit_follow_up_context('${customerId}','${interest.id}');`)));
        parsers.followUp(followUp, { customerId, interestId: interest.id }, 'sales_owned_only');
        assert.equal(followUp.canWrite, actor === owner);
    }
    cases.push('actual Visit SOP Voice and narrow follow-up snapshots pass application parsers');
    const appointmentCount = await query('SELECT count(*) FROM public.lead_appointments;');
    const walkPayload = visitPayload('check_in', { appointmentId: null, expectedAppointmentRevision: null, reason: 'SYNTHETIC actual walk-in without appointment' });
    await deny('other Sales cannot check in a walk-in for imported interest', request(other, call('crm_v2_visits_command', walkPayload)), /CRM_VISITS_FORBIDDEN/);
    const walkRequest = randomUUID();
    const walk = await rpc(owner, 'crm_v2_visits_command', walkPayload, walkRequest);
    assert.equal(walk.appointmentId, null);
    assert.equal((await rpc(owner, 'crm_v2_visits_command', walkPayload, walkRequest)).replayed, true);
    assert.equal(await query('SELECT count(*) FROM public.lead_appointments;'), appointmentCount);
    await check('walk-in and exact retry create one awaiting Visit without a fabricated appointment', `SELECT count(*)=1 AND bool_and(appointment_id IS NULL AND status='awaiting_voice' AND completed_voice_id IS NULL)
      FROM public.lead_visits WHERE id='${walk.visitId}';`);
    const walkSopScope = { ...scope, appointmentId: null, visitId: walk.visitId };
    const walkSopPayload = (command, extra = {}) => ({ command, ...walkSopScope, occurredAt: timestamp(), reason: 'SYNTHETIC actual walk-in SOP', ...extra });
    let walkRun = await rpc(owner, 'crm_v2_record_visit_sop', walkSopPayload('start', { plotId: 'K-9' }));
    const walkStage = (stage, answers) => walkSopPayload('complete_stage', { runId: walkRun.runId, expectedRunRevision: walkRun.runRevision, stage, answers,
        recap: stage === 'stage_a' ? null : { feedback: 'SYNTHETIC walk-in feedback', objections: 'SYNTHETIC no objection', departedAt: timestamp() } });
    walkRun = await rpc(owner, 'crm_v2_record_visit_sop', walkStage('stage_a', await answersFor('stage_a')));
    walkRun = await rpc(owner, 'crm_v2_record_visit_sop', walkSopPayload('start_tour', { runId: walkRun.runId, expectedRunRevision: walkRun.runRevision }));
    walkRun = await rpc(owner, 'crm_v2_record_visit_sop', walkStage('stage_c', stageC));
    const walkSopRead = JSON.parse(await query(request(owner, `SELECT public.crm_v2_visit_sop_context('${customerId}','${interest.id}',NULL,'${walk.visitId}',0);`)));
    parsers.sop(walkSopRead, { customerId, interestId: interest.id, appointmentId: null, visitId: walk.visitId, eventPage: 0 });
    await check('walk-in completed SOP remains awaiting Customer Voices', `SELECT r.current_stage='completed' AND r.appointment_id IS NULL AND v.status='awaiting_voice'
      FROM public.house_visit_checklist_runs r JOIN public.lead_visits v ON v.id=r.visit_id WHERE r.id='${walkRun.runId}';`);

    // A past token is a transaction-local synthetic fixture, not an issued QR.
    // Existing token guards stay enabled; no app function, TTL or system clock is changed.
    // Every probe rolls back (including the rejecting query's aborted transaction).
    const expiredToken = 'b'.repeat(64);
    const expiredHash = createHash('sha256').update(expiredToken).digest('hex');
    const expiredSetup = `INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),'${walk.visitId}',NULL);
      INSERT INTO sales_private.visit_submission_tokens(visit_id,token_hash,created_at,expires_at)
      VALUES('${walk.visitId}','${expiredHash}',clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour');
      DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();`;
    const walkVoiceSql = `SELECT public.crm_v2_customer_voices_context('${customerId}','${interest.id}','${walk.visitId}');`;
    const expiredRead = JSON.parse(await query(request(owner, walkVoiceSql, expiredSetup).replace(/COMMIT;$/, 'ROLLBACK;')));
    parsers.voice(expiredRead, { customerId, interestId: interest.id, visitId: walk.visitId });
    assert.equal(expiredRead.activeToken, null);
    assert.equal(expiredRead.submission, null);
    cases.push('expired QR is absent from the parsed active-token staff contract');
    const submitToken = (token, id = randomUUID()) => `SELECT public.crm_v2_customer_voice_submit('${token}','${id}','customer_voices_v1',${json(answers)});`;
    for (const [label, sql] of [['open', `SELECT public.crm_v2_customer_voice_open('${expiredToken}');`], ['submit', submitToken(expiredToken)]]) {
        await deny(`expired QR cannot ${label} on the installed chain`, `BEGIN; ${expiredSetup} SET LOCAL ROLE anon; ${sql} ROLLBACK;`, /CRM_VOICE_TOKEN_UNAVAILABLE/);
    }
    await check('expired probes roll back token fixture and leave no survey or completion history', `SELECT
      NOT EXISTS(SELECT 1 FROM sales_private.visit_submission_tokens WHERE token_hash='${expiredHash}')
      AND NOT EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id='${walk.visitId}')
      AND NOT EXISTS(SELECT 1 FROM sales_private.voice_events WHERE visit_id='${walk.visitId}')
      AND EXISTS(SELECT 1 FROM public.lead_visits WHERE id='${walk.visitId}' AND status='awaiting_voice' AND completed_voice_id IS NULL);`);

    const firstToken = 'c'.repeat(64);
    const replacementToken = 'd'.repeat(64);
    const walkVoicePayload = { ...voicePayload, visitId: walk.visitId, expectedVisitRevision: walk.visitRevision,
        tokenHash: createHash('sha256').update(firstToken).digest('hex'), reason: 'SYNTHETIC walk-in initial QR' };
    const firstIssued = await rpc(owner, 'crm_v2_customer_voices_command', walkVoicePayload);
    assert.equal(JSON.parse(await query(anonymous(`SELECT public.crm_v2_customer_voice_open('${firstToken}');`))).formVersion, 'customer_voices_v1');
    const rotatePayload = { ...walkVoicePayload, expectedTokenId: firstIssued.tokenId,
        tokenHash: createHash('sha256').update(replacementToken).digest('hex'), reason: 'SYNTHETIC customer requests replacement QR' };
    await deny('other Sales cannot rotate walk-in QR', request(other, call('crm_v2_customer_voices_command', rotatePayload)), /CRM_VOICE_FORBIDDEN/);
    const rotateRequest = randomUUID();
    const rotated = await rpc(owner, 'crm_v2_customer_voices_command', rotatePayload, rotateRequest);
    assert.equal((await rpc(owner, 'crm_v2_customer_voices_command', rotatePayload, rotateRequest)).replayed, true);
    await check('rotation and exact retry retain two tokens with only the replacement active', `SELECT count(*)=2
      AND count(*) FILTER(WHERE id='${firstIssued.tokenId}' AND revoked_at IS NOT NULL AND consumed_at IS NULL)=1
      AND count(*) FILTER(WHERE id='${rotated.tokenId}' AND revoked_at IS NULL AND consumed_at IS NULL)=1
      FROM sales_private.visit_submission_tokens WHERE visit_id='${walk.visitId}';`);
    for (const [label, sql] of [['open', `SELECT public.crm_v2_customer_voice_open('${firstToken}');`], ['submit', submitToken(firstToken)]]) {
        await deny(`rotated old QR cannot ${label}`, anonymous(sql), /CRM_VOICE_TOKEN_UNAVAILABLE/);
    }
    const rotatedRead = JSON.parse(await query(request(owner, walkVoiceSql)));
    parsers.voice(rotatedRead, { customerId, interestId: interest.id, visitId: walk.visitId });
    assert.equal(rotatedRead.activeToken.id, rotated.tokenId);
    assert.equal(rotatedRead.submission, null);
    await check('rejected old QR leaves walk-in awaiting valid submission', `SELECT status='awaiting_voice' AND completed_voice_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id='${walk.visitId}') FROM public.lead_visits WHERE id='${walk.visitId}';`);
    assert.deepEqual(Object.keys(JSON.parse(await query(anonymous(`SELECT public.crm_v2_customer_voice_open('${replacementToken}');`)))).sort(), ['expiresAt', 'formVersion']);
    assert.deepEqual(JSON.parse(await query(anonymous(submitToken(replacementToken)))), { submitted: true, replayed: false });
    await check('replacement QR completes the exact walk-in once without optional personal defaults', `SELECT count(*)=1 AND bool_and(v.status='completed' AND v.completed_voice_id=c.id
      AND v.appointment_id IS NULL AND c.lead_id IS NULL AND c.monthly_income IS NULL AND c.phone IS NULL AND c.purpose_relocate IS NULL)
      FROM public.lead_visits v JOIN public.customer_voices c ON c.visit_id=v.id WHERE v.id='${walk.visitId}';`);
    const walkCompleted = JSON.parse(await query(request(owner, walkVoiceSql)));
    parsers.voice(walkCompleted, { customerId, interestId: interest.id, visitId: walk.visitId });
    assert.equal(walkCompleted.activeToken, null);
    const allVisits = JSON.parse(await query(request(owner, `SELECT public.crm_v2_visits_context('${customerId}','${interest.id}',0,0,0);`)));
    parsers.visits(allVisits, { customerId, interestId: interest.id, appointmentPage: 0, visitPage: 0, eventPage: 0 });
    assert.equal(await query('SELECT count(*) FROM public.lead_appointments;'), appointmentCount);
    cases.push('walk-in SOP, rotated Voice and final Visits snapshots pass application parsers without inventing appointment history');
    await deny('direct manipulation of imported identity still blocked', `UPDATE public.sales_customers SET customer_name='SYNTHETIC changed' WHERE id='${customerId}';`, /HISTORY_SEALED/);
    await deny('direct historical sale write remains blocked', 'UPDATE public.sales SET sale_price=1;', /EXTERNAL_|CRM_BOOKING_/);
    await check('private write permits cleaned after all workflow commands', `SELECT
      NOT EXISTS(SELECT 1 FROM sales_private.visits_write_permits)
      AND NOT EXISTS(SELECT 1 FROM sales_private.visit_sop_write_permits)
      AND NOT EXISTS(SELECT 1 FROM sales_private.voice_write_permits);`);
    assert.equal(await query(protectedState), baseline);
    cases.push('entire imported customer and interest histories, source, sales, construction, old voices and SLA remain unchanged');
    const preflightSource = load('sql/sales/deployment/central_visits_preflight_readonly.sql');
    const preflight = JSON.parse(await query(preflightSource));
    assert.equal(preflight.reportVersion, 'central-visits-preflight-v1');
    assert.equal(preflight.transactionTimeoutSupported, true);
    assert.equal(preflight.settings.visits_enabled, true);
    assert.ok(preflight.functionMetadata.some(item => item.signature === 'crm_v2_visits_command(uuid,jsonb)'));
    assert.ok(preflight.relations.some(item => item.name === 'lead_visits'));
    cases.push('metadata-only preflight executes and returns installed function relation and timeout support evidence');
    const { runCentralVisitsDisableRuntime } = await import('./central-visits-disable-runtime.mjs');
    let reviewedActiveDisable;
    if (reviewedPackage) {
        const { runCentralVisitsReviewedActiveProbe } = await import('./central-visits-reviewed-runtime.mjs');
        reviewedActiveDisable = await runCentralVisitsReviewedActiveProbe({ query, root, report, releaseDigest: reviewedInstall.releaseDigest });
    }
    const disabled = await runCentralVisitsDisableRuntime({ query, root, report, owner, request, anonymous, customerId, interestId: interest.id, visitId: checked.visitId, rawToken, answers });
    let reviewedDisable;
    if (reviewedPackage) {
        const { runCentralVisitsReviewedRuntime } = await import('./central-visits-reviewed-runtime.mjs');
        reviewedDisable = await runCentralVisitsReviewedRuntime({ query, root, report, releaseDigest: reviewedInstall.releaseDigest });
    }
    for (const [path, source] of sources) assert.equal(readFileSync(join(root, path), 'utf8'), source, `Source changed during rehearsal: ${path}`);
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false, exactInstalledBookingChain: true,
        importedAppointmentTested: true, scopedFollowUpTested: true, sopAndQrCompletionTested: true,
        importedWalkInTested: true, expiredQrRollbackProbeTested: true, rotatedQrTested: true, disabled, reviewedInstall, reviewedActivation, reviewedActiveDisable, reviewedDisable, realSupabasePoliciesTested: false, activationReady: false };
}
