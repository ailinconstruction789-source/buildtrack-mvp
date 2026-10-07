// Runs within the disposable installed-chain harness only; never connects live.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Exercise ON -> OFF with the same reviewed operation body. Replace only the
// transaction terminator with assertions and an intentional rollback, so the
// existing active-workflow/local-disable suite can continue without re-enabling.
export async function runCentralVisitsReviewedActiveProbe({ query, root, report, releaseDigest }) {
    const path = 'sql/sales/deployment/central_visits_disable_reviewed.sql';
    const sql = readFileSync(join(root, path), 'utf8');
    report.sources[path] = createHash('sha256').update(sql).digest('hex');
    const signatures = [...sql.matchAll(/^    '(public\.crm_v2_[^']+)'/gm)].map(match => match[1]);
    assert.equal(signatures.length, 15);
    const operationId = randomUUID();
    const review = JSON.parse(await query(`SELECT jsonb_build_object(
      'operationId','${operationId}', 'operationKind','disable',
      'reviewReference','SYNTHETIC active reviewed disable rollback probe',
      'expectedDatabase',current_database(),'expectedSessionActor',session_user,
      'expectedSettingsDigest',(SELECT md5(to_jsonb(s)::text) FROM public.crm_settings s WHERE id),
      'batchId',batch_id,'planDigest',plan_digest,'releaseDigest',release_digest)
      FROM crm_external_private.visit_workflow_operations WHERE operation_kind='install';`));
    assert.equal(review.releaseDigest, releaseDigest);
    assert.match(review.expectedDatabase, /^buildtrack_sales_runtime_[a-f0-9]+$/);
    assert.equal(await query('SELECT visits_enabled AND visit_sop_enabled AND customer_voices_enabled FROM public.crm_settings WHERE id;'), 't');
    const state = `SELECT jsonb_build_object(
      'settings',(SELECT to_jsonb(s) FROM public.crm_settings s WHERE id),
      'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY operation_id) FROM crm_external_private.visit_workflow_operations t),
      'functions',(SELECT jsonb_agg(jsonb_build_object('id',oid,'acl',proacl) ORDER BY oid) FROM pg_proc
        WHERE oid IN (${signatures.map(signature => `'${signature}'::regprocedure`).join(',')})),
      'policy',(SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid='public.customer_voices'::regclass AND polname='voice_v2_private_read'));`;
    const before = await query(state);
    const afterProbe = `DO $active_disable_probe$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE id AND NOT visits_enabled
        AND NOT visit_sop_enabled AND NOT customer_voices_enabled)
        OR NOT EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_operations
          WHERE operation_id='${operationId}' AND operation_kind='disable'
            AND (settings_before->>'visits_enabled')::boolean
            AND (settings_before->>'visit_sop_enabled')::boolean
            AND (settings_before->>'customer_voices_enabled')::boolean
            AND NOT (settings_after->>'visits_enabled')::boolean
            AND NOT (settings_after->>'visit_sop_enabled')::boolean
            AND NOT (settings_after->>'customer_voices_enabled')::boolean)
        OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE p.oid IN (${signatures.map(signature => `'${signature}'::regprocedure`).join(',')}) AND a.grantee<>p.proowner)
        OR NOT crm_external_private.booking_writer_ready() THEN
        RAISE EXCEPTION 'SYNTHETIC_REVIEWED_ACTIVE_DISABLE_ASSERTION_FAILED';
      END IF;
      RAISE EXCEPTION 'SYNTHETIC_REVIEWED_ACTIVE_DISABLE_PROBE_ROLLBACK';
    END; $active_disable_probe$; ROLLBACK;`;
    await assert.rejects(query(`SET buildtrack.visit_operation='${JSON.stringify(review).replaceAll("'", "''")}';\n${sql.replace(/COMMIT;\s*$/, afterProbe)}`), /SYNTHETIC_REVIEWED_ACTIVE_DISABLE_PROBE_ROLLBACK/);
    assert.equal(await query(state), before);

    // query() opens one local psql connection per call. A separate transaction
    // takes exactly the settings lock used by scoped writers. The advisory
    // marker is acquired AFTER the row lock, providing observable readiness;
    // seeing only RowShareLock would not prove the row-lock statement finished.
    // The holder lasts at most four seconds (six-second statement/tx ceilings).
    const marker = Number.parseInt(randomUUID().slice(0, 7), 16);
    let holderError;
    const holder = query(`BEGIN;
      SET LOCAL statement_timeout='6s'; SET LOCAL transaction_timeout='6s';
      SELECT 1 FROM public.crm_settings WHERE id FOR SHARE;
      SELECT pg_advisory_xact_lock(20260930,${marker});
      SELECT pg_sleep(4);
      COMMIT;`).catch(error => { holderError = error; });
    try {
        const deadline = Date.now() + 1200;
        let held = false;
        do {
            held = await query(`SELECT EXISTS(SELECT 1 FROM pg_locks marker
              JOIN pg_locks row_lock ON row_lock.pid=marker.pid
              WHERE marker.locktype='advisory' AND marker.classid=20260930
                AND marker.objid=${marker} AND marker.objsubid=2 AND marker.granted
                AND row_lock.locktype='relation' AND row_lock.relation='public.crm_settings'::regclass
                AND row_lock.mode='RowShareLock' AND row_lock.granted);`) === 't';
            if (!held && Date.now() < deadline) await query('SELECT pg_sleep(0.05);');
        } while (!held && Date.now() < deadline);
        assert.equal(held, true, 'Synthetic settings lock holder must signal readiness within the bounded probe');
        await assert.rejects(query(`SET buildtrack.visit_operation='${JSON.stringify(review).replaceAll("'", "''")}';\n${sql}`), /canceling statement due to lock timeout/);
    } finally {
        await holder;
    }
    if (holderError) throw holderError;
    assert.equal(await query(state), before);
    assert.equal(await query(`SELECT NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory'
      AND classid=20260930 AND objid=${marker} AND objsubid=2 AND granted);`), 't');
    return { assertions: 4, cases: ['reviewed active-disable body seals all 15 APIs and records ON to OFF with booking ready',
        'rollback probe restores exact active settings API grants Voice policy and receipt history',
        'separate connection proves settings FOR SHARE lock held and reviewed disable hits bounded lock timeout',
        'contention abort preserves exact active access settings and receipts after holder exits'],
    syntheticOnly: true, productionChanged: false, committed: false, concurrentDisableTested: true,
    concurrentDisableMode: 'settings-row-contention-timeout', inFlightRpcCompletionTested: false };
}

