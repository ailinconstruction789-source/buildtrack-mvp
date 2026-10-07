// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateDispatcherCapacity, summarizeCycleSamples } from './dispatcher-capacity.mjs';

const baseline = Object.freeze({
    candidateCount: 895, countIsExact: true, startsAtSweepHead: true, tickSeconds: 60, cycleBudgetMs: 1000,
});

describe('SQL14 fixed-phase dispatcher capacity, offline and never activation approval', () => {
    it('accounts for completion-based spacing and the rejected intervening minute tick', () => {
        expect(estimateDispatcherCapacity(baseline)).toMatchObject({
            maxItemsPerCycle: 10, cyclesPerEligibleTick: 1, completionSpacingMs: 60_000,
            cycles: 90, schedulerTicksPerCycle: 2, skippedTicksBetweenCycles: 1,
            effectiveCycleStartIntervalMs: 120_000, initialWaitAllowanceMs: 60_000,
            modeledSweepMs: 10_741_000, canFitWarningModel: false,
            guaranteesDelivery: false, activationReady: false,
        });
    });

    it.each([
        [0, 0, 0], [1, 1, 61_000], [10, 1, 61_000], [11, 2, 181_000],
        [895, 90, 10_741_000], [901, 91, 10_861_000],
    ])('rounds %s candidates to %s bounded cycles and %s ms including final completion', (candidateCount, cycles, modeledSweepMs) => {
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount })).toMatchObject({ cycles, modeledSweepMs });
    });

    it('does not allocate a boundary/reset cycle or an initial wait for an empty set', () => {
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount: 0, startsAtSweepHead: false }))
            .toMatchObject({ cycles: 0, boundaryAllowanceCycles: 0, initialWaitAllowanceMs: 0, modeledSweepMs: 0 });
    });

    it('includes one extra cycle for an unknown shared-cursor starting point', () => {
        expect(estimateDispatcherCapacity({ ...baseline, startsAtSweepHead: false }))
            .toMatchObject({ cycles: 91, boundaryAllowanceCycles: 1, modeledSweepMs: 10_861_000 });
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount: 10, startsAtSweepHead: false }))
            .toMatchObject({ cycles: 2, modeledSweepMs: 181_000, canFitWarningModel: true });
    });

    it.each([0, 10, 895, 901])('never gives a positive warning fit for a lower-bound count %s', candidateCount => {
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount, countIsExact: false }))
            .toMatchObject({ canFitWarningModel: false, reason: 'CANDIDATE_COUNT_IS_LOWER_BOUND' });
    });

    it('uses inclusive eligibility at precisely completion plus spacing', () => {
        expect(estimateDispatcherCapacity({ ...baseline, tickSeconds: 61 }))
            .toMatchObject({ schedulerTicksPerCycle: 1, skippedTicksBetweenCycles: 0, effectiveCycleStartIntervalMs: 61_000 });
        expect(estimateDispatcherCapacity({ ...baseline, tickSeconds: 61, cycleBudgetMs: 1001 }))
            .toMatchObject({ schedulerTicksPerCycle: 2, skippedTicksBetweenCycles: 1, effectiveCycleStartIntervalMs: 122_000 });
    });

    it.each([
        [1, 1, 61, 61_000], [30, 1, 3, 90_000], [30, 30_000, 3, 90_000],
        [30, 30_001, 4, 120_000], [60, 59_999, 2, 120_000], [60, 60_000, 2, 120_000],
        [60, 60_001, 3, 180_000], [120, 1000, 1, 120_000], [60, 600_000, 11, 660_000],
    ])('serializes ticks %ss and execution %sms into %s ticks / %sms between starts', (tickSeconds, cycleBudgetMs, schedulerTicksPerCycle, effectiveCycleStartIntervalMs) => {
        const result = estimateDispatcherCapacity({ ...baseline, tickSeconds, cycleBudgetMs });
        expect(result).toMatchObject({ schedulerTicksPerCycle, effectiveCycleStartIntervalMs });
        expect(result.skippedTicksBetweenCycles).toBe(schedulerTicksPerCycle - 1);
        expect(effectiveCycleStartIntervalMs).toBeGreaterThanOrEqual(cycleBudgetMs + 60_000);
        expect(effectiveCycleStartIntervalMs - tickSeconds * 1000).toBeLessThan(cycleBudgetMs + 60_000);
    });

    it.each([60_000, 60_001, 600_000])('returns arithmetic but never approves a cycle consuming/exceeding its tick: %sms', cycleBudgetMs => {
        const result = estimateDispatcherCapacity({ ...baseline, candidateCount: 10, cycleBudgetMs });
        expect(result).toMatchObject({ cycleExceedsTick: true, canFitWarningModel: false, reason: 'CYCLE_BUDGET_CONSUMES_TICK' });
        expect(result.modeledSweepMs).toBe(60_000 + cycleBudgetMs);
    });

    it('requires strictly less than the warning window, not equality', () => {
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount: 10, tickSeconds: 1799, cycleBudgetMs: 999 }))
            .toMatchObject({ modeledSweepMs: 1_799_999, canFitWarningModel: true });
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount: 10, tickSeconds: 1799 }))
            .toMatchObject({ modeledSweepMs: 1_800_000, canFitWarningModel: false });
        expect(estimateDispatcherCapacity({ ...baseline, candidateCount: 10, tickSeconds: 1799, cycleBudgetMs: 1001 }))
            .toMatchObject({ modeledSweepMs: 1_800_001, canFitWarningModel: false });
    });

    it('has no budget default; missing external execution evidence is rejected', () => {
        const withoutBudget = { ...baseline };
        delete withoutBudget.cycleBudgetMs;
        expect(() => estimateDispatcherCapacity(withoutBudget)).toThrow('Invalid cycleBudgetMs');
    });

    it('defaults only the previously selected warning window', () => {
        expect(estimateDispatcherCapacity(baseline)).toEqual(estimateDispatcherCapacity({ ...baseline, warningMinutes: 30 }));
    });

    it.each(['candidateCount', 'tickSeconds', 'cycleBudgetMs', 'warningMinutes'])('validates numeric %s without coercion', key => {
        for (const value of [-1, 0.5, NaN, Infinity, -Infinity, '1', null, false, new Date(), new Date('invalid'), Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => estimateDispatcherCapacity({ ...baseline, [key]: value })).toThrow(`Invalid ${key}`);
        }
        if (key !== 'warningMinutes') expect(() => estimateDispatcherCapacity({ ...baseline, [key]: undefined })).toThrow(`Invalid ${key}`);
    });

    it.each([
        ['candidateCount', 1_000_001], ['tickSeconds', 0], ['tickSeconds', 86_401],
        ['cycleBudgetMs', 0], ['cycleBudgetMs', 600_001], ['warningMinutes', 0], ['warningMinutes', 1441],
    ])('rejects out-of-range %s=%s', (key, value) => {
        expect(() => estimateDispatcherCapacity({ ...baseline, [key]: value })).toThrow(`Invalid ${key}`);
    });

    it.each(['countIsExact', 'startsAtSweepHead'])('requires explicit boolean %s', key => {
        for (const value of [null, undefined, 'true', 1, 0, Object(true)]) {
            expect(() => estimateDispatcherCapacity({ ...baseline, [key]: value })).toThrow(`Invalid ${key}`);
        }
    });

    it.each([null, undefined, [], '1', 1, false, new Date(), new Date('invalid'), () => baseline])('rejects a non-record input %s', input => {
        expect(() => estimateDispatcherCapacity(input)).toThrow('Invalid capacity input');
    });

    it('rejects unused policy overrides, preventing accidental reuse of the old multi-cycle helper', () => {
        for (const extra of [{ cyclesPerTick: 5 }, { completionSpacingMs: 0 }, { initialWaitMs: 0 }, { activationReady: true }, { [Symbol('input')]: true }]) {
            expect(() => estimateDispatcherCapacity({ ...baseline, ...extra })).toThrow('Unknown capacity input');
        }
    });

    it('keeps all maximum-range derived arithmetic safely integral', () => {
        const result = estimateDispatcherCapacity({ ...baseline, candidateCount: 1_000_000, startsAtSweepHead: false,
            tickSeconds: 86_400, cycleBudgetMs: 600_000, warningMinutes: 1440 });
        expect(result.cycles).toBe(100_001);
        for (const value of Object.values(result).filter(value => typeof value === 'number')) expect(Number.isSafeInteger(value)).toBe(true);
    });

    it('is deterministic, immutable, and never turns a favorable model into activation or delivery approval', () => {
        const input = Object.freeze({ ...baseline, candidateCount: 10 });
        const first = estimateDispatcherCapacity(input);
        expect(estimateDispatcherCapacity(input)).toEqual(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(input).toEqual({ ...baseline, candidateCount: 10 });
        expect(first).toMatchObject({ canFitWarningModel: true, guaranteesDelivery: false, activationReady: false,
            assumesSuccessfulCycles: true, assumesNoQueuedCatchUp: true, reason: 'FIXED_PHASE_MODEL_ONLY' });
    });
});

