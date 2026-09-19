import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import { LeadWorkInputError, parseLeadWorkInput, type LeadWorkInput, type LeadWorkResult } from './leadWorkContracts';
import { parseLeadWorkResult, parseLeadWorkScopeQuery, parseLeadWorkSnapshot, type LeadWorkScope, type LeadWorkSnapshot } from './leadWorkReadContracts';

export type { LeadWorkScope, LeadWorkSnapshot, LeadWorkAction, LeadWorkActivity } from './leadWorkReadContracts';
export type { LeadWorkInput, LeadWorkResult } from './leadWorkContracts';

const definitiveRejections: Readonly<Record<string, readonly number[]>> = {
    INVALID_INPUT: [400], TIME_INVALID: [400], UNAUTHENTICATED: [401], FORBIDDEN: [403], NOT_FOUND: [404],
    STALE_ACTION: [409], SCOPE_CLOSED: [409], INACTIVE_OWNER: [409], CONFLICT: [409],
    ACTOR_CHANGED: [409],
    PAYLOAD_TOO_LARGE: [413], UNSUPPORTED_MEDIA_TYPE: [415], SETUP_REQUIRED: [503], FEATURE_DISABLED: [503],
};

export class LeadWorkApiError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'LeadWorkApiError'; }
    get definitelyNotSaved(): boolean { return Object.hasOwn(definitiveRejections, this.code) && definitiveRejections[this.code].includes(this.status); }
}

export interface LeadWorkApi {
    read(scope: LeadWorkScope): Promise<LeadWorkSnapshot>;
    save(input: LeadWorkInput, expectedActorId: string): Promise<LeadWorkResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknownResult = (writing: boolean) => new LeadWorkApiError('UNKNOWN_RESULT', writing
    ? 'ยังยืนยันผลบันทึกไม่ได้ กรุณาลองใหม่ด้วยรหัสคำขอและข้อมูลเดิม ห้ามสร้างคำขอใหม่'
    : 'ตรวจสอบข้อมูลรายละเอียดงานไม่ได้ กรุณาลองโหลดใหม่');

async function request(path: string, input?: LeadWorkInput, expectedActorId?: string): Promise<{ data: unknown; status: number }> {
    let token: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new LeadWorkApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', 401);
        }
        // Bind the user's write intent to the same session used for the bearer token.
        // This is not authorization; the server must still verify that token/role.
        const sessionUserId = data.session.user?.id;
        if (input && (!isCentralUuid(expectedActorId) || expectedActorId.length !== 36
            || !isCentralUuid(sessionUserId) || sessionUserId.length !== 36
            || sessionUserId.toLowerCase() !== expectedActorId.toLowerCase())) {
            throw new LeadWorkApiError('ACTOR_CHANGED', 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป กรุณาตรวจสอบบัญชีและโหลดงานใหม่ก่อนบันทึก', 409);
        }
        token = data.session.access_token;
    } catch (error) {
        if (error instanceof LeadWorkApiError) throw error;
        throw new LeadWorkApiError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    let response: Response;
    try {
        response = await fetch(path, {
            method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
            ...(input ? { body: JSON.stringify(input) } : {}),
        });
    } catch { throw new LeadWorkApiError('NETWORK_ERROR', input ? 'การเชื่อมต่อขัดข้อง ผลบันทึกยังไม่แน่ชัด ให้ใช้รหัสคำขอและข้อมูลเดิมเมื่อลองใหม่' : 'โหลดรายละเอียดงานไม่ได้ กรุณาตรวจการเชื่อมต่อ'); }
    let envelope: unknown;
    try { envelope = await response.json(); } catch { throw unknownResult(!!input); }
    if (!isRecord(envelope)) throw unknownResult(!!input);
    if (!response.ok && !('data' in envelope) && isRecord(envelope.error)
        && typeof envelope.error.code === 'string' && envelope.error.code.length > 0 && typeof envelope.error.message === 'string') {
        throw new LeadWorkApiError(envelope.error.code, envelope.error.message, response.status);
    }
    if (!response.ok || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknownResult(!!input);
    return { data: envelope.data, status: response.status };
}

export const leadWorkApi: LeadWorkApi = {
    read: async scope => {
        if (!scope || !isCentralUuid(scope.customerId) || scope.customerId.length !== 36
            || (scope.interestId !== null && (!isCentralUuid(scope.interestId) || scope.interestId.length !== 36))) {
            throw new LeadWorkApiError('INVALID_INPUT', 'ขอบเขตงานไม่ถูกต้อง', 400);
        }
        const params = new URLSearchParams({ customerId: scope.customerId });
        if (scope.interestId !== null) params.set('interestId', scope.interestId);
        const path = `/api/sales-crm/lead-work?${params}`;
        const expected = parseLeadWorkScopeQuery(`https://local.invalid${path}`);
        const result = await request(path);
        try {
            if (result.status !== 200) throw unknownResult(false);
            return parseLeadWorkSnapshot(result.data, expected);
        } catch { throw unknownResult(false); }
    },
    save: async (input, expectedActorId) => {
        let normalized: LeadWorkInput;
        try { normalized = parseLeadWorkInput(input); }
        catch (error) {
            if (error instanceof LeadWorkInputError) throw new LeadWorkApiError(error.code, error.message, 400);
            throw new LeadWorkApiError('INVALID_INPUT', 'ข้อมูลการติดตามไม่ถูกต้อง', 400);
        }
        const response = await request('/api/sales-crm/lead-work', normalized, expectedActorId);
        try {
            const result = parseLeadWorkResult(response.data, normalized.command);
            if (response.status !== (result.replayed ? 200 : 201)) throw unknownResult(true);
            return result;
        } catch { throw unknownResult(true); }
    },
};