export async function runCentralVisitsReviewedRuntime({ query, root, report, releaseDigest }) {
    const path = 'sql/sales/deployment/central_visits_disable_reviewed.sql';
    const sql = readFileSync(join(root, path), 'utf8');
    report.sources[path] = createHash('sha256').update(sql).digest('hex');
    const cases = [];
    const base = JSON.parse(await query(`SELECT jsonb_build_object(
      'operationId','${randomUUID()}', 'operationKind','disable',
      'reviewReference','SYNTHETIC reviewed disable rehearsal',
      'expectedDatabase',current_database(),'expectedSessionActor',session_user,
      'expectedSettingsDigest',(SELECT md5(to_jsonb(s)::text) FROM public.crm_settings s WHERE id),
      'batchId',batch_id,'planDigest',plan_digest,'releaseDigest',release_digest)
      FROM crm_external_private.visit_workflow_operations WHERE operation_kind='install';`));
    assert.equal(base.releaseDigest, releaseDigest);
    assert.match(base.expectedDatabase, /^buildtrack_sales_runtime_[a-f0-9]+$/);
    const prepared = (review = base, source = sql) => `SET buildtrack.visit_operation='${JSON.stringify(review).replaceAll("'", "''")}';\n${source}`;
    const preserved = `SELECT jsonb_build_object(
      'settings',(SELECT to_jsonb(s) FROM public.crm_settings s WHERE id),
      'data',(SELECT jsonb_object_agg(name,digest) FROM (
        SELECT 'visits' name,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) digest FROM public.lead_visits t
        UNION ALL SELECT 'voices',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.customer_voices t
        UNION ALL SELECT 'tokens',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sales_private.visit_submission_tokens t
        UNION ALL SELECT 'sop',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.house_visit_checklist_runs t
        UNION ALL SELECT 'appointments',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.lead_appointments t
        UNION ALL SELECT 'actions',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.crm_next_actions t
        UNION ALL SELECT 'customers',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.sales_customers t
        UNION ALL SELECT 'interests',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.lead_project_interests t
        UNION ALL SELECT 'sales',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.sales t
        UNION ALL SELECT 'plots',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.plots t
      ) q),
      'booking',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'definition',md5(pg_get_functiondef(oid))) ORDER BY oid)
        FROM pg_proc WHERE oid IN ('public.crm_v2_booking_context(uuid,integer)'::regprocedure,'public.crm_v2_booking_command(uuid,jsonb)'::regprocedure)));`;
    const snapshot = await query(preserved);
    const receipts = 'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY operation_id),\'[]\'::jsonb) FROM crm_external_private.visit_workflow_operations t;';
    const receiptsBefore = await query(receipts);
    await assert.rejects(query(sql), /CENTRAL_VISITS_DISABLE_EXPLICIT_REVIEW_REQUIRED/);
    cases.push('reviewed disable refuses absent per-operation inputs');
    for (const changed of [
        { expectedDatabase: 'different_database' }, { expectedSessionActor: 'different_operator' },
        { operationKind: 'install' }, { reviewReference: '' }, { unreviewedExtra: 'value' },
    ]) await assert.rejects(query(prepared({ ...base, ...changed })), /CENTRAL_VISITS_DISABLE_EXPLICIT_REVIEW_REQUIRED/);
    cases.push('reviewed disable rejects wrong target actor kind missing reason and unknown review keys');
    await assert.rejects(query(prepared({ ...base, expectedSettingsDigest: '0'.repeat(32) })), /CENTRAL_VISITS_DISABLE_SETTINGS_DRIFT/);
    cases.push('reviewed disable aborts on settings drift');
    for (const changed of [{ releaseDigest: '0'.repeat(64) }, { planDigest: '0'.repeat(64) }, { batchId: randomUUID() }]) {
        await assert.rejects(query(prepared({ ...base, ...changed })), /CENTRAL_VISITS_DISABLE_REVIEW_MISMATCH/);
    }
    cases.push('reviewed disable requires exact source booking Visit and installed artifact digests');
    await assert.rejects(query(`SET ROLE authenticated; ${prepared()}`), /permission denied|EXTERNAL_CUTOVER_OPERATOR_REQUIRED/);
    cases.push('review configuration cannot authorize an application caller');
    await assert.rejects(query(prepared(base, sql.replace(/COMMIT;\s*$/, "DO $late$ BEGIN RAISE EXCEPTION 'SYNTHETIC_REVIEWED_DISABLE_LATE_FAILURE'; END; $late$; COMMIT;"))), /SYNTHETIC_REVIEWED_DISABLE_LATE_FAILURE/);
    assert.equal(await query(preserved), snapshot);
    assert.equal(await query(receipts), receiptsBefore);
    cases.push('late failure rolls back immutable operation receipt and all changes');
    await query(prepared());
    assert.equal(await query(preserved), snapshot);
    const recorded = JSON.parse(await query(`SELECT to_jsonb(t) FROM crm_external_private.visit_workflow_operations t WHERE operation_id='${base.operationId}';`));
    assert.equal(recorded.operation_kind, 'disable');
    assert.equal(recorded.release_digest, releaseDigest);
    assert.equal(recorded.review_reference, base.reviewReference);
    assert.equal(recorded.session_actor, base.expectedSessionActor);
    assert.equal(recorded.current_actor, base.expectedSessionActor);
    assert.deepEqual(recorded.settings_before, recorded.settings_after);
    assert.equal(recorded.function_acl_before.functions.length, 15);
    assert.equal(recorded.function_acl_after.functions.length, 15);
    assert.ok(recorded.performed_at);
    cases.push('reviewed repeat-disable preserves collected data booking APIs all settings and records exact operator evidence');
    await assert.rejects(query(prepared()), /CENTRAL_VISITS_DISABLE_OPERATION_ALREADY_RECORDED/);
    cases.push('recorded operation ID cannot be silently reused');
    for (const statement of [
        "UPDATE crm_external_private.visit_workflow_operations SET review_reference='changed'",
        'DELETE FROM crm_external_private.visit_workflow_operations',
        'TRUNCATE crm_external_private.visit_workflow_operations',
    ]) await assert.rejects(query(`BEGIN; ${statement}; ROLLBACK;`), /ROLE_REVIEW_HISTORY_APPEND_ONLY/);
    cases.push('operational receipts reject UPDATE DELETE and TRUNCATE even for the operator');
    for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(await query(`SELECT NOT has_table_privilege('${role}','crm_external_private.visit_workflow_operations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`), 't');
    }
    cases.push('operation receipt table is unavailable to API roles');
    assert.equal(await query('SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.booking_activation_permits);'), 't');
    assert.equal(readFileSync(join(root, path), 'utf8'), sql);
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false,
        repeatDisableTested: true, concurrentDisableTested: false, realCallerTested: false };
}
