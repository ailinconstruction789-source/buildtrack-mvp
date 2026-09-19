import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import { LeadLifecycleInputError, parseLeadLifecycleInput, type LeadLifecycleInput, type LeadLifecycleResult } from './leadLifecycleContracts';
import { parseLeadLifecycleContext, parseLeadLifecycleResult, type LeadLifecycleContext } from './leadLifecycleReadContracts';
import { parseLeadWorkScopeQuery, type LeadWorkScope } from './leadWorkReadContracts';

export type { LeadLifecycleInput, LeadLifecycleResult } from './leadLifecycleContracts';
export type { LeadLifecycleContext, LeadLifecycleCandidate } from './leadLifecycleReadContracts';
export type { LeadWorkScope } from './leadWorkReadContracts';

const definitiveRejections: Readonly<Record<string, readonly number[]>> = {
    INVALID_INPUT: [400], UNAUTHENTICATED: [401], FORBIDDEN: [403], NOT_FOUND: [404],
    STALE_SCOPE: [409], STALE_ACTION: [409], SCOPE_CLOSED: [409], INACTIVE_TARGET: [409],
    BOOKING_HISTORY_EXISTS: [409], OPEN_INTERESTS: [409], UNCHANGED_OWNER: [409], ACTOR_CHANGED: [409],
    PAYLOAD_TOO_LARGE: [413], UNSUPPORTED_MEDIA_TYPE: [415], SETUP_REQUIRED: [503], FEATURE_DISABLED: [503],
};

export class LeadLifecycleApiError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'LeadLifecycleApiError'; }
    get definitelyNotSaved(): boolean { return Object.hasOwn(definitiveRejections, this.code) && definitiveRejections[this.code].includes(this.status); }
}

export interface LeadLifecycleApi {
    read(scope: LeadWorkScope): Promise<LeadLifecycleContext>;
    save(input: LeadLifecycleInput, expectedActorId: string): Promise<LeadLifecycleResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const unknownResult = (writing: boolean) => new LeadLifecycleApiError('UNKNOWN_RESULT', writing
    ? 'ยังยืนยันผลบันทึกไม่ได้ กรุณาลองใหม่ด้วยรหัสคำขอและข้อมูลเดิม ห้ามสร้างคำขอใหม่'
    : 'ตรวจสอบข้อมูลการเปลี่ยนแปลง Lead ไม่ได้ กรุณาลองโหลดใหม่');

async function request(path: string, input?: LeadLifecycleInput, expectedActorId?: string): Promise<{ data: unknown; status: number }> {
    let token: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new LeadLifecycleApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', 401);
        }
        // Bind intent to the user of this exact token. This is not authorization;
        // the server verifies JWT, active role and current scope ownership again.
        const sessionUserId = data.session.user?.id;
        if (input && (!strictUuid(expectedActorId) || !strictUuid(sessionUserId)
            || sessionUserId.toLowerCase() !== expectedActorId.toLowerCase())) {
            throw new LeadLifecycleApiError('ACTOR_CHANGED', 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป กรุณาตรวจสอบบัญชีและโหลดงานใหม่ก่อนบันทึก', 409);
        }
        token = data.session.access_token;
    } catch (error) {
        if (error instanceof LeadLifecycleApiError) throw error;
        throw new LeadLifecycleApiError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    let response: Response;
    try {
        response = await fetch(path, {
            method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
            ...(input ? { body: JSON.stringify(input) } : {}),
        });
    } catch { throw new LeadLifecycleApiError('NETWORK_ERROR', input
        ? 'การเชื่อมต่อขัดข้อง ผลบันทึกยังไม่แน่ชัด ให้ใช้รหัสคำขอและข้อมูลเดิมเมื่อลองใหม่'
        : 'โหลดข้อมูลการเปลี่ยนแปลง Lead ไม่ได้ กรุณาตรวจการเชื่อมต่อ'); }
    let envelope: unknown;
    try { envelope = await response.json(); } catch { throw unknownResult(!!input); }
    if (!isRecord(envelope)) throw unknownResult(!!input);
    if (!response.ok && !('data' in envelope) && isRecord(envelope.error)
        && typeof envelope.error.code === 'string' && envelope.error.code.length > 0 && typeof envelope.error.message === 'string') {
        throw new LeadLifecycleApiError(envelope.error.code, envelope.error.message, response.status);
    }
    if (!response.ok || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknownResult(!!input);
    return { data: envelope.data, status: response.status };
}

export const leadLifecycleApi: LeadLifecycleApi = {
    read: async scope => {
        if (!scope || !strictUuid(scope.customerId) || (scope.interestId !== null && !strictUuid(scope.interestId))) {
            throw new LeadLifecycleApiError('INVALID_INPUT', 'ขอบเขตงานไม่ถูกต้อง', 400);
        }
        const params = new URLSearchParams({ customerId: scope.customerId });
        if (scope.interestId !== null) params.set('interestId', scope.interestId);
        const path = `/api/sales-crm/lifecycle?${params}`;
        const expected = parseLeadWorkScopeQuery(`https://local.invalid${path}`);
        const response = await request(path);
        try {
            if (response.status !== 200) throw unknownResult(false);
            return parseLeadLifecycleContext(response.data, expected);
        } catch { throw unknownResult(false); }
    },
    save: async (input, expectedActorId) => {
        let normalized: LeadLifecycleInput;
        try { normalized = parseLeadLifecycleInput(input); }
        catch (error) {
            if (error instanceof LeadLifecycleInputError) throw new LeadLifecycleApiError(error.code, error.message, 400);
            throw new LeadLifecycleApiError('INVALID_INPUT', 'ข้อมูลการเปลี่ยนแปลง Lead ไม่ถูกต้อง', 400);
        }
        const response = await request('/api/sales-crm/lifecycle', normalized, expectedActorId);
        try {
            const result = parseLeadLifecycleResult(response.data, normalized);
            if (response.status !== (result.replayed ? 200 : 201)) throw unknownResult(true);
            return result;
        } catch { throw unknownResult(true); }
    },
};
