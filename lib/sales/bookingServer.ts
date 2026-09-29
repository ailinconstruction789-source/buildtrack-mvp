/** Server only: caller JWT, no service-role key or legacy writes/fallback. */
import { createClient } from '@supabase/supabase-js';
import { centralBookingReleaseAllowed } from './releaseScope';
import { BOOKING_CONTRACT_VERSION, BOOKING_MAX_BYTES, BookingInputError, bookingRecord, bookingUuid, parseBookingContext,
  parseBookingInput, parseBookingQuery, parseBookingResult, parseBookingSearch } from './bookingContracts';

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ระบบจองจาก Lead ส่วนกลางยังปิดอยู่', SETUP_REQUIRED: 'ยังไม่พร้อมใช้งาน กรุณาให้ Admin ตรวจฐานข้อมูลและการเปลี่ยนจากระบบเดิม',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้', NOT_FOUND: 'ไม่พบลูกค้าหรือรายการจอง',
  INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ', CONFLICT: 'ข้อมูลขัดแย้ง กรุณาโหลดข้อมูลล่าสุด',
  STALE_STATE: 'สถานะ ผู้ดูแล หรืองานถัดไปเปลี่ยนแล้ว กรุณาโหลดใหม่', PLOT_UNAVAILABLE: 'แปลงไม่ว่างหรือไม่อยู่ในโครงการนี้แล้ว',
  IDEMPOTENCY_CONFLICT: 'รหัสคำขอถูกใช้กับข้อมูลอื่น ให้ Admin ตรวจสอบก่อนเริ่มคำขอใหม่',
  DUPLICATE_REVIEW_REQUIRED: 'พบเบอร์โทรนี้แล้ว กรุณาค้นลูกค้าเดิมหรือให้ Admin ตรวจสอบ ห้ามรวมลูกค้าอัตโนมัติ',
  UNKNOWN_RESULT: 'ยังยืนยันผลบันทึกไม่ได้ ให้ลองซ้ำด้วยคำขอเดิม ห้ามเริ่มคำขอใหม่', READ_UNAVAILABLE: 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่',
};
const error = (status: number, code: string) => new HttpError(status, code, messages[code] || messages.INVALID_INPUT);
export function bookingsEnabled(): boolean {
  return centralBookingReleaseAllowed() && process.env.SALES_CRM_V2_ENABLED === 'true' && process.env.SALES_CRM_LEAD_WORK_ENABLED === 'true'
    && process.env.SALES_CRM_LIFECYCLE_ENABLED === 'true' && process.env.SALES_CRM_BOOKING_ENABLED === 'true';
}
function gate() { if (!bookingsEnabled()) throw error(503, 'FEATURE_DISABLED'); }
function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function fail(failure: unknown, writing: boolean): Response {
  const safe = failure instanceof HttpError ? failure : failure instanceof BookingInputError ? new HttpError(400, 'INVALID_INPUT', failure.message)
    : error(503, writing ? 'UNKNOWN_RESULT' : 'READ_UNAVAILABLE');
  return json({ error: { code: safe.code, message: safe.message } }, safe.status);
}
function rpcError(value: unknown): never {
  let record: Record<string, unknown> = {}; try { record = bookingRecord(value); } catch { /* sanitized below */ }
  const code = record.code, marker = record.message;
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(String(code))) throw error(503, 'SETUP_REQUIRED');
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(String(code))) throw error(401, 'UNAUTHENTICATED');
  if (code === '42501') throw error(403, 'FORBIDDEN');
  if (code === '23505') throw error(409, 'CONFLICT');
  if (['22023', '22P02', '23502', '23503', '23514'].includes(String(code))) throw error(400, 'INVALID_INPUT');
  const statuses: Record<string, number> = { FORBIDDEN: 403, SETUP_REQUIRED: 503, INVALID_INPUT: 400, NOT_FOUND: 404,
    CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, STALE_STATE: 409, PLOT_UNAVAILABLE: 409, DUPLICATE_REVIEW_REQUIRED: 409 };
  if (code === 'P0001' && typeof marker === 'string') {
    const key = marker.replace(/^CRM_BOOKING_/, '');
    if (marker === `CRM_BOOKING_${key}` && Object.hasOwn(statuses, key)) throw error(statuses[key], key);
    if (marker === 'CRM_DUPLICATE_REVIEW_REQUIRED') throw error(409, 'DUPLICATE_REVIEW_REQUIRED');
    if (marker === 'CRM_WORK_STALE_ACTION') throw error(409, 'STALE_STATE');
  }
  throw error(503, 'UNKNOWN_RESULT');
}
async function authorize(request: Request, writing: boolean) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 8192) throw error(401, 'UNAUTHENTICATED');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) throw error(503, 'SETUP_REQUIRED');
  try {
    const raw: unknown = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'));
    if (bookingRecord(raw).role === 'service_role') throw error(503, 'SETUP_REQUIRED');
  } catch (failure) { if (failure instanceof HttpError) throw failure; }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } } });
  const auth = await client.auth.getUser(match[1]);
  if (auth.error || !auth.data.user) throw error(401, 'UNAUTHENTICATED');
  let userId: string; try { userId = bookingUuid(auth.data.user.id); } catch { throw error(401, 'UNAUTHENTICATED'); }
  const role = await client.rpc('crm_v2_role'); if (role.error) rpcError(role.error);
  if (!['sales', 'admin', 'owner'].includes(role.data) || (writing && role.data === 'owner')) throw error(403, 'FORBIDDEN');
  const caps = await client.rpc('crm_v2_booking_capabilities'); if (caps.error) rpcError(caps.error);
  if (!caps.data || caps.data.contract_version !== BOOKING_CONTRACT_VERSION || caps.data.enabled !== true) throw error(503, 'SETUP_REQUIRED');
  return { client, actor: { userId, role: role.data as string } };
}
async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'ต้องส่งข้อมูลเป็น JSON');
  if (Number(request.headers.get('content-length')) > BOOKING_MAX_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลเกิน 16 KB');
  if (!request.body) throw new BookingInputError();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > BOOKING_MAX_BYTES) { void reader.cancel().catch(() => undefined); throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลเกิน 16 KB'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseBookingInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (failure) { if (failure instanceof HttpError) throw failure; throw new BookingInputError(); }
  finally { reader.releaseLock(); }
}
export async function handleBookingPost(request: Request): Promise<Response> {
  try {
    gate(); const input = await body(request); const { client, actor } = await authorize(request, true);
    if (input.command === 'book' && input.newCustomer && ((actor.role === 'sales' && input.newCustomer.assignedSalesUserId !== null)
      || (actor.role === 'admin' && input.newCustomer.assignedSalesUserId === null))) throw error(400, 'INVALID_INPUT');
    const { requestId, ...payload } = input;
    const reply = await client.rpc('crm_v2_booking_command', { p_request_id: requestId, p_payload: payload });
    if (reply.error) rpcError(reply.error);
    let result; try { result = parseBookingResult(reply.data, input); } catch { throw error(503, 'UNKNOWN_RESULT'); }
    return json({ data: result }, result.replayed ? 200 : 201);
  } catch (failure) { return fail(failure, true); }
}
export async function handleBookingGet(request: Request, search = false): Promise<Response> {
  try {
    gate(); const scope = parseBookingQuery(request.url, search); const { client, actor } = await authorize(request, false);
    const reply = search ? await client.rpc('crm_v2_booking_search', { p_query: scope.query, p_page: scope.page })
      : await client.rpc('crm_v2_booking_context', { p_customer_id: scope.customerId, p_page: scope.page });
    if (reply.error) rpcError(reply.error);
    let data;
    try {
      data = search ? parseBookingSearch(reply.data, scope.page) : parseBookingContext(reply.data, scope.customerId, scope.page);
      if ('actor' in data && (data.actor.userId !== actor.userId || data.actor.role !== actor.role)) throw new Error();
    } catch { throw error(503, 'SETUP_REQUIRED'); }
    return json({ data }, 200);
  } catch (failure) {
    return fail(failure instanceof HttpError && failure.code === 'UNKNOWN_RESULT' ? error(503, 'READ_UNAVAILABLE') : failure, false);
  }
}
