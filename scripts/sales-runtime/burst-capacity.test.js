// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateBurstCapacity } from './burst-capacity.mjs';

const baseline = Object.freeze({
    candidateCount: 895, countIsExact: true, startsAtSweepHead: true, admissionWindowKnownClear: true,
    tickSeconds: 15, cycleBudgetMs: 1000,
});

describe('proposed burst capacity is a hypothetical static-workset model, not deployment approval', () => {
    it.each([[895, 90, 18, 5, 275_000], [901, 91, 19, 1, 286_000]])(
        'models %s candidates as %s cycles / %s ticks with %s final cycles in %s ms',
        (candidateCount, cycles, ticks, finalTickCycles, modeledSweepMs) => {
            expect(estimateBurstCapacity({ ...baseline, candidateCount })).toMatchObject({
                maxItemsPerCycle: 10, maxCyclesPerWake: 5, maxAdmissionsPerWindow: 5,
                admissionWindowMs: 10_000, softWakeBudgetMs: 8000, cyclesPerTick: 5,
                cycles, ticks, finalTickCycles, initialWaitAllowanceMs: 15_000, modeledSweepMs,
                targetLatencyMs: 300_000, warningWindowMs: 1_800_000,
                canFitTargetLatencyModel: true, canFitWarningModel: true,
                guaranteesDelivery: false, activationReady: false,
            });
        });

    it.each([[895, 91, 286_000], [901, 92, 287_000]])(
        'adds one unknown-cursor boundary cycle for %s candidates', (candidateCount, cycles, modeledSweepMs) => {
            expect(estimateBurstCapacity({ ...baseline, candidateCount, startsAtSweepHead: false }))
                .toMatchObject({ cycles, boundaryAllowanceCycles: 1, modeledSweepMs, canFitTargetLatencyModel: true });
        });

    it.each([
        [0, 0, 0, 0], [1, 1, 1, 16_000], [10, 1, 1, 16_000], [11, 2, 1, 17_000],
        [50, 5, 1, 20_000], [51, 6, 2, 31_000], [100, 10, 2, 35_000],
    ])('rounds %s candidates to %s cycles / %s wakes / %s ms', (candidateCount, cycles, ticks, modeledSweepMs) => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount })).toMatchObject({ cycles, ticks, modeledSweepMs });
    });

    it('does not invent an empty-set boundary cycle or initial wait', () => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 0, startsAtSweepHead: false, admissionWindowKnownClear: false }))
            .toMatchObject({ cycles: 0, boundaryAllowanceCycles: 0, ticks: 0, finalTickCycles: 0,
                initialWaitAllowanceMs: 0, admissionWindowAllowanceMs: 0, modeledSweepMs: 0 });
    });

    it('adds a separate startup tick when the admission window is not known clear', () => {
        expect(estimateBurstCapacity({ ...baseline, admissionWindowKnownClear: false })).toMatchObject({
            cycles: 90, ticks: 18, initialWaitAllowanceMs: 15_000, admissionWindowAllowanceTicks: 1,
            admissionWindowAllowanceMs: 15_000, modeledSweepMs: 290_000, canFitTargetLatencyModel: true,
        });
        expect(estimateBurstCapacity({ ...baseline, startsAtSweepHead: false, admissionWindowKnownClear: false })).toMatchObject({
            cycles: 91, boundaryAllowanceCycles: 1, admissionWindowAllowanceMs: 15_000,
            modeledSweepMs: 301_000, canFitTargetLatencyModel: false, canFitWarningModel: true,
        });
    });

    it.each([
        [1, 5], [1000, 5], [1600, 5], [1601, 4], [2000, 4], [2001, 3],
        [2666, 3], [2667, 2], [4000, 2], [4001, 1], [8000, 1], [8001, 0],
    ])('fits execution allowance %s ms into %s cycles per wake without exceeding either cap', (cycleBudgetMs, cyclesPerTick) => {
        const result = estimateBurstCapacity({ ...baseline, cycleBudgetMs });
        expect(result.cyclesPerTick).toBe(cyclesPerTick);
        expect(result.fullTickWorkBudgetMs).toBe(cyclesPerTick * cycleBudgetMs);
        expect(result.fullTickWorkBudgetMs).toBeLessThanOrEqual(8000);
        expect(result.cyclesPerTick).toBeLessThanOrEqual(5);
    });

    it('allows the last cycle to finish exactly at the soft stop but does not allocate another', () => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 60, cycleBudgetMs: 1600 }))
            .toMatchObject({ cyclesPerTick: 5, fullTickWorkBudgetMs: 8000, ticks: 2,
                finalTickCycles: 1, modeledSweepMs: 31_600 });
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 20, cycleBudgetMs: 8000 }))
            .toMatchObject({ cyclesPerTick: 1, ticks: 2, finalTickCycles: 1, modeledSweepMs: 38_000 });
    });

    it.each([8001, 9999])('refuses a modeled allowance %s ms that cannot fit any cycle inside the soft budget', cycleBudgetMs => {
        expect(estimateBurstCapacity({ ...baseline, cycleBudgetMs })).toMatchObject({
            cyclesPerTick: 0, cycleFitsTick: true, modelBudgetFits: false, ticks: null, modeledSweepMs: null,
            canFitTargetLatencyModel: false, canFitWarningModel: false, reason: 'NO_CYCLE_FITS_SOFT_BUDGET',
        });
    });

    it.each([15_000, 15_001, 600_000])('refuses an execution allowance consuming/exceeding the tick: %s ms', cycleBudgetMs => {
        expect(estimateBurstCapacity({ ...baseline, cycleBudgetMs })).toMatchObject({
            cycleFitsTick: false, modelBudgetFits: false, modeledSweepMs: null,
            canFitTargetLatencyModel: false, canFitWarningModel: false, reason: 'CYCLE_BUDGET_CONSUMES_TICK',
        });
    });

    it('does not confuse the soft stop with interruption or caller statement timeout', () => {
        expect(estimateBurstCapacity(baseline)).toMatchObject({
            softBudgetInterruptsRunningCycle: false, callerStatementTimeoutModeled: false,
            cycleBudgetScope: 'TOTAL_PREPARE_EXECUTE_COMMITS_AND_ORCHESTRATION',
        });
    });

    it('keeps the five-minute latency target separate from the thirty-minute warning window', () => {
        expect(estimateBurstCapacity({ ...baseline, tickSeconds: 60 })).toMatchObject({
            modeledSweepMs: 1_085_000, canFitTargetLatencyModel: false, canFitWarningModel: true,
            reason: 'TARGET_LATENCY_NOT_MET_IN_MODEL',
        });
    });

    it('accepts exactly the confirmed latency target but not a millisecond more', () => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 10, tickSeconds: 299, cycleBudgetMs: 999 }))
            .toMatchObject({ modeledSweepMs: 299_999, canFitTargetLatencyModel: true });
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 10, tickSeconds: 299 }))
            .toMatchObject({ modeledSweepMs: 300_000, canFitTargetLatencyModel: true });
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 10, tickSeconds: 299, cycleBudgetMs: 1001 }))
            .toMatchObject({ modeledSweepMs: 300_001, canFitTargetLatencyModel: false });
    });

    it('still requires strict warning-window fit independently of the inclusive latency target', () => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 10, tickSeconds: 1799,
            targetLatencyMinutes: 30, cycleBudgetMs: 999 }))
            .toMatchObject({ modeledSweepMs: 1_799_999, canFitTargetLatencyModel: true, canFitWarningModel: true });
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 10, tickSeconds: 1799, targetLatencyMinutes: 30 }))
            .toMatchObject({ modeledSweepMs: 1_800_000, canFitTargetLatencyModel: true, canFitWarningModel: false,
                reason: 'WARNING_WINDOW_NOT_MET_IN_MODEL' });
    });

    it.each([0, 10, 895, 901])('never approves either timing comparison for lower-bound count %s', candidateCount => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount, countIsExact: false })).toMatchObject({
            canFitTargetLatencyModel: false, canFitWarningModel: false, reason: 'CANDIDATE_COUNT_IS_LOWER_BOUND',
        });
    });

    it('models fixed serial admission times within the global rolling cap, including its inclusive expiry boundary', () => {
        for (const cycleBudgetMs of [1, 1000, 1600, 1601, 2000, 4000, 8000]) {
            for (const tickSeconds of [10, 11, 60]) {
                const result = estimateBurstCapacity({ ...baseline, cycleBudgetMs, tickSeconds });
                const admissions = Array.from({ length: 4 }, (_, wake) => Array.from(
                    { length: result.cyclesPerTick }, (_, cycle) => wake * result.tickMs + cycle * cycleBudgetMs,
                )).flat();
                for (const at of admissions) {
                    const inWindow = admissions.filter(previous => previous <= at && previous > at - 10_000);
                    expect(inWindow.length).toBeLessThanOrEqual(5);
                }
                expect(result.fullTickWorkBudgetMs).toBeLessThan(result.tickMs);
            }
        }
    });

    it('retains ten-second fixed-cost arithmetic but does not approve its unbounded variable-cost admission overlap', () => {
        expect(estimateBurstCapacity({ ...baseline, tickSeconds: 10 })).toMatchObject({
            modeledSweepMs: 185_000, admissionClearanceRequiredMs: 15_000,
            admissionClearanceSatisfied: false, clearanceBoundApplies: false,
            canFitTargetLatencyModel: false, canFitWarningModel: false, reason: 'ADMISSION_WINDOW_OVERLAP_NOT_BOUNDED',
        });
        expect(estimateBurstCapacity({ ...baseline, tickSeconds: 10, candidateCount: 901 }))
            .toMatchObject({ modeledSweepMs: 191_000, canFitTargetLatencyModel: false });
    });

    it('demonstrates why equal-cost ten-second arithmetic is not a bound for variable cycle durations', () => {
        // First wake costs 1000 ms per cycle; the next wake's first cycle costs
        // only 1 ms. Both satisfy a 1000 ms allowance. Its second admission at
        // 10001 ms is nevertheless rejected: five earlier reservations remain.
        const accepted = [0, 1000, 2000, 3000, 4000, 10_000];
        const attemptedAt = 10_001;
        expect(accepted.filter(at => at > attemptedAt - 10_000 && at <= attemptedAt)).toHaveLength(5);
        expect(estimateBurstCapacity({ ...baseline, tickSeconds: 10 }).clearanceBoundApplies).toBe(false);
    });

    it('requires clearance through the entire modeled wake budget, with inclusive equality', () => {
        expect(estimateBurstCapacity({ ...baseline, tickSeconds: 14 })).toMatchObject({
            admissionClearanceRequiredMs: 15_000, admissionClearanceSatisfied: false, canFitTargetLatencyModel: false,
        });
        expect(estimateBurstCapacity(baseline)).toMatchObject({
            admissionClearanceRequiredMs: 15_000, admissionClearanceSatisfied: true, clearanceBoundApplies: true,
        });
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 10, cycleBudgetMs: 8000, tickSeconds: 18 }))
            .toMatchObject({ admissionClearanceRequiredMs: 18_000, admissionClearanceSatisfied: true, canFitTargetLatencyModel: true });
    });

    it('does not require an admission window for an exactly empty workset', () => {
        expect(estimateBurstCapacity({ ...baseline, candidateCount: 0, tickSeconds: 10, admissionWindowKnownClear: false }))
            .toMatchObject({ modeledSweepMs: 0, admissionClearanceSatisfied: false,
                clearanceBoundApplies: true, canFitTargetLatencyModel: true, canFitWarningModel: true });
    });

    it('requires an explicit per-cycle allowance rather than borrowing a worker-only observation', () => {
        const withoutBudget = { ...baseline };
        delete withoutBudget.cycleBudgetMs;
        expect(() => estimateBurstCapacity(withoutBudget)).toThrow('Invalid cycleBudgetMs');
    });

    it('defaults the proposed tick, confirmed latency and selected warning independently', () => {
        const withoutTick = { ...baseline };
        delete withoutTick.tickSeconds;
        expect(estimateBurstCapacity(withoutTick)).toEqual(estimateBurstCapacity({
            ...baseline, targetLatencyMinutes: 5, warningMinutes: 30,
        }));
    });

    it.each(['candidateCount', 'tickSeconds', 'cycleBudgetMs', 'targetLatencyMinutes', 'warningMinutes'])(
        'validates numeric %s without coercion', key => {
            for (const value of [-1, 0.5, NaN, Infinity, -Infinity, '1', null, false, new Date('invalid'), Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => estimateBurstCapacity({ ...baseline, [key]: value })).toThrow(`Invalid ${key}`);
            }
            if (key === 'candidateCount' || key === 'cycleBudgetMs') {
                expect(() => estimateBurstCapacity({ ...baseline, [key]: undefined })).toThrow(`Invalid ${key}`);
            }
        });

    it.each([
        ['candidateCount', 1_000_001], ['tickSeconds', 0], ['tickSeconds', 9], ['tickSeconds', 86_401],
        ['cycleBudgetMs', 0], ['cycleBudgetMs', 600_001], ['targetLatencyMinutes', 0],
        ['targetLatencyMinutes', 1441], ['warningMinutes', 0], ['warningMinutes', 1441],
    ])('rejects out-of-range %s=%s', (key, value) => {
        expect(() => estimateBurstCapacity({ ...baseline, [key]: value })).toThrow(`Invalid ${key}`);
    });

    it.each(['countIsExact', 'startsAtSweepHead', 'admissionWindowKnownClear'])('requires explicit boolean %s', key => {
        for (const value of [null, undefined, 'true', 1, 0, Object(true)]) {
            expect(() => estimateBurstCapacity({ ...baseline, [key]: value })).toThrow(`Invalid ${key}`);
        }
    });

    it.each([null, undefined, [], '1', 1, false, new Date('invalid'), () => baseline])('rejects a non-record input %s', input => {
        expect(() => estimateBurstCapacity(input)).toThrow('Invalid capacity input');
    });

    it('rejects policy and readiness overrides rather than silently ignoring them', () => {
        for (const extra of [{ cyclesPerTick: 10 }, { softWakeBudgetMs: 9000 }, { maxAdmissionsPerWindow: 10 },
            { initialWaitMs: 0 }, { activationReady: true }, { [Symbol('input')]: true }]) {
            expect(() => estimateBurstCapacity({ ...baseline, ...extra })).toThrow('Unknown capacity input');
        }
    });

    it('keeps maximum-range derived arithmetic safe and integral', () => {
        const result = estimateBurstCapacity({ ...baseline, candidateCount: 1_000_000, startsAtSweepHead: false,
            tickSeconds: 86_400, cycleBudgetMs: 8000, targetLatencyMinutes: 1440, warningMinutes: 1440 });
        expect(result.cycles).toBe(100_001);
        for (const value of Object.values(result).filter(value => typeof value === 'number')) expect(Number.isSafeInteger(value)).toBe(true);
    });

    it('is deterministic and immutable, and explicitly excludes sources of unbounded delay', () => {
        const input = Object.freeze({ ...baseline });
        const result = estimateBurstCapacity(input);
        expect(estimateBurstCapacity(input)).toEqual(result);
        expect(input).toEqual(baseline);
        expect(Object.isFrozen(result)).toBe(true);
        expect(result).toMatchObject({ canFitTargetLatencyModel: true, activationReady: false, guaranteesDelivery: false,
            arithmeticAssumesNoAdmissionWait: true, assumesSuccessfulCyclesWithinSuppliedBudget: true, assumesNoCompetingAdmissions: true,
            assumesNoPriorDispatcherBacklog: true, assumesNoQueuedCatchUp: true, reason: 'FIXED_PHASE_MODEL_ONLY' });
    });
});
