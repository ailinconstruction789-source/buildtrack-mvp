import { isCentralUuid } from './centralContracts';
import { parseWorkScheduleInput, WORK_SCHEDULE_MAX_BODY_BYTES, type WorkScheduleInput } from './workScheduleContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:work-schedule-pending:v1';
const guidance = 'ตรวจหรือเก็บคำขอจัดเวรค้างไม่ได้อย่างปลอดภัย กรุณาให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่สำหรับ Sales คนเดิมหรือคนอื่น';

export class WorkSchedulePendingError extends Error {
    constructor() { super(guidance); this.name = 'WorkSchedulePendingError'; }
}

function uuid(value: string): string {
    if (!isCentralUuid(value) || value.length !== 36) throw new WorkSchedulePendingError();
    return value.toLowerCase();
}

/** ONE queue per signed-in Admin across every target Sales, not a per-Sales key.
 * This is an identity namespace, not a grant of the Admin role. */
export function workSchedulePendingKey(actorId: string): string {
    return `${PREFIX}:${uuid(actorId)}`;
}

function storageOrThrow(storage?: PendingStorage): PendingStorage {
    try { return storage ?? window.sessionStorage; } catch { throw new WorkSchedulePendingError(); }
}

function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }

function parsedPayload(value: unknown): WorkScheduleInput {
    const input = parseWorkScheduleInput(value);
    if (byteLength(JSON.stringify(input)) > WORK_SCHEDULE_MAX_BODY_BYTES) throw new WorkSchedulePendingError();
    // Clone and freeze every mutable layer. A caller cannot silently alter a
    // recovered request's target/version/periods while retaining its request ID.
    return Object.freeze({ ...input, coverage: Object.freeze({ ...input.coverage }),
        periods: Object.freeze(input.periods.map(period => Object.freeze({ ...period }))) });
}

/** A recovered write-ahead receipt is ALWAYS uncertain. It stores only actor and
 * command, never a token, customer/staff display name, or fetched schedule snapshot. */
export function readWorkSchedulePending(actorId: string, storage?: PendingStorage): WorkScheduleInput | null {
    try {
        const raw = storageOrThrow(storage).getItem(workSchedulePendingKey(actorId));
        if (raw === null) return null;
        // Allow bounded envelope metadata in addition to the full API body budget.
        if (raw.length > WORK_SCHEDULE_MAX_BODY_BYTES + 1024 || byteLength(raw) > WORK_SCHEDULE_MAX_BODY_BYTES + 1024) throw new WorkSchedulePendingError();
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkSchedulePendingError();
        const envelope = value as Record<string, unknown>;
        if (Object.keys(envelope).length !== 3 || envelope.version !== 1 || envelope.actorId !== uuid(actorId)
            || !Object.hasOwn(envelope, 'payload')) throw new WorkSchedulePendingError();
        return parsedPayload(envelope.payload);
    } catch { throw new WorkSchedulePendingError(); }
}

export function writeWorkSchedulePending(actorId: string, input: WorkScheduleInput, storage?: PendingStorage): void {
    try {
        const target = storageOrThrow(storage), payload = parsedPayload(input);
        const previous = readWorkSchedulePending(actorId, target);
        if (previous && JSON.stringify(previous) !== JSON.stringify(payload)) throw new WorkSchedulePendingError();
        target.setItem(workSchedulePendingKey(actorId), JSON.stringify({ version: 1, actorId: uuid(actorId), payload }));
        if (JSON.stringify(readWorkSchedulePending(actorId, target)) !== JSON.stringify(payload)) throw new WorkSchedulePendingError();
    } catch { throw new WorkSchedulePendingError(); }
}

/** Acknowledge only the current, valid request. Missing is an idempotent no-op;
 * another request or a corrupt queue is never removed. Verify actual removal. */
export function clearWorkSchedulePending(actorId: string, expectedRequestId: string, storage?: PendingStorage): void {
    try {
        const target = storageOrThrow(storage), expected = uuid(expectedRequestId);
        const previous = readWorkSchedulePending(actorId, target);
        if (previous && previous.requestId !== expected) throw new WorkSchedulePendingError();
        const key = workSchedulePendingKey(actorId);
        target.removeItem(key);
        if (target.getItem(key) !== null) throw new WorkSchedulePendingError();
    } catch { throw new WorkSchedulePendingError(); }
}
