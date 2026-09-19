/** Server adapter only. No legacy fallback, service-role client or direct table access. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import {
    LEAD_LIFECYCLE_CONTRACT_VERSION, LEAD_LIFECYCLE_MAX_BODY_BYTES, LeadLifecycleInputError,
    parseLeadLifecycleInput, type LeadLifecycleInput,
} from './leadLifecycleContracts';
import { LeadWorkInputError } from './leadWorkContracts';
import { parseLeadWorkScopeQuery } from './leadWorkReadContracts';
import { LEAD_LIFECYCLE_READ_CONTRACT_VERSION, parseLeadLifecycleContext, parseLeadLifecycleResult } from './leadLifecycleReadContracts';

class LeadLifecycleHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const setup = () => new LeadLifecycleHttpError(503, 'SETUP_REQUIRED', 'ระบบเปลี่ยนผู้ดูแลและปิด Lead ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์');
const unavailable = () => new LeadLifecycleHttpError(503, 'SERVICE_UNAVAILABLE', 'ยังยืนยันผลการบันทึกไม่ได้ หากส่งซ้ำให้ใช้รหัสคำขอและข้อมูลเดิม ห้ามสร้างคำขอใหม่จนกว่าจะตรวจผลเดิม');
const readUnavailable = () => new LeadLifecycleHttpError(503, 'READ_UNAVAILABLE', 'โหลดข้อมูลผู้ดูแลและสถานะ Lead ไม่ได้ กรุณาลองโหลดใหม่ภายหลัง');
const forbidden = () => new LeadLifecycleHttpError(403, 'FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์เปลี่ยนผู้ดูแลหรือปิด Lead ที่ระบุ');
const unauthorized = () => new LeadLifecycleHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนเปลี่ยนแปลง Lead');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStrictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;

function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}

function gate() {
    // All private server switches must be enabled before constructing a network client.
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true') {
        throw new LeadLifecycleHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดการเปลี่ยนผู้ดูแลและปิด Lead ผ่านระบบใหม่นี้');
    }
}

function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        // Decode only to reject privileged-key misconfiguration; never authorize using it.
        const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (isRecord(decoded) && decoded.role === 'service_role') throw setup();
    } catch (error) {
        if (error instanceof LeadLifecycleHttpError) throw error;
    }
}

function rpcError(error: unknown): LeadLifecycleHttpError {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const marker = isRecord(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        switch (marker) {
            case 'CRM_LIFECYCLE_INVALID_INPUT': return new LeadLifecycleHttpError(400, 'INVALID_INPUT', 'ข้อมูลการเปลี่ยนแปลง Lead ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
            case 'CRM_LIFECYCLE_FORBIDDEN': return forbidden();
            case 'CRM_LIFECYCLE_SETUP_REQUIRED': return setup();
            case 'CRM_LIFECYCLE_NOT_FOUND': return new LeadLifecycleHttpError(404, 'NOT_FOUND', 'ไม่พบลูกค้าหรือขอบเขตงานที่ระบุ');
            case 'CRM_LIFECYCLE_IDEMPOTENCY_CONFLICT': return new LeadLifecycleHttpError(409, 'IDEMPOTENCY_CONFLICT', 'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาให้ Admin ตรวจผลคำขอเดิมก่อนเริ่มใหม่');
            case 'CRM_LIFECYCLE_STALE_SCOPE': return new LeadLifecycleHttpError(409, 'STALE_SCOPE', 'ผู้ดูแลหรือสถานะ Lead เปลี่ยนแล้ว กรุณาโหลดสถานะล่าสุดก่อนทำรายการ');
            case 'CRM_LIFECYCLE_STALE_ACTION': return new LeadLifecycleHttpError(409, 'STALE_ACTION', 'งานถัดไปเปลี่ยนแล้ว กรุณาโหลดสถานะล่าสุดก่อนทำรายการ');
            case 'CRM_LIFECYCLE_SCOPE_CLOSED': return new LeadLifecycleHttpError(409, 'SCOPE_CLOSED', 'ขอบเขตงานนี้ปิดแล้ว ไม่สามารถเปลี่ยนแปลงตามคำขอได้');
            case 'CRM_LIFECYCLE_INACTIVE_TARGET': return new LeadLifecycleHttpError(409, 'INACTIVE_TARGET', 'ผู้ดูแลคนใหม่ต้องเป็น Sales ที่ใช้งานอยู่ กรุณาให้ Admin ตรวจสอบ');
            case 'CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS': return new LeadLifecycleHttpError(409, 'BOOKING_HISTORY_EXISTS', 'Lead นี้มีประวัติการจองแล้ว จึงไม่สามารถปิดเป็น Lost ก่อนจองได้');
            case 'CRM_LIFECYCLE_OPEN_INTERESTS': return new LeadLifecycleHttpError(409, 'OPEN_INTERESTS', 'ยังมีงานในโครงการที่เปิดอยู่ กรุณาตรวจแต่ละโครงการก่อนปิด Lead ส่วนกลาง');
            case 'CRM_LIFECYCLE_UNCHANGED_OWNER': return new LeadLifecycleHttpError(409, 'UNCHANGED_OWNER', 'ผู้ดูแลที่เลือกเป็นคนเดิม กรุณาตรวจสอบอีกครั้ง');
        }
    }
    // Unknown outcomes must not be advertised as definitely unsaved.
    return unavailable();
}

function readRpcError(error: unknown): LeadLifecycleHttpError {
    // The context RPC composes the shared work reader. Only its documented read
    // failures cross this boundary; never recognize work-command markers on POST.
    if (isRecord(error) && error.code === 'P0001' && typeof error.message === 'string'
        && ['CRM_WORK_INVALID_INPUT', 'CRM_WORK_FORBIDDEN', 'CRM_WORK_SETUP_REQUIRED', 'CRM_WORK_NOT_FOUND'].includes(error.message)) {
        return rpcError({ code: 'P0001', message: error.message.replace('CRM_WORK_', 'CRM_LIFECYCLE_') });
    }
    return rpcError(error);
}

async function authorize(request: Request, command?: LeadLifecycleInput['command']) {
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
    // Metadata is not authority. SQL still checks current ownership and active roles.
    if (role !== 'sales' && role !== 'admin' && role !== 'owner') throw forbidden();
    if (command !== undefined && role === 'owner') throw forbidden();
    if (command === 'reassign_owner' && role !== 'admin') throw forbidden();
    const { data: capabilities, error: capabilityError } = await client.rpc('crm_v2_lead_lifecycle_capabilities');
    if (capabilityError) throw rpcError(capabilityError);
    if (!isRecord(capabilities) || capabilities.contract_version !== LEAD_LIFECYCLE_CONTRACT_VERSION || capabilities.enabled !== true) throw setup();
    if (command === undefined && capabilities.read_contract_version !== LEAD_LIFECYCLE_READ_CONTRACT_VERSION) throw setup();
    return { client, actor: { userId: authData.user.id.toLowerCase(), role } };
}

async function readInput(request: Request): Promise<LeadLifecycleInput> {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new LeadLifecycleHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งข้อมูลการเปลี่ยนแปลง Lead เป็น JSON');
    }
    const tooLarge = () => new LeadLifecycleHttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลคำขอมีขนาดเกิน 16 KB');
    const lengthHeader = request.headers.get('content-length');
    if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > LEAD_LIFECYCLE_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new LeadLifecycleInputError('ไม่พบข้อมูลการเปลี่ยนแปลง Lead');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > LEAD_LIFECYCLE_MAX_BODY_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw tooLarge();
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseLeadLifecycleInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof LeadLifecycleHttpError || error instanceof LeadLifecycleInputError) throw error;
        throw new LeadLifecycleInputError('อ่านข้อมูล JSON ไม่ได้ กรุณาตรวจสอบคำขอ');
    } finally {
        reader.releaseLock();
    }
}

export async function handleLeadLifecyclePost(request: Request): Promise<Response> {
    try {
        gate();
        const input = await readInput(request);
        const { client } = await authorize(request, input.command);
        const { requestId, ...payload } = input;
        const { data, error } = await client.rpc('crm_v2_change_lead_lifecycle', { p_request_id: requestId, p_payload: payload });
        if (error) throw rpcError(error);
        // RPC success may already be committed. Malformed results require the same
        // request key/payload for recovery, never a new logical command or an auto retry.
        let result;
        try { result = parseLeadLifecycleResult(data, input); } catch { throw unavailable(); }
        return json({ data: result }, result.replayed ? 200 : 201);
    } catch (error) {
        if (error instanceof LeadLifecycleInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof LeadLifecycleHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}

export async function handleLeadLifecycleGet(request: Request): Promise<Response> {
    try {
        gate();
        const scope = parseLeadWorkScopeQuery(request.url);
        const { client, actor } = await authorize(request);
        const { data, error } = await client.rpc('crm_v2_lead_lifecycle_context', { p_customer_id: scope.customerId, p_interest_id: scope.interestId });
        if (error) throw readRpcError(error);
        let context;
        try { context = parseLeadLifecycleContext(data, scope); } catch { throw setup(); }
        if (context.work.actor.userId !== actor.userId || context.work.actor.role !== actor.role) throw setup();
        return json({ data: context }, 200);
    } catch (error) {
        if (error instanceof LeadWorkInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        // Reads cannot report a write outcome. Unexpected mutation-only markers are
        // incompatible read responses, not instructions to retry a saved command.
        const safe = error instanceof LeadLifecycleHttpError
            && ['FEATURE_DISABLED', 'SETUP_REQUIRED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT'].includes(error.code)
            ? error : readUnavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
