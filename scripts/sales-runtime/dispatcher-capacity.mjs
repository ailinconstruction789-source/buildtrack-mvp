/**
 * Offline arithmetic for SQL14's single-cycle dispatcher, not a scheduler.
 *
 * SQL14 permits another request at completed_at + 60 seconds (inclusive). A
 * successful cycle taking any positive time below 60 seconds therefore cannot
 * start at the immediately following minute tick: that tick is too early.
 *
 * The caller supplies an externally measured, integer-millisecond cycle budget.
 * This is a hypothetical STATIC workset with successful serial cycles, a fixed
 * scheduler phase, and no queued catch-up ticks. It models neither retries,
 * contention, scheduling delay, new Leads, nor a persistent poison batch. A
 * measured maximum is an observation, not an execution-time upper bound.
 */
const COMPLETION_SPACING_MS = 60_000;
const MAX_ITEMS_PER_CYCLE = 10;
const ALLOWED_INPUTS = new Set([
    'candidateCount', 'countIsExact', 'startsAtSweepHead', 'tickSeconds', 'cycleBudgetMs', 'warningMinutes',
]);

export function estimateDispatcherCapacity(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Invalid capacity input');
    if (Reflect.ownKeys(input).some(key => !ALLOWED_INPUTS.has(key))) throw new Error('Unknown capacity input');
    const { candidateCount, countIsExact, startsAtSweepHead, tickSeconds, cycleBudgetMs, warningMinutes = 30 } = input;
    for (const [name, value, minimum, maximum] of [
        ['candidateCount', candidateCount, 0, 1_000_000],
        ['tickSeconds', tickSeconds, 1, 86_400],
        ['cycleBudgetMs', cycleBudgetMs, 1, 600_000],
        ['warningMinutes', warningMinutes, 1, 1440],
    ]) {
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
    }
    if (typeof countIsExact !== 'boolean') throw new Error('Invalid countIsExact');
    if (typeof startsAtSweepHead !== 'boolean') throw new Error('Invalid startsAtSweepHead');

    // An unknown shared cursor can encounter a partial/empty tail before the
    // fixed set is fully visited. Reserve one boundary/reset cycle, not a claim
    // about ongoing arrivals or another caller changing the cursor concurrently.
    const boundaryAllowanceCycles = candidateCount > 0 && !startsAtSweepHead ? 1 : 0;
    const cycles = Math.ceil(candidateCount / MAX_ITEMS_PER_CYCLE) + boundaryAllowanceCycles;
    const tickMs = tickSeconds * 1000;
    const schedulerTicksPerCycle = Math.ceil((cycleBudgetMs + COMPLETION_SPACING_MS) / tickMs);
    const effectiveCycleStartIntervalMs = schedulerTicksPerCycle * tickMs;
    const initialWaitAllowanceMs = cycles > 0 ? tickMs : 0;
    const modeledSweepMs = cycles > 0
        ? initialWaitAllowanceMs + (cycles - 1) * effectiveCycleStartIntervalMs + cycleBudgetMs
        : 0;
    // Arithmetic still models serial starts when a cycle consumes a full tick,
    // but it must not approve capacity without examining real queued/late ticks.
    const cycleExceedsTick = cycleBudgetMs >= tickMs;
    const warningWindowMs = warningMinutes * 60_000;
    const canFitWarningModel = !cycleExceedsTick && countIsExact && modeledSweepMs < warningWindowMs;

    return Object.freeze({
        model: 'DISPATCHER_14_FIXED_PHASE_STATIC_WORKSET',
        maxItemsPerCycle: MAX_ITEMS_PER_CYCLE,
        cyclesPerEligibleTick: 1,
        completionSpacingMs: COMPLETION_SPACING_MS,
        candidateCount,
        countIsExact,
        startsAtSweepHead,
        cycleBudgetMs,
        tickMs,
        cycles,
        boundaryAllowanceCycles,
        schedulerTicksPerCycle,
        skippedTicksBetweenCycles: schedulerTicksPerCycle - 1,
        effectiveCycleStartIntervalMs,
        initialWaitAllowanceMs,
        modeledSweepMs,
        warningWindowMs,
        cycleExceedsTick,
        canFitWarningModel,
        assumesSuccessfulCycles: true,
        assumesNoQueuedCatchUp: true,
        guaranteesDelivery: false,
        activationReady: false,
        reason: cycleExceedsTick ? 'CYCLE_BUDGET_CONSUMES_TICK'
            : !countIsExact ? 'CANDIDATE_COUNT_IS_LOWER_BOUND'
                : !canFitWarningModel ? 'WARNING_WINDOW_NOT_MET_IN_MODEL' : 'FIXED_PHASE_MODEL_ONLY',
    });
}

/** Summarize caller-provided elapsed samples; do not turn them into guarantees.
 * Nearest-rank percentile: sort ascending, select ceil(p * n) - 1.
 * Samples may be fractional milliseconds. The caller must explicitly ceil an
 * observed duration before using it as the integer capacity-model input.
 */
export function summarizeCycleSamples(samples) {
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > 100_000) throw new Error('Invalid cycle samples');
    for (const sample of samples) {
        if (typeof sample !== 'number' || !Number.isFinite(sample) || sample <= 0 || sample > Number.MAX_SAFE_INTEGER) {
            throw new Error('Invalid cycle sample');
        }
    }
    const ordered = [...samples].sort((left, right) => left - right);
    const nearestRank = percentile => ordered[Math.ceil(percentile * ordered.length) - 1];
    return Object.freeze({
        count: ordered.length,
        p50Ms: nearestRank(0.5),
        p95Ms: nearestRank(0.95),
        maxMs: ordered[ordered.length - 1],
        percentileMethod: 'nearest-rank',
        observedOnly: true,
        isUpperBound: false,
    });
}
