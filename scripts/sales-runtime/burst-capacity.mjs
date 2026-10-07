/**
 * Pure offline planner for the PROPOSED burst dispatcher, not a scheduler or an
 * execution-time promise. No database, filesystem, network or environment access.
 *
 * One wake may finish at most five serial 10-item cycles. Global admission is at
 * most five reservations per rolling 10 seconds. The proposed cadence is 15
 * seconds, subject to the clearance check below. The 8-second wake stop is SOFT: it cannot interrupt
 * an already running cycle and is not a caller statement timeout.
 *
 * cycleBudgetMs is a supplied hypothetical TOTAL per-cycle allowance, including
 * prepare, execute, commits and orchestration overhead. An observed worker-only
 * duration does not establish this allowance or make it an upper bound. The
 * arithmetic assumes fixed-phase wakes and successful serial cycles,
 * with no retries, new arrivals, competing admissions, queued catch-up, poison
 * work or prior dispatcher backlog. It does not predict those conditions.
 *
 * Merely spacing wakes by 10 seconds is insufficient: faster later cycles may
 * reach admission while a preceding wake's late reservations are still live.
 * Positive fit requires enough time for the ENTIRE prior modeled wake budget
 * plus the rolling window. Otherwise returned arithmetic is fixed-cost-only,
 * not a conservative estimate for variable durations within the input budget.
 */
const MAX_ITEMS_PER_CYCLE = 10;
const MAX_CYCLES_PER_WAKE = 5;
const SOFT_WAKE_BUDGET_MS = 8000;
const ADMISSION_WINDOW_MS = 10_000;
const ALLOWED_INPUTS = new Set([
    'candidateCount', 'countIsExact', 'startsAtSweepHead', 'admissionWindowKnownClear', 'tickSeconds', 'cycleBudgetMs',
    'targetLatencyMinutes', 'warningMinutes',
]);

