/** Dormant HTTP adapter only: no timer, scheduler, automatic retry, direct table
 * access, browser caller or background runner. One POST invokes one bounded SQL
 * transaction; GET never processes tasks or advances the private global cursor. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import { SLA_CYCLE_CONTRACT_VERSION, SLA_CYCLE_MAX_BODY_BYTES, SLA_CYCLE_MAX_ITEMS, SlaCycleInputError,
    parseSlaCycleContext, parseSlaCycleInput, parseSlaCycleLookup, parseSlaCycleQuery, parseSlaCycleResult } from './slaCycleContracts';

class CycleHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly definitelyNotProcessed = true) { super(message); }
}
const setup = () => new CycleHttpError(503, 'SETUP_REQUIRED', 'ระบบรอบประมวลผล SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง');
const forbidden = () => new CycleHttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้นที่ใช้รอบประมวลผล SLA ได้');
const unauthorized = () => new CycleHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนใช้รอบประมวลผล SLA');
const uncertain = () => new CycleHttpError(503, 'UNKNOWN_RESULT', 'ยังยืนยันผลรอบประมวลผลไม่ได้ ให้ตรวจใบรับหรือลองด้วยรหัสคำขอเดิมเท่านั้น ห้ามสร้างรหัสใหม่', false);
const precheck = () => new CycleHttpError(503, 'PRECHECK_UNAVAILABLE', 'ตรวจความพร้อมก่อนประมวลผลไม่ได้ คำขอครั้งนี้ยังไม่ถูกส่งไปประมวลผล');
const unavailable = () => new CycleHttpError(503, 'READ_UNAVAILABLE', 'ตรวจผลรอบ SLA ไม่ได้ ยังสรุปไม่ได้ว่าคำขอเดิมบันทึกหรือไม่');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function writingEnabled() {
    return process.env.SALES_CRM_SLA_PROCESSING_ENABLED === 'true' && process.env.SALES_CRM_SLA_CYCLE_ENABLED === 'true';
}
function gate(write: boolean) {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true'
        || (write && !writingEnabled())) throw new CycleHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดระบบรอบประมวลผล SLA');
}
function assertPublicKey(key: string) {
    if (key !== key.trim() || key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (record(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof CycleHttpError) throw error; }
}
function rpcError(error: unknown, phase: 'read' | 'precheck' | 'process'): CycleHttpError {
    const code = record(error) && typeof error.code === 'string' ? error.code : '';
    const marker = record(error) && typeof error.message === 'string' ? error.message : '';
    // Only these exact cycle-function exceptions establish a known transaction
    // abort after invocation. Underlying 09 errors and all unknown/transport
    // failures remain uncertain; a later denial says nothing about an earlier call.
    if (code === 'P0001') {
        if (marker === 'CRM_SLA_CYCLE_INVALID_INPUT') return new CycleHttpError(400, 'INVALID_INPUT', 'คำขอรอบประมวลผล SLA ไม่ถูกต้อง');
        if (marker === 'CRM_SLA_CYCLE_FORBIDDEN') return forbidden();
        if (marker === 'CRM_SLA_CYCLE_SETUP_REQUIRED') return setup();
        if (marker === 'CRM_SLA_CYCLE_BUSY') return new CycleHttpError(503, 'BUSY', 'มีรอบประมวลผลกำลังทำงาน คำขอครั้งนี้ยังไม่ประมวลผล ให้คงรหัสคำขอเดิมไว้');
    }
    if (phase === 'process') return uncertain();
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    return phase === 'read' ? unavailable() : precheck();
}
async function readInput(request: Request) {
    if (new URL(request.url).search) throw new SlaCycleInputError();
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new CycleHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งคำขอรอบประมวลผลเป็น JSON');
    }
    const tooLarge = () => new CycleHttpError(413, 'PAYLOAD_TOO_LARGE', 'คำขอรอบประมวลผลมีขนาดเกิน 4 KB');
    const declared = request.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > SLA_CYCLE_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new SlaCycleInputError();
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > SLA_CYCLE_MAX_BODY_BYTES) { void reader.cancel().catch(() => undefined); throw tooLarge(); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseSlaCycleInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof CycleHttpError || error instanceof SlaCycleInputError) throw error;
        throw new SlaCycleInputError();
    } finally { reader.releaseLock(); }
}
function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
async function handle(request: Request, write: boolean): Promise<Response> {
    let processorAttempted = false;
    try {
        gate(write);
        const input = write ? await readInput(request) : parseSlaCycleQuery(request.url);
        const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
        if (!match || match[1].length > 8192) throw unauthorized();
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) throw setup();
        assertPublicKey(key);
        const token = match[1];
        const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: `Bearer ${token}` } } });
        const { data, error } = await client.auth.getUser(token);
        if (error || !data?.user || !strictUuid(data.user.id)) throw unauthorized();
        const actorId = data.user.id.toLowerCase(), phase = write ? 'precheck' : 'read';
        const { data: role, error: roleError } = await client.rpc('crm_v2_role');
        if (roleError) throw rpcError(roleError, phase);
        if (role !== 'admin') throw forbidden();
        const { data: capability, error: capabilityError } = await client.rpc('crm_v2_sla_cycle_capabilities');
        if (capabilityError) throw rpcError(capabilityError, phase);
        if (!record(capability) || capability.contract_version !== SLA_CYCLE_CONTRACT_VERSION || capability.enabled !== true
            || typeof capability.processing_enabled !== 'boolean') throw setup();
        if (!write) {
            if (input === null) return json({ data: parseSlaCycleContext({ actor: { userId: actorId, role: 'admin' },
                processingEnabled: writingEnabled() && capability.processing_enabled, maxItems: SLA_CYCLE_MAX_ITEMS }, actorId) }, 200);
            const { data: lookup, error: lookupError } = await client.rpc('crm_v2_first_contact_cycle_receipt', { p_request: input });
            if (lookupError) throw rpcError(lookupError, 'read');
            try { return json({ data: parseSlaCycleLookup(lookup, input, actorId) }, 200); } catch { throw setup(); }
        }
        if (!input || capability.processing_enabled !== true) throw setup();
        processorAttempted = true;
        const { data: receipt, error: processError } = await client.rpc('crm_v2_process_first_contact_cycle', { p_request: input });
        if (processError) throw rpcError(processError, 'process');
        try { return json({ data: parseSlaCycleResult(receipt, input, actorId) }, 200); } catch { throw uncertain(); }
    } catch (error) {
        const safe = error instanceof SlaCycleInputError && !processorAttempted
            ? new CycleHttpError(400, error.code, error.message)
            : error instanceof CycleHttpError ? error : processorAttempted ? uncertain() : write ? precheck() : unavailable();
        return json({ error: { code: safe.code, message: safe.message,
            ...(write ? { definitelyNotProcessed: safe.definitelyNotProcessed } : {}) } }, safe.status);
    }
}
export async function handleSlaCycleGet(request: Request): Promise<Response> { return handle(request, false); }
export async function handleSlaCyclePost(request: Request): Promise<Response> { return handle(request, true); }
