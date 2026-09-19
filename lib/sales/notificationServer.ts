/** Server-only boundary: verified caller JWT and public key, never service-role or
 * direct-table access. This adapter does not produce or dispatch reminders.
 */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import {
    NOTIFICATION_CONTRACT_VERSION, NOTIFICATION_MAX_BODY_BYTES, NotificationInputError,
    parseNotificationQuery, parseNotificationReadInput, parseNotificationReadResult, parseNotificationSnapshot,
} from './notificationContracts';

class NotificationHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const setup = () => new NotificationHttpError(503, 'SETUP_REQUIRED', 'ระบบแจ้งเตือนยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์');
const unavailable = () => new NotificationHttpError(503, 'SERVICE_UNAVAILABLE', 'ยังยืนยันผลอ่านแล้วไม่ได้ กรุณาโหลดใหม่หรือลองซ้ำกับแจ้งเตือนรายการเดิม');
const readUnavailable = () => new NotificationHttpError(503, 'READ_UNAVAILABLE', 'โหลดแจ้งเตือนไม่ได้ กรุณาลองโหลดใหม่ภายหลัง');
const forbidden = () => new NotificationHttpError(403, 'FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบแจ้งเตือน');
const unauthorized = () => new NotificationHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนเปิดแจ้งเตือน');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function json(data: unknown, status: number) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function gate() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true') {
        throw new NotificationHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดระบบแจ้งเตือนในแอป');
    }
}
function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        // Configuration rejection only: decoded token claims never authorize a caller.
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (isRecord(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof NotificationHttpError) throw error; }
}
function rpcError(error: unknown): NotificationHttpError {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const marker = isRecord(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        switch (marker) {
            case 'CRM_NOTIFICATION_INVALID_INPUT': return new NotificationHttpError(400, 'INVALID_INPUT', 'ข้อมูลแจ้งเตือนไม่ถูกต้อง กรุณาตรวจสอบคำขอ');
            case 'CRM_NOTIFICATION_FORBIDDEN': return forbidden();
            case 'CRM_NOTIFICATION_SETUP_REQUIRED': return setup();
            case 'CRM_NOTIFICATION_NOT_AVAILABLE': return new NotificationHttpError(404, 'NOT_AVAILABLE', 'แจ้งเตือนนี้ไม่พร้อมใช้งานแล้ว กรุณาโหลดรายการใหม่');
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
    if (role !== 'sales' && role !== 'admin' && role !== 'owner') throw forbidden();
    const { data: capability, error: capabilityError } = await client.rpc('crm_v2_notifications_capabilities');
    if (capabilityError) throw rpcError(capabilityError);
    if (!isRecord(capability) || capability.contract_version !== NOTIFICATION_CONTRACT_VERSION || capability.enabled !== true) throw setup();
    return { client, actorId: data.user.id.toLowerCase(), role };
}
async function readInput(request: Request) {
    if (new URL(request.url).search) throw new NotificationInputError();
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new NotificationHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งคำขออ่านแล้วเป็น JSON');
    }
    const tooLarge = () => new NotificationHttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลคำขอมีขนาดเกิน 8 KB');
    const header = request.headers.get('content-length');
    if (header && /^\d+$/.test(header) && Number(header) > NOTIFICATION_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new NotificationInputError();
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > NOTIFICATION_MAX_BODY_BYTES) { void reader.cancel().catch(() => undefined); throw tooLarge(); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseNotificationReadInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof NotificationHttpError || error instanceof NotificationInputError) throw error;
        throw new NotificationInputError();
    } finally { reader.releaseLock(); }
}
export async function handleNotificationGet(request: Request): Promise<Response> {
    try {
        gate();
        const page = parseNotificationQuery(request.url);
        const { client, actorId, role } = await authorize(request);
        const { data, error } = await client.rpc('crm_v2_notifications_snapshot', { p_page: page });
        if (error) throw rpcError(error);
        let snapshot;
        try { snapshot = parseNotificationSnapshot(data, page, actorId, role); } catch { throw setup(); }
        return json({ data: snapshot }, 200);
    } catch (error) {
        if (error instanceof NotificationInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof NotificationHttpError
            && ['FEATURE_DISABLED', 'SETUP_REQUIRED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_AVAILABLE', 'INVALID_INPUT'].includes(error.code)
            ? error : readUnavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
export async function handleNotificationPost(request: Request): Promise<Response> {
    try {
        gate();
        const input = await readInput(request);
        const { client } = await authorize(request);
        const { data, error } = await client.rpc('crm_v2_mark_notification_read', { p_notification_id: input.notificationId });
        if (error) throw rpcError(error);
        let result;
        try { result = parseNotificationReadResult(data, input); } catch { throw unavailable(); }
        return json({ data: result }, 200);
    } catch (error) {
        if (error instanceof NotificationInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof NotificationHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
