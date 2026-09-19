/** Read-only Admin preview. A caller JWT/public key is used for the source RPC;
 * no service-role, emitter, direct-table access or persistence is involved. */
import { createClient } from '@supabase/supabase-js';
import { isCentralUuid } from './centralContracts';
import { buildSlaPreview } from './slaPreviewEngine';
import { SLA_PREVIEW_CONTRACT_VERSION, SlaPreviewInputError, parseSlaPreviewQuery, parseSlaPreviewSnapshot, parseSlaPreviewSource } from './slaPreviewContracts';

class PreviewHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const setup = () => new PreviewHttpError(503, 'SETUP_REQUIRED', 'ตัวอย่าง SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและรูปแบบข้อมูล');
const forbidden = () => new PreviewHttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้นที่ดูตัวอย่าง SLA ได้');
const unauthorized = () => new PreviewHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนดูตัวอย่าง SLA');
const unavailable = () => new PreviewHttpError(503, 'READ_UNAVAILABLE', 'โหลดตัวอย่าง SLA ไม่ได้ กรุณาลองใหม่ภายหลัง ไม่มีการเปลี่ยนข้อมูล');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
function gate() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true') {
        throw new PreviewHttpError(503, 'FEATURE_DISABLED', 'ยังไม่เปิดหน้าตัวอย่าง SLA');
    }
}
function assertPublicKey(key: string) {
    if (key.startsWith('sb_secret_')) throw setup();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (record(value) && value.role === 'service_role') throw setup();
    } catch (error) { if (error instanceof PreviewHttpError) throw error; }
}
function rpcError(error: unknown): PreviewHttpError {
    const code = record(error) && typeof error.code === 'string' ? error.code : '';
    const marker = record(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setup();
    if (code === '42501') return forbidden();
    if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return unauthorized();
    if (code === 'P0001') {
        if (marker === 'CRM_SLA_PREVIEW_FORBIDDEN') return forbidden();
        if (marker === 'CRM_SLA_PREVIEW_SETUP_REQUIRED') return setup();
        if (marker === 'CRM_SLA_PREVIEW_INVALID_INPUT') return new PreviewHttpError(400, 'INVALID_INPUT', 'ข้อมูลคำขอดูตัวอย่าง SLA ไม่ถูกต้อง');
    }
    return unavailable();
}
function json(data: unknown, status: number): Response {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
export async function handleSlaPreviewGet(request: Request): Promise<Response> {
    try {
        gate();
        const page = parseSlaPreviewQuery(request.url);
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
        const { data: capability, error: capabilityError } = await client.rpc('crm_v2_sla_preview_capabilities');
        if (capabilityError) throw rpcError(capabilityError);
        if (!record(capability) || capability.contract_version !== SLA_PREVIEW_CONTRACT_VERSION || capability.enabled !== true) throw setup();
        const { data: sourceData, error: sourceError } = await client.rpc('crm_v2_sla_preview_source', { p_page: page });
        if (sourceError) throw rpcError(sourceError);
        let snapshot;
        try {
            const source = parseSlaPreviewSource(sourceData, page, actorId);
            snapshot = parseSlaPreviewSnapshot(buildSlaPreview(source), page, actorId);
        } catch { throw setup(); }
        return json({ data: snapshot }, 200);
    } catch (error) {
        if (error instanceof SlaPreviewInputError) return json({ error: { code: error.code, message: error.message } }, 400);
        const safe = error instanceof PreviewHttpError ? error : unavailable();
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
}
