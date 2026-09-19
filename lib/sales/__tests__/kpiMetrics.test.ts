// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeMetricObservations, type MetricObservation, type MetricObservationInput } from '../kpiMetrics';

const met: MetricObservation = { unitKey: 'visit:1', outcome: 'met', evidenceIds: ['voice:1'] };
const missed: MetricObservation = { unitKey: 'visit:2', outcome: 'missed', evidenceIds: [] };

describe('evidence-only metric aggregation', () => {
    it('keeps missed due work in the denominator, without employee scoring', () => {
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [met, missed] })).toMatchObject({
            state: 'observed', percent: 50, counts: { uniqueUnits: 2, met: 1, missed: 1, knownEligible: 2 },
        });
    });

    it('reports observed zero only when known due work was actually missed', () => {
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [missed] })).toMatchObject({ state: 'observed', percent: 0 });
    });

    it('deduplicates the same task/Visit instead of inflating completed work', () => {
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [met, met, met, missed] })).toMatchObject({
            state: 'observed', percent: 50, counts: { uniqueUnits: 2, duplicateRowsIgnored: 2, knownEligible: 2 },
        });
    });

    it('treats evidence ordering and repeated references as the same replay', () => {
        const first = { ...met, evidenceIds: ['a', 'b'] };
        const second = { ...met, evidenceIds: ['b', 'a', 'a'] };
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [first, second] })).toMatchObject({
            state: 'observed', percent: 100, counts: { uniqueUnits: 1, duplicateRowsIgnored: 1 },
        });
    });

    it.each([
        { ...met, outcome: 'missed' }, { ...met, evidenceIds: ['different'] }, { ...met, exclusionReason: 'different revision' },
    ] as MetricObservation[])('rejects conflicting versions of the same unit: %j', conflict => {
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [met, conflict] }))
            .toEqual({ state: 'invalid', code: 'CONFLICTING_DUPLICATE', percent: null });
    });

    it('keeps unknown legacy evidence distinct from misses and withholds a misleading percentage', () => {
        const legacy: MetricObservation = { unitKey: 'legacy:1', outcome: 'unknown', evidenceIds: [] };
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [met, legacy] })).toMatchObject({
            state: 'needs_evidence', percent: null, counts: { unknown: 1, missed: 0, knownEligible: 1 },
        });
    });

    it.each([[], [met], [missed]].map(observations => ({ observations })))('never interprets a partial source as a complete KPI: %j', ({ observations }) => {
        expect(summarizeMetricObservations({ sourceComplete: false, observations })).toMatchObject({ state: 'needs_evidence', percent: null });
    });

    it('returns N/A, not zero or full marks, for a confirmed empty eligible population', () => {
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [] })).toMatchObject({ state: 'no_eligible_work', percent: null });
    });

    it('exposes future work and reasoned exclusions separately without choosing a weight redistribution', () => {
        const future: MetricObservation = { unitKey: 'task:future', outcome: 'not_due', evidenceIds: [] };
        const excluded: MetricObservation = { unitKey: 'visit:excluded', outcome: 'not_applicable', evidenceIds: ['exception:1'], exclusionReason: 'ลูกค้ายกเลิกก่อนเข้าชม' };
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [future, excluded] })).toMatchObject({
            state: 'no_eligible_work', percent: null, counts: { notDue: 1, notApplicable: 1, knownEligible: 0 },
        });
    });

    it.each([
        null, undefined, {}, { sourceComplete: 'true', observations: [] }, { sourceComplete: true, observations: null },
        { sourceComplete: true, observations: [null] },
        ...[
            { unitKey: '' }, { unitKey: ' visit:1 ' }, { unitKey: 'visit:\n1' }, { outcome: 'done' },
            { evidenceIds: [] }, { evidenceIds: null }, { evidenceIds: [42] }, { evidenceIds: [' '] },
            { exclusionReason: 123 }, { outcome: 'not_applicable', exclusionReason: ' ' },
        ].map(change => ({ sourceComplete: true, observations: [{ ...met, ...change }] })),
    ])('rejects malformed evidence rather than silently succeeding: %j', input => {
        expect(summarizeMetricObservations(input as MetricObservationInput)).toEqual({ state: 'invalid', code: 'INVALID_INPUT', percent: null });
    });

    it('does not mutate immutable input while canonicalizing or counting', () => {
        const row = Object.freeze({ ...met, evidenceIds: Object.freeze(['b', 'a']) });
        const input = Object.freeze({ sourceComplete: true, observations: Object.freeze([row]) });
        summarizeMetricObservations(input);
        expect(row.evidenceIds).toEqual(['b', 'a']);
        expect(input.observations).toEqual([row]);
    });

    it('rejects sparse arrays that would otherwise pretend to contain evidence', () => {
        expect(summarizeMetricObservations({ sourceComplete: true, observations: [{ ...met, evidenceIds: new Array<string>(1) }] }))
            .toMatchObject({ state: 'invalid', percent: null });
        expect(summarizeMetricObservations({ sourceComplete: true, observations: new Array<MetricObservation>(1) }))
            .toMatchObject({ state: 'invalid', percent: null });
    });

    it.each(['\u0000', '\u007f', '\u009f', 'reason\u0000embedded', 'reason\u007fembedded'])(
        'rejects unusable exclusion reasons instead of raising compliance by dropping a unit: %j', exclusionReason => {
            const excluded: MetricObservation = { unitKey: 'visit:excluded', outcome: 'not_applicable', evidenceIds: [], exclusionReason };
            expect(summarizeMetricObservations({ sourceComplete: true, observations: [met, excluded] }))
                .toMatchObject({ state: 'invalid', percent: null });
        },
    );
});
