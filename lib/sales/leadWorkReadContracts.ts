import { isCentralUuid, type CrmRole } from './centralContracts';
import { LeadWorkInputError, type LeadWorkInput, type LeadWorkResult } from './leadWorkContracts';
import { parseEvidenceTimestamp } from './leadEvidence';

export const LEAD_WORK_READ_CONTRACT_VERSION = 'lead_work_read_v2';
export interface LeadWorkScope { readonly customerId: string; readonly interestId: string | null }
export interface LeadWorkAction extends LeadWorkScope {
    readonly id: string;
    readonly ownerUserId: string;
    readonly action: string;
    readonly dueAt: string;
    readonly recordedAt: string;
    readonly status: 'open' | 'superseded' | 'cancelled';
    readonly closedAt: string | null;
    readonly closeReason: string | null;
}
export interface LeadWorkActivity extends LeadWorkScope {
    readonly id: string;
    readonly activityType: 'call' | 'chat' | 'follow_up' | 'note';
    readonly action: string | null;
    readonly channel: 'phone' | 'chat' | 'email' | 'in_person' | 'other' | null;
    readonly result: 'contact_success' | 'no_answer' | 'customer_requested_later' | 'other' | null;
    readonly occurredAt: string;
    readonly recordedAt: string;
    readonly performedByUserId: string | null;
    readonly recordedByUserId: string;
    readonly note: string | null;
}
export interface LeadWorkSnapshot {
    readonly actor: { readonly userId: string; readonly role: CrmRole };
    readonly scope: LeadWorkScope;
    readonly customer: { readonly id: string; readonly name: string; readonly phone: string | null; readonly leadCreatedAt: string | null };
    readonly projectName: string | null;
    readonly owner: { readonly userId: string; readonly displayName: string | null; readonly active: boolean };
    readonly scopeClosed: boolean;
    readonly lifecycleRevision: string;
    readonly canWrite: boolean;
    readonly asOf: string;
    readonly currentAction: LeadWorkAction | null;
    readonly actions: readonly LeadWorkAction[];
    readonly activities: readonly LeadWorkActivity[];
    readonly history: { readonly limit: 20; readonly actionsHasMore: boolean; readonly activitiesHasMore: boolean };
}

export class LeadWorkSnapshotError extends Error {
    constructor() { super('ข้อมูลรายละเอียดงานไม่ตรงกับรูปแบบหรือขอบเขตที่ร้องขอ'); this.name = 'LeadWorkSnapshotError'; }
}
const bad = (): never => { throw new LeadWorkSnapshotError(); };
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
}
function uuid(value: unknown): string { return isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad(); }
function nullableId(value: unknown): string | null { return value === null ? null : uuid(value); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : bad(); }
function text(value: unknown, nonempty = false): string {
    if (typeof value !== 'string' || (nonempty && !value.trim())) return bad();
    if (Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) return bad();
    return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || /\s/u.test(value) || Array.from(value).some(c => {
        const code = c.charCodeAt(0); return code <= 31 || (code >= 127 && code <= 159);
    }) || parseEvidenceTimestamp(value) === null) return bad();
    return value;
}
function nullableTime(value: unknown): string | null { return value === null ? null : timestamp(value); }
function instant(value: string): bigint { return parseEvidenceTimestamp(value)!; }
function scopeData(value: unknown): LeadWorkScope {
    const scope = record(value);
    return { customerId: uuid(scope.customerId), interestId: nullableId(scope.interestId) };
}
function sameScope(left: LeadWorkScope, right: LeadWorkScope): boolean {
    return left.customerId === right.customerId && left.interestId === right.interestId;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
    return typeof value === 'string' && choices.includes(value as T) ? value as T : bad();
}

export function parseLeadWorkScopeQuery(url: string): LeadWorkScope {
    try {
        const params = new URL(url).searchParams;
        if (Array.from(params.keys()).some(key => key !== 'customerId' && key !== 'interestId')
            || params.getAll('customerId').length !== 1 || params.getAll('interestId').length > 1) return bad();
        return { customerId: uuid(params.get('customerId')), interestId: params.has('interestId') ? uuid(params.get('interestId')) : null };
    } catch { throw new LeadWorkInputError('ขอบเขตลูกค้าหรือโครงการที่ร้องขอไม่ถูกต้อง'); }
}

function actionData(value: unknown, scope: LeadWorkScope, asOf: bigint): LeadWorkAction {
    const row = record(value);
    const result: LeadWorkAction = {
        ...scopeData(row), id: uuid(row.id), ownerUserId: uuid(row.ownerUserId), action: text(row.action, true),
        dueAt: timestamp(row.dueAt), recordedAt: timestamp(row.recordedAt),
        status: choice(row.status, ['open', 'superseded', 'cancelled']), closedAt: nullableTime(row.closedAt), closeReason: nullableText(row.closeReason),
    };
    if (!sameScope(result, scope) || instant(result.recordedAt) > asOf) return bad();
    if (result.status === 'open') {
        if (result.closedAt !== null || result.closeReason !== null) return bad();
    } else if (result.closedAt === null || result.closeReason === null || !result.closeReason.trim()
        || instant(result.closedAt) < instant(result.recordedAt) || instant(result.closedAt) > asOf) return bad();
    return result;
}