describe('observed cycle duration summary, separate from scheduler capacity', () => {
    it('handles a single fractional observation without inventing an upper bound', () => {
        expect(summarizeCycleSamples([0.125])).toEqual({
            count: 1, p50Ms: 0.125, p95Ms: 0.125, maxMs: 0.125,
            percentileMethod: 'nearest-rank', observedOnly: true, isUpperBound: false,
        });
    });

    it('uses nearest rank, not interpolation, for even and odd samples', () => {
        expect(summarizeCycleSamples([4, 1, 3, 2])).toMatchObject({ count: 4, p50Ms: 2, p95Ms: 4, maxMs: 4 });
        expect(summarizeCycleSamples([5, 4, 3, 2, 1])).toMatchObject({ count: 5, p50Ms: 3, p95Ms: 5, maxMs: 5 });
        expect(summarizeCycleSamples(Array.from({ length: 20 }, (_, index) => index + 1)))
            .toMatchObject({ count: 20, p50Ms: 10, p95Ms: 19, maxMs: 20 });
        expect(summarizeCycleSamples(Array.from({ length: 21 }, (_, index) => index + 1)))
            .toMatchObject({ count: 21, p50Ms: 11, p95Ms: 20, maxMs: 21 });
        expect(summarizeCycleSamples(Array.from({ length: 100 }, (_, index) => index + 1)))
            .toMatchObject({ count: 100, p50Ms: 50, p95Ms: 95, maxMs: 100 });
    });

    it('retains duplicated and fractional samples, without truncation or string sorting', () => {
        expect(summarizeCycleSamples([20, 2.5, 10.1, 2.5, 3.25]))
            .toMatchObject({ count: 5, p50Ms: 3.25, p95Ms: 20, maxMs: 20 });
    });

    it('requires explicit rounding before an observed maximum becomes a scenario input', () => {
        const summary = summarizeCycleSamples([500.5, 999.1]);
        expect(() => estimateDispatcherCapacity({ ...baseline, cycleBudgetMs: summary.maxMs })).toThrow('Invalid cycleBudgetMs');
        expect(estimateDispatcherCapacity({ ...baseline, cycleBudgetMs: Math.ceil(summary.maxMs) })).toMatchObject({
            cycleBudgetMs: 1000, guaranteesDelivery: false, activationReady: false,
        });
    });

    it.each([[], null, undefined, '1', {}, new Float64Array([1]), new Date(), new Date('invalid')])('rejects invalid collection %s', samples => {
        expect(() => summarizeCycleSamples(samples)).toThrow('Invalid cycle samples');
    });

    it.each([0, -1, NaN, Infinity, -Infinity, '1', null, undefined, false, {}, new Date(), new Date('invalid'), Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid observation %s', sample => {
            expect(() => summarizeCycleSamples([1, sample, 2])).toThrow('Invalid cycle sample');
        });

    it('rejects sparse samples and unbounded collection sizes', () => {
        expect(() => summarizeCycleSamples(new Array(2))).toThrow('Invalid cycle sample');
        expect(() => summarizeCycleSamples(new Array(100_001).fill(1))).toThrow('Invalid cycle samples');
    });

    it('does not sort the input in place and is deterministic with a frozen result', () => {
        const samples = Object.freeze([10, 1, 3]);
        const result = summarizeCycleSamples(samples);
        expect(samples).toEqual([10, 1, 3]);
        expect(summarizeCycleSamples(samples)).toEqual(result);
        expect(Object.isFrozen(result)).toBe(true);
    });
});
