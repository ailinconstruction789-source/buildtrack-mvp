// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const sql = readFileSync('sql/sales/deployment/central_visits_activate_reviewed.sql', 'utf8');
const disable = readFileSync('sql/sales/deployment/central_visits_disable_reviewed.sql', 'utf8');
const runtime = readFileSync('scripts/sales-runtime/central-visits-activate-reviewed-runtime.mjs', 'utf8');
describe('reviewed first Visit activation preparation', () => {
    it('requires independent evidence and exact target, never supplies actual production approval', () => {
        for (const key of ['cutover_operator_check()', 'expectedDatabase', 'expectedSessionActor', 'expectedSettingsDigest',
            'backupReference', 'clientReleaseReference', 'tokenLogReviewReference', 'releaseDigest', 'planDigest', 'operationId']) expect(sql).toContain(key);
        expect(sql).toContain('operator_attestations_not_automatically_verified');
        expect(sql).not.toMatch(/SET(?: LOCAL)? buildtrack\.visit_operation|kbthmdedilswdmmczfay|d831341f/);
    });
    it('serializes exact first activation and rejects stale receipts and resume', () => {
        for (const key of ['WHERE id FOR UPDATE', 'pg_advisory_xact_lock(20260929,23)', "operation_kind IN ('activate','disable')",
            "operation_kind='install'", 'sales_rollback_receipts', 'CENTRAL_VISITS_ACTIVATE_OPERATION_ALREADY_RECORDED',
            "lock_timeout='2s'", "statement_timeout='15s'", "transaction_timeout='30s'"]) expect(sql).toContain(key);
    });
    it('checks all installed function definitions owners ACLs and inherited callers before granting', () => {
        for (const key of ['jsonb_array_elements(installed)', 'definitionMd5', "entry->>'owner'", "entry->'acl'",
            "has_function_privilege(r.oid,fn,'EXECUTE')", 'CENTRAL_VISITS_ACTIVATE_API_MANIFEST_INCOMPLETE']) expect(sql).toContain(key);
        const signatures = source => [...source.matchAll(/^    '(public\.crm_v2_[^']+)'/gm)].map(m => m[1]);
        expect(signatures(sql)).toEqual(signatures(disable));
        expect(signatures(sql)).toHaveLength(15);
        expect(sql).not.toMatch(/ON ALL FUNCTIONS|ALTER DEFAULT PRIVILEGES/);
    });
    it('requires four exact restrictive Voice policies RLS and the enabled row seal', () => {
        for (const key of ['voice_v2_private_read', 'voice_v2_no_insert', 'voice_v2_no_update', 'voice_v2_no_delete',
            'relrowsecurity', 'NOT p.polpermissive', 'cardinality(p.polroles)=2', "tgenabled='O'", 'guard_visit_voice_fields()',
            'voice_v2_row_guard', 'external_bridge_activation_seal', 'tgtype=31', 'tgtype=23', 'tgqual IS NULL']) expect(sql).toContain(key);
    });
    it('changes only the three flags with a private permit and appends operator evidence atomically', () => {
        expect(sql.match(/UPDATE public\.[a-z_]+/g)).toEqual(['UPDATE public.crm_settings']);
        expect(sql.match(/DELETE FROM [a-z_.]+/g)).toEqual(['DELETE FROM crm_external_private.visit_workflow_activation_permits']);
        expect(sql).toContain('SET visits_enabled=true,visit_sop_enabled=true,customer_voices_enabled=true WHERE id');
        expect(sql).toContain("before_settings-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']");
        expect(sql).toContain('INSERT INTO crm_external_private.visit_workflow_operations(');
        expect(sql).not.toMatch(/DROP\s+|TRUNCATE\s+|DISABLE TRIGGER|session_replication_role/i);
        expect(sql.trim()).toMatch(/COMMIT;$/);
    });
    it('tests drift and late rollback locally using explicitly synthetic review references', () => {
        for (const key of ['SYNTHETIC backup evidence only', 'SYNTHETIC client evidence only', 'SYNTHETIC token log evidence only',
            'SYNTHETIC_ACTIVATION_LATE_FAILURE', 'CENTRAL_VISITS_ACTIVATE_FUNCTION_DRIFT', 'CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT',
            'assert.equal(await query(snapshot), before)', 'realBackupVerified: false', 'realClientVerified: false']) expect(runtime).toContain(key);
    });
});
