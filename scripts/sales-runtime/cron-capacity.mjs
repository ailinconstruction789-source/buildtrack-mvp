/** Offline arithmetic only: no scheduler, network, environment or database.
 * Inputs must come from a representative load test, not a guessed Pro capacity.
 * This models SERIAL committed cycles over a STATIC task set. It cannot promise
 * delivery under retries, contention, new Leads or a persistent poison batch.
 */
export function estimateCronCapacity({ candidateCount, countIsExact, startsAtSweepHead, tickSeconds, cyclesPerTick, cycleBudgetMs, warningMinutes = 30 }) {
    for (const [name, value, minimum, maximum] of [
        ['candidateCount', candidateCount, 0, 1_000_000], ['tickSeconds', tickSeconds, 1, 86_400],
        ['cyclesPerTick', cyclesPerTick, 1, 100], ['cycleBudgetMs', cycleBudgetMs, 1, 600_000],
        ['warningMinutes', warningMinutes, 1, 1440],
    ]) {
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
    }
    if (typeof countIsExact !== 'boolean') throw new Error('Invalid countIsExact');
    if (typeof startsAtSweepHead !== 'boolean') throw new Error('Invalid startsAtSweepHead');
    // The shared cursor may start on an empty/partial tail. Allow one additional
    // boundary/reset cycle unless the operator has established a head start.
    const boundaryAllowanceCycles = candidateCount > 0 && !startsAtSweepHead ? 1 : 0;
    const cycles = Math.ceil(candidateCount / 10) + boundaryAllowanceCycles;
    const ticks = Math.ceil(cycles / cyclesPerTick);
    const tickBudgetMs = cyclesPerTick * cycleBudgetMs;
    // Include up to one full tick of initial wait plus completion of the last
    // cycle. The model is invalid if serial work can consume the whole interval.
    const fitsTick = tickBudgetMs < tickSeconds * 1000;
    const lastTickCycles = cycles ? ((cycles - 1) % cyclesPerTick) + 1 : 0;
    const modeledSweepMs = cycles ? ticks * tickSeconds * 1000 + lastTickCycles * cycleBudgetMs : 0;
    return Object.freeze({ maxItemsPerCycle: 10, cycles, ticks, tickBudgetMs, fitsTick, boundaryAllowanceCycles,
        modeledSweepMs: fitsTick ? modeledSweepMs : null,
        countIsExact, fitsWarningWindowInModel: fitsTick && countIsExact && modeledSweepMs < warningMinutes * 60_000,
        guaranteesDelivery: false,
        reason: !fitsTick ? 'TICK_BUDGET_EXCEEDED' : !countIsExact ? 'CANDIDATE_COUNT_IS_LOWER_BOUND' : 'MODEL_ONLY_LOAD_TEST_REQUIRED' });
}
