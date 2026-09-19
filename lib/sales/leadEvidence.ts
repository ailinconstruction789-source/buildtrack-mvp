/**
 * Pure evidence-contract checks for FUTURE server commands, not a live workflow.
 * Load all evidence, scope relations, actor identity, owner and stage classification
 * from trusted server storage. A browser-supplied object does not become trusted
 * by passing these checks. This module does NOT authorize writes, verify authenticity,
 * activate projects, award Qualified credit, or calculate any KPI/HR score.
 *
 * needs_evidence means the claim is not established (including legacy unknowns),
 * never an automatic staff failure. invalid means inconsistent/malformed evidence.
 */
import type { CrmActor } from './workflow';

export type EvidenceScope =
    | { readonly kind: 'customer'; readonly customerId: string }
    | { readonly kind: 'interest'; readonly customerId: string; readonly interestId: string };

export interface EvidenceContext {
    readonly scope: EvidenceScope;
    readonly owner: CrmActor;
    readonly asOf: string;
}

export interface RecordedLeadEvidence {
    readonly id: string;
    readonly scope: EvidenceScope;
    readonly recordedByUserId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
}

export interface NextActionEvidence extends RecordedLeadEvidence {
    readonly ownerUserId: string;
    readonly action: string;
    readonly dueAt: string;
    readonly status: 'open' | 'done' | 'cancelled';
}

export interface AttemptLogEvidence extends RecordedLeadEvidence {
    readonly performedByUserId: string;
    readonly action: string;
    readonly channel: string;
    readonly result: 'contact_success' | 'no_answer' | 'customer_requested_later' | 'other' | 'unknown';
}

export interface PreliminaryLoanReadinessEvidence extends RecordedLeadEvidence {
    readonly state: 'known' | 'unknown';
    /** An evidenced preliminary assessment, not a declaration of bank approval. */
    readonly summary: string | null;
}

export interface QualificationEvidence extends RecordedLeadEvidence {
    readonly contact: AttemptLogEvidence | null;
    readonly genuineInterest: boolean | null;
    readonly projectName: string | null;
    readonly needs: string | null;
    readonly budget: number | null;
    readonly loanReadiness: PreliminaryLoanReadinessEvidence | null;
    /** Resolved by trusted/versioned workflow rules; no hardcoded Active taxonomy here. */
    readonly stage: { readonly code: string; readonly activity: 'active' | 'inactive' | 'unknown' } | null;
    readonly nextAction: NextActionEvidence | null;
}

export type EvidenceIssueCode =
    | 'MISSING_EVIDENCE' | 'INVALID_VALUE' | 'SCOPE_MISMATCH' | 'TIME_ORDER'
    | 'FUTURE_EVIDENCE' | 'OWNER_MISMATCH' | 'OWNER_NOT_SALES' | 'INACTIVE_OWNER'
    | 'NEXT_ACTION_NOT_OPEN' | 'CONTACT_NOT_SUCCESSFUL' | 'INTEREST_NOT_CONFIRMED'
    | 'NEEDS_NOT_KNOWN' | 'FINANCE_NOT_KNOWN' | 'INACTIVE_STAGE';

export interface EvidenceIssue { readonly code: EvidenceIssueCode; readonly field: string }
export type EvidenceFailure =
    | { readonly status: 'needs_evidence'; readonly issues: readonly EvidenceIssue[] }
    | { readonly status: 'invalid'; readonly issues: readonly EvidenceIssue[] };
export type EvidenceValidation<T> = { readonly status: 'valid'; readonly value: T } | EvidenceFailure;
export type NextActionTiming = 'scheduled' | 'overdue';
export type QualificationAssessment =
    | { readonly status: 'qualified'; readonly qualificationEvidenceId: string; readonly contactEvidenceId: string; readonly nextActionTiming: NextActionTiming }
    | EvidenceFailure;

/** Strict Gregorian RFC3339 subset, returning exact epoch microseconds as bigint.
 * Rejects date-only/local dates, calendar rollover, leap seconds, 24:00, unknown
 * -00:00 offsets and precision beyond PostgreSQL's six fractional digits instead
 * of silently truncating. Callers must not coerce the result to a JS number.
 */
