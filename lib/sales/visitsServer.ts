/** Caller-JWT only. No service key, browser table writer or legacy fallback. */
import { createClient } from '@supabase/supabase-js';
import { visitWorkflowReleaseAllowed } from './releaseScope';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { VISITS_CONTRACT_VERSION, VISITS_MAX_BYTES, VisitsInputError, parseVisitsInput, parseVisitsQuery, parseVisitsResult, parseVisitsSnapshot } from './visitsContracts';

export function visitsEnabled(): boolean {
  return visitWorkflowReleaseAllowed() && ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_VISITS_ENABLED'].every(key => process.env[key] === 'true');
}
const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ยังไม่เปิดนัดหมายและเข้าชมส่วนกลาง', SETUP_REQUIRED: 'งานเข้าชมยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'เฉพาะ Sales เจ้าของงานหรือ Admin ที่บันทึกได้', NOT_FOUND: 'ไม่พบลูกค้าหรือรายการในโครงการนี้',
  INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจวันเวลาและเหตุผล', CONFLICT: 'สถานะขัดแย้ง กรุณาโหลดข้อมูลล่าสุด', STALE_STATE: 'รายการหรือผู้ดูแลเปลี่ยนแล้ว กรุณาโหลดใหม่', SCOPE_CLOSED: 'ความสนใจนี้ปิดแล้ว ไม่สามารถเพิ่มงานเข้าชมได้',
  IDEMPOTENCY_CONFLICT: 'รหัสคำขอถูกใช้กับข้อมูลอื่น ให้ Admin ตรวจสอบก่อนเริ่มคำขอใหม่',
  UNKNOWN_RESULT: 'ยังยืนยันผลบันทึกไม่ได้ ให้ตรวจซ้ำด้วยคำขอเดิม ห้ามเริ่มคำขอใหม่', READ_UNAVAILABLE: 'โหลดประวัติเข้าชมไม่ได้ กรุณาลองใหม่',
};
class HttpError extends Error { constructor(readonly status: number, readonly code: string, message = messages[code]) { super(message); } }
const fail = (status: number, code: string): never => { throw new HttpError(status, code); };
const json = (value: unknown, status: number) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
function failureResponse(error: unknown, writing: boolean) {
  const safe = error instanceof HttpError ? error : error instanceof VisitsInputError ? new HttpError(400, 'INVALID_INPUT') : new HttpError(503, writing ? 'UNKNOWN_RESULT' : 'READ_UNAVAILABLE');
  return json({ error: { code: safe.code, message: safe.message } }, safe.status);
}
function rpcError(value: unknown): never {
  let raw: Record<string, unknown> = {}; try { raw = bookingRecord(value); } catch { /* sanitize */ }
  const code = String(raw.code);
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return fail(503, 'SETUP_REQUIRED');
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return fail(401, 'UNAUTHENTICATED');
  if (code === '42501') return fail(403, 'FORBIDDEN');
  if (code === '23505') return fail(409, 'CONFLICT');
  if (['22023', '22P02', '23502', '23503', '23514'].includes(code)) return fail(400, 'INVALID_INPUT');
  const statuses: Record<string, number> = { FORBIDDEN: 403, SETUP_REQUIRED: 503, INVALID_INPUT: 400, NOT_FOUND: 404, CONFLICT: 409, STALE_STATE: 409, SCOPE_CLOSED: 409, IDEMPOTENCY_CONFLICT: 409 };
  if (code === 'P0001') for (const [marker, status] of Object.entries(statuses)) if (raw.message === `CRM_VISITS_${marker}`) return fail(status, marker);
  return fail(503, 'UNKNOWN_RESULT');
}
async function authorize(request: Request, writing: boolean) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 8192) return fail(401, 'UNAUTHENTICATED');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) return fail(503, 'SETUP_REQUIRED');
  try { if (bookingRecord(JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'))).role === 'service_role') return fail(503, 'SETUP_REQUIRED'); }
  catch (error) { if (error instanceof HttpError) throw error; }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${match[1]}` } } });
  const auth = await client.auth.getUser(match[1]);
  if (auth.error || !auth.data.user) return fail(401, 'UNAUTHENTICATED');
  let userId: string; try { userId = bookingUuid(auth.data.user.id); } catch { return fail(401, 'UNAUTHENTICATED'); }
  const role = await client.rpc('crm_v2_role'); if (role.error) rpcError(role.error);
  if (!['sales', 'admin', 'owner'].includes(role.data) || writing && role.data === 'owner') return fail(403, 'FORBIDDEN');
  const caps = await client.rpc('crm_v2_visits_capabilities'); if (caps.error) rpcError(caps.error);
  if (caps.data?.contract_version !== VISITS_CONTRACT_VERSION || caps.data?.enabled !== true) return fail(503, 'SETUP_REQUIRED');
  return { client, actor: { userId, role: role.data as string } };
}
async function readBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'ต้องส่งข้อมูลเป็น JSON');
  const tooLarge = () => new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลเกิน 16 KB');
  if (Number(request.headers.get('content-length')) > VISITS_MAX_BYTES) throw tooLarge();
  if (!request.body) throw new VisitsInputError();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > VISITS_MAX_BYTES) { void reader.cancel().catch(() => undefined); throw tooLarge(); } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return parseVisitsInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) { if (error instanceof HttpError) throw error; throw new VisitsInputError(); }
  finally { reader.releaseLock(); }
}
export async function handleVisitsPost(request: Request) {
  try {
    if (!visitsEnabled()) return fail(503, 'FEATURE_DISABLED');
    const input = await readBody(request), { client } = await authorize(request, true), { requestId, ...payload } = input;
    const reply = await client.rpc('crm_v2_visits_command', { p_request_id: requestId, p_payload: payload }); if (reply.error) rpcError(reply.error);
    let result; try { result = parseVisitsResult(reply.data, input); } catch { return fail(503, 'UNKNOWN_RESULT'); }
    return json({ data: result }, result.replayed ? 200 : 201);
  } catch (error) { return failureResponse(error, true); }
}
export async function handleVisitsGet(request: Request) {
  try {
    if (!visitsEnabled()) return fail(503, 'FEATURE_DISABLED');
    const scope = parseVisitsQuery(request.url), { client, actor } = await authorize(request, false);
    const reply = await client.rpc('crm_v2_visits_context', { p_customer_id: scope.customerId, p_interest_id: scope.interestId,
      p_appointment_page: scope.appointmentPage, p_visit_page: scope.visitPage, p_event_page: scope.eventPage }); if (reply.error) rpcError(reply.error);
    let snapshot;
    try {
      snapshot = parseVisitsSnapshot(reply.data, scope);
      if (snapshot.actor.userId !== actor.userId || snapshot.actor.role !== actor.role) return fail(503, 'SETUP_REQUIRED');
    } catch { return fail(503, 'SETUP_REQUIRED'); }
    return json({ data: snapshot }, 200);
  } catch (error) { return failureResponse(error instanceof HttpError && error.code === 'UNKNOWN_RESULT' ? new HttpError(503, 'READ_UNAVAILABLE') : error, false); }
}
