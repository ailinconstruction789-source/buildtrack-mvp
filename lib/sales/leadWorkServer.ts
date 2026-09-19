/** Server route only. Deliberately isolated from browser clients and legacy writes. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import {
    LEAD_WORK_CONTRACT_VERSION, LEAD_WORK_MAX_BODY_BYTES, LeadWorkInputError, parseLeadWorkInput,
    type LeadWorkResult,
} from './leadWorkContracts';
import { LEAD_WORK_READ_CONTRACT_VERSION, parseLeadWorkScopeQuery, parseLeadWorkSnapshot } from './leadWorkReadContracts';

class LeadWorkHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const setup = () => new LeadWorkHttpError(503, 'SETUP_REQUIRED', 'ระบบติดตาม Lead ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์ฐานข้อมูล');
const unavailable = () => new LeadWorkHttpError(503, 'SERVICE_UNAVAILABLE', 'ยังยืนยันผลการบันทึกไม่ได้ หากส่งซ้ำให้ใช้รหัสคำขอและข้อมูลเดิม ห้ามสร้างคำขอใหม่จนกว่าจะตรวจผลเดิม');
const readUnavailable = () => new LeadWorkHttpError(503, 'READ_UNAVAILABLE', 'โหลดรายละเอียดงานติดตามไม่ได้ กรุณาลองโหลดใหม่ภายหลัง');
const forbidden = () => new LeadWorkHttpError(403, 'FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ทำรายการติดตาม Lead นี้');
const unauthorized = () => new LeadWorkHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนใช้งานการติดตาม Lead');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStrictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;

function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}

function gate() {
    // BOTH server-side switches must be enabled before client construction or any network call.
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true') {
        throw new LeadWorkHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดการบันทึกงานติดตาม Lead ระบบเดิมยังทำงานตามปกติ');
    }
}

function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        // Decode only to REJECT privileged-key misconfiguration, never to authorize a user.
        const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (isRecord(decoded) && decoded.role === 'service_role') throw setup();
    } catch (error) {
        if (error instanceof LeadWorkHttpError) throw error;
    }
}

function rpcError(error: unknown): LeadWorkHttpError {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const marker = isRecord(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === 'P0001') {
        switch (marker) {
            case 'CRM_WORK_INVALID_INPUT': return new LeadWorkHttpError(400, 'INVALID_INPUT', 'ข้อมูลการติดตามไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
            case 'CRM_WORK_TIME_INVALID': return new LeadWorkHttpError(400, 'TIME_INVALID', 'วันเวลาของงานไม่สอดคล้องกับหลักฐานหรือเวลาปัจจุบัน กรุณาตรวจสอบ');
            case 'CRM_WORK_STALE_ACTION': return new LeadWorkHttpError(409, 'STALE_ACTION', 'งานถัดไปเปลี่ยนแปลงแล้ว กรุณาโหลดสถานะล่าสุดก่อนทำรายการ');
            case 'CRM_WORK_FORBIDDEN': return forbidden();
            case 'CRM_WORK_SETUP_REQUIRED': return setup();
            case 'CRM_WORK_NOT_FOUND': return new LeadWorkHttpError(404, 'NOT_FOUND', 'ไม่พบลูกค้าหรือขอบเขตงานที่ระบุ');
            case 'CRM_WORK_IDEMPOTENCY_CONFLICT': return new LeadWorkHttpError(409, 'IDEMPOTENCY_CONFLICT', 'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาให้ Admin ตรวจผลคำขอเดิมก่อนเริ่มใหม่');
            case 'CRM_WORK_SCOPE_CLOSED': return new LeadWorkHttpError(409, 'SCOPE_CLOSED', 'ขอบเขตงานนี้ปิดแล้ว ไม่สามารถเพิ่มการติดตามตามปกติได้');
            case 'CRM_WORK_INACTIVE_OWNER': return new LeadWorkHttpError(409, 'INACTIVE_OWNER', 'ผู้ดูแลงานยังไม่ใช่ Sales ที่ใช้งานอยู่ กรุณาให้ Admin ตรวจสอบ');
        }
    }
    if (['22023', '22P02', '23502', '23503', '23514'].includes(code)) return new LeadWorkHttpError(400, 'INVALID_INPUT', 'ข้อมูลการติดตามไม่ถูกต้องหรือข้อมูลอ้างอิงมีการเปลี่ยนแปลง');
    if (code === '23505') return new LeadWorkHttpError(409, 'CONFLICT', 'ข้อมูลขัดแย้งกับรายการเดิม กรุณาตรวจผลคำขอเดิมก่อนทำรายการใหม่');
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    return unavailable();
}

async function authorize(request: Request, writing = true) {
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > 8192) throw unauthorized();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw setup();
    assertPublicKey(key);
    const token = match[1];
    const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user || !isStrictUuid(authData.user.id)) throw unauthorized();
    const { data: role, error: roleError } = await client.rpc('crm_v2_role');
    if (roleError) throw rpcError(roleError);
    // Never trust metadata or posted roles. Current ownership is checked again by the command RPC.
    if (role !== 'sales' && role !== 'admin' && role !== 'owner') throw forbidden();
    if (writing && role === 'owner') throw forbidden();
    const { data: capabilities, error: capabilityError } = await client.rpc('crm_v2_lead_work_capabilities');
    if (capabilityError) throw rpcError(capabilityError);
    if (!isRecord(capabilities) || capabilities.contract_version !== LEAD_WORK_CONTRACT_VERSION || capabilities.enabled !== true) throw setup();
    if (!writing && capabilities.read_contract_version !== LEAD_WORK_READ_CONTRACT_VERSION) throw setup();
    return { client, actor: { userId: authData.user.id.toLowerCase(), role } };
}

async function readInput(request: Request) {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new LeadWorkHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งข้อมูลการติดตามเป็น JSON');
    }
    const tooLarge = () => new LeadWorkHttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลคำขอมีขนาดเกิน 16 KB');
    const lengthHeader = request.headers.get('content-length');
    if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > LEAD_WORK_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new LeadWorkInputError('ไม่พบข้อมูลการติดตามที่ต้องการบันทึก');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > LEAD_WORK_MAX_BODY_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw tooLarge();
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseLeadWorkInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof LeadWorkHttpError || error instanceof LeadWorkInputError) throw error;
        throw new LeadWorkInputError('อ่านข้อมูล JSON ไม่ได้ กรุณาตรวจสอบคำขอ');
    } finally {
        reader.releaseLock();
    }
}

export async function handleLeadWorkPost(request: Request): Promise<Response> {
    try {
        gate();
        const input = await readInput(request);
        const { client } = await authorize(request);
        const { requestId, ...payload } = input;
        const { data, error } = await client.rpc('crm_v2_record_lead_work', { p_request_id: requestId, p_payload: payload });
        if (error) throw rpcError(error);
        // A successful RPC can already have committed. Never generate a new key or
        // retry with different data merely because its response could not be verified.
        if (!isRecord(data) || !isStrictUuid(data.nextActionId) || typeof data.replayed !== 'boolean'
            || (input.command === 'set_next_action' ? data.activityId !== null : !isStrictUuid(data.activityId))) throw unavailable();
        const result: LeadWorkResult = {
            nextActionId: data.nextActionId.toLowerCase(),
            activityId: typeof data.activityId === 'string' ? data.activityId.toLowerCase() : null,
            replayed: data.replayed,
        };
        return json({ data: result }, result.replayed ? 200 : 201);
    } catch (error) {
        if (error instanceof LeadWorkInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof LeadWorkHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}

export async function handleLeadWorkGet(request: Request): Promise<Response> {
    try {
        gate();
        const scope = parseLeadWorkScopeQuery(request.url);
        const { client, actor } = await authorize(request, false);
        const { data, error } = await client.rpc('crm_v2_lead_work_snapshot', { p_customer_id: scope.customerId, p_interest_id: scope.interestId });
        if (error) throw rpcError(error);
        let snapshot;
        try { snapshot = parseLeadWorkSnapshot(data, scope); } catch { throw setup(); }
        if (snapshot.actor.userId !== actor.userId || snapshot.actor.role !== actor.role) throw setup();
        return json({ data: snapshot }, 200);
    } catch (error) {
        if (error instanceof LeadWorkInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        // Read failures must not claim that any write may have occurred.
        const safe = error instanceof LeadWorkHttpError && error.code !== 'SERVICE_UNAVAILABLE' ? error : readUnavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