export function parseEvidenceTimestamp(value: unknown): bigint | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const [, yyyy, mm, dd, hh, min, ss, fraction, zone] = match;
    const [year, month, day, hour, minute, second] = [yyyy, mm, dd, hh, min, ss].map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
        || hour > 23 || minute > 59 || second > 59 || zone === '-00:00') return null;
    const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
    const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, 0);
    const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (zone.startsWith('-') ? -1 : 1);
    return BigInt(date.getTime() - offset) * BigInt(1000) + BigInt((fraction ?? '').padEnd(6, '0'));
}

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasControls = (value: unknown) => typeof value === 'string' && Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
});
const nonBlank = (value: unknown): value is string => typeof value === 'string' && !hasControls(value) && value.trim().length > 0;
const absent = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && !value.trim());

class Checks {
    readonly missing: EvidenceIssue[] = [];
    readonly invalid: EvidenceIssue[] = [];
    need(code: EvidenceIssueCode, field: string) { this.missing.push({ code, field }); }
    bad(code: EvidenceIssueCode, field: string) { this.invalid.push({ code, field }); }
    text(value: unknown, field: string) {
        if (hasControls(value)) this.bad('INVALID_VALUE', field);
        else if (absent(value)) this.need('MISSING_EVIDENCE', field);
        else if (!nonBlank(value)) this.bad('INVALID_VALUE', field);
    }
    record(value: unknown, field: string): RecordValue | null {
        if (isRecord(value)) return value;
        if (absent(value)) this.need('MISSING_EVIDENCE', field);
        else this.bad('INVALID_VALUE', field);
        return null;
    }
    time(value: unknown, field: string): bigint | null {
        if (absent(value)) { this.need('MISSING_EVIDENCE', field); return null; }
        const parsed = parseEvidenceTimestamp(value);
        if (parsed === null) this.bad('INVALID_VALUE', field);
        return parsed;
    }
    failure(): EvidenceFailure | null {
        if (this.invalid.length) return { status: 'invalid', issues: [...this.invalid, ...this.missing] };
        return this.missing.length ? { status: 'needs_evidence', issues: [...this.missing] } : null;
    }
}

function checkScope(value: unknown, field: string, checks: Checks): EvidenceScope | null {
    const scope = checks.record(value, field);
    if (!scope) return null;
    checks.text(scope.customerId, `${field}.customerId`);
    if (absent(scope.kind)) { checks.need('MISSING_EVIDENCE', `${field}.kind`); return null; }
    if (scope.kind !== 'customer' && scope.kind !== 'interest') { checks.bad('INVALID_VALUE', `${field}.kind`); return null; }
    if (scope.kind === 'interest') checks.text(scope.interestId, `${field}.interestId`);
    else if (scope.interestId !== undefined) checks.bad('SCOPE_MISMATCH', `${field}.interestId`);
    if (!nonBlank(scope.customerId) || (scope.kind === 'interest' && !nonBlank(scope.interestId))) return null;
    return scope.kind === 'customer' ? { kind: 'customer', customerId: scope.customerId }
        : { kind: 'interest', customerId: scope.customerId, interestId: scope.interestId as string };
}

interface CheckedContext { scope: EvidenceScope | null; ownerId: string | null; asOf: bigint | null }
function checkContext(value: unknown, checks: Checks): CheckedContext {
    const context = checks.record(value, 'context');
    if (!context) return { scope: null, ownerId: null, asOf: null };
    const scope = checkScope(context.scope, 'context.scope', checks);
    const asOf = checks.time(context.asOf, 'context.asOf');
    const owner = checks.record(context.owner, 'context.owner');
    if (owner) {
        checks.text(owner.userId, 'context.owner.userId');
        if (absent(owner.role)) checks.need('MISSING_EVIDENCE', 'context.owner.role');
        else if (owner.role !== 'sales') checks.bad('OWNER_NOT_SALES', 'context.owner.role');
        if (owner.active === false) checks.bad('INACTIVE_OWNER', 'context.owner.active');
        else if (owner.active !== true) {
            if (absent(owner.active)) checks.need('MISSING_EVIDENCE', 'context.owner.active');
            else checks.bad('INVALID_VALUE', 'context.owner.active');
        }
    }
    return { scope, asOf, ownerId: owner && nonBlank(owner.userId) ? owner.userId : null };
}

