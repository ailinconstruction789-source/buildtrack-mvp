import { isCentralUuid } from './centralContracts';
import { parseLeadLifecycleInput, type LeadLifecycleInput } from './leadLifecycleContracts';

export interface LeadLifecyclePendingScope { readonly customerId: string; readonly interestId: string | null }
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:lead-lifecycle-pending:v1';
const guidance = 'ตรวจหรือเก็บคำขอเปลี่ยนแปลง Lead ค้างไม่ได้อย่างปลอดภัย กรุณาให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่';

export class LeadLifecyclePendingError extends Error {
    constructor() { super(guidance); this.name = 'LeadLifecyclePendingError'; }
}

function uuid(value: string): string {
    if (!isCentralUuid(value) || value.length !== 36) throw new LeadLifecyclePendingError();
    return value.toLowerCase();
}

export function leadLifecyclePendingKey(actorUserId: string, scope: LeadLifecyclePendingScope): string {
    return `${PREFIX}:${uuid(actorUserId)}:${uuid(scope.customerId)}:${scope.interestId === null ? 'central' : uuid(scope.interestId)}`;
}

function storageOrThrow(storage?: PendingStorage): PendingStorage {
    try { return storage ?? window.sessionStorage; } catch { throw new LeadLifecyclePendingError(); }
}

function exactInput(input: LeadLifecycleInput, actor: string, scope: LeadLifecyclePendingScope): LeadLifecycleInput {
    uuid(actor);
    const parsed = parseLeadLifecycleInput(input);
    if (parsed.customerId !== uuid(scope.customerId) || parsed.interestId !== (scope.interestId === null ? null : uuid(scope.interestId))) {
        throw new LeadLifecyclePendingError();
    }
    return parsed;
}

/** Persist only the command, never bearer tokens or a customer/work snapshot.
 * Every recovered write-ahead entry is uncertain, including interrupted first sends. */
export function readLeadLifecyclePending(actorUserId: string, scope: LeadLifecyclePendingScope, storage?: PendingStorage): LeadLifecycleInput | null {
    try {
        const raw = storageOrThrow(storage).getItem(leadLifecyclePendingKey(actorUserId, scope));
        if (raw === null) return null;
        if (raw.length > 32768) throw new LeadLifecyclePendingError();
        const envelope: unknown = JSON.parse(raw);
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new LeadLifecyclePendingError();
        const record = envelope as Record<string, unknown>;
        if (Object.keys(record).length !== 4 || record.version !== 1 || record.actorUserId !== uuid(actorUserId)
            || record.uncertain !== true || !Object.hasOwn(record, 'input')) throw new LeadLifecyclePendingError();
        return exactInput(record.input as LeadLifecycleInput, actorUserId, scope);
    } catch { throw new LeadLifecyclePendingError(); }
}

export function writeLeadLifecyclePending(actorUserId: string, scope: LeadLifecyclePendingScope, input: LeadLifecycleInput, storage?: PendingStorage): void {
    try {
        const target = storageOrThrow(storage), canonical = exactInput(input, actorUserId, scope);
        const previous = readLeadLifecyclePending(actorUserId, scope, target);
        if (previous && JSON.stringify(previous) !== JSON.stringify(canonical)) throw new LeadLifecyclePendingError();
        target.setItem(leadLifecyclePendingKey(actorUserId, scope), JSON.stringify({ version: 1, actorUserId: uuid(actorUserId), uncertain: true, input: canonical }));
        if (JSON.stringify(readLeadLifecyclePending(actorUserId, scope, target)) !== JSON.stringify(canonical)) throw new LeadLifecyclePendingError();
    } catch { throw new LeadLifecyclePendingError(); }
}

/** Delete only the verified same command, and verify deletion. Corrupt or replaced
 * entries must be reviewed, never discarded to permit another mutation. */
export function clearLeadLifecyclePending(actorUserId: string, scope: LeadLifecyclePendingScope, input: LeadLifecycleInput, storage?: PendingStorage): void {
    try {
        const target = storageOrThrow(storage), canonical = exactInput(input, actorUserId, scope);
        const previous = readLeadLifecyclePending(actorUserId, scope, target);
        if (previous && JSON.stringify(previous) !== JSON.stringify(canonical)) throw new LeadLifecyclePendingError();
        const key = leadLifecyclePendingKey(actorUserId, scope);
        target.removeItem(key);
        if (target.getItem(key) !== null) throw new LeadLifecyclePendingError();
    } catch { throw new LeadLifecyclePendingError(); }
}
