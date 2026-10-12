/** Read-only public RPC using the request's caller. Never reads private import tables. */
import { createClient } from '@supabase/supabase-js';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { historicalCustomerEvidenceEnabled } from './historicalCustomerEvidenceFlags';
import { parseHistoricalCustomerEvidenceQuery, parseHistoricalCustomerEvidenceSnapshot } from './historicalCustomerEvidenceContracts';
import { PROJECT_SALES_CONTRACT_VERSION } from './projectSalesContracts';

class ReadError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function fail(status: number, code: string): never { throw new ReadError(status, code); }
const messages: Record<string, string> = { FEATURE_DISABLED: 'ยังไม่เปิดการอ่านประวัติจากต้นทาง', INVALID_INPUT: 'รหัสหรือลำดับหน้าไม่ถูกต้อง',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'ไม่มีสิทธิ์อ่านประวัติลูกค้า', NOT_FOUND: 'ไม่พบประวัติในขอบเขตนี้',
  SETUP_REQUIRED: 'ตัวอ่านประวัติยังไม่พร้อม', READ_UNAVAILABLE: 'โหลดประวัติไม่สำเร็จ กรุณาลองใหม่', STALE_STATE: 'บัญชีหรือข้อมูลเปลี่ยนระหว่างโหลด' };
function rpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (['42883', '42P01', '42703', 'PGRST202', 'PGRST205'].includes(error.code || '') || error.message === 'CRM_CUSTOMER_HISTORY_SETUP_REQUIRED') fail(503, 'SETUP_REQUIRED');
  if (error.code === '42501' || error.message === 'CRM_CUSTOMER_HISTORY_FORBIDDEN') fail(403, 'FORBIDDEN');
  if (error.message === 'CRM_CUSTOMER_HISTORY_NOT_FOUND') fail(404, 'NOT_FOUND');
  if (['CRM_CUSTOMER_HISTORY_INVALID_INPUT', 'CRM_CUSTOMER_HISTORY_SCOPE_INVALID'].includes(error.message || '')) fail(400, 'INVALID_INPUT');
  fail(503, 'READ_UNAVAILABLE');
}
export async function handleHistoricalCustomerEvidence(request: Request): Promise<Response> {
  const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
  try {
    if (!historicalCustomerEvidenceEnabled()) fail(503, 'FEATURE_DISABLED');
    let scope; try { scope = parseHistoricalCustomerEvidenceQuery(request.url); } catch { return fail(400, 'INVALID_INPUT'); }
    const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token || token.length > 8192) fail(401, 'UNAUTHENTICATED');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || key.startsWith('sb_secret_')) fail(503, 'SETUP_REQUIRED');
    try { if (bookingRecord(JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString())).role === 'service_role') fail(503, 'SETUP_REQUIRED'); }
    catch (error) { if (error instanceof ReadError) throw error; }
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } } });
    const auth = await client.auth.getUser(token);
    if (auth.error || !auth.data.user) fail(401, 'UNAUTHENTICATED');
    const actorId = bookingUuid(auth.data.user!.id), role = await client.rpc('crm_v2_role'); rpcError(role.error);
    if (!['sales', 'admin', 'owner'].includes(role.data)) fail(403, 'FORBIDDEN');
    const caps = await client.rpc('crm_v2_project_sales_capabilities'); rpcError(caps.error);
    if (caps.data?.contract_version !== PROJECT_SALES_CONTRACT_VERSION || caps.data?.enabled !== true) fail(503, 'SETUP_REQUIRED');
    if (request.signal.aborted) fail(503, 'READ_UNAVAILABLE');
    const reply = await client.rpc('crm_v2_customer_history', { p_customer_id: scope.customerId, p_interest_id: scope.interestId, p_sale_id: scope.saleId, p_page: scope.page });
    rpcError(reply.error);
    const snapshot = parseHistoricalCustomerEvidenceSnapshot(reply.data, scope);
    if (snapshot.actor.userId !== actorId || snapshot.actor.role !== role.data) fail(409, 'STALE_STATE');
    if (request.signal.aborted) fail(503, 'READ_UNAVAILABLE');
    return json({ data: snapshot }, 200);
  } catch (error) {
    const safe = error instanceof ReadError ? error : new ReadError(503, 'READ_UNAVAILABLE');
    return json({ error: { code: safe.code, message: messages[safe.code] } }, safe.status);
  }
}
