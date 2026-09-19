import { isCentralUuid } from './centralContracts';

export const LEAD_LIFECYCLE_CONTRACT_VERSION = 'lead_lifecycle_v1';
export const LEAD_LIFECYCLE_MAX_BODY_BYTES = 16 * 1024;

interface LeadLifecycleBase {
    readonly requestId: string;
    readonly customerId: string;
    readonly interestId: string | null;
    readonly expectedRevision: string;
    readonly expectedActionId: string | null;
    readonly reason: string;
}

export type LeadLifecycleInput =
    | (LeadLifecycleBase & { readonly command: 'reassign_owner'; readonly newOwnerUserId: string })
    | (LeadLifecycleBase & { readonly command: 'close_lost' });

export interface LeadLifecycleResult {
    readonly revision: string;
    readonly nextActionId: string | null;
    readonly replayed: boolean;
}

export type LeadLifecycleEnvelope =
    | { readonly data: LeadLifecycleResult }
    | { readonly error: { readonly code: string; readonly message: string } };

export class LeadLifecycleInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor(message = 'ข้อมูลการเปลี่ยนผู้ดูแลหรือปิด Lead ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง') {
        super(message);
        this.name = 'LeadLifecycleInputError';
    }
}

function uuid(value: unknown): string {
    // The length check also rejects the final-line-terminator exception of regex "$".
    if (!isCentralUuid(value) || value.length !== 36) throw new LeadLifecycleInputError('รหัสอ้างอิง Lead ไม่ถูกต้อง');
    return value.toLowerCase();
}

function nullableUuid(value: unknown): string | null {
    return value === null ? null : uuid(value);
}

function reason(value: unknown): string {
    if (typeof value !== 'string') throw new LeadLifecycleInputError();
    const characters = Array.from(value);
    if (characters.some(character => {
        const code = character.charCodeAt(0);
        const loneSurrogate = character.length === 1 && code >= 0xd800 && code <= 0xdfff;
        return loneSurrogate || code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
    })) throw new LeadLifecycleInputError('เหตุผลต้องเป็นข้อความบรรทัดเดียวและใช้อักขระ Unicode ที่ถูกต้อง');
    const trimmed = value.trim();
    if (!trimmed || Array.from(trimmed).length > 1000) throw new LeadLifecycleInputError('กรุณาระบุเหตุผลไม่เกิน 1,000 ตัวอักษร');
    return trimmed;
}

/** Data validation only, never authorization. The server verifies the caller;
 * the RPC resolves current ownership, active target Sales, state/revision/action,
 * booking history and central/project scope from trusted database state.
 */
export function parseLeadLifecycleInput(value: unknown): LeadLifecycleInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LeadLifecycleInputError();
    const input = value as Record<string, unknown>;
    if (input.command !== 'reassign_owner' && input.command !== 'close_lost') throw new LeadLifecycleInputError('คำสั่งเปลี่ยนแปลง Lead ไม่ถูกต้อง');
    const keys = ['requestId', 'command', 'customerId', 'interestId', 'expectedRevision', 'expectedActionId', 'reason'];
    if (input.command === 'reassign_owner') keys.push('newOwnerUserId');
    if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
        throw new LeadLifecycleInputError('ข้อมูลมีฟิลด์ไม่ครบหรือมีฟิลด์ที่ไม่อนุญาต');
    }
    const base: LeadLifecycleBase = {
        requestId: uuid(input.requestId), customerId: uuid(input.customerId), interestId: nullableUuid(input.interestId),
        expectedRevision: uuid(input.expectedRevision), expectedActionId: nullableUuid(input.expectedActionId), reason: reason(input.reason),
    };
    return input.command === 'close_lost' ? { ...base, command: input.command }
        : { ...base, command: input.command, newOwnerUserId: uuid(input.newOwnerUserId) };
}