function checkRecorded(value: unknown, field: string, context: CheckedContext, checks: Checks): RecordValue | null {
    const record = checks.record(value, field);
    if (!record) return null;
    checks.text(record.id, `${field}.id`);
    checks.text(record.recordedByUserId, `${field}.recordedByUserId`);
    const scope = checkScope(record.scope, `${field}.scope`, checks);
    if (scope && context.scope && (scope.customerId !== context.scope.customerId || scope.kind !== context.scope.kind
        || (scope.kind === 'interest' && context.scope.kind === 'interest' && scope.interestId !== context.scope.interestId))) {
        checks.bad('SCOPE_MISMATCH', `${field}.scope`);
    }
    const occurred = checks.time(record.occurredAt, `${field}.occurredAt`);
    const recorded = checks.time(record.recordedAt, `${field}.recordedAt`);
    if (occurred !== null && recorded !== null && occurred > recorded) checks.bad('TIME_ORDER', field);
    if (context.asOf !== null && ((occurred !== null && occurred > context.asOf) || (recorded !== null && recorded > context.asOf))) {
        checks.bad('FUTURE_EVIDENCE', field);
    }
    return record;
}

function checkNextAction(value: unknown, context: CheckedContext, checks: Checks): NextActionTiming | null {
    const action = checkRecorded(value, 'nextAction', context, checks);
    if (!action) return null;
    checks.text(action.action, 'nextAction.action');
    checks.text(action.ownerUserId, 'nextAction.ownerUserId');
    if (nonBlank(action.ownerUserId) && context.ownerId && action.ownerUserId !== context.ownerId) checks.bad('OWNER_MISMATCH', 'nextAction.ownerUserId');
    if (action.status === 'done' || action.status === 'cancelled') checks.need('NEXT_ACTION_NOT_OPEN', 'nextAction.status');
    else if (absent(action.status)) checks.need('MISSING_EVIDENCE', 'nextAction.status');
    else if (action.status !== 'open') checks.bad('INVALID_VALUE', 'nextAction.status');
    const due = checks.time(action.dueAt, 'nextAction.dueAt');
    // A late task remains overdue evidence: do not reset dueAt or hide it as invalid.
    return due === null || context.asOf === null ? null : due < context.asOf ? 'overdue' : 'scheduled';
}

function checkAttempt(value: unknown, context: CheckedContext, checks: Checks): boolean {
    const attempt = checkRecorded(value, 'contact', context, checks);
    if (!attempt) return false;
    checks.text(attempt.performedByUserId, 'contact.performedByUserId');
    checks.text(attempt.action, 'contact.action');
    checks.text(attempt.channel, 'contact.channel');
    if (absent(attempt.result) || attempt.result === 'unknown') checks.need('MISSING_EVIDENCE', 'contact.result');
    else if (typeof attempt.result !== 'string' || !['contact_success', 'no_answer', 'customer_requested_later', 'other'].includes(attempt.result)) checks.bad('INVALID_VALUE', 'contact.result');
    return attempt.result === 'contact_success';
}

export function validateNextAction(evidence: NextActionEvidence | null | undefined, context: EvidenceContext): EvidenceValidation<{ readonly timing: NextActionTiming }> {
    const checks = new Checks();
    const timing = checkNextAction(evidence, checkContext(context, checks), checks);
    return checks.failure() ?? { status: 'valid', value: { timing: timing as NextActionTiming } };
}

export function validateAttemptLog(evidence: AttemptLogEvidence | null | undefined, context: EvidenceContext): EvidenceValidation<{ readonly successfulContact: boolean }> {
    const checks = new Checks();
    const successfulContact = checkAttempt(evidence, checkContext(context, checks), checks);
    return checks.failure() ?? { status: 'valid', value: { successfulContact } };
}

/** Qualification is a snapshot: later facts cannot support an earlier assessment.
 * The future next-action due date is intentionally not part of this ordering.
 */
