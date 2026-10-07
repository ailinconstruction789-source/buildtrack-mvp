// Called only by the local synthetic installed-chain harness. No live connector.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { assembleReviewedVisits, reviewedVisitSources, reviewedVisitMigration, reviewedVisitPreflight } from './central-visits-reviewed.mjs';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export async function runReviewedVisitInstall({ query, root, report }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND session_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const texts = new Map([...reviewedVisitSources, reviewedVisitMigration].map(path => {
        const text = readFileSync(join(root, path), 'utf8'); report.sources[path] = createHash('sha256').update(text).digest('hex'); return [path, text];
    }));
    const { sql, releaseDigest } = assembleReviewedVisits(texts);
    assert.equal(sql, texts.get(reviewedVisitMigration).replaceAll('\r\n', '\n'));
    const preflight = JSON.parse(await query(texts.get(reviewedVisitPreflight)));
    assert.equal(preflight.bookingReview.length, 1);
    const target = JSON.parse(await query("SELECT jsonb_build_object('database',current_database(),'actor',session_user);"));
    const cfg = { operationKind: 'install', operationId: randomUUID(), reviewReference: 'SYNTHETIC reviewed install rehearsal',
        expectedDatabase: target.database, expectedSessionActor: target.actor, releaseDigest,
        batchId: preflight.bookingReview[0].batchId, planDigest: preflight.bookingReview[0].sourceDigest, expectedPreflight: preflight };
    const prepare = value => `SET buildtrack.visit_operation=${literal(JSON.stringify(value))};\n${sql}`;
    const cases = [];
    const deny = async (name, statement, pattern) => { await assert.rejects(query(statement), pattern); cases.push(name); };
    await deny('reviewed installer refuses absent input', sql, /CENTRAL_VISITS_REVIEW_INPUT_REQUIRED/);
    await deny('reviewed installer refuses mismatched release digest', prepare({ ...cfg, releaseDigest: '0'.repeat(64) }), /CENTRAL_VISITS_REVIEW_INPUT_REQUIRED/);
    await deny('reviewed installer refuses wrong database', prepare({ ...cfg, expectedDatabase: 'wrong_database' }), /CENTRAL_VISITS_REVIEW_INPUT_REQUIRED/);
    await deny('reviewed installer refuses wrong source batch', prepare({ ...cfg, batchId: randomUUID() }), /CENTRAL_VISITS_REVIEW_BATCH_CHANGED/);
    await deny('reviewed installer refuses stale metadata', prepare({ ...cfg, expectedPreflight: { ...preflight, databaseVersion: 'stale' } }), /CENTRAL_VISITS_REVIEW_METADATA_CHANGED/);
    await deny('application caller cannot install even with valid review inputs', `SET ROLE authenticated; ${prepare(cfg)}`, /permission denied|EXTERNAL_CUTOVER_OPERATOR_REQUIRED/);
    await deny('late install failure rolls back schema grants flags and receipt', prepare(cfg).replace(/COMMIT;\s*$/, "DO $late$ BEGIN RAISE EXCEPTION 'REVIEWED_INSTALL_LATE_FAILURE'; END; $late$; COMMIT;"), /REVIEWED_INSTALL_LATE_FAILURE/);
    assert.deepEqual(JSON.parse(await query(texts.get(reviewedVisitPreflight))), preflight);
    assert.equal(await query("SELECT to_regclass('crm_external_private.visit_workflow_operations') IS NULL;"), 't');
    cases.push('failed installer leaves exact catalog and settings manifest unchanged');
    await query(prepare(cfg));
    assert.equal(await query(`SELECT operation_kind='install' AND release_digest='${releaseDigest}' AND session_actor=session_user
      AND settings_before=${literal(JSON.stringify(preflight.settings))}::jsonb
      FROM crm_external_private.visit_workflow_operations WHERE operation_id='${cfg.operationId}';`), 't');
    cases.push('sealed install records immutable operator source digest and before-after settings receipt');
    await deny('repeat install refuses object collisions without replacing existing workflow', prepare(cfg), /CENTRAL_VISITS_REVIEW_OBJECT_COLLISION/);
    return { assertions: cases.length, cases, releaseDigest, migration: reviewedVisitMigration, productionChanged: false,
        syntheticMetadataInputs: true, productionActivationIncluded: false };
}
