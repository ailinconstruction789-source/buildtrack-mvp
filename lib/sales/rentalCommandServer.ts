/** Server-only caller JWT commands. No privileged key or legacy fallback. */
import { createClient } from '@supabase/supabase-js';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { customerDealEditEnabled } from './customerDealEditServer';
import { RENTAL_COMMAND_VERSION, RENTAL_COMMAND_MAX_BYTES, RentalCommandInputError,
  parseRentalCommandInput, parseRentalCommandQuery, parseRentalCommandResult, parseRentalCommandSnapshot } from './rentalCommandContracts';

export function rentalCommandsEnabled(): boolean { return customerDealEditEnabled() && process.env.SALES_CRM_RENTALS_ENABLED === 'true'; }
const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ยังไม่เปิดกระบวนการเช่าส่วนกลาง', SETUP_REQUIRED: 'กระบวนการเช่าส่วนกลางยังไม่พร้อม กรุณาให้ Admin ตรวจการเชื่อมข้อมูลและสิทธิ์',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'เฉพาะ Sales ผู้ดูแลโครงการ หรือ Admin ที่ดำเนินการเช่าได้',
  NOT_FOUND: 'ไม่พบลูกค้าหรือสัญญาเช่าในโครงการนี้', INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจวันเวลาและรายละเอียด',
  CONFLICT: 'สถานะหรือหลักฐานขัดแย้ง กรุณาโหลดข้อมูลล่าสุด', STALE_STATE: 'สัญญาหรือผู้ดูแลเปลี่ยนแล้ว กรุณาโหลดใหม่',
  IDEMPOTENCY_CONFLICT: 'รหัสคำขอถูกใช้กับข้อมูลอื่น ให้ Admin ตรวจสอบก่อนเริ่มคำขอใหม่',
  UNKNOWN_RESULT: 'ยังยืนยันผลบันทึกไม่ได้ ให้ตรวจซ้ำด้วยคำขอเดิม ห้ามเริ่มคำขอใหม่', READ_UNAVAILABLE: 'โหลดข้อมูลการเช่าไม่ได้ กรุณาลองใหม่',
};
class HttpError extends Error { constructor(readonly status: number, readonly code: string, message = messages[code]) { super(message); } }
const fail = (status: number, code: string): never => { throw new HttpError(status, code); };
function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function failureResponse(failure: unknown, writing: boolean) {
  const safe = failure instanceof HttpError ? failure : failure instanceof RentalCommandInputError ? new HttpError(400, 'INVALID_INPUT')
    : new HttpError(503, writing ? 'UNKNOWN_RESULT' : 'READ_UNAVAILABLE');
  return json({ error: { code: safe.code, message: safe.message } }, safe.status);
}
function rpcError(value: unknown): never {
  let raw: Record<string, unknown> = {}; try { raw = bookingRecord(value); } catch { /* sanitized below */ }
  const code = String(raw.code);
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(code)) return fail(503, 'SETUP_REQUIRED');
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return fail(401, 'UNAUTHENTICATED');
  if (code === '42501') return fail(403, 'FORBIDDEN');
  if (code === '23505') return fail(409, 'CONFLICT');
  if (['22023', '22P02', '23502', '23503', '23514'].includes(code)) return fail(400, 'INVALID_INPUT');
  const statuses: Record<string, number> = { FORBIDDEN: 403, SETUP_REQUIRED: 503, INVALID_INPUT: 400, NOT_FOUND: 404, CONFLICT: 409, STALE_STATE: 409, IDEMPOTENCY_CONFLICT: 409 };
  if (code === 'P0001') for (const [marker, status] of Object.entries(statuses)) {
    if (raw.message === `CRM_RENTAL_${marker}`) return fail(status, marker);
  }
  return fail(503, 'UNKNOWN_RESULT');
}
async function authorize(request: Request, writing: boolean) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 8192) return fail(401, 'UNAUTHENTICATED');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) return fail(503, 'SETUP_REQUIRED');
  try { if (bookingRecord(JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'))).role === 'service_role') return fail(503, 'SETUP_REQUIRED'); }
  catch (failure) { if (failure instanceof HttpError) throw failure; }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } } });
  const auth = await client.auth.getUser(match[1]);
  if (auth.error || !auth.data.user) return fail(401, 'UNAUTHENTICATED');
  let userId: string; try { userId = bookingUuid(auth.data.user.id); } catch { return fail(401, 'UNAUTHENTICATED'); }
  const role = await client.rpc('crm_v2_role'); if (role.error) rpcError(role.error);
  if (!['sales', 'admin', 'owner'].includes(role.data) || (writing && role.data === 'owner')) return fail(403, 'FORBIDDEN');
  const caps = await client.rpc('crm_v2_rental_capabilities'); if (caps.error) rpcError(caps.error);
  if (caps.data?.contract_version !== RENTAL_COMMAND_VERSION || caps.data?.enabled !== true) return fail(503, 'SETUP_REQUIRED');
  return { client, actor: { userId, role: role.data as string } };
}
async function readBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'ต้องส่งข้อมูลเป็น JSON');
  if (Number(request.headers.get('content-length')) > RENTAL_COMMAND_MAX_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลเกิน 16 KB');
  if (!request.body) throw new RentalCommandInputError();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > RENTAL_COMMAND_MAX_BYTES) { void reader.cancel().catch(() => undefined); throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลเกิน 16 KB'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseRentalCommandInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (failure) { if (failure instanceof HttpError) throw failure; throw new RentalCommandInputError(); }
  finally { reader.releaseLock(); }
}
export async function handleRentalCommandPost(request: Request) {
  try {
    if (!rentalCommandsEnabled()) return fail(503, 'FEATURE_DISABLED');
    const input = await readBody(request), { client } = await authorize(request, true);
    const { requestId, ...payload } = input;
    const reply = await client.rpc('crm_v2_rental_command', { p_request_id: requestId, p_payload: payload });
    if (reply.error) rpcError(reply.error);
    let result; try { result = parseRentalCommandResult(reply.data, input); } catch { return fail(503, 'UNKNOWN_RESULT'); }
    return json({ data: result }, result.replayed ? 200 : 201);
  } catch (failure) { return failureResponse(failure, true); }
}
export async function handleRentalCommandGet(request: Request) {
  try {
    if (!rentalCommandsEnabled()) return fail(503, 'FEATURE_DISABLED');
    const scope = parseRentalCommandQuery(request.url), { client, actor } = await authorize(request, false);
    const reply = await client.rpc('crm_v2_rental_context', { p_customer_id: scope.customerId, p_project_name: scope.projectName, p_contract_id: scope.contractId,
      p_contract_page: scope.contractPage, p_event_page: scope.eventPage, p_payment_page: scope.paymentPage, p_plot_page: scope.plotPage });
    if (reply.error) rpcError(reply.error);
    let snapshot;
    try {
      snapshot = parseRentalCommandSnapshot(reply.data, scope);
      if (snapshot.actor.userId !== actor.userId || snapshot.actor.role !== actor.role) return fail(503, 'SETUP_REQUIRED');
    } catch { return fail(503, 'SETUP_REQUIRED'); }
    return json({ data: snapshot }, 200);
  } catch (failure) {
    return failureResponse(failure instanceof HttpError && failure.code === 'UNKNOWN_RESULT' ? new HttpError(503, 'READ_UNAVAILABLE') : failure, false);
  }
}
