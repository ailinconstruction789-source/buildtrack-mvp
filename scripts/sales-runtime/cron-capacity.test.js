// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateCronCapacity } from './cron-capacity.mjs';

const baseline = { candidateCount: 895, countIsExact: true, startsAtSweepHead: true, tickSeconds: 60, cyclesPerTick: 1, cycleBudgetMs: 1000 };
describe('offline Cron capacity model, not a delivery guarantee', () => {
    it('demonstrates why one10-item cycle per minute cannot scan895 within30 minutes', () => {
        expect(estimateCronCapacity(baseline)).toMatchObject({ cycles: 90, ticks: 90,
            modeledSweepMs: 5_401_000, fitsWarningWindowInModel: false, guaranteesDelivery: false });
    });
    it('includes last-cycle execution and full initial tick wait', () => {
        expect(estimateCronCapacity({ ...baseline, cyclesPerTick: 5 })).toMatchObject({ cycles: 90, ticks: 18,
            tickBudgetMs: 5000, modeledSweepMs: 1_085_000, fitsWarningWindowInModel: true, guaranteesDelivery: false });
    });
    it('is never positive on capped counts', () => {
        expect(estimateCronCapacity({ ...baseline, candidateCount: 901, countIsExact: false, cyclesPerTick: 10 }))
            .toMatchObject({ cycles: 91, ticks: 10, fitsWarningWindowInModel: false, reason: 'CANDIDATE_COUNT_IS_LOWER_BOUND' });
    });
    it('allows a boundary/reset cycle when the shared cursor is not known to be at the head', () => {
        expect(estimateCronCapacity({ ...baseline, startsAtSweepHead: false }))
            .toMatchObject({ cycles: 91, ticks: 91, boundaryAllowanceCycles: 1 });
    });
    it('refuses a tick that can overrun or exactly consume its interval', () => {
        for (const cycleBudgetMs of [6000, 6001]) {
            expect(estimateCronCapacity({ ...baseline, cyclesPerTick: 10, cycleBudgetMs })).toMatchObject({
                fitsTick: false, modeledSweepMs: null, fitsWarningWindowInModel: false, reason: 'TICK_BUDGET_EXCEEDED' });
        }
    });
    it('does not claim an exact warning-boundary sweep fits', () => {
        expect(estimateCronCapacity({ ...baseline, candidateCount: 10, tickSeconds: 1799 })).toMatchObject({
            modeledSweepMs: 1_800_000, fitsWarningWindowInModel: false });
    });
    it.each([[0, 0, 0], [1, 1, 1], [10, 1, 1], [11, 2, 1], [50, 5, 1], [51, 6, 2]])(
        'rounds candidate%s to cycles%s and ticks%s', (candidateCount, cycles, ticks) => {
            expect(estimateCronCapacity({ ...baseline, candidateCount, cyclesPerTick: 5 })).toMatchObject({ cycles, ticks });
        });
    it.each(['candidateCount', 'tickSeconds', 'cyclesPerTick', 'cycleBudgetMs', 'warningMinutes'])(
        'rejects invalid numeric %s', key => {
            for (const value of [-1, 0.5, NaN, Infinity, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
                if (key === 'warningMinutes' && value === undefined) continue;
                expect(() => estimateCronCapacity({ ...baseline, [key]: value })).toThrow();
            }
        });
    it.each([null, undefined, 'true', 1])('rejects nonboolean exactness %s', countIsExact => {
        expect(() => estimateCronCapacity({ ...baseline, countIsExact })).toThrow();
    });
    it('defaults the omitted warning to the approved30-minute model', () => {
        expect(estimateCronCapacity(baseline)).toEqual(estimateCronCapacity({ ...baseline, warningMinutes: 30 }));
    });
    it.each([null, undefined, 'true', 1])('requires explicit cursor knowledge %s', startsAtSweepHead => {
        expect(() => estimateCronCapacity({ ...baseline, startsAtSweepHead })).toThrow();
    });
    it('does not mutate inputs and freezes result', () => {
        const input = Object.freeze({ ...baseline });
        expect(Object.isFrozen(estimateCronCapacity(input))).toBe(true);
        expect(input).toEqual(baseline);
    });
});
