/** Admin-only observation. No queue command, worker invocation or direct-table
 * access is allowed here; reads remain available while processing is disabled. */
import { createClient } from '@supabase/supabase-js';
import { extendedSalesReleaseAllowed } from './releaseScope';
import { isCentralUuid } from './centralContracts';
import { QUEUE_MONITOR_CONTRACT_VERSION, QueueMonitorInputError, parseQueueMonitorQuery, parseQueueMonitorSnapshot } from './queueMonitorContracts';

class QueueMonitorHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const setup = () => new QueueMonitorHttpError(503, 'SETUP_REQUIRED', 'ระบบตรวจคิวแจ้งเตือนยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง');
const forbidden = () => new QueueMonitorHttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้นที่ตรวจคิวแจ้งเตือนได้');
const unauthorized = () => new QueueMonitorHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนตรวจคิวแจ้งเตือน');
const unavailable = () => new QueueMonitorHttpError(503, 'READ_UNAVAILABLE', 'โหลดข้อมูลตรวจคิวไม่ได้ กรุณาลองใหม่ภายหลัง');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function gate() {
    if (!extendedSalesReleaseAllowed() || process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true'
        || process.env.SALES_CRM_QUEUE_MONITOR_ENABLED !== 'true') {
        throw new QueueMonitorHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดหน้าตรวจคิวแจ้งเตือน');
    }
}
function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (record(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof QueueMonitorHttpError) throw error; }
}
function rpcError(error: unknown): QueueMonitorHttpError {
    const code = record(error) && typeof error.code === 'string' ? error.code : '';
    const marker = record(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        if (marker === 'CRM_QUEUE_MONITOR_FORBIDDEN') return forbidden();
        if (marker === 'CRM_QUEUE_MONITOR_SETUP_REQUIRED') return setup();
    }
    return unavailable();
}
function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
export async function handleQueueMonitorGet(request: Request): Promise<Response> {
    try {
        gate();
        parseQueueMonitorQuery(request.url);
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
        const { data: capability, error: capabilityError } = await client.rpc('crm_v2_queue_monitor_capabilities');
        if (capabilityError) throw rpcError(capabilityError);
        if (!record(capability) || capability.contract_version !== QUEUE_MONITOR_CONTRACT_VERSION || capability.enabled !== true) throw setup();
        const { data: snapshot, error: snapshotError } = await client.rpc('crm_v2_queue_monitor_snapshot');
        if (snapshotError) throw rpcError(snapshotError);
        let result;
        try { result = parseQueueMonitorSnapshot(snapshot, actorId); } catch { throw setup(); }
        return json({ data: result }, 200);
    } catch (error) {
        if (error instanceof QueueMonitorInputError) return json({ error: { code: 'INVALID_INPUT', message: error.message } }, 400);
        const safe = error instanceof QueueMonitorHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