function activityData(value: unknown, scope: LeadWorkScope, asOf: bigint): LeadWorkActivity {
    const row = record(value);
    const result: LeadWorkActivity = {
        ...scopeData(row), id: uuid(row.id), activityType: choice(row.activityType, ['call', 'chat', 'follow_up', 'note']),
        action: nullableText(row.action), channel: row.channel === null ? null : choice(row.channel, ['phone', 'chat', 'email', 'in_person', 'other'] as const),
        result: row.result === null ? null : choice(row.result, ['contact_success', 'no_answer', 'customer_requested_later', 'other'] as const),
        occurredAt: timestamp(row.occurredAt), recordedAt: timestamp(row.recordedAt), performedByUserId: nullableId(row.performedByUserId),
        recordedByUserId: uuid(row.recordedByUserId), note: nullableText(row.note),
    };
    if (!sameScope(result, scope) || instant(result.occurredAt) > instant(result.recordedAt) || instant(result.recordedAt) > asOf) return bad();
    return result;
}

function historyRows<T extends { id: string; recordedAt: string }>(value: unknown, parse: (row: unknown) => T): T[] {
    if (!Array.isArray(value) || value.length > 20) return bad();
    const rows = value.map(parse);
    if (new Set(rows.map(row => row.id)).size !== rows.length) return bad();
    if (rows.some((row, index) => index > 0 && instant(row.recordedAt) > instant(rows[index - 1].recordedAt))) return bad();
    return rows;
}

/** Validate/projection only. This does not grant write permission or establish evidence truth. */
export function parseLeadWorkSnapshot(value: unknown, expectedScope?: LeadWorkScope): LeadWorkSnapshot {
    const root = record(value);
    const scope = scopeData(root.scope);
    if (expectedScope !== undefined && !sameScope(scope, scopeData(expectedScope))) return bad();
    const actorRow = record(root.actor);
    const actor = { userId: uuid(actorRow.userId), role: choice(actorRow.role, ['sales', 'admin', 'owner']) };
    const customerRow = record(root.customer);
    const customer = { id: uuid(customerRow.id), name: text(customerRow.name, true), phone: nullableText(customerRow.phone), leadCreatedAt: nullableTime(customerRow.leadCreatedAt) };
    if (customer.id !== scope.customerId) return bad();
    const ownerRow = record(root.owner);
    const owner = { userId: uuid(ownerRow.userId), displayName: nullableText(ownerRow.displayName), active: bool(ownerRow.active) };
    const projectName = root.projectName === null ? null : text(root.projectName, true);
    if ((scope.interestId === null) !== (projectName === null)) return bad();
    const scopeClosed = bool(root.scopeClosed);
    const lifecycleRevision = uuid(root.lifecycleRevision);
    const canWrite = bool(root.canWrite);
    if (canWrite !== (!scopeClosed && owner.active && (actor.role === 'admin' || (actor.role === 'sales' && actor.userId === owner.userId)))) return bad();
    const asOf = timestamp(root.asOf);
    const asOfTime = instant(asOf);
    const currentAction = root.currentAction === null ? null : actionData(root.currentAction, scope, asOfTime);
    if (currentAction !== null && currentAction.status !== 'open') return bad();
    const actions = historyRows(root.actions, row => actionData(row, scope, asOfTime));
    const activities = historyRows(root.activities, row => activityData(row, scope, asOfTime));
    const historyRow = record(root.history);
    if (historyRow.limit !== 20) return bad();
    const history = { limit: 20 as const, actionsHasMore: bool(historyRow.actionsHasMore), activitiesHasMore: bool(historyRow.activitiesHasMore) };
    if ((history.actionsHasMore && actions.length !== 20) || (history.activitiesHasMore && activities.length !== 20)) return bad();
    const openActions = actions.filter(action => action.status === 'open');
    if (openActions.length > 1 || openActions.some(action => action.id !== currentAction?.id)) return bad();
    if (currentAction) {
        const historical = actions.find(action => action.id === currentAction.id);
        if (!historical && !history.actionsHasMore) return bad();
        if (historical && (historical.ownerUserId !== currentAction.ownerUserId || historical.action !== currentAction.action
            || historical.status !== currentAction.status || historical.closedAt !== null || historical.closeReason !== null
            || instant(historical.dueAt) !== instant(currentAction.dueAt) || instant(historical.recordedAt) !== instant(currentAction.recordedAt))) return bad();
    }
    return { actor, scope, customer, projectName, owner, scopeClosed, lifecycleRevision, canWrite, asOf, currentAction, actions, activities, history };
}

/** A successful write can have committed even when this projection rejects its reply. */
export function parseLeadWorkResult(value: unknown, command: LeadWorkInput['command']): LeadWorkResult {
    const row = record(value);
    const nextActionId = uuid(row.nextActionId);
    const activityId = nullableId(row.activityId);
    if ((command === 'set_next_action' && activityId !== null) || (command === 'record_attempt' && activityId === null)) return bad();
    return { nextActionId, activityId, replayed: bool(row.replayed) };
}
