// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const disable = readFileSync('sql/sales/deployment/central_visits_disable_local.sql', 'utf8');
const preflight = readFileSync('sql/sales/deployment/central_visits_preflight_readonly.sql', 'utf8');
const harness = readFileSync('scripts/sales-runtime/central-visits-disable-runtime.mjs', 'utf8');
describe('Visit release disable preparation boundaries', () => {
    it('rejects production and demands operator and matched receipts', () => {
        for (const text of ["session_user !~ '^runtime_[a-f0-9]+$'", "inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet",
            'cutover_operator_check()', 'USING(batch_id,plan_digest)', 'CENTRAL_VISITS_DISABLE_REVIEW_MISMATCH']) expect(disable).toContain(text);
    });
    it('only turns off the three Visit flags and preserves every other setting', () => {
        expect(disable).toContain('SET visits_enabled=false,visit_sop_enabled=false,customer_voices_enabled=false WHERE id');
        expect(disable).toContain("value-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']");
        expect(disable).not.toMatch(/DROP\s+(TABLE|FUNCTION|TRIGGER)|TRUNCATE|DISABLE TRIGGER|session_replication_role/i);
        expect(disable).not.toMatch(/UPDATE public\.(sales|plots|lead_visits|customer_voices|crm_next_actions)\s/i);
        expect(disable).not.toMatch(/DELETE FROM (public\.|crm_external_private\.(visit_workflow_releases|snapshot_batches))/i);
    });
    it('seals all 15 APIs and removes policy dependency before sealing helper', () => {
        const signatures = disable.match(/^    'public\.crm_v2_[^']+'/gm);
        expect(signatures).toHaveLength(15);
        expect(disable.indexOf('ALTER POLICY voice_v2_private_read')).toBeLessThan(disable.indexOf('DO $seal_visit_apis$'));
        expect(disable).toContain('a.grantee<>owner_id');
        expect(disable).toContain("g.grantee=0 THEN 'PUBLIC'");
    });
    it('native rehearsal compares data and rejects anonymous old clients', () => {
        expect(harness).toContain('SYNTHETIC_DISABLE_LATE_FAILURE');
        expect(harness.match(/await assertState\('/g)).toHaveLength(3);
        expect(harness).toContain('crm_v2_customer_voice_submit');
        expect(harness).toContain('repeat disable safely preserves data');
    });
    it('preflight is read-only and exposes only metadata/settings, never customer rows', () => {
        expect(preflight).toContain('BEGIN TRANSACTION READ ONLY;');
        expect(preflight.trim()).toMatch(/ROLLBACK;$/);
        expect(preflight).not.toMatch(/\b(?:INSERT INTO|UPDATE public|DELETE FROM|CREATE TABLE|ALTER |GRANT |REVOKE )/i);
        expect(preflight.match(/FROM public\.[a-z_]+/g)).toEqual(['FROM public.crm_settings']);
    });
});
