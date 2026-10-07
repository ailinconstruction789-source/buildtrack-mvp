// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCentralBookingCandidate, centralBookingCandidatePath, centralBookingHeader, centralBookingFooter, centralBookingParts } from './central-booking-candidate.mjs';
import { syntheticExternalSnapshot } from './external-snapshot-fixture.mjs';
const texts = () => new Map([centralBookingHeader, ...centralBookingParts, centralBookingFooter].map(p => [p, readFileSync(p, 'utf8')]));
describe('bounded central booking installation candidate', () => {
    it('exactly matches the saved migration and contains all six pinned companions', () => {
        const candidate = assembleCentralBookingCandidate(texts());
        expect(candidate).toBe(readFileSync(centralBookingCandidatePath, 'utf8').replaceAll('\r\n', '\n'));
        expect(candidate.match(/LF-normalized SHA256:/g)).toHaveLength(6);
        expect(candidate).toContain('generate_series(2,966)');
        expect(candidate).toContain('CENTRAL_BOOKING_SHARED_BASELINE_CHANGED');
        expect(candidate).toContain('CENTRAL_BOOKING_UNSEALED_API');
    });
    it('rejects changed guarded wrappers and missing sources', () => {
        const changed = texts();
        changed.set(centralBookingParts[0], changed.get(centralBookingParts[0]).replace('DESIGN ONLY:', 'REVIEWED:'));
        expect(() => assembleCentralBookingCandidate(changed)).toThrow('GUARD_CHANGED');
        changed.delete(centralBookingHeader);
        expect(() => assembleCentralBookingCandidate(changed)).toThrow();
    });
    it('does not invoke activation, import, network, cron or bypass triggers', () => {
        const candidate = assembleCentralBookingCandidate(texts());
        expect(candidate).not.toMatch(/(?:SELECT|PERFORM)\s+crm_external_private\.(?:enable_booking_writer|stage_snapshot|materialize_crm|replace_sales)\s*\(/i);
        expect(candidate).not.toMatch(/DISABLE TRIGGER|session_replication_role|cron\.schedule|net\.http|dblink|COPY.+PROGRAM/i);
        expect(candidate).toContain("SET LOCAL transaction_timeout='30s'");
    });
    it('models full source coverage without inventing customer rows', () => {
        const plan = syntheticExternalSnapshot({ sourceLastRow: 966 });
        const rows = [...plan.sourceRecords.map(x => x.sourceRow), ...plan.skippedSourceRows].sort((a, b) => a - b);
        expect(rows).toEqual(Array.from({ length: 965 }, (_, i) => i + 2));
        expect(plan.customers).toHaveLength(syntheticExternalSnapshot().customers.length);
    });
});
