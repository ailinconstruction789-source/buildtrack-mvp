// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalBookingWriterDraftPath, externalBookingWriterTestBody, runExternalBookingWriterRuntime } from './external-booking-writer-runtime.mjs';
import { syntheticExternalSnapshot } from './external-snapshot-fixture.mjs';

describe('composed imported booking writer rehearsal', () => {
    it('requires verified fresh loopback identity before files or writes', async () => {
        const calls = [];
        await expect(runExternalBookingWriterRuntime({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('inet_server_addr()');
    });
    it('adapts exact inert guard only in memory', () => {
        const source = readFileSync(externalBookingWriterDraftPath, 'utf8');
        expect(externalBookingWriterTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(externalBookingWriterDraftPath, 'utf8')).toBe(source);
        for (const changed of [source.replace('ROLLBACK;', 'COMMIT;'), source.replace('DESIGN ONLY:', 'APPROVED:'), `${source}\n\\connect remote`]) {
            expect(() => externalBookingWriterTestBody(changed)).toThrow();
        }
    });
    it('prepares booked source at ingestion, never by rewriting sealed history', () => {
        const old = syntheticExternalSnapshot({ includeHeldBooking: true });
        const booked = syntheticExternalSnapshot({ includeHeldBooking: true, firstBookingStage: 'booked' });
        expect(booked.planDigest).not.toBe(old.planDigest);
        expect(JSON.stringify(booked)).toContain('booked');
        expect(() => syntheticExternalSnapshot({ firstBookingStage: 'invented' })).toThrow();
    });
});
