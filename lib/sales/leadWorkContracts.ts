import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';

export const LEAD_WORK_CONTRACT_VERSION = 'lead_work_v1';
export const LEAD_WORK_MAX_BODY_BYTES = 16 * 1024;

export interface LeadWorkNextAction {
    readonly action: string;
    readonly dueAt: string;
}

export interface LeadWorkAttempt {
    readonly action: string;
    readonly channel: 'phone' | 'chat' | 'email' | 'in_person' | 'other';
    readonly result: 'contact_success' | 'no_answer' | 'customer_requested_later' | 'other';
    readonly occurredAt: string;
}

interface LeadWorkBase {
    readonly requestId: string;
    readonly customerId: string;
    readonly interestId: string | null;
    readonly expectedActionId: string | null;
    readonly nextAction: LeadWorkNextAction;
    readonly reason: string;
}

export type LeadWorkInput =
    | (LeadWorkBase & { readonly command: 'set_next_action' })
    | (LeadWorkBase & { readonly command: 'record_attempt'; readonly attempt: LeadWorkAttempt });

export interface LeadWorkResult {
    readonly nextActionId: string;
    readonly activityId: string | null;
    readonly replayed: boolean;
}

export type LeadWorkEnvelope = { readonly data: LeadWorkResult } | { readonly error: { readonly code: string; readonly message: string } };

export class LeadWorkInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor(message = 'ข้อมูลการติดตาม Lead ไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่') {
        super(message);
        this.name = 'LeadWorkInputError';
    }
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LeadWorkInputError();
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        throw new LeadWorkInputError('ข้อมูลมีฟิลด์ไม่ครบหรือมีฟิลด์ที่ไม่อนุญาต');
    }
}

function uuid(value: unknown): string {
    if (!isCentralUuid(value) || value.length !== 36) throw new LeadWorkInputError('รหัสอ้างอิงงานไม่ถูกต้อง');
    return value.toLowerCase();
}

function nullableUuid(value: unknown): string | null {
    return value === null ? null : uuid(value);
}

function invalidTextCharacter(value: string): boolean {
    return Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        // Array.from keeps valid surrogate pairs together; a lone UTF-16 surrogate
        // is not a PostgreSQL-compatible Unicode scalar even if JSON.parse allows it.
        const loneSurrogate = character.length === 1 && code >= 0xd800 && code <= 0xdfff;
        return loneSurrogate || code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
    });
}

function line(value: unknown, maximum: number): string {
    if (typeof value !== 'string') throw new LeadWorkInputError();
    if (invalidTextCharacter(value)) throw new LeadWorkInputError('กรุณากรอกรายละเอียดเป็นข้อความบรรทัดเดียวและใช้อักขระ Unicode ที่ถูกต้อง');
    const trimmed = value.trim();
    if (!trimmed || Array.from(trimmed).length > maximum) throw new LeadWorkInputError('รายละเอียดว่างหรือยาวเกินกำหนด');
    return trimmed;
}

function timestamp(value: unknown): string {
    // Do not rely on regex "$": JavaScript allows it immediately before a final
    // line terminator. Timestamps contain neither whitespace nor control characters.
    if (typeof value !== 'string' || /\s/u.test(value) || invalidTextCharacter(value) || parseEvidenceTimestamp(value) === null) {
        throw new LeadWorkInputError('วันเวลาต้องถูกต้องและระบุเขตเวลาชัดเจน');
    }
    // Keep all supplied microseconds/offset. Trusted current-time checks belong to SQL.
    return value;
}

/** Shape validation only: the RPC must derive actor/owner, scope authorization,
 * current state, trusted time and expectedActionId concurrency from database state.
 */
export function parseLeadWorkInput(value: unknown): LeadWorkInput {
    const input = record(value);
    if (input.command !== 'set_next_action' && input.command !== 'record_attempt') throw new LeadWorkInputError('คำสั่งติดตาม Lead ไม่ถูกต้อง');
    const baseKeys = ['requestId', 'command', 'customerId', 'interestId', 'expectedActionId', 'nextAction', 'reason'];
    exactKeys(input, input.command === 'record_attempt' ? [...baseKeys, 'attempt'] : baseKeys);
    const next = record(input.nextAction);
    exactKeys(next, ['action', 'dueAt']);
    const base: LeadWorkBase = {
        requestId: uuid(input.requestId), customerId: uuid(input.customerId), interestId: nullableUuid(input.interestId),
        expectedActionId: nullableUuid(input.expectedActionId), reason: line(input.reason, 1000),
        nextAction: { action: line(next.action, 500), dueAt: timestamp(next.dueAt) },
    };
    if (input.command === 'set_next_action') return { ...base, command: input.command };
    const attempt = record(input.attempt);
    exactKeys(attempt, ['action', 'channel', 'result', 'occurredAt']);
    if (typeof attempt.channel !== 'string' || !['phone', 'chat', 'email', 'in_person', 'other'].includes(attempt.channel)
        || typeof attempt.result !== 'string' || !['contact_success', 'no_answer', 'customer_requested_later', 'other'].includes(attempt.result)) {
        throw new LeadWorkInputError('ช่องทางหรือผลการติดตามไม่ถูกต้อง');
    }
    return {
        ...base, command: input.command,
        attempt: {
            action: line(attempt.action, 500), channel: attempt.channel as LeadWorkAttempt['channel'],
            result: attempt.result as LeadWorkAttempt['result'], occurredAt: timestamp(attempt.occurredAt),
        },
    };
}
