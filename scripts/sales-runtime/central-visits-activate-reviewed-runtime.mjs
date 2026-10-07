// Runs ONLY in the disposable local installed-chain harness. References below
// are explicitly synthetic, never evidence of a real backup or deployed client.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export async function runReviewedVisitActivation({ query, root, report, releaseDigest }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND session_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const path = 'sql/sales/deployment/central_visits_activate_reviewed.sql';
    const sql = readFileSync(join(root, path), 'utf8');
    report.sources[path] = createHash('sha256').update(sql).digest('hex');
    const signatures = [...sql.matchAll(/^    '(public\.crm_v2_[^']+)'/gm)].map(match => match[1]);
    assert.equal(signatures.length, 15);
    const base = JSON.parse(await query(`SELECT jsonb_build_object(
      'operationId','${randomUUID()}','operationKind','activate','reviewReference','SYNTHETIC first activation rehearsal',
      'expectedDatabase',current_database(),'expectedSessionActor',session_user,
      'expectedSettingsDigest',(SELECT md5(to_jsonb(s)::text) FROM public.crm_settings s WHERE id),
      'batchId',batch_id,'planDigest',plan_digest,'releaseDigest',release_digest,
      'backupReference','SYNTHETIC backup evidence only',
      'clientReleaseReference','SYNTHETIC client evidence only',
      'tokenLogReviewReference','SYNTHETIC token log evidence only')
      FROM crm_external_private.visit_workflow_operations WHERE operation_kind='install';`));
    assert.equal(base.releaseDigest, releaseDigest);
    const prepare = (review = base, source = sql) => `SET buildtrack.visit_operation='${JSON.stringify(review).replaceAll("'", "''")}';\n${source}`;
    const snapshot = `SELECT jsonb_build_object(
      'settings',(SELECT to_jsonb(s) FROM public.crm_settings s WHERE id),
      'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY operation_id) FROM crm_external_private.visit_workflow_operations t),
      'release',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY batch_id),'[]'::jsonb) FROM crm_external_private.visit_workflow_releases t),
      'permits',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM crm_external_private.visit_workflow_activation_permits t),
      'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'def',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','sales_private','crm_external_private')),
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p WHERE polrelid='public.customer_voices'::regclass));`;
    const before = await query(snapshot);
    const cases = [];
    const deny = async (name, statement, pattern) => { await assert.rejects(query(statement), pattern); cases.push(name); };
    await deny('activation refuses absent operator attestations', sql, /CENTRAL_VISITS_ACTIVATE_EXPLICIT_REVIEW_REQUIRED/);
    for (const changed of [{ expectedDatabase: 'wrong_database' }, { expectedSessionActor: 'wrong_actor' },
        { operationKind: 'install' }, { reviewReference: '' }, { backupReference: '' }, { clientReleaseReference: '' },
        { tokenLogReviewReference: '' }, { unexpectedKey: 'invalid' }]) {
        await assert.rejects(query(prepare({ ...base, ...changed })), /CENTRAL_VISITS_ACTIVATE_EXPLICIT_REVIEW_REQUIRED/);
    }
    cases.push('activation rejects wrong target actor kind and missing backup client token-log reviews');
    await deny('activation rejects changed settings', prepare({ ...base, expectedSettingsDigest: '0'.repeat(32) }), /CENTRAL_VISITS_ACTIVATE_SETTINGS_DRIFT/);
    for (const changed of [{ releaseDigest: '0'.repeat(64) }, { planDigest: '0'.repeat(64) }, { batchId: randomUUID() }]) {
        await assert.rejects(query(prepare({ ...base, ...changed })), /CENTRAL_VISITS_ACTIVATE_REVIEW_MISMATCH/);
    }
    cases.push('activation binds the exact installed artifact and source booking receipt');
    await deny('review inputs do not authorize API callers', `SET ROLE authenticated; ${prepare()}`, /permission denied|EXTERNAL_CUTOVER_OPERATOR_REQUIRED/);
    // Inject drift inside the same transaction; every failed probe rolls back.
    const afterBegin = source => sql.replace('BEGIN;', `BEGIN;\n${source}`);
    await deny('activation refuses function body drift', prepare(base, afterBegin("COMMENT ON FUNCTION public.crm_v2_visits_capabilities() IS 'synthetic'; ALTER FUNCTION public.crm_v2_visits_capabilities() SET search_path TO public;")), /CENTRAL_VISITS_ACTIVATE_FUNCTION_DRIFT/);
    await deny('activation refuses unexpected API grant', prepare(base, afterBegin('GRANT EXECUTE ON FUNCTION public.crm_v2_visits_capabilities() TO anon;')), /CENTRAL_VISITS_ACTIVATE_FUNCTION_DRIFT|CENTRAL_VISITS_ACTIVATE_API_NOT_SEALED/);
    await deny('activation refuses weakened restrictive Voice policy', prepare(base, afterBegin('ALTER POLICY voice_v2_no_insert ON public.customer_voices WITH CHECK(true);')), /CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT/);
    await deny('activation refuses disabled Voice seal trigger', prepare(base, afterBegin('ALTER TABLE public.customer_voices DISABLE TRIGGER crm_foundation_legacy_fields_sealed;')), /CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT/);
    await deny('activation refuses disabled Voice row guard', prepare(base, afterBegin('ALTER TABLE public.customer_voices DISABLE TRIGGER voice_v2_row_guard;')), /CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT/);
    await deny('activation refuses disabled settings activation seal', prepare(base, afterBegin('ALTER TABLE public.crm_settings DISABLE TRIGGER external_bridge_activation_seal;')), /CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT/);
    await deny('activation refuses booking function drift', prepare(base, afterBegin('ALTER FUNCTION public.crm_v2_booking_capabilities() SET search_path TO public;')), /CENTRAL_VISITS_ACTIVATE_BASELINE_DRIFT/);
    await deny('late failure rolls back flags grants release and immutable operation receipt', prepare(base,
        sql.replace(/COMMIT;\s*$/, "DO $late$ BEGIN RAISE EXCEPTION 'SYNTHETIC_ACTIVATION_LATE_FAILURE'; END; $late$; COMMIT;")), /SYNTHETIC_ACTIVATION_LATE_FAILURE/);
    assert.equal(await query(snapshot), before);
    cases.push('all rejected activation probes preserve exact metadata and settings');
    await query(prepare());
    const recorded = JSON.parse(await query(`SELECT to_jsonb(t) FROM crm_external_private.visit_workflow_operations t WHERE operation_id='${base.operationId}';`));
    assert.equal(recorded.operation_kind, 'activate');
    assert.equal(recorded.release_digest, releaseDigest);
    assert.equal(recorded.session_actor, base.expectedSessionActor);
    assert.equal(recorded.current_actor, base.expectedSessionActor);
    for (const key of ['visits_enabled', 'visit_sop_enabled', 'customer_voices_enabled']) {
        assert.equal(recorded.settings_before[key], false); assert.equal(recorded.settings_after[key], true);
    }
    const other = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['visits_enabled', 'visit_sop_enabled', 'customer_voices_enabled'].includes(key)));
    assert.deepEqual(other(recorded.settings_before), other(recorded.settings_after));
    assert.deepEqual(recorded.function_acl_after.reviewEvidence, {
        backupReference: base.backupReference, clientReleaseReference: base.clientReleaseReference,
        tokenLogReviewReference: base.tokenLogReviewReference, evidenceType: 'operator_attestations_not_automatically_verified',
    });
    cases.push('first activation records operator attestations and changes exactly three flags');
    const anonymous = signatures.slice(-3);
    for (const signature of signatures) {
        assert.equal(await query(`SELECT has_function_privilege('authenticated','${signature}','EXECUTE');`), 't');
        assert.equal(await query(`SELECT has_function_privilege('anon','${signature}','EXECUTE');`), anonymous.includes(signature) ? 't' : 'f');
        assert.equal(await query(`SELECT has_function_privilege('service_role','${signature}','EXECUTE');`), 'f');
    }
    assert.equal(await query("SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_activation_permits) AND crm_external_private.booking_writer_ready();"), 't');
    cases.push('exact 15 authenticated and three anonymous APIs enabled while booking remains ready');
    await deny('activation operation cannot replay', prepare(), /CENTRAL_VISITS_ACTIVATE_OPERATION_ALREADY_RECORDED/);
    const next = { ...base, operationId: randomUUID(), expectedSettingsDigest: await query('SELECT md5(to_jsonb(s)::text) FROM public.crm_settings s WHERE id;') };
    await deny('different operation cannot reactivate existing release', prepare(next), /CENTRAL_VISITS_ACTIVATE_FIRST_ACTIVATION_ONLY/);
    assert.equal(readFileSync(join(root, path), 'utf8'), sql);
    return { assertions: cases.length, cases, syntheticOnly: true, syntheticReviewEvidence: true,
        productionChanged: false, realBackupVerified: false, realClientVerified: false };
}