export function estimateBurstCapacity(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Invalid capacity input');
    if (Reflect.ownKeys(input).some(key => !ALLOWED_INPUTS.has(key))) throw new Error('Unknown capacity input');
    const {
        candidateCount, countIsExact, startsAtSweepHead, admissionWindowKnownClear, tickSeconds = 15, cycleBudgetMs,
        targetLatencyMinutes = 5, warningMinutes = 30,
    } = input;
    for (const [name, value, minimum, maximum] of [
        ['candidateCount', candidateCount, 0, 1_000_000],
        ['tickSeconds', tickSeconds, 10, 86_400],
        ['cycleBudgetMs', cycleBudgetMs, 1, 600_000],
        ['targetLatencyMinutes', targetLatencyMinutes, 1, 1440],
        ['warningMinutes', warningMinutes, 1, 1440],
    ]) {
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
    }
    if (typeof countIsExact !== 'boolean') throw new Error('Invalid countIsExact');
    if (typeof startsAtSweepHead !== 'boolean') throw new Error('Invalid startsAtSweepHead');
    if (typeof admissionWindowKnownClear !== 'boolean') throw new Error('Invalid admissionWindowKnownClear');

    const boundaryAllowanceCycles = candidateCount > 0 && !startsAtSweepHead ? 1 : 0;
    const cycles = Math.ceil(candidateCount / MAX_ITEMS_PER_CYCLE) + boundaryAllowanceCycles;
    const tickMs = tickSeconds * 1000;
    // A final cycle may finish exactly at the soft stop, but no extra cycle is
    // included after that boundary. Runtime enforcement remains separate.
    const cyclesPerTick = Math.min(MAX_CYCLES_PER_WAKE, Math.floor(SOFT_WAKE_BUDGET_MS / cycleBudgetMs));
    const cycleFitsTick = cycleBudgetMs < tickMs;
    const modelBudgetFits = cyclesPerTick > 0 && cycleFitsTick;
    const ticks = modelBudgetFits ? Math.ceil(cycles / cyclesPerTick) : null;
    const finalTickCycles = modelBudgetFits && cycles > 0 ? ((cycles - 1) % cyclesPerTick) + 1 : 0;
    const initialWaitAllowanceMs = modelBudgetFits && cycles > 0 ? tickMs : 0;
    // With no competing admissions, one additional full tick (at least 10s)
    // allows any previously retained reservations to expire before the sweep.
    const admissionWindowAllowanceTicks = modelBudgetFits && cycles > 0 && !admissionWindowKnownClear ? 1 : 0;
    const admissionWindowAllowanceMs = admissionWindowAllowanceTicks * tickMs;
    const admissionClearanceRequiredMs = ADMISSION_WINDOW_MS + cyclesPerTick * cycleBudgetMs;
    const admissionClearanceSatisfied = tickMs >= admissionClearanceRequiredMs;
    const clearanceBoundApplies = modelBudgetFits && (cycles === 0 || admissionClearanceSatisfied);
    const modeledSweepMs = !modelBudgetFits ? null : cycles === 0 ? 0
        : initialWaitAllowanceMs + admissionWindowAllowanceMs + (ticks - 1) * tickMs + finalTickCycles * cycleBudgetMs;
    const targetLatencyMs = targetLatencyMinutes * 60_000;
    const warningWindowMs = warningMinutes * 60_000;
    // Target is explicitly "within five minutes" (inclusive). Warning-window
    // fit remains strict: notification at the deadline is no longer advance notice.
    const canFitTargetLatencyModel = clearanceBoundApplies && countIsExact && modeledSweepMs <= targetLatencyMs;
    const canFitWarningModel = clearanceBoundApplies && countIsExact && modeledSweepMs < warningWindowMs;

    return Object.freeze({
        model: 'PROPOSED_BURST_FIXED_PHASE_STATIC_WORKSET',
        maxItemsPerCycle: MAX_ITEMS_PER_CYCLE,
        maxCyclesPerWake: MAX_CYCLES_PER_WAKE,
        maxAdmissionsPerWindow: MAX_CYCLES_PER_WAKE,
        admissionWindowMs: ADMISSION_WINDOW_MS,
        softWakeBudgetMs: SOFT_WAKE_BUDGET_MS,
        softBudgetInterruptsRunningCycle: false,
        callerStatementTimeoutModeled: false,
        candidateCount,
        countIsExact,
        startsAtSweepHead,
        admissionWindowKnownClear,
        cycleBudgetMs,
        cycleBudgetScope: 'TOTAL_PREPARE_EXECUTE_COMMITS_AND_ORCHESTRATION',
        tickMs,
        cycles,
        boundaryAllowanceCycles,
        cyclesPerTick,
        fullTickWorkBudgetMs: cyclesPerTick * cycleBudgetMs,
        cycleFitsTick,
        modelBudgetFits,
        ticks,
        finalTickCycles,
        initialWaitAllowanceMs,
        admissionWindowAllowanceTicks,
        admissionWindowAllowanceMs,
        admissionClearanceRequiredMs,
        admissionClearanceSatisfied,
        clearanceBoundApplies,
        modeledSweepMs,
        targetLatencyMs,
        warningWindowMs,
        canFitTargetLatencyModel,
        canFitWarningModel,
        arithmeticAssumesNoAdmissionWait: true,
        assumesSuccessfulCyclesWithinSuppliedBudget: true,
        assumesNoCompetingAdmissions: true,
        assumesNoPriorDispatcherBacklog: true,
        assumesNoQueuedCatchUp: true,
        guaranteesDelivery: false,
        activationReady: false,
        reason: !cycleFitsTick ? 'CYCLE_BUDGET_CONSUMES_TICK'
            : !modelBudgetFits ? 'NO_CYCLE_FITS_SOFT_BUDGET'
                : !countIsExact ? 'CANDIDATE_COUNT_IS_LOWER_BOUND'
                    : !clearanceBoundApplies ? 'ADMISSION_WINDOW_OVERLAP_NOT_BOUNDED'
                        : !canFitTargetLatencyModel ? 'TARGET_LATENCY_NOT_MET_IN_MODEL'
                            : !canFitWarningModel ? 'WARNING_WINDOW_NOT_MET_IN_MODEL' : 'FIXED_PHASE_MODEL_ONLY',
    });
}
