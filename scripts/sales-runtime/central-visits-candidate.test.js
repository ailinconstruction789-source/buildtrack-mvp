// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCentralVisitsCandidate, centralVisitsCandidatePath, centralVisitsHeader,
    centralVisitsFooter, centralVisitsAdapter, centralVisitsParts } from './central-visits-candidate.mjs';
const texts = () => new Map([centralVisitsHeader, ...centralVisitsParts, centralVisitsFooter]
    .map(path => [path, readFileSync(path, 'utf8')]));
describe('additive local-only central visits candidate', () => {
    it('matches the saved candidate with just visits, SOP, Voices and narrow adapter', () => {
        const candidate = assembleCentralVisitsCandidate(texts());
        expect(candidate).toBe(readFileSync(centralVisitsCandidatePath, 'utf8').replaceAll('\r\n', '\n'));
        expect(candidate.match(/LF-normalized SHA256:/g)).toHaveLength(4);
        expect(centralVisitsParts).toEqual(['sql/sales/23_visits_draft.sql', 'sql/sales/25_visit_sop_draft.sql',
            'sql/sales/26_customer_voices_draft.sql', centralVisitsAdapter]);
        expect(candidate).not.toContain('CREATE TABLE public.crm_next_actions');
        expect(candidate).not.toContain('ADD COLUMN lead_lifecycle_enabled');
        expect(candidate).not.toContain('ADD COLUMN project_interests_enabled');
    });
    it.each(centralVisitsParts.slice(0, 3))('rejects changed guards on %s', path => {
        const sources = texts();
        sources.set(path, sources.get(path).replace('DESIGN ONLY:', 'UNGUARDED:'));
        expect(() => assembleCentralVisitsCandidate(sources)).toThrow('CENTRAL_VISITS_SOURCE_GUARD_CHANGED');
    });
    it('rejects absent fragments and client-side SQL commands', () => {
        const missing = texts(); missing.delete(centralVisitsAdapter);
        expect(() => assembleCentralVisitsCandidate(missing)).toThrow();
        const unsafe = texts(); unsafe.set(centralVisitsFooter, '\\! external-command');
        expect(() => assembleCentralVisitsCandidate(unsafe)).toThrow('psql metacommands');
    });
    it('makes both installation and activation local-only and leaves defaults sealed', () => {
        const candidate = assembleCentralVisitsCandidate(texts());
        expect(candidate.match(/RAISE EXCEPTION 'CENTRAL_VISITS_LOCAL_SYNTHETIC_ONLY'/g)).toHaveLength(2);
        expect(candidate.match(/inet_server_addr\(\) IS DISTINCT FROM '127\.0\.0\.1'::inet/g)).toHaveLength(2);
        expect(candidate.match(/current_setting\('buildtrack.synthetic_runtime',true\)/g)).toHaveLength(2);
        expect(candidate).toContain('CENTRAL_VISITS_UNSEALED_API');
        expect(candidate).toContain('CENTRAL_VISITS_UNEXPECTED_ACTIVATION');
        expect(candidate).not.toMatch(/(?:SELECT|PERFORM)\s+crm_external_private\.enable_visit_workflow\s*\(/i);
        expect(candidate).not.toMatch(/DISABLE TRIGGER|session_replication_role|cron\.schedule|net\.http|dblink|COPY.+PROGRAM/i);
    });
    it('preserves imported-history guards and adapts only the customer Voice seal', () => {
        const adapter = texts().get(centralVisitsAdapter);
        expect(adapter).not.toMatch(/CREATE OR REPLACE FUNCTION crm_external_private\.(?:guard_materialized_history|booking_interest_allowed|booking_activation_allowed)/);
        expect(adapter).not.toMatch(/UPDATE public\.(?:sales_customers|lead_project_interests|sales|plots)\s+SET/i);
        expect(adapter).toContain('DROP TRIGGER crm_foundation_legacy_fields_sealed ON public.customer_voices');
        expect(adapter).toContain('p.visit_id=NEW.visit_id AND p.voice_id=NEW.id');
        expect(adapter).toContain("jsonb_array_elements_text(TG_ARGV[0]::jsonb)");
        expect(adapter).toContain("RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED'");
        expect(adapter).toContain('ALTER POLICY voice_v2_private_read ON public.customer_voices USING(visit_id IS NULL)');
        expect(adapter).toContain('USING(visit_id IS NULL OR public.crm_v2_voice_row_readable(visit_id))');
    });
    it('publishes the agreed narrow follow-up shape without granting general work or lifecycle', () => {
        const adapter = texts().get(centralVisitsAdapter);
        expect(adapter).toContain("'read_contract_version','lead_work_read_v2'");
        expect(adapter).toContain("p_payload->>'command' IS DISTINCT FROM 'set_next_action'");
        expect(adapter).toContain("jsonb_typeof(p_payload->'interestId') IS DISTINCT FROM 'string'");
        expect(adapter).toContain("public.crm_v2_role() IS DISTINCT FROM 'sales'");
        expect(adapter).toContain("IF owner_id IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'");
        expect(adapter).toContain("to_jsonb(actor_role='sales' AND (snapshot->>'canWrite')::boolean)");
        expect(adapter).toContain('RETURN public.crm_v2_record_lead_work(p_request_id,p_payload)');
        for (const grant of adapter.matchAll(/GRANT EXECUTE[\s\S]*?;/g)) {
            expect(grant[0]).not.toMatch(/crm_v2_(?:record_lead_work|lead_work_snapshot|change_lead_lifecycle|lead_lifecycle_context)\(/);
        }
    });
    it('permits only the three new switches while preserving every existing setting', () => {
        const adapter = texts().get(centralVisitsAdapter);
        expect(adapter).toContain("p_old-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']");
        expect(adapter).toContain("=p_new-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']");
        expect(adapter).toContain('UPDATE public.crm_settings SET visits_enabled=true,visit_sop_enabled=true,customer_voices_enabled=true WHERE id');
        expect(adapter).not.toMatch(/(?:notifications|sla|post_booking|reports|project_interests)_enabled\s*=\s*true/);
    });
});
