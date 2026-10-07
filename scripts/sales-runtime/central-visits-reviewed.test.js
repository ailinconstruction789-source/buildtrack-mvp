// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assembleReviewedVisits, reviewedVisitSources, reviewedVisitMigration } from './central-visits-reviewed.mjs';
const texts = () => new Map(reviewedVisitSources.map(path => [path, readFileSync(path, 'utf8')]));
describe('reviewed sealed Visit preparation', () => {
    it('matches saved CLI-created migration exactly', () => {
        const { sql, releaseDigest, functionNames } = assembleReviewedVisits(texts());
        expect(sql).toBe(readFileSync(reviewedVisitMigration, 'utf8').replaceAll('\r\n', '\n'));
        expect(releaseDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(functionNames).toHaveLength(30);
    });
    it('has operator target manifest and collision checks and no installed production activation', () => {
        const { sql } = assembleReviewedVisits(texts());
        for (const text of ['cutover_operator_check()', 'CENTRAL_VISITS_REVIEW_INPUT_REQUIRED', 'CENTRAL_VISITS_REVIEW_METADATA_CHANGED',
            'CENTRAL_VISITS_REVIEW_OBJECT_COLLISION', "SET LOCAL lock_timeout='2s'", 'pg_try_advisory_xact_lock', 'CENTRAL_VISITS_LOCAL_SYNTHETIC_ONLY']) expect(sql).toContain(text);
        expect(sql).not.toMatch(/(?:SELECT|PERFORM)\s+crm_external_private\.enable_visit_workflow\(/i);
        expect(sql).not.toContain('central_visits_shared_before SET data_hash');
        expect(sql).not.toContain('jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)');
        expect(sql).not.toMatch(/DISABLE TRIGGER|session_replication_role|DROP TABLE|TRUNCATE public\./i);
    });
    it('keeps all four restrictive Voice policies and immutable private receipt', () => {
        const { sql } = assembleReviewedVisits(texts());
        for (const name of ['voice_v2_private_read','voice_v2_no_insert','voice_v2_no_update','voice_v2_no_delete']) expect(sql).toContain(`CREATE POLICY ${name}`);
        expect(sql).toContain('CREATE TRIGGER visit_workflow_operations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE');
        expect(sql).toContain('ALTER TABLE crm_external_private.visit_workflow_operations ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('CENTRAL_VISITS_UNSEALED_API');
        expect(sql).not.toMatch(/__[A-Z_]+__/);
        expect(sql).toContain("'house_visit_checklist_items'" );
        expect(sql).toContain("n.nspname='sales_private' AND c.relname='visit_submission_tokens'");
        expect(sql).toContain("n.nspname||'.'||p.proname IN (");
    });
    it('changes review digest if a reviewed source changes and rejects missing source', () => {
        const source = texts(); const initial = assembleReviewedVisits(source).releaseDigest;
        const path = 'sql/sales/deployment/central_visits_reviewed_receipt.sql'; source.set(path, source.get(path)+'\n-- revised review\n');
        expect(assembleReviewedVisits(source).releaseDigest).not.toBe(initial);
        source.delete(path); expect(() => assembleReviewedVisits(source)).toThrow('VISIT_REVIEW_SOURCE_MISSING');
    });
});
