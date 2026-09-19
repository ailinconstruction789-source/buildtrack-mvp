import { isCentralUuid } from './centralContracts';
import type { LeadLifecycleInput, LeadLifecycleResult } from './leadLifecycleContracts';
import { parseLeadWorkSnapshot, type LeadWorkScope, type LeadWorkSnapshot } from './leadWorkReadContracts';

export const LEAD_LIFECYCLE_READ_CONTRACT_VERSION = 'lead_lifecycle_read_v1';
export interface LeadLifecycleCandidate { readonly userId: string; readonly displayName: string | null }
export interface LeadLifecycleContext {
    readonly work: LeadWorkSnapshot;
    readonly candidates: readonly LeadLifecycleCandidate[];
    readonly candidatesTruncated: boolean;
    readonly canReassign: boolean;
    readonly canClose: boolean;
    readonly blockers: { readonly hasBookingHistory: boolean; readonly hasOpenInterests: boolean };
    readonly impact: { readonly openSlaCount: number; readonly pendingNotificationCount: number };
}

export class LeadLifecycleContextError extends Error {
    constructor() { super('ข้อมูลการเปลี่ยนแปลง Lead ไม่ตรงกับรูปแบบหรือขอบเขตที่ร้องขอ'); this.name = 'LeadLifecycleContextError'; }
}
const bad = (): never => { throw new LeadLifecycleContextError(); };
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
}
function uuid(value: unknown): string { return isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad(); }
function nullableUuid(value: unknown): string | null { return value === null ? null : uuid(value); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : bad(); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : bad(); }
function displayName(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) return bad();
    return value;
}

/** Projection consistency only. These flags are a snapshot for display, not write
 * authorization: the command RPC must recheck owner, revision, action and blockers.
 * Impact counts describe existing affected rows, not future notification forecasts.
 */
export function parseLeadLifecycleContext(value: unknown, expectedScope?: LeadWorkScope): LeadLifecycleContext {
    const root = record(value);
    const work = parseLeadWorkSnapshot(root.work, expectedScope);
    if (!Array.isArray(root.candidates) || root.candidates.length > 200) return bad();
    const candidates: LeadLifecycleCandidate[] = [];
    const seen = new Set<string>();
    for (const value of root.candidates) {
        const row = record(value);
        const candidate = { userId: uuid(row.userId), displayName: displayName(row.displayName) };
        if (seen.has(candidate.userId)) return bad();
        seen.add(candidate.userId); candidates.push(candidate);
    }
    const candidatesTruncated = bool(root.candidatesTruncated);
    if (candidatesTruncated && candidates.length !== 200) return bad();
    if (work.actor.role !== 'admin' && (candidates.length !== 0 || candidatesTruncated)) return bad();
    const blockerRow = record(root.blockers);
    const blockers = { hasBookingHistory: bool(blockerRow.hasBookingHistory), hasOpenInterests: bool(blockerRow.hasOpenInterests) };
    if (work.scope.interestId !== null && blockers.hasOpenInterests) return bad();
    const impactRow = record(root.impact);
    const impact = { openSlaCount: count(impactRow.openSlaCount), pendingNotificationCount: count(impactRow.pendingNotificationCount) };
    const canReassign = bool(root.canReassign), canClose = bool(root.canClose);
    const admin = work.actor.role === 'admin';
    const owns = work.actor.role === 'sales' && work.actor.userId === work.owner.userId;
    if (canReassign !== (!work.scopeClosed && admin)
        || canClose !== (!work.scopeClosed && (admin || owns) && !blockers.hasBookingHistory
            && !(work.scope.interestId === null && blockers.hasOpenInterests))) return bad();
    return { work, candidates, candidatesTruncated, canReassign, canClose, blockers, impact };
}

/** A rejected successful reply may already have committed. Callers must preserve
 * the request ID/payload rather than turning this validation error into a new save.
 */
export function parseLeadLifecycleResult(value: unknown, input: Pick<LeadLifecycleInput, 'command' | 'expectedActionId'>): LeadLifecycleResult {
    const intent = record(input);
    if (intent.command !== 'close_lost' && intent.command !== 'reassign_owner') return bad();
    const expected = nullableUuid(intent.expectedActionId);
    const row = record(value);
    const result = { revision: uuid(row.revision), nextActionId: nullableUuid(row.nextActionId), replayed: bool(row.replayed) };
    if (intent.command === 'close_lost') {
        if (result.nextActionId !== null) return bad();
    } else if (expected === null ? result.nextActionId !== null : result.nextActionId === null || result.nextActionId === expected) return bad();
    return result;
}
