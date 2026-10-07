/** Read-only aggregate reports, caller JWT only. No legacy or service-role fallback. */
import { createClient } from '@supabase/supabase-js';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { SALES_REPORTS_CONTRACT_VERSION, SalesReportsInputError, parseSalesReportQuery, parseSalesReportSnapshot } from './salesReportsContracts';
import { salesReportsEnabled } from './projectSalesFlags';

const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ยังไม่เปิดรายงานจาก Lead ส่วนกลาง', SETUP_REQUIRED: 'รายงานยังไม่พร้อม กรุณาให้ Admin ตรวจการเชื่อมข้อมูลเก่าและสิทธิ์ก่อน',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'คุณไม่มีสิทธิ์ดูข้อมูลฝ่ายขาย', INVALID_INPUT: 'โครงการหรือช่วงวันที่ Lead ไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบโครงการนี้', READ_UNAVAILABLE: 'โหลดรายงานไม่ได้ กรุณาลองใหม่',
};
class ReadError extends Error { constructor(readonly status: number, readonly code: string) { super(messages[code]); } }
const fail = (status: number, code: string): never => { throw new ReadError(status, code); };
function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function rpcFailure(value: unknown): never {
  let raw: Record<string, unknown> = {}; try { raw = bookingRecord(value); } catch { /* Never expose raw error details. */ }
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(String(raw.code))) return fail(503, 'SETUP_REQUIRED');
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(String(raw.code))) return fail(401, 'UNAUTHENTICATED');
  if (raw.code === '42501') return fail(403, 'FORBIDDEN');
  if (['22023', '22P02'].includes(String(raw.code))) return fail(400, 'INVALID_INPUT');
  if (raw.code === 'P0001') {
    const statuses: Record<string, number> = { SETUP_REQUIRED: 503, FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404 };
    for (const [code, status] of Object.entries(statuses)) if (raw.message === `CRM_SALES_REPORTS_${code}`) return fail(status, code);
  }
  return fail(503, 'READ_UNAVAILABLE');
}
export async function handleSalesReportsGet(request: Request): Promise<Response> {
  try {
    if (!salesReportsEnabled()) return fail(503, 'FEATURE_DISABLED');
    const scope = parseSalesReportQuery(request.url);
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > 8192) return fail(401, 'UNAUTHENTICATED');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || key.startsWith('sb_secret_')) return fail(503, 'SETUP_REQUIRED');
    try {
      const tokenKey = bookingRecord(JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8')));
      if (tokenKey.role === 'service_role') return fail(503, 'SETUP_REQUIRED');
    } catch (failure) { if (failure instanceof ReadError) throw failure; }
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${match[1]}` } } });
    const auth = await client.auth.getUser(match[1]);
    if (auth.error || !auth.data.user) return fail(401, 'UNAUTHENTICATED');
    let actor: string; try { actor = bookingUuid(auth.data.user.id); } catch { return fail(401, 'UNAUTHENTICATED'); }
    const role = await client.rpc('crm_v2_role'); if (role.error) rpcFailure(role.error);
    if (!['sales', 'admin', 'owner'].includes(role.data)) return fail(403, 'FORBIDDEN');
    const caps = await client.rpc('crm_v2_sales_reports_capabilities'); if (caps.error) rpcFailure(caps.error);
    if (caps.data?.contract_version !== SALES_REPORTS_CONTRACT_VERSION || caps.data?.enabled !== true) return fail(503, 'SETUP_REQUIRED');
    const reply = await client.rpc('crm_v2_sales_report', { p_project_name: scope.projectName, p_from_date: scope.fromDate, p_to_date: scope.toDate });
    if (reply.error) rpcFailure(reply.error);
    let snapshot;
    try {
      snapshot = parseSalesReportSnapshot(reply.data, scope);
      if (snapshot.actor.userId !== actor || snapshot.actor.role !== role.data) return fail(503, 'SETUP_REQUIRED');
    } catch { return fail(503, 'SETUP_REQUIRED'); }
    return json({ data: snapshot }, 200);
  } catch (failure) {
    const safe = failure instanceof ReadError ? failure : failure instanceof SalesReportsInputError ? new ReadError(400, 'INVALID_INPUT') : new ReadError(503, 'READ_UNAVAILABLE');
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