function checkSnapshotOrder(qualification: RecordValue, checks: Checks) {
    const assessmentOccurred = parseEvidenceTimestamp(qualification.occurredAt);
    const assessmentRecorded = parseEvidenceTimestamp(qualification.recordedAt);
    for (const field of ['contact', 'loanReadiness', 'nextAction'] as const) {
        const evidence = qualification[field];
        if (!isRecord(evidence)) continue;
        const occurred = parseEvidenceTimestamp(evidence.occurredAt);
        const recorded = parseEvidenceTimestamp(evidence.recordedAt);
        if (occurred !== null && assessmentOccurred !== null && occurred > assessmentOccurred) checks.bad('TIME_ORDER', `${field}.occurredAt`);
        if (recorded !== null && assessmentRecorded !== null && recorded > assessmentRecorded) checks.bad('TIME_ORDER', `${field}.recordedAt`);
    }
}

export function evaluateQualification(evidence: QualificationEvidence | null | undefined, context: EvidenceContext): QualificationAssessment {
    const checks = new Checks();
    const checkedContext = checkContext(context, checks);
    const qualification = checkRecorded(evidence, 'qualification', checkedContext, checks);
    if (!qualification) return checks.failure()!;
    const successfulContact = checkAttempt(qualification.contact, checkedContext, checks);
    if (!successfulContact) checks.need('CONTACT_NOT_SUCCESSFUL', 'contact');
    if (qualification.genuineInterest !== true) {
        if (qualification.genuineInterest === false || absent(qualification.genuineInterest)) checks.need('INTEREST_NOT_CONFIRMED', 'qualification.genuineInterest');
        else checks.bad('INVALID_VALUE', 'qualification.genuineInterest');
    }
    for (const field of ['projectName', 'needs'] as const) {
        if (hasControls(qualification[field]) || (!absent(qualification[field]) && typeof qualification[field] !== 'string')) checks.bad('INVALID_VALUE', `qualification.${field}`);
    }
    if (!nonBlank(qualification.projectName) && !nonBlank(qualification.needs)) checks.need('NEEDS_NOT_KNOWN', 'qualification.needs');
    const budgetKnown = typeof qualification.budget === 'number' && Number.isFinite(qualification.budget) && qualification.budget > 0;
    if (!absent(qualification.budget) && (typeof qualification.budget !== 'number' || !Number.isFinite(qualification.budget) || qualification.budget < 0)) {
        checks.bad('INVALID_VALUE', 'qualification.budget');
    }
    let loanKnown = false;
    if (qualification.loanReadiness !== null && qualification.loanReadiness !== undefined) {
        const loan = checkRecorded(qualification.loanReadiness, 'loanReadiness', checkedContext, checks);
        if (loan) {
            if (loan.state === 'known') { checks.text(loan.summary, 'loanReadiness.summary'); loanKnown = nonBlank(loan.summary); }
            else if (absent(loan.state)) checks.need('MISSING_EVIDENCE', 'loanReadiness.state');
            else if (loan.state !== 'unknown') checks.bad('INVALID_VALUE', 'loanReadiness.state');
            if (loan.state !== 'known' && loan.summary !== null && loan.summary !== undefined
                && (typeof loan.summary !== 'string' || hasControls(loan.summary))) checks.bad('INVALID_VALUE', 'loanReadiness.summary');
        }
    }
    if (!budgetKnown && !loanKnown) checks.need('FINANCE_NOT_KNOWN', 'qualification.budgetOrLoanReadiness');
    const stage = checks.record(qualification.stage, 'qualification.stage');
    if (stage) {
        checks.text(stage.code, 'qualification.stage.code');
        if (stage.activity === 'inactive' || stage.activity === 'unknown' || absent(stage.activity)) checks.need('INACTIVE_STAGE', 'qualification.stage.activity');
        else if (stage.activity !== 'active') checks.bad('INVALID_VALUE', 'qualification.stage.activity');
    }
    const timing = checkNextAction(qualification.nextAction, checkedContext, checks);
    checkSnapshotOrder(qualification, checks);
    return checks.failure() ?? {
        status: 'qualified', qualificationEvidenceId: qualification.id as string,
        contactEvidenceId: (qualification.contact as AttemptLogEvidence).id, nextActionTiming: timing as NextActionTiming,
    };
}
