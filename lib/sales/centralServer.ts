/** Server route helpers only. Do not import this module into a client component. */
import { createClient } from '@supabase/supabase-js';
import {
    CENTRAL_CONTRACT_VERSION, CENTRAL_MAX_BODY_BYTES, CENTRAL_PAGE_SIZE,
    CentralInputError, isCentralUuid, parseCentralCreateInput, parseCentralPage,
    type CentralCreateResult, type CentralSnapshot, type CrmRole,
} from './centralContracts';

class CentralHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const setupRequired = () => new CentralHttpError(503, 'SETUP_REQUIRED', 'Lead ส่วนกลางยังไม่พร้อมใช้งาน กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์ฐานข้อมูล');
const unavailable = () => new CentralHttpError(503, 'SERVICE_UNAVAILABLE', 'ระบบ Lead ส่วนกลางไม่พร้อมชั่วคราว กรุณาลองใหม่ภายหลัง');
const forbidden = () => new CentralHttpError(403, 'FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ Lead ส่วนกลาง');
const unauthorized = () => new CentralHttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่ก่อนใช้งาน Lead ส่วนกลาง');

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' },
    });
}

function errorResponse(error: unknown): Response {
    if (error instanceof CentralInputError) return json({ error: { code: error.code, message: error.message } }, 400);
    const safe = error instanceof CentralHttpError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRole(value: unknown): value is CrmRole {
    return value === 'sales' || value === 'admin' || value === 'owner';
}

function gate() {
    // This guard intentionally precedes client construction, authentication, and all RPC calls.
    if (process.env.SALES_CRM_V2_ENABLED !== 'true') {
        throw new CentralHttpError(503, 'FEATURE_DISABLED', 'Lead ส่วนกลางยังปิดใช้งานอยู่ ระบบเดิมยังทำงานตามปกติ');
    }
}

function assertPublicKey(key: string) {
    // Reject a accidentally configured privileged key. Decoding here only rejects
    // misconfiguration; it is NEVER a source of user identity or authorization.
    if (key.startsWith('sb_secret_')) throw setupRequired();
    const payload = key.split('.')[1];
    if (!payload) return;
    try {
        const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (isRecord(decoded) && decoded.role === 'service_role') throw setupRequired();
    } catch (error) {
        if (error instanceof CentralHttpError) throw error;
    }
}

function rpcError(error: unknown): CentralHttpError {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const marker = isRecord(error) && typeof error.message === 'string' ? error.message : '';
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return setupRequired();
    if (code === 'P0001') {
        switch (marker) {
            case 'CRM_DUPLICATE_REVIEW_REQUIRED':
                return new CentralHttpError(409, 'DUPLICATE_REVIEW_REQUIRED', 'พบเบอร์โทรนี้ในข้อมูลเดิม กรุณาให้ Admin ตรวจสอบก่อนสร้าง Lead ใหม่');
            case 'CRM_PLOT_UNAVAILABLE':
                return new CentralHttpError(409, 'PLOT_UNAVAILABLE', 'แปลงที่เลือกไม่ว่างหรือไม่อยู่ในโครงการนี้ กรุณาเลือกใหม่');
            case 'CRM_IDEMPOTENCY_CONFLICT':
                return new CentralHttpError(409, 'IDEMPOTENCY_CONFLICT', 'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาให้ Admin ตรวจผลคำขอเดิมก่อนเริ่มใหม่');
            case 'CRM_INVALID_INPUT':
                return new CentralHttpError(400, 'INVALID_INPUT', 'ข้อมูล Lead ไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่');
            case 'CRM_SALES_OWNER_REQUIRED':
                return new CentralHttpError(400, 'SALES_OWNER_REQUIRED', 'กรุณาเลือกผู้ดูแลที่เป็น Sales และยังใช้งานอยู่');
            case 'CRM_FORBIDDEN': return forbidden();
            case 'CRM_SETUP_REQUIRED': return setupRequired();
        }
    }
    if (code === '23505') return new CentralHttpError(409, 'CONFLICT', 'ข้อมูลขัดแย้งกับรายการที่มีอยู่ กรุณาตรวจสอบก่อนบันทึกใหม่');
    if (['22023', '22P02', '23502', '23503', '23514'].includes(code)) {
        return new CentralHttpError(400, 'INVALID_INPUT', 'ข้อมูล Lead ไม่ถูกต้องหรือมีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง');
    }
    if (code === '42501') return forbidden();
    if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') return unauthorized();
    return unavailable();
}

async function authorize(request: Request, writing: boolean) {
    const authorization = request.headers.get('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > 8192) throw unauthorized();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw setupRequired();
    assertPublicKey(key);
    const token = match[1];
    // Each request gets a separate anonymous client carrying only the caller's JWT.
    // Never import the browser singleton or a service-role client here.
    const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user || !isCentralUuid(authData.user.id)) throw unauthorized();
    const { data: role, error: roleError } = await client.rpc('crm_v2_role');
    if (roleError) throw rpcError(roleError);
    // user_metadata and app_metadata are deliberately never read for permissions.
    if (!isRole(role) || (writing && role === 'owner')) throw forbidden();
    const { data: capabilities, error: capabilityError } = await client.rpc('crm_v2_capabilities');
    if (capabilityError) throw rpcError(capabilityError);
    if (!isRecord(capabilities) || capabilities.contract_version !== CENTRAL_CONTRACT_VERSION || capabilities.enabled !== true) throw setupRequired();
    return { client, actor: { userId: authData.user.id, role } };
}

async function readInput(request: Request) {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new CentralHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาส่งข้อมูลเป็น JSON');
    }
    const tooLarge = () => new CentralHttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลคำขอมีขนาดเกิน 16 KB กรุณาลดรายละเอียด');
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > CENTRAL_MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) throw new CentralInputError('ไม่พบข้อมูล Lead ที่ต้องการบันทึก');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > CENTRAL_MAX_BODY_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw tooLarge();
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return parseCentralCreateInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
        if (error instanceof CentralHttpError || error instanceof CentralInputError) throw error;
        throw new CentralInputError('อ่านข้อมูล JSON ไม่ได้ กรุณาตรวจสอบแล้วลองใหม่');
    } finally {
        reader.releaseLock();
    }
}

