// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const sql = readFileSync('sql/sales/deployment/central_visits_disable_reviewed.sql', 'utf8');
const local = readFileSync('sql/sales/deployment/central_visits_disable_local.sql', 'utf8');
const runtime = readFileSync('scripts/sales-runtime/central-visits-reviewed-runtime.mjs', 'utf8');
describe('reviewed Visit disable operator draft', () => {
    it('requires separate explicit inputs, real operator and exact target without built-in production approval', () => {
        for (const value of ['cutover_operator_check()', 'buildtrack.visit_operation', 'expectedDatabase', 'expectedSessionActor',
            'expectedSettingsDigest', 'operationKind', 'operationId', 'reviewReference', 'planDigest', 'releaseDigest',
            'CENTRAL_VISITS_DISABLE_EXPLICIT_REVIEW_REQUIRED']) expect(sql).toContain(value);
        expect(sql).not.toMatch(/SET(?: LOCAL)? buildtrack\.visit_operation|kbthmdedilswdmmczfay|d831341f/);
        expect(sql).toContain("jsonb_typeof(p.value)<>'string'");
        expect(sql).toContain("review-ARRAY[");
    });
    it('bounds duration and drains scoped writers by locking the shared settings row', () => {
        for (const value of ["lock_timeout='2s'", "statement_timeout='15s'", "transaction_timeout='30s'", 'WHERE id FOR UPDATE',
            'pg_advisory_xact_lock(20260929,23)']) expect(sql).toContain(value);
        expect(sql.indexOf('WHERE id FOR UPDATE')).toBeLessThan(sql.indexOf('UPDATE public.crm_settings'));
        expect(sql).not.toMatch(/LOCK TABLE public\.(sales|plots|projects)/);
    });
    it('requires matching source booking visit and immutable install receipts, and refuses operation replay', () => {
        for (const value of ['USING(batch_id,plan_digest)', 'snapshot_batches', 'sales_rollback_receipts',
            "o.operation_kind='install'", "o.release_digest=review->>'releaseDigest'", 'operation_id=operation',
            'CENTRAL_VISITS_DISABLE_OPERATION_ALREADY_RECORDED']) expect(sql).toContain(value);
    });
    it('seals exactly the previously rehearsed 15 API signatures and verifies inherited permissions too', () => {
        const signatures = source => [...source.matchAll(/^    '(public\.crm_v2_[^']+)'/gm)].map(match => match[1]);
        expect(signatures(sql)).toHaveLength(15);
        expect(signatures(sql)).toEqual(signatures(local));
        expect(sql).toContain("grantee.grantee=0 THEN 'PUBLIC'");
        expect(sql).toContain("has_function_privilege(r.oid,fn,'EXECUTE')");
        expect(sql.indexOf('ALTER POLICY voice_v2_private_read')).toBeLessThan(sql.indexOf("EXECUTE format('REVOKE ALL"));
    });
    it('preserves collected data, unrelated settings and grants, while appending operator evidence atomically', () => {
        expect(sql).toContain('SET visits_enabled=false,visit_sop_enabled=false,customer_voices_enabled=false WHERE id');
        expect(sql).toContain("before_settings-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']");
        expect(sql).toContain('INSERT INTO crm_external_private.visit_workflow_operations(');
        expect(sql).toContain('session_user,current_user,before_settings,after_settings,before_access,after_access');
        expect(sql.trim()).toMatch(/COMMIT;$/);
        expect(sql).not.toMatch(/DROP\s+(TABLE|FUNCTION|TRIGGER)|TRUNCATE\s+|DISABLE TRIGGER|session_replication_role/i);
        expect(sql.match(/UPDATE public\.[a-z_]+/g)).toEqual(['UPDATE public.crm_settings']);
        expect(sql.match(/DELETE FROM [a-z_.]+/g)).toEqual(['DELETE FROM crm_external_private.booking_activation_permits']);
        expect(sql).not.toMatch(/GRANT\s+|ON ALL FUNCTIONS|ALTER DEFAULT PRIVILEGES/);
    });
    it('coordinates separate local lock holder through catalog evidence and bounds the contention probe', () => {
        expect(runtime).toContain('WHERE id FOR SHARE;');
        expect(runtime.indexOf('WHERE id FOR SHARE;')).toBeLessThan(runtime.indexOf('SELECT pg_advisory_xact_lock(20260930'));
        expect(runtime).toContain('JOIN pg_locks row_lock ON row_lock.pid=marker.pid');
        expect(runtime).toContain('marker.objsubid=2 AND marker.granted');
        expect(runtime).toContain('Date.now() + 1200');
        expect(runtime).toContain('SELECT pg_sleep(4);');
        expect(runtime).toContain('canceling statement due to lock timeout');
        expect(runtime).toContain('finally {\n        await holder;');
        expect(runtime).toContain("concurrentDisableMode: 'settings-row-contention-timeout'");
        expect(runtime).toContain('inFlightRpcCompletionTested: false');
    });
});
