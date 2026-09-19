/**
 * Evidence aggregation only; no employee scores, policy decisions, DB or network.
 * A trusted server projection must establish eligibility, due dates, evidence,
 * ownership, and COMPLETE source coverage first. Browser-supplied classifications
 * are never proof. One unit is one task/Visit/scope-day, not one phone call.
 * This does not select any still-unapproved denominator or N/A weighting policy.
 */
export type MetricObservationOutcome = 'met' | 'missed' | 'not_due' | 'not_applicable' | 'unknown';
export interface MetricObservation {
    readonly unitKey: string;
    readonly outcome: MetricObservationOutcome;
    readonly evidenceIds: readonly string[];
    readonly exclusionReason?: string;
}

export interface MetricObservationInput {
    readonly sourceComplete: boolean;
    readonly observations: readonly MetricObservation[];
}

export interface MetricObservationCounts {
    readonly uniqueUnits: number;
    readonly duplicateRowsIgnored: number;
    readonly met: number;
    readonly missed: number;
    readonly notDue: number;
    readonly notApplicable: number;
    readonly unknown: number;
    readonly knownEligible: number;
}

export type MetricObservationSummary =
    | { readonly state: 'invalid'; readonly code: 'INVALID_INPUT' | 'CONFLICTING_DUPLICATE'; readonly percent: null }
    | { readonly state: 'needs_evidence'; readonly percent: null; readonly counts: MetricObservationCounts }
    | { readonly state: 'no_eligible_work'; readonly percent: null; readonly counts: MetricObservationCounts }
    | { readonly state: 'observed'; readonly percent: number; readonly counts: MetricObservationCounts };

const outcomes: readonly MetricObservationOutcome[] = ['met', 'missed', 'not_due', 'not_applicable', 'unknown'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const canonicalId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const invalid = (code: 'INVALID_INPUT' | 'CONFLICTING_DUPLICATE' = 'INVALID_INPUT'): MetricObservationSummary => ({ state: 'invalid', code, percent: null });

export function summarizeMetricObservations(input: MetricObservationInput): MetricObservationSummary {
    if (!isRecord(input) || typeof input.sourceComplete !== 'boolean' || !Array.isArray(input.observations)) return invalid();
    const units = new Map<string, { signature: string; outcome: MetricObservationOutcome }>();
    let duplicateRowsIgnored = 0;
    for (const raw of input.observations as readonly unknown[]) {
        if (!isRecord(raw) || !canonicalId(raw.unitKey) || !outcomes.includes(raw.outcome as MetricObservationOutcome)
            || !Array.isArray(raw.evidenceIds) || !Array.from(raw.evidenceIds).every(canonicalId)
            || (raw.exclusionReason !== undefined && typeof raw.exclusionReason !== 'string')) return invalid();
        if (raw.outcome === 'met' && raw.evidenceIds.length === 0) return invalid();
        const reason = typeof raw.exclusionReason === 'string' ? raw.exclusionReason.trim() : '';
        if (/[\u0000-\u001f\u007f-\u009f]/.test(reason)) return invalid();
        if (raw.outcome === 'not_applicable' && !reason) return invalid();
        // Sorted unique evidence IDs make replay independent of query/join order.
        const signature = JSON.stringify([raw.outcome, [...new Set(raw.evidenceIds)].sort(), reason]);
        const prior = units.get(raw.unitKey);
        if (prior) {
            if (prior.signature !== signature) return invalid('CONFLICTING_DUPLICATE');
            duplicateRowsIgnored++;
        } else units.set(raw.unitKey, { signature, outcome: raw.outcome as MetricObservationOutcome });
    }

    const counts = { uniqueUnits: units.size, duplicateRowsIgnored, met: 0, missed: 0, notDue: 0, notApplicable: 0, unknown: 0, knownEligible: 0 };
    for (const unit of units.values()) {
        switch (unit.outcome) {
            case 'met': counts.met++; break;
            case 'missed': counts.missed++; break;
            case 'not_due': counts.notDue++; break;
            case 'not_applicable': counts.notApplicable++; break;
            case 'unknown': counts.unknown++; break;
        }
    }
    counts.knownEligible = counts.met + counts.missed;
    if (!input.sourceComplete || counts.unknown > 0) return { state: 'needs_evidence', percent: null, counts };
    if (counts.knownEligible === 0) return { state: 'no_eligible_work', percent: null, counts };
    return { state: 'observed', percent: counts.met / counts.knownEligible * 100, counts };
}
