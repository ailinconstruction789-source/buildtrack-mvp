import { isCentralUuid } from './centralContracts';
import { parseLeadWorkInput, type LeadWorkInput } from './leadWorkContracts';

export interface LeadWorkPendingScope { readonly customerId: string; readonly interestId: string | null }
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:lead-work-pending:v1';
const guidance = 'ไม่สามารถตรวจหรือเก็บคำขอค้างได้อย่างปลอดภัย กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่';

export class LeadWorkPendingError extends Error {
    constructor() { super(guidance); this.name = 'LeadWorkPendingError'; }
}

function uuid(value: string): string {
    if (!isCentralUuid(value) || value.length !== 36) throw new LeadWorkPendingError();
    return value.toLowerCase();
}

export function leadWorkPendingKey(actorUserId: string, scope: LeadWorkPendingScope): string {
    return `${PREFIX}:${uuid(actorUserId)}:${uuid(scope.customerId)}:${scope.interestId === null ? 'central' : uuid(scope.interestId)}`;
}

function storageOrThrow(storage?: PendingStorage): PendingStorage {
    try { return storage ?? window.sessionStorage; } catch { throw new LeadWorkPendingError(); }
}

function exactInput(input: LeadWorkInput, actor: string, scope: LeadWorkPendingScope): LeadWorkInput {
    uuid(actor);
    const parsed = parseLeadWorkInput(input);
    if (parsed.customerId !== uuid(scope.customerId) || parsed.interestId !== (scope.interestId === null ? null : uuid(scope.interestId))) {
        throw new LeadWorkPendingError();
    }
    return parsed;
}

/** Only the command is persisted: no token, customer name/phone, or snapshot. A
 * recovered write-ahead entry is ALWAYS uncertain, even if the tab closed before send. */
export function readLeadWorkPending(actorUserId: string, scope: LeadWorkPendingScope, storage?: PendingStorage): LeadWorkInput | null {
    try {
        const raw = storageOrThrow(storage).getItem(leadWorkPendingKey(actorUserId, scope));
        if (raw === null) return null;
        if (raw.length > 32768) throw new LeadWorkPendingError();
        const envelope: unknown = JSON.parse(raw);
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new LeadWorkPendingError();
        const record = envelope as Record<string, unknown>;
        if (Object.keys(record).length !== 4 || record.version !== 1 || record.actorUserId !== uuid(actorUserId)
            || record.uncertain !== true || !Object.hasOwn(record, 'input')) throw new LeadWorkPendingError();
        return exactInput(record.input as LeadWorkInput, actorUserId, scope);
    } catch { throw new LeadWorkPendingError(); }
}

export function writeLeadWorkPending(actorUserId: string, scope: LeadWorkPendingScope, input: LeadWorkInput, storage?: PendingStorage): void {
    try {
        const target = storageOrThrow(storage);
        const canonical = exactInput(input, actorUserId, scope);
        const previous = readLeadWorkPending(actorUserId, scope, target);
        if (previous && JSON.stringify(previous) !== JSON.stringify(canonical)) throw new LeadWorkPendingError();
        const key = leadWorkPendingKey(actorUserId, scope);
        target.setItem(key, JSON.stringify({ version: 1, actorUserId: uuid(actorUserId), uncertain: true, input: canonical }));
        const recovered = readLeadWorkPending(actorUserId, scope, target);
        if (JSON.stringify(recovered) !== JSON.stringify(canonical)) throw new LeadWorkPendingError();
    } catch { throw new LeadWorkPendingError(); }
}

/** Remove only our verified command. Never discard a mismatched/corrupt receipt. */
export function clearLeadWorkPending(actorUserId: string, scope: LeadWorkPendingScope, input: LeadWorkInput, storage?: PendingStorage): void {
    try {
        const target = storageOrThrow(storage);
        const previous = readLeadWorkPending(actorUserId, scope, target);
        if (previous && JSON.stringify(previous) !== JSON.stringify(exactInput(input, actorUserId, scope))) throw new LeadWorkPendingError();
        const key = leadWorkPendingKey(actorUserId, scope);
        target.removeItem(key);
        if (target.getItem(key) !== null) throw new LeadWorkPendingError();
    } catch { throw new LeadWorkPendingError(); }
}
