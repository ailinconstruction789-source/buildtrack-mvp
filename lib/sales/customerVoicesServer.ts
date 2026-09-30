/** Caller-JWT staff management and anonymous bearer-capability submission. No service key. */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { visitWorkflowReleaseAllowed } from './releaseScope';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { CUSTOMER_VOICES_CONTRACT_VERSION, CUSTOMER_VOICES_MAX_BYTES, CustomerVoicesInputError,
  parseVoicePublicInput, parseVoicePublicResult, parseVoiceQuery, parseVoiceSnapshot, parseVoiceStaffInput, parseVoiceStaffResult } from './customerVoicesContracts';

export function customerVoicesEnabled(): boolean {
  return visitWorkflowReleaseAllowed() && ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_VISITS_ENABLED', 'SALES_CRM_CUSTOMER_VOICES_ENABLED'].every(key => process.env[key] === 'true');
}
const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ยังไม่เปิดแบบสอบถามผ่าน QR', SETUP_REQUIRED: 'ระบบแบบสอบถามยังไม่พร้อม กรุณาติดต่อ Sales',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'เฉพาะ Sales เจ้าของงานหรือ Admin ที่จัดการ QR ได้',
  INVALID_INPUT: 'กรุณาเลือกคะแนนทั้ง 8 ด้านและตรวจข้อมูลอีกครั้ง', NOT_FOUND: 'ไม่พบ Visit ที่ระบุ',
  STALE_STATE: 'ข้อมูลหรือ QR เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด', SCOPE_CLOSED: 'Visit นี้ไม่รับแบบสอบถามแล้ว',
  TOKEN_UNAVAILABLE: 'ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาติดต่อ Sales เพื่อขอ QR ใหม่',
  IDEMPOTENCY_CONFLICT: 'คำขอนี้ไม่ตรงกับรายการเดิม กรุณาติดต่อ Sales เพื่อตรวจสอบ',
  UNKNOWN_RESULT: 'ยังยืนยันผลไม่ได้ กรุณาตรวจซ้ำด้วยคำขอเดิม อย่าเพิ่งปิดหน้านี้', READ_UNAVAILABLE: 'โหลดข้อมูลไม่ได้ กรุณาลองใหม่',
};
class HttpError extends Error { constructor(readonly status: number, readonly code: string, message = messages[code]) { super(message); } }
const fail = (status: number, code: string): never => { throw new HttpError(status, code); };
function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Authorization' } });
}
function failure(error: unknown, writing: boolean) {
  const safe = error instanceof HttpError ? error : error instanceof CustomerVoicesInputError ? new HttpError(400, 'INVALID_INPUT')
    : new HttpError(503, writing ? 'UNKNOWN_RESULT' : 'READ_UNAVAILABLE');
  return json({ error: { code: safe.code, message: safe.message } }, safe.status);
}
function rpcError(value: unknown, publicRequest = false): never {
  let raw: Record<string, unknown> = {}; try { raw = bookingRecord(value); } catch { /* Never reflect database messages. */ }
  const code = String(raw.code);
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return fail(503, 'SETUP_REQUIRED');
  if (!publicRequest && ['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return fail(401, 'UNAUTHENTICATED');
  if (code === '42501') return fail(publicRequest ? 503 : 403, publicRequest ? 'SETUP_REQUIRED' : 'FORBIDDEN');
  if (['22023', '22P02', '23502', '23503', '23514'].includes(code)) return fail(400, 'INVALID_INPUT');
  const statuses: Record<string, number> = { FORBIDDEN: 403, SETUP_REQUIRED: 503, INVALID_INPUT: 400, NOT_FOUND: 404,
    STALE_STATE: 409, SCOPE_CLOSED: 409, TOKEN_UNAVAILABLE: 410, IDEMPOTENCY_CONFLICT: 409 };
  if (code === 'P0001') for (const [marker, status] of Object.entries(statuses)) if (raw.message === `CRM_VOICE_${marker}`) {
    if (publicRequest && ['FORBIDDEN', 'NOT_FOUND', 'STALE_STATE', 'SCOPE_CLOSED'].includes(marker)) return fail(410, 'TOKEN_UNAVAILABLE');
    return fail(status, marker);
  }
  return fail(503, 'UNKNOWN_RESULT');
}
function database(bearer?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) return fail(503, 'SETUP_REQUIRED');
  try { if (bookingRecord(JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'))).role === 'service_role') return fail(503, 'SETUP_REQUIRED'); }
  catch (error) { if (error instanceof HttpError) throw error; }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(bearer ? { global: { headers: { Authorization: `Bearer ${bearer}` } } } : {}) });
}
async function authorize(request: Request, writing: boolean) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 8192) return fail(401, 'UNAUTHENTICATED');
  const client = database(match[1]);
  const auth = await client.auth.getUser(match[1]); if (auth.error || !auth.data.user) return fail(401, 'UNAUTHENTICATED');
  let userId: string; try { userId = bookingUuid(auth.data.user.id); } catch { return fail(401, 'UNAUTHENTICATED'); }
  const role = await client.rpc('crm_v2_role'); if (role.error) rpcError(role.error);
  if (!['sales', 'admin', 'owner'].includes(role.data) || writing && role.data === 'owner') return fail(403, 'FORBIDDEN');
  const caps = await client.rpc('crm_v2_customer_voices_capabilities'); if (caps.error) rpcError(caps.error);
  if (caps.data?.contract_version !== CUSTOMER_VOICES_CONTRACT_VERSION || caps.data?.enabled !== true) return fail(503, 'SETUP_REQUIRED');
  return { client, actor: { userId, role: role.data as string } };
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'ต้องส่งข้อมูลเป็น JSON');
  const tooLarge = () => new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลเกิน 16 KB');
  if (Number(request.headers.get('content-length')) > CUSTOMER_VOICES_MAX_BYTES) throw tooLarge();
  if (!request.body) throw new CustomerVoicesInputError();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > CUSTOMER_VOICES_MAX_BYTES) { void reader.cancel().catch(() => undefined); throw tooLarge(); } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof HttpError) throw error; throw new CustomerVoicesInputError(); }
  finally { reader.releaseLock(); }
}
export async function handleCustomerVoicesGet(request: Request) {
  try {
    if (!customerVoicesEnabled()) return fail(503, 'FEATURE_DISABLED');
    const scope = parseVoiceQuery(request.url), { client, actor } = await authorize(request, false);
    const reply = await client.rpc('crm_v2_customer_voices_context', { p_customer_id: scope.customerId, p_interest_id: scope.interestId, p_visit_id: scope.visitId });
    if (reply.error) rpcError(reply.error);
    let result;
    try { result = parseVoiceSnapshot(reply.data, scope); if (result.actor.userId !== actor.userId || result.actor.role !== actor.role) return fail(503, 'SETUP_REQUIRED'); }
    catch { return fail(503, 'SETUP_REQUIRED'); }
    return json({ data: result }, 200);
  } catch (error) { return failure(error instanceof HttpError && error.code === 'UNKNOWN_RESULT' ? new HttpError(503, 'READ_UNAVAILABLE') : error, false); }
}
export async function handleCustomerVoicesPost(request: Request) {
  try {
    if (!customerVoicesEnabled()) return fail(503, 'FEATURE_DISABLED');
    const input = parseVoiceStaffInput(await body(request)), { client } = await authorize(request, true);
    const { token, requestId, ...fields } = input;
    const reply = await client.rpc('crm_v2_customer_voices_command', { p_request_id: requestId,
      p_payload: { ...fields, tokenHash: token === null ? null : createHash('sha256').update(token).digest('hex') } });
    if (reply.error) rpcError(reply.error);
    let result; try { result = parseVoiceStaffResult(reply.data, input); } catch { return fail(503, 'UNKNOWN_RESULT'); }
    return json({ data: result }, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, true); }
}
export async function handlePublicCustomerVoicePost(request: Request) {
  let writing = false;
  try {
    if (!customerVoicesEnabled()) return fail(503, 'FEATURE_DISABLED');
    // A capability is never accepted from URL/query, cookies or a staff identity.
    if (new URL(request.url).search) return fail(400, 'INVALID_INPUT');
    const input = parseVoicePublicInput(await body(request)); writing = input.command === 'submit';
    // The public RPC hashes the original capability itself. A stored hash must
    // NOT also be a usable bearer credential via direct PostgREST calls.
    const client = database();
    const reply = input.command === 'open'
      ? await client.rpc('crm_v2_customer_voice_open', { p_token: input.token })
      : await client.rpc('crm_v2_customer_voice_submit', { p_token: input.token, p_request_id: input.requestId, p_form_version: input.formVersion, p_answers: input.answers });
    if (reply.error) rpcError(reply.error, true);
    let result; try { result = parseVoicePublicResult(reply.data, input); } catch { return fail(503, writing ? 'UNKNOWN_RESULT' : 'READ_UNAVAILABLE'); }
    return json({ data: result }, 'submitted' in result && !result.replayed ? 201 : 200);
  } catch (error) { return failure(error instanceof HttpError && error.code === 'UNKNOWN_RESULT' && !writing ? new HttpError(503, 'READ_UNAVAILABLE') : error, writing); }
}
