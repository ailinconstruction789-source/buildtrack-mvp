// Runs only within the already-verified disposable installed-chain rehearsal.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runCentralVisitsDisableRuntime({ query, root, report, owner, request, anonymous, customerId, interestId, visitId, rawToken, answers }) {
    const path = 'sql/sales/deployment/central_visits_disable_local.sql';
    const sql = readFileSync(join(root, path), 'utf8');
    report.sources[path] = createHash('sha256').update(sql).digest('hex');
    const cases = [];
    const scope = { customerId, interestId, expectedInterestRevision: await query(`SELECT lifecycle_revision FROM public.lead_project_interests WHERE id='${interestId}';`) };
    const rpc = async (name, payload) => JSON.parse(await query(request(owner, `SELECT public.${name}('${randomUUID()}','${JSON.stringify(payload)}'::jsonb);`)));
    const pending = await rpc('crm_v2_visits_command', { ...scope, command: 'check_in', appointmentId: null,
        expectedAppointmentRevision: null, occurredAt: new Date().toISOString(), reason: 'SYNTHETIC outstanding work before disable' });
    await rpc('crm_v2_record_visit_sop', { ...scope, command: 'start', appointmentId: null, visitId: pending.visitId,
        plotId: 'K-9', occurredAt: new Date().toISOString(), reason: 'SYNTHETIC unfinished SOP before disable' });
    const pendingToken = 'e'.repeat(64);
    await rpc('crm_v2_customer_voices_command', { ...scope, command: 'issue', visitId: pending.visitId,
        expectedVisitRevision: pending.visitRevision, expectedTokenId: null,
        tokenHash: createHash('sha256').update(pendingToken).digest('hex'), reason: 'SYNTHETIC outstanding QR before disable' });
    const signatures = [...sql.matchAll(/^    '(public\.crm_v2_[^']+)'/gm)].map(match => match[1]);
    assert.equal(signatures.length, 15);
    const accessState = `SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_object('id',oid,'acl',proacl) ORDER BY oid)
      FROM pg_proc WHERE oid IN (${signatures.map(signature => `'${signature}'::regprocedure`).join(',')})),
      'policy',(SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid='public.customer_voices'::regclass AND polname='voice_v2_private_read'));`;
    const accessBefore = await query(accessState);
    const bookingAccess = "SELECT jsonb_agg(jsonb_build_object('id',oid,'acl',proacl,'definition',md5(pg_get_functiondef(oid))) ORDER BY oid) FROM pg_proc WHERE oid IN ('public.crm_v2_booking_context(uuid,integer)'::regprocedure,'public.crm_v2_booking_command(uuid,jsonb)'::regprocedure);";
    const bookingBefore = await query(bookingAccess);
    const dataState = `SELECT jsonb_build_object(
      'settings',(SELECT to_jsonb(s)-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled'] FROM public.crm_settings s WHERE id),
      'rows',(SELECT jsonb_object_agg(name,body) FROM (
        SELECT 'visits' AS name,(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.lead_visits t) AS body
        UNION ALL SELECT 'appointments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.lead_appointments t)
        UNION ALL SELECT 'sop',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.house_visit_checklist_runs t)
        UNION ALL SELECT 'sopItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.house_visit_checklist_items t)
        UNION ALL SELECT 'visitEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.visits_events t)
        UNION ALL SELECT 'visitRequests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.visits_command_requests t)
        UNION ALL SELECT 'sopEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.visit_sop_events t)
        UNION ALL SELECT 'sopRequests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.visit_sop_command_requests t)
        UNION ALL SELECT 'voiceEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.voice_events t)
        UNION ALL SELECT 'voiceRequests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.voice_staff_requests t)
        UNION ALL SELECT 'voiceSubmissions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM sales_private.voice_submissions t)
        UNION ALL SELECT 'voices',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_voices t)
        UNION ALL SELECT 'nextActions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.crm_next_actions t)
        UNION ALL SELECT 'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sales_private.visit_submission_tokens t)
        UNION ALL SELECT 'sales',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t)
        UNION ALL SELECT 'plots',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.plots t)
        UNION ALL SELECT 'customers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_customers t)
        UNION ALL SELECT 'interests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.lead_project_interests t)
        UNION ALL SELECT 'release',(SELECT jsonb_agg(to_jsonb(t) ORDER BY batch_id) FROM crm_external_private.visit_workflow_releases t)
      ) q));`;
    const before = JSON.parse(await query(dataState));
    const firstDifference = (actual, expected, path = 'snapshot') => {
        if (Object.is(actual, expected)) return null;
        if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return path;
        for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
            const difference = firstDifference(actual[key], expected[key], `${path}.${key}`);
            if (difference) return difference;
        }
        return null;
    };
    const assertState = async checkpoint => {
        const actual = JSON.parse(await query(dataState));
        const difference = firstDifference(actual, before);
        assert.equal(difference, null, `Disable preservation failed at ${checkpoint}: ${difference}`);
    };
    await assert.rejects(query(sql), /CENTRAL_VISITS_DISABLE_LOCAL_ONLY/);
    cases.push('disable rejects missing local synthetic marker');
    const prepared = `SET buildtrack.central_visits_disable='local_synthetic_v1';\n${sql}`;
    await assert.rejects(query(`SET ROLE authenticated; ${prepared}`), /permission denied|EXTERNAL_CUTOVER_OPERATOR_REQUIRED/);
    cases.push('authenticated non-operator cannot run reviewed local disable');
    await assert.rejects(query(prepared.replace(/COMMIT;\s*$/, "DO $late$ BEGIN RAISE EXCEPTION 'SYNTHETIC_DISABLE_LATE_FAILURE'; END; $late$; COMMIT;")), /SYNTHETIC_DISABLE_LATE_FAILURE/);
    assert.equal(await query("SELECT visits_enabled AND visit_sop_enabled AND customer_voices_enabled AND has_function_privilege('authenticated','public.crm_v2_visits_command(uuid,jsonb)','EXECUTE') FROM public.crm_settings WHERE id;"), 't');
    await assertState('failed disable rollback');
    assert.equal(await query(accessState), accessBefore);
    cases.push('failed disable atomically restores flags grants policy and collected data');
    await query(prepared);
    await assertState('successful disable');
    cases.push('disable preserves all collected workflow data imported identities booking plots and release receipt');
    assert.equal(await query("SELECT NOT visits_enabled AND NOT visit_sop_enabled AND NOT customer_voices_enabled AND crm_external_private.booking_writer_ready() FROM public.crm_settings WHERE id;"), 't');
    cases.push('only Visit switches turn off and booking writer remains ready');
    assert.equal(await query(bookingAccess), bookingBefore);
    JSON.parse(await query(request(owner, `SELECT public.crm_v2_booking_context('${customerId}',0);`)));
    cases.push('existing booking API definitions and grants unchanged and Sales caller context still works');
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        assert.equal(await query(`SELECT ${signatures.map(signature => `NOT has_function_privilege('${role}','${signature}','EXECUTE')`).join(' AND ')};`), 't');
        cases.push(`disabled new writer grants denied for ${role}`);
    }
    await assert.rejects(query(request(owner, `SELECT public.crm_v2_visits_context('${customerId}','${interestId}',0,0,0);`)), /permission denied/);
    await assert.rejects(query(anonymous(`SELECT public.crm_v2_customer_voice_open('${rawToken}');`)), /permission denied/);
    await assert.rejects(query(anonymous(`SELECT public.crm_v2_customer_voice_submit('${rawToken}','${randomUUID()}','customer_voices_v1','${JSON.stringify(answers)}'::jsonb);`)), /permission denied/);
    cases.push('old clients and anonymous QR cannot call disabled workflow endpoints');
    await assert.rejects(query(anonymous(`SELECT public.crm_v2_customer_voice_submit('${pendingToken}','${randomUUID()}','customer_voices_v1','${JSON.stringify(answers)}'::jsonb);`)), /permission denied/);
    assert.equal(await query(`SELECT v.status='awaiting_voice' AND v.completed_voice_id IS NULL AND r.current_stage='stage_a'
      AND EXISTS(SELECT 1 FROM sales_private.visit_submission_tokens WHERE visit_id=v.id AND consumed_at IS NULL AND revoked_at IS NULL)
      FROM public.lead_visits v JOIN public.house_visit_checklist_runs r ON r.visit_id=v.id WHERE v.id='${pending.visitId}';`), 't');
    cases.push('unconsumed QR and partial SOP survive disable but outstanding QR cannot submit');
    assert.equal(await query(request(owner, 'SELECT count(*)=1 AND bool_and(visit_id IS NULL) FROM public.customer_voices;')), 't');
    cases.push('legacy Voice reads continue without revoked helper dependency');
    assert.equal(await query(`SELECT status='completed' AND completed_voice_id IS NOT NULL FROM public.lead_visits WHERE id='${visitId}';`), 't');
    cases.push('completed Visit and response are retained rather than reverted');
    await query(prepared);
    await assertState('repeated disable');
    cases.push('repeat disable safely preserves data');
    assert.equal(await query('SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.booking_activation_permits);'), 't');
    cases.push('operator settings permit is cleaned after disable');
    assert.equal(readFileSync(join(root, path), 'utf8'), sql);
    return { assertions: cases.length, cases, productionChanged: false, syntheticOnly: true, reactivationTested: false };
}
