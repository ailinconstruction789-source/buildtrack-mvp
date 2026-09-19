/** Server-only adapter: caller JWT + public key, never legacy or direct-table writes. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import {
    WORK_SCHEDULE_CONTRACT_VERSION, WORK_SCHEDULE_MAX_BODY_BYTES, WorkScheduleInputError,
    parseWorkScheduleInput, parseWorkScheduleQuery, parseWorkScheduleResult, parseWorkScheduleSnapshot,
} from './workScheduleContracts';

class WorkScheduleHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const setup = () => new WorkScheduleHttpError(503, 'SETUP_REQUIRED', 'ระบบตารางงานยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์');
const unavailable = () => new WorkScheduleHttpError(503, 'SERVICE_UNAVAILABLE', 'ยังยืนยันผลการบันทึกไม่ได้ หากส่งซ้ำให้ใช้รหัสคำขอและข้อมูลเดิม ห้ามสร้างคำขอใหม่จนกว่าจะตรวจผลเดิม');
const readUnavailable = () => new WorkScheduleHttpError(503, 'READ_UNAVAILABLE', 'โหลดตารางงานไม่ได้ กรุณาลองโหลดใหม่ภายหลัง');
const forbidden = () => new WorkScheduleHttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้นที่จัดการตารางงานได้');
const unauthorized = () => new WorkScheduleHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนจัดการตารางงาน');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function json(data: unknown, status: number) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function gate() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true') {
        throw new WorkScheduleHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดระบบจัดการตารางงาน Sales');
    }
}
function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        // Reject privileged configuration only; decoded claims never authorize users.
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (isRecord(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof WorkScheduleHttpError) throw error; }
}
function rpcError(error: unknown): WorkScheduleHttpError {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const marker = isRecord(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        switch (marker) {
            case 'CRM_SCHEDULE_INVALID_INPUT': return new WorkScheduleHttpError(400, 'INVALID_INPUT', 'ข้อมูลตารางงานไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
            case 'CRM_SCHEDULE_FORBIDDEN': return forbidden();
            case 'CRM_SCHEDULE_SETUP_REQUIRED': return setup();
            case 'CRM_SCHEDULE_NOT_FOUND': return new WorkScheduleHttpError(404, 'NOT_FOUND', 'ไม่พบ Sales หรือตารางงานที่ระบุ');
            case 'CRM_SCHEDULE_STALE_VERSION': return new WorkScheduleHttpError(409, 'STALE_VERSION', 'ตารางงานเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุดก่อนแก้ไข');
            case 'CRM_SCHEDULE_INACTIVE_TARGET': return new WorkScheduleHttpError(409, 'INACTIVE_TARGET', 'Sales ที่เลือกไม่ได้เปิดใช้งาน กรุณาตรวจสอบอีกครั้ง');
            case 'CRM_SCHEDULE_IDEMPOTENCY_CONFLICT': return new WorkScheduleHttpError(409, 'IDEMPOTENCY_CONFLICT', 'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาให้ Admin ตรวจผลคำขอเดิมก่อนเริ่มใหม่');
        }
    }
    return unavailable();
}
async function authorize(request: Request) {
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > 8192) throw unauthorized();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw setup();
    assertPublicKey(key);
    const token = match[1];
    const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user || !strictUuid(data.user.id)) throw unauthorized();
    const { data: role, error: roleError } = await client.rpc('crm_v2_role');
    if (roleError) throw rpcError(roleError);
    if (role !== 'admin') throw forbidden();
    const { data: capability, error: capabilityError } = await client.rpc('crm_v2_work_schedule_capabilities');
    if (capabilityError) throw rpcError(capabilityError);
    if (!isRecord(capability) || capability.contract_version !== WORK_SCHEDULE_CONTRACT_VERSION || capability.enabled !== true) throw setup();
    return { client, actorId: data.user.id.toLowerCase() };
}
async function readInput(request: Request) {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new WorkScheduleHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งข้อมูลตารางงานเป็น JSON');
    }
    const tooLarge = () => new WorkScheduleHttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลคำขอมีขนาดเกิน 64 KB');
    const header = request.headers.get('content-length');
    if (header && /^\d+$/.test(header) && Number(header) > WORK_SCHEDULE_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new WorkScheduleInputError('ไม่พบข้อมูลตารางงาน');
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > WORK_SCHEDULE_MAX_BODY_BYTES) { void reader.cancel().catch(() => undefined); throw tooLarge(); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseWorkScheduleInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof WorkScheduleHttpError || error instanceof WorkScheduleInputError) throw error;
        throw new WorkScheduleInputError('อ่านข้อมูล JSON ไม่ได้ กรุณาตรวจสอบคำขอ');
    } finally { reader.releaseLock(); }
}
export async function handleWorkScheduleGet(request: Request): Promise<Response> {
    try {
        gate();
        const selected = parseWorkScheduleQuery(request.url);
        const { client, actorId } = await authorize(request);
        const { data, error } = await client.rpc('crm_v2_work_schedule_snapshot', { p_sales_user_id: selected });
        if (error) throw rpcError(error);
        let snapshot;
        try { snapshot = parseWorkScheduleSnapshot(data, selected); } catch { throw setup(); }
        if (snapshot.actor.userId !== actorId) throw setup();
        return json({ data: snapshot }, 200);
    } catch (error) {
        if (error instanceof WorkScheduleInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof WorkScheduleHttpError
            && ['FEATURE_DISABLED', 'SETUP_REQUIRED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'INACTIVE_TARGET'].includes(error.code)
            ? error : readUnavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
export async function handleWorkSchedulePost(request: Request): Promise<Response> {
    try {
        gate();
        const input = await readInput(request);
        const { client } = await authorize(request);
        const { requestId, ...payload } = input;
        const { data, error } = await client.rpc('crm_v2_publish_work_schedule', { p_request_id: requestId, p_payload: payload });
        if (error) throw rpcError(error);
        let result;
        try { result = parseWorkScheduleResult(data, input); } catch { throw unavailable(); }
        return json({ data: result }, result.replayed ? 200 : 201);
    } catch (error) {
        if (error instanceof WorkScheduleInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof WorkScheduleHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
