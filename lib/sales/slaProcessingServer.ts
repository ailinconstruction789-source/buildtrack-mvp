/** Local HTTP adapter for the FUTURE locked database processor. The server sends
 * only the command, never a browser/preview-derived deadline, owner or calendar.
 * No scheduler is installed and no processing happens on import or GET. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import { SLA_PROCESSING_CONTRACT_VERSION, SLA_PROCESSING_MAX_BODY_BYTES, SlaProcessingInputError,
    parseSlaProcessingInput, parseSlaProcessingResult } from './slaProcessingContracts';

class ProcessingHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly definitelyNotProcessed: boolean) { super(message); }
}
const setup = () => new ProcessingHttpError(503, 'SETUP_REQUIRED', 'ระบบประมวลผล SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง', true);
const forbidden = () => new ProcessingHttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้นที่ประมวลผล SLA ได้', true);
const unauthorized = () => new ProcessingHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนประมวลผล SLA', true);
const uncertain = () => new ProcessingHttpError(503, 'UNKNOWN_RESULT', 'ยังยืนยันผลประมวลผลไม่ได้ ให้ลองซ้ำด้วยคำขอเดิมเท่านั้น อย่าสร้างคำขอใหม่', false);
const precheck = () => new ProcessingHttpError(503, 'PRECHECK_UNAVAILABLE', 'ตรวจความพร้อมก่อนประมวลผลไม่ได้ คำขอครั้งนี้ยังไม่ถูกส่งไปประมวลผล', true);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function gate() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true'
        || process.env.SALES_CRM_SLA_PROCESSING_ENABLED !== 'true') {
        throw new ProcessingHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดระบบประมวลผล SLA', true);
    }
}
function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (record(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof ProcessingHttpError) throw error; }
}
function rpcError(error: unknown, processorAttempted: boolean): ProcessingHttpError {
    const code = record(error) && typeof error.code === 'string' ? error.code : '';
    const marker = record(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        if (marker === 'CRM_SLA_PROCESS_INVALID_INPUT') return new ProcessingHttpError(400, 'INVALID_INPUT', 'คำขอประมวลผล SLA ไม่ถูกต้อง', true);
        if (marker === 'CRM_SLA_PROCESS_FORBIDDEN') return forbidden();
        if (marker === 'CRM_SLA_PROCESS_SETUP_REQUIRED') return setup();
        if (marker === 'CRM_SLA_PROCESS_NOT_AVAILABLE') return new ProcessingHttpError(404, 'NOT_AVAILABLE', 'งานนี้ไม่พร้อมประมวลผล กรุณาตรวจรายการล่าสุด', true);
        if (marker === 'CRM_SLA_PROCESS_IDEMPOTENCY_CONFLICT') return new ProcessingHttpError(409, 'IDEMPOTENCY_CONFLICT', 'หมายเลขคำขอนี้ผูกกับข้อมูลอื่นแล้ว กรุณาให้ Admin ตรวจสอบ อย่าเปลี่ยนคำขอเพื่อข้ามข้อขัดแย้ง', true);
    }
    return processorAttempted ? uncertain() : precheck();
}
async function readInput(request: Request) {
    if (new URL(request.url).search) throw new SlaProcessingInputError();
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new ProcessingHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งคำขอประมวลผลเป็น JSON', true);
    }
    const tooLarge = () => new ProcessingHttpError(413, 'PAYLOAD_TOO_LARGE', 'คำขอประมวลผลมีขนาดเกิน 4 KB', true);
    const declared = request.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > SLA_PROCESSING_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new SlaProcessingInputError();
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > SLA_PROCESSING_MAX_BODY_BYTES) { void reader.cancel().catch(() => undefined); throw tooLarge(); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseSlaProcessingInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof ProcessingHttpError || error instanceof SlaProcessingInputError) throw error;
        throw new SlaProcessingInputError();
    } finally { reader.releaseLock(); }
}
function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
export async function handleSlaProcessingPost(request: Request): Promise<Response> {
    // Transport/malformed-success failures after this boundary are uncertain.
    // A failure before it proves only THIS attempt did not invoke the processor.
    let processorAttempted = false;
    try {
        gate();
        const input = await readInput(request);
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
        const actorId = data.user.id.toLowerCase();
        const { data: role, error: roleError } = await client.rpc('crm_v2_role');
        if (roleError) throw rpcError(roleError, false);
        if (role !== 'admin') throw forbidden();
        const { data: capability, error: capabilityError } = await client.rpc('crm_v2_sla_processing_capabilities');
        if (capabilityError) throw rpcError(capabilityError, false);
        if (!record(capability) || capability.contract_version !== SLA_PROCESSING_CONTRACT_VERSION || capability.enabled !== true) throw setup();
        processorAttempted = true;
        const { data: receipt, error: processError } = await client.rpc('crm_v2_process_first_contact', { p_request: input });
        if (processError) throw rpcError(processError, true);
        let result;
        try { result = parseSlaProcessingResult(receipt, input, actorId); } catch { throw uncertain(); }
        return json({ data: result }, 200);
    } catch (error) {
        if (error instanceof SlaProcessingInputError && !processorAttempted) {
            return json({ error: { code: error.code, message: error.message, definitelyNotProcessed: true } }, 400);
        }
        const safe = error instanceof ProcessingHttpError ? error : processorAttempted ? uncertain() : precheck();
        return json({ error: { code: safe.code, message: safe.message, definitelyNotProcessed: safe.definitelyNotProcessed } }, safe.status);
    }
}
