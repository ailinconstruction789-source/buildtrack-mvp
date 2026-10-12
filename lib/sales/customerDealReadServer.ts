/** Exact canonical CRM context through existing authorized readers. No data mutations. */
import { createClient } from '@supabase/supabase-js';
import { bookingRecord, bookingUuid, parseBookingContext } from './bookingContracts';
import { projectSalesEnabled } from './projectSalesFlags';
import { PROJECT_SALES_CONTRACT_VERSION, parseProjectSalesSnapshot, type ProjectSaleRow } from './projectSalesContracts';
import { customerHistoryTimeline } from './customerHistory';
import { parseCustomerDealReadQuery, parseCustomerDealReadSnapshot } from './customerDealReadContracts';
import { customerDealEditEnabled } from './customerDealEditServer';
import { CUSTOMER_DEAL_EDIT_VERSION, parseCustomerDealEditSnapshot, type CustomerDealEditSnapshot } from './customerDealEditContracts';
import { historicalCustomerEvidenceEnabled } from './historicalCustomerEvidenceFlags';
import { parseHistoricalCustomerEvidenceSnapshot, type HistoricalCustomerEvidenceSnapshot } from './historicalCustomerEvidenceContracts';

const MAX_PAGES = 20; // Bounded detail lookup, never a silent truncated success.
class ReadError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function fail(status: number, code: string): never { throw new ReadError(status, code); }
const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ยังไม่เปิดการอ่านข้อมูลดีล CRM', UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'ไม่มีสิทธิ์ดูข้อมูลฝ่ายขาย', INVALID_INPUT: 'รหัสรายการหรือโครงการไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบรายการขายในโครงการนี้', SETUP_REQUIRED: 'ตัวอ่านข้อมูลลูกค้ายังไม่พร้อม',
  STALE_STATE: 'ข้อมูลดีลเปลี่ยนระหว่างโหลด กรุณาลองใหม่', READ_UNAVAILABLE: 'โหลดข้อมูลลูกค้าไม่สำเร็จ กรุณาลองใหม่',
};
function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function rpcError(error: { code?: string } | null) {
  if (!error) return;
  if (['42883','42P01','42703','PGRST202','PGRST205'].includes(error.code || '')) fail(503, 'SETUP_REQUIRED');
  if (error.code === '42501') fail(403, 'FORBIDDEN');
  fail(503, 'READ_UNAVAILABLE');
}
export async function handleCustomerDealRead(request: Request): Promise<Response> {
  try {
    if (!projectSalesEnabled()) fail(503, 'FEATURE_DISABLED');
    let scope;
    try { scope = parseCustomerDealReadQuery(request.url); } catch { return fail(400, 'INVALID_INPUT'); }
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
    const actorId = bookingUuid(auth.data.user!.id);
    const role = await client.rpc('crm_v2_role'); rpcError(role.error);
    if (!['sales','admin','owner'].includes(role.data)) fail(403, 'FORBIDDEN');
    const caps = await client.rpc('crm_v2_project_sales_capabilities'); rpcError(caps.error);
    if (caps.data?.contract_version !== PROJECT_SALES_CONTRACT_VERSION || caps.data?.enabled !== true) fail(503, 'SETUP_REQUIRED');
    let currentDetails: CustomerDealEditSnapshot | null = null;
    const readDetails = async () => {
      const reply = await client.rpc('crm_v2_customer_deal_details_context', { p_sale_id: scope.saleId, p_project_name: scope.projectName });
      rpcError(reply.error);
      const snapshot = parseCustomerDealEditSnapshot(reply.data, scope);
      if (snapshot.actor.userId !== actorId || snapshot.actor.role !== role.data) fail(409, 'STALE_STATE');
      return snapshot;
    };
    if (customerDealEditEnabled()) {
      const detailsCaps = await client.rpc('crm_v2_customer_deal_details_capabilities'); rpcError(detailsCaps.error);
      if (detailsCaps.data?.contract_version !== CUSTOMER_DEAL_EDIT_VERSION || detailsCaps.data?.enabled !== true) fail(503, 'SETUP_REQUIRED');
      currentDetails = await readDetails();
    }
    // Only the same caller's existing sales/plot SELECT grants. Never read CRM customer tables directly.
    const saleReply = await client.from('sales').select('*,plots(project_name)').eq('id', scope.saleId).single();
    rpcError(saleReply.error);
    const sale = saleReply.data;
    // A cancelled canonical booking may have released its plot. Its project is
    // established below by the exact authorized Interest and booking context.
    const releasedCancelledPlot = sale?.plot_id === null && sale?.plots == null && sale?.crm_stage === 'cancelled';
    if (!sale || sale.id !== scope.saleId || !sale.project_interest_id
      || (!releasedCancelledPlot && sale.plots?.project_name !== scope.projectName)) fail(404, 'NOT_FOUND');
    let canonical: ProjectSaleRow | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (request.signal.aborted) fail(503, 'READ_UNAVAILABLE');
      const query = { projectName: scope.projectName, tab: 'all' as const, query: '', page };
      const reply = await client.rpc('crm_v2_project_sales', { p_project_name: scope.projectName, p_tab: 'all', p_query: '', p_page: page });
      rpcError(reply.error);
      const snapshot = parseProjectSalesSnapshot(reply.data, query);
      if (snapshot.actor.userId !== actorId || snapshot.actor.role !== role.data) fail(503, 'SETUP_REQUIRED');
      canonical = snapshot.rows.find(row => row.saleId === scope.saleId);
      if (canonical) break;
      if (!snapshot.hasMore) fail(404, 'NOT_FOUND');
    }
    if (!canonical) fail(503, 'READ_UNAVAILABLE');
    if (canonical.interestId !== sale.project_interest_id || canonical.plotId !== sale.plot_id) fail(409, 'STALE_STATE');
    if (canonical.projectName !== scope.projectName || (releasedCancelledPlot && canonical.stage !== 'cancelled')) fail(409, 'STALE_STATE');
    let contextSale, customer;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (request.signal.aborted) fail(503, 'READ_UNAVAILABLE');
      const reply = await client.rpc('crm_v2_booking_context', { p_customer_id: canonical.customerId, p_page: page });
      rpcError(reply.error);
      const context = parseBookingContext(reply.data, canonical.customerId, page);
      if (context.actor.userId !== actorId || context.actor.role !== role.data) fail(503, 'SETUP_REQUIRED');
      const candidate = context.sales.find(row => row.id === scope.saleId);
      if (candidate) { contextSale = candidate; customer = context.customer; break; }
      if (!context.hasMore) fail(409, 'STALE_STATE');
    }
    if (!contextSale || !customer) fail(503, 'READ_UNAVAILABLE');
    if (customer.id !== canonical.customerId || contextSale.interestId !== canonical.interestId || contextSale.projectName !== scope.projectName
      || contextSale.plotId !== sale.plot_id || contextSale.revision !== sale.booking_revision
      || contextSale.stage !== canonical.stage || contextSale.salePrice !== canonical.salePrice) fail(409, 'STALE_STATE');
    if (currentDetails && (currentDetails.customer.id !== customer.id || currentDetails.customer.name !== customer.name
      || currentDetails.customer.phone !== customer.phone || canonical.customerName !== customer.name || canonical.phone !== customer.phone
      || currentDetails.deal.interestId !== canonical.interestId || currentDetails.deal.revision !== contextSale.revision
      || currentDetails.deal.stage !== contextSale.stage || currentDetails.deal.salePrice !== contextSale.salePrice)) fail(409, 'STALE_STATE');
    let importedEvidence: HistoricalCustomerEvidenceSnapshot | null = null;
    const readImportedEvidence = async () => {
      const evidenceScope = { customerId: customer.id, interestId: canonical.interestId, saleId: scope.saleId, page: 0 };
      const reply = await client.rpc('crm_v2_customer_history', { p_customer_id: evidenceScope.customerId,
        p_interest_id: evidenceScope.interestId, p_sale_id: evidenceScope.saleId, p_page: 0 });
      rpcError(reply.error);
      const snapshot = parseHistoricalCustomerEvidenceSnapshot(reply.data, evidenceScope);
      if (snapshot.actor.userId !== actorId || snapshot.actor.role !== role.data) fail(409, 'STALE_STATE');
      if (snapshot.records.some(record => record.projectName !== scope.projectName)) fail(409, 'STALE_STATE');
      return snapshot;
    };
    if (contextSale.importedHistory && historicalCustomerEvidenceEnabled()) importedEvidence = await readImportedEvidence();
    const finalReply = await client.from('sales').select('*,plots(project_name)').eq('id', scope.saleId).single();
    rpcError(finalReply.error);
    const finalSale = finalReply.data;
    const stableFields = ['id', 'project_interest_id', 'plot_id', 'lead_id', 'booking_revision', 'updated_at',
      'crm_stage', 'contract_status', 'sale_price', 'bank_name', 'payment_method', 'booked_at', 'contracted_at',
      'loan_submission_date', 'transferred_at', 'crm_transfer_date', 'crm_handover_at', 'crm_handover_date', 'cancelled_at'];
    if (!finalSale || (releasedCancelledPlot
      ? finalSale.plot_id !== null || finalSale.plots != null || finalSale.crm_stage !== 'cancelled'
      : finalSale.plots?.project_name !== scope.projectName)
      || stableFields.some(field => (sale[field] ?? null) !== (finalSale[field] ?? null))) fail(409, 'STALE_STATE');
    if (currentDetails && JSON.stringify(await readDetails()) !== JSON.stringify(currentDetails)) fail(409, 'STALE_STATE');
    if (importedEvidence && JSON.stringify(await readImportedEvidence()) !== JSON.stringify(importedEvidence)) fail(409, 'STALE_STATE');
    // A visit belongs to this exact source-backed Sale, never another interest or earlier purchase by the same person.
    const importedVisit = importedEvidence?.records[0]?.events.find(event => event.kind === 'visited')?.date ?? null;
    // A missing Lead or missing event dates are normal for historical customers.
    const result = parseCustomerDealReadSnapshot({ actor: { userId: actorId, role: role.data },
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      deal: { id: sale.id, customerId: customer.id, interestId: canonical.interestId, projectName: scope.projectName,
        plotId: canonical.plotId, stage: contextSale.stage, leadId: sale.lead_id ?? null,
        origin: contextSale.importedHistory ? 'historical' : 'live', revision: contextSale.revision,
        salePrice: contextSale.salePrice, bankName: currentDetails ? currentDetails.deal.bankName : sale.bank_name || null, paymentMethod: contextSale.paymentMethod },
      history: customerHistoryTimeline(sale, contextSale.importedHistory, { visited: importedVisit }), readOnly: true,
      detailsEditingAvailable: currentDetails ? currentDetails.customer.canEdit || currentDetails.deal.canEdit : false }, scope);
    return json({ data: result }, 200);
  } catch (error) {
    const safe = error instanceof ReadError ? error : new ReadError(503, 'READ_UNAVAILABLE');
    return json({ error: { code: safe.code, message: messages[safe.code] } }, safe.status);
  }
}
