import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import {
    WORK_SCHEDULE_MAX_BODY_BYTES, WorkScheduleInputError, parseWorkScheduleInput, parseWorkScheduleResult, parseWorkScheduleSnapshot,
    type WorkScheduleInput, type WorkScheduleResult, type WorkScheduleSnapshot,
} from './workScheduleContracts';
export type { WorkScheduleInput, WorkScheduleResult, WorkScheduleSnapshot } from './workScheduleContracts';

const definitiveRejections: Readonly<Record<string, readonly number[]>> = {
    INVALID_INPUT: [400], UNAUTHENTICATED: [401], FORBIDDEN: [403], NOT_FOUND: [404],
    STALE_VERSION: [409], INACTIVE_TARGET: [409], ACTOR_CHANGED: [409],
    PAYLOAD_TOO_LARGE: [413], UNSUPPORTED_MEDIA_TYPE: [415], SETUP_REQUIRED: [503], FEATURE_DISABLED: [503],
};
export class WorkScheduleApiError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'WorkScheduleApiError'; }
    get definitelyNotSaved(): boolean { return Object.hasOwn(definitiveRejections, this.code) && definitiveRejections[this.code].includes(this.status); }
}
export interface WorkScheduleApi {
    read(salesUserId: string | null): Promise<WorkScheduleSnapshot>;
    save(input: WorkScheduleInput, expectedActorId: string): Promise<WorkScheduleResult>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const unknownResult = (writing: boolean) => new WorkScheduleApiError('UNKNOWN_RESULT', writing
    ? 'ยังยืนยันผลบันทึกไม่ได้ กรุณาลองใหม่ด้วยรหัสคำขอและข้อมูลเดิม ห้ามสร้างคำขอใหม่'
    : 'ตรวจสอบข้อมูลตารางงานไม่ได้ กรุณาลองโหลดใหม่');

async function request(path: string, input?: WorkScheduleInput, expectedActorId?: string) {
    let token: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new WorkScheduleApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', 401);
        }
        // Intent binding only. The same captured session supplies both actor and
        // bearer; server-side verified Admin authority remains mandatory.
        const userId = data.session.user?.id;
        if (input && (!strictUuid(userId) || !strictUuid(expectedActorId) || userId.toLowerCase() !== expectedActorId.toLowerCase())) {
            throw new WorkScheduleApiError('ACTOR_CHANGED', 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป กรุณาตรวจบัญชีและโหลดตารางใหม่ก่อนบันทึก', 409);
        }
        token = data.session.access_token;
    } catch (error) {
        if (error instanceof WorkScheduleApiError) throw error;
        throw new WorkScheduleApiError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    let response: Response;
    try {
        response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
            ...(input ? { body: JSON.stringify(input) } : {}),
        });
    } catch { throw new WorkScheduleApiError('NETWORK_ERROR', input
        ? 'การเชื่อมต่อขัดข้อง ผลบันทึกยังไม่แน่ชัด ให้ใช้รหัสคำขอและข้อมูลเดิมเมื่อลองใหม่'
        : 'โหลดตารางงานไม่ได้ กรุณาตรวจการเชื่อมต่อ'); }
    let envelope: unknown;
    try { envelope = await response.json(); } catch { throw unknownResult(!!input); }
    if (!record(envelope)) throw unknownResult(!!input);
    if (!response.ok && !('data' in envelope) && record(envelope.error)
        && typeof envelope.error.code === 'string' && envelope.error.code.length > 0 && typeof envelope.error.message === 'string') {
        throw new WorkScheduleApiError(envelope.error.code, envelope.error.message, response.status);
    }
    if (!response.ok || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknownResult(!!input);
    return { data: envelope.data, status: response.status };
}
export const workScheduleApi: WorkScheduleApi = {
    read: async salesUserId => {
        if (salesUserId !== null && !strictUuid(salesUserId)) throw new WorkScheduleApiError('INVALID_INPUT', 'Sales ที่ร้องขอไม่ถูกต้อง', 400);
        const selected = salesUserId === null ? null : salesUserId.toLowerCase();
        const path = `/api/sales-crm/work-schedule${selected === null ? '' : `?${new URLSearchParams({ salesUserId: selected })}`}`;
        const response = await request(path);
        try {
            if (response.status !== 200) throw unknownResult(false);
            return parseWorkScheduleSnapshot(response.data, selected);
        } catch { throw unknownResult(false); }
    },
    save: async (input, expectedActorId) => {
        let normalized: WorkScheduleInput;
        try { normalized = parseWorkScheduleInput(input); }
        catch (error) {
            throw new WorkScheduleApiError('INVALID_INPUT', error instanceof WorkScheduleInputError ? error.message : 'ข้อมูลตารางงานไม่ถูกต้อง', 400);
        }
        if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > WORK_SCHEDULE_MAX_BODY_BYTES) {
            throw new WorkScheduleApiError('PAYLOAD_TOO_LARGE', 'ข้อมูลคำขอมีขนาดเกิน 64 KB', 413);
        }
        const response = await request('/api/sales-crm/work-schedule', normalized, expectedActorId);
        try {
            const result = parseWorkScheduleResult(response.data, normalized);
            if (response.status !== (result.replayed ? 200 : 201)) throw unknownResult(true);
            return result;
        } catch { throw unknownResult(true); }
    },
};