function textField(value: unknown): string {
    if (typeof value !== 'string') throw setupRequired();
    return value;
}

function nullableText(value: unknown): string | null {
    return value === null ? null : textField(value);
}

function idField(value: unknown): string {
    if (!isCentralUuid(value)) throw setupRequired();
    return value;
}

/** Explicit projection avoids returning unexpected database fields to the browser. */
function snapshotData(value: unknown, actor: CentralSnapshot['actor'], page: number): CentralSnapshot {
    if (!isRecord(value) || !isRecord(value.actor) || value.actor.userId !== actor.userId || value.actor.role !== actor.role
        || !Array.isArray(value.projects) || !Array.isArray(value.salesOwners) || !Array.isArray(value.customers)
        || value.customers.length > CENTRAL_PAGE_SIZE || value.page !== page || typeof value.hasMore !== 'boolean') throw setupRequired();
    return {
        actor,
        page,
        hasMore: value.hasMore,
        projects: value.projects.map(project => {
            if (!isRecord(project)) throw setupRequired();
            return { name: textField(project.name) };
        }),
        salesOwners: value.salesOwners.map(owner => {
            if (!isRecord(owner)) throw setupRequired();
            return { userId: idField(owner.userId), displayName: textField(owner.displayName) };
        }),
        customers: value.customers.map(customer => {
            if (!isRecord(customer) || !Array.isArray(customer.interests)) throw setupRequired();
            return {
                id: idField(customer.id), name: textField(customer.name), phone: nullableText(customer.phone),
                channel: nullableText(customer.channel), notes: nullableText(customer.notes), ownerUserId: idField(customer.ownerUserId),
                leadCreatedAt: nullableText(customer.leadCreatedAt), intakeStatus: textField(customer.intakeStatus),
                interests: customer.interests.map(interest => {
                    if (!isRecord(interest) || (interest.workspaceState !== 'central_interest' && interest.workspaceState !== 'project_active')) throw setupRequired();
                    return {
                        id: idField(interest.id), projectName: textField(interest.projectName), ownerUserId: idField(interest.ownerUserId),
                        workspaceState: interest.workspaceState, engagementStatus: textField(interest.engagementStatus), plotId: nullableText(interest.plotId),
                    };
                }),
            };
        }),
    };
}

export async function handleCentralGet(request: Request): Promise<Response> {
    try {
        gate();
        const page = parseCentralPage(request.url);
        const { client, actor } = await authorize(request, false);
        const { data, error } = await client.rpc('crm_v2_central_snapshot', { p_page: page, p_page_size: CENTRAL_PAGE_SIZE });
        if (error) throw rpcError(error);
        return json({ data: snapshotData(data, actor, page) });
    } catch (error) { return errorResponse(error); }
}

export async function handleCentralPost(request: Request): Promise<Response> {
    try {
        gate();
        const input = await readInput(request);
        const { client, actor } = await authorize(request, true);
        if (actor.role === 'sales' && input.assignedSalesUserId !== undefined) throw forbidden();
        if (actor.role === 'admin' && input.assignedSalesUserId === undefined) {
            throw new CentralHttpError(400, 'SALES_OWNER_REQUIRED', 'Admin ต้องเลือก Sales ผู้ดูแล Lead ใหม่');
        }
        const { requestId, ...payload } = input;
        const { data, error } = await client.rpc('crm_v2_create_customer', { p_request_id: requestId, p_payload: payload });
        if (error) throw rpcError(error);
        // A successful RPC may already have committed. An invalid response must
        // retain the caller's idempotency key, not claim that nothing was saved.
        if (!isRecord(data) || !isCentralUuid(data.customerId) || typeof data.replayed !== 'boolean') throw unavailable();
        const result: CentralCreateResult = { customerId: data.customerId, replayed: data.replayed };
        return json({ data: result }, data.replayed ? 200 : 201);
    } catch (error) { return errorResponse(error); }
}
