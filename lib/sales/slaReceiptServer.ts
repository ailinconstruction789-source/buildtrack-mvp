/** Read-only receipt review. The processing kill switch can remain OFF while an
 * Admin recovers a historical receipt. No processor, clock or direct-table call. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import { SLA_RECEIPT_CONTRACT_VERSION, SlaReceiptInputError, parseSlaReceiptContext, parseSlaReceiptLookup, parseSlaReceiptQuery } from './slaReceiptContracts';

class ReceiptHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const setup = () => new ReceiptHttpError(503, 'SETUP_REQUIRED', 'ระบบตรวจผล SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง');
const forbidden = () => new ReceiptHttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้นที่ตรวจผล SLA ได้');
const unauthorized = () => new ReceiptHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนตรวจผล SLA');
const unavailable = () => new ReceiptHttpError(503, 'READ_UNAVAILABLE', 'ตรวจผล SLA ไม่ได้ กรุณาลองตรวจด้วยคำขอเดิมภายหลัง ยังสรุปไม่ได้ว่าคำขอเดิมบันทึกหรือไม่');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function gate() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true') {
        throw new ReceiptHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดระบบตรวจผล SLA');
    }
}
function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (record(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof ReceiptHttpError) throw error; }
}
function rpcError(error: unknown): ReceiptHttpError {
    const code = record(error) && typeof error.code === 'string' ? error.code : '';
    const marker = record(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        if (marker === 'CRM_SLA_RECEIPT_FORBIDDEN') return forbidden();
        if (marker === 'CRM_SLA_RECEIPT_SETUP_REQUIRED') return setup();
        if (marker === 'CRM_SLA_RECEIPT_INVALID_INPUT') return new ReceiptHttpError(400, 'INVALID_INPUT', 'ข้อมูลคำขอตรวจผล SLA ไม่ถูกต้อง');
    }
    return unavailable();
}
function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
export async function handleSlaReceiptGet(request: Request): Promise<Response> {
    try {
        gate();
        const input = parseSlaReceiptQuery(request.url);
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
        if (roleError) throw rpcError(roleError);
        if (role !== 'admin') throw forbidden();
        const { data: capability, error: capabilityError } = await client.rpc('crm_v2_sla_receipt_capabilities');
        if (capabilityError) throw rpcError(capabilityError);
        if (!record(capability) || capability.contract_version !== SLA_RECEIPT_CONTRACT_VERSION || capability.enabled !== true
            || typeof capability.processing_enabled !== 'boolean') throw setup();
        if (input === null) {
            const context = parseSlaReceiptContext({ actor: { userId: actorId, role: 'admin' },
                processingEnabled: process.env.SALES_CRM_SLA_PROCESSING_ENABLED === 'true' && capability.processing_enabled }, actorId);
            return json({ data: context }, 200);
        }
        const { data: lookup, error: lookupError } = await client.rpc('crm_v2_first_contact_receipt', { p_request: input });
        if (lookupError) throw rpcError(lookupError);
        let result;
        try { result = parseSlaReceiptLookup(lookup, input, actorId); } catch { throw setup(); }
        return json({ data: result }, 200);
    } catch (error) {
        if (error instanceof SlaReceiptInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof ReceiptHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
