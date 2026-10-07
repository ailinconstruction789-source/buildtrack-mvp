// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleExternalDataCandidate, externalDataCandidatePath, externalDataHeader, externalDataFooter, externalDataParts } from './external-data-candidate.mjs';
import { runExternalDataCandidateRuntime } from './external-data-candidate-runtime.mjs';
const texts = () => new Map([externalDataHeader, ...externalDataParts, externalDataFooter].map(p => [p, readFileSync(p, 'utf8')]));
describe('sealed external-data schema candidate', () => {
    it('checks synthetic loopback identity before reading source or changing anything', async () => {
        const calls = [];
        await expect(runExternalDataCandidateRuntime({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('buildtrack.synthetic_runtime');
        expect(calls[0]).toContain("inet_server_addr()='127.0.0.1'");
    });
    it('matches saved migration exactly and pins all five source drafts', () => {
        const candidate = assembleExternalDataCandidate(texts());
        expect(candidate).toBe(readFileSync(externalDataCandidatePath, 'utf8').replaceAll('\r\n', '\n'));
        expect(candidate.match(/LF-normalized SHA256:/g)).toHaveLength(5);
        expect(candidate).toContain('EXTERNAL_DATA_SHARED_DATA_CHANGED');
        expect(candidate).toContain('EXTERNAL_DATA_SHARED_TRIGGER_CHANGED');
        expect(candidate).toContain("SET LOCAL transaction_timeout='30s'");
    });
    it('rejects missing files and changed guarded wrappers', () => {
        for (const path of externalDataParts) {
            const changed = texts();
            changed.set(path, changed.get(path).replace("RAISE EXCEPTION 'DESIGN ONLY:", "RAISE EXCEPTION 'REVIEWED:"));
            expect(() => assembleExternalDataCandidate(changed)).toThrow('SOURCE_GUARD_CHANGED');
        }
        const missing = texts(); missing.delete(externalDataFooter);
        expect(() => assembleExternalDataCandidate(missing)).toThrow();
    });
    it('never invokes source import, identity seeding, cutover, activation, network or cron', () => {
        const candidate = assembleExternalDataCandidate(texts());
        // Function definitions are deliberately installed, not invoked by this file.
        const installation = candidate.replace(/\bAS \$\$[\s\S]*?\$\$;/g, 'AS <reviewed function body>;');
        expect(installation).not.toMatch(/(?:SELECT|PERFORM)\s+(?:crm_external_private\.(?:stage_snapshot|materialize_crm|prepare_booking_release|replace_sales|enable_booking_writer)|account_security_private\.review_account_role)\s*\(/i);
        expect(candidate).not.toMatch(/DISABLE TRIGGER|session_replication_role|cron\.schedule|net\.http|dblink|COPY.+PROGRAM/i);
    });
});
