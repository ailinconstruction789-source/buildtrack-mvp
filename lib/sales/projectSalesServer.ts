/** Server only, read-only, caller JWT and explicit projections; no legacy fallback. */
import { createClient } from '@supabase/supabase-js';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { PROJECT_SALES_CONTRACT_VERSION, ProjectSalesInputError, parseProjectSalesQuery, parseProjectSalesSnapshot } from './projectSalesContracts';
import { projectSalesEnabled } from './projectSalesFlags';
import { PROJECT_MAP_MAX_PAGES, PROJECT_MAP_MAX_PLOTS, parseProjectMapName, parseProjectMapSnapshot, parseStoredProjectMapLayout } from './projectMapContracts';
import { parseExcelBookingAmounts, parseExcelReportProject } from './excelReportContracts';
import { readExcelHouseDetails } from './excelHouseDetailsServer';
import { rentalCommandsEnabled } from './rentalCommandServer';
import { RENTAL_COMMAND_VERSION } from './rentalCommandContracts';
import { parseRentalProjectPage, type RentalProjectPage } from './rentalProjectReadContracts';
import { WORKSPACE_READ_CONTRACT_VERSION, parseSourceMembershipMetadata } from './workspaceReadContracts';
export { projectSalesEnabled } from './projectSalesFlags';

const messages: Record<string, string> = {
  FEATURE_DISABLED: 'ยังไม่เปิดข้อมูลลูกค้าจองจากส่วนกลาง', SETUP_REQUIRED: 'ข้อมูลยังไม่พร้อม กรุณาให้ Admin ตรวจการเชื่อมข้อมูลเก่าและสิทธิ์ก่อนใช้งาน',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'คุณไม่มีสิทธิ์ดูข้อมูลฝ่ายขาย', INVALID_INPUT: 'โครงการหรือตัวกรองไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบโครงการนี้', READ_UNAVAILABLE: 'โหลดข้อมูลลูกค้าจองไม่ได้ กรุณาลองใหม่',
};
class ReadError extends Error { constructor(readonly status: number, readonly code: string) { super(messages[code]); } }
const fail = (status: number, code: string): never => { throw new ReadError(status, code); };
function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
function rpcFailure(value: unknown): never {
  let raw: Record<string, unknown> = {}; try { raw = bookingRecord(value); } catch { /* No raw error details leave server. */ }
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(String(raw.code))) return fail(503, 'SETUP_REQUIRED');
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(String(raw.code))) return fail(401, 'UNAUTHENTICATED');
  if (raw.code === '42501') return fail(403, 'FORBIDDEN');
  if (['22023', '22P02'].includes(String(raw.code))) return fail(400, 'INVALID_INPUT');
  if (raw.code === 'P0001') {
    const statuses: Record<string, number> = { SETUP_REQUIRED: 503, FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404 };
    for (const [code, status] of Object.entries(statuses)) if (raw.message === `CRM_PROJECT_SALES_${code}` || raw.message === `CRM_RENTAL_${code}`) return fail(status, code);
  }
  return fail(503, 'READ_UNAVAILABLE');
}
export async function handleProjectMapGet(request: Request): Promise<Response> {
  return handleProjectRead(request, true);
}
export async function handleExcelReportGet(request: Request): Promise<Response> {
  return handleProjectRead(request, true, true);
}
export async function handleProjectSalesGet(request: Request): Promise<Response> {
  return handleProjectRead(request, false);
}
async function handleProjectRead(request: Request, map: boolean, excel = false): Promise<Response> {
  try {
    if (!projectSalesEnabled()) return fail(503, 'FEATURE_DISABLED');
    let scope;
    if (map) {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== 'projectName') || params.getAll('projectName').length !== 1) return fail(400, 'INVALID_INPUT');
      try { scope = { projectName: parseProjectMapName(params.get('projectName')), tab: 'all' as const, query: '', page: 0 }; }
      catch { return fail(400, 'INVALID_INPUT'); }
    } else scope = parseProjectSalesQuery(request.url);
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
    const workspace = process.env.SALES_CRM_PROJECT_WORKSPACE_ENABLED === 'true';
    const caps = await client.rpc(workspace ? 'crm_v2_workspace_capabilities' : 'crm_v2_project_sales_capabilities'); if (caps.error) rpcFailure(caps.error);
    if (caps.data?.contract_version !== (workspace ? WORKSPACE_READ_CONTRACT_VERSION : PROJECT_SALES_CONTRACT_VERSION) || caps.data?.enabled !== true) return fail(503, 'SETUP_REQUIRED');
    if (workspace && parseSourceMembershipMetadata(caps.data.sourceMembership)?.active !== true) return fail(503, 'SETUP_REQUIRED');
    const reader = workspace ? 'crm_v2_workspace_project_sales' : 'crm_v2_project_sales';
    const reply = await client.rpc(reader, { p_project_name: scope.projectName, p_tab: scope.tab, p_query: scope.query, p_page: scope.page });
    if (reply.error) rpcFailure(reply.error);
    let snapshot;
    try {
      snapshot = parseProjectSalesSnapshot(reply.data, scope);
      if (snapshot.actor.userId !== actor || snapshot.actor.role !== role.data) return fail(503, 'SETUP_REQUIRED');
      if (workspace && (snapshot.sourceMembership?.active !== true || snapshot.sourceMembership.revisionId !== caps.data.sourceMembership.revisionId)) return fail(503, 'SETUP_REQUIRED');
    } catch { return fail(503, 'SETUP_REQUIRED'); }
    if (!map) return json({ data: snapshot }, 200);
    // A full project history is required: never derive vacant plots from one filtered page.
    const salePages = [snapshot];
    while (salePages[salePages.length - 1].hasMore) {
      if (salePages.length >= PROJECT_MAP_MAX_PAGES || request.signal.aborted) return fail(503, 'READ_UNAVAILABLE');
      const nextScope = { ...scope, page: salePages.length };
      const next = await client.rpc(reader, { p_project_name: scope.projectName, p_tab: 'all', p_query: '', p_page: nextScope.page });
      if (next.error) rpcFailure(next.error);
      const nextSnapshot = parseProjectSalesSnapshot(next.data, nextScope);
      if (workspace && JSON.stringify(nextSnapshot.sourceMembership) !== JSON.stringify(snapshot.sourceMembership)) return fail(503, 'READ_UNAVAILABLE');
      salePages.push(nextSnapshot);
    }
    let rentalPages: RentalProjectPage[] | undefined;
    const readRentalPage = async (page: number): Promise<RentalProjectPage> => {
      if (request.signal.aborted) return fail(503, 'READ_UNAVAILABLE');
      const reply = await client.rpc('crm_v2_rental_project_context', { p_project_name: scope.projectName, p_page: page });
      if (reply.error) rpcFailure(reply.error);
      const parsed = parseRentalProjectPage(reply.data, { projectName: scope.projectName!, page });
      if (parsed.actor.userId !== actor || parsed.actor.role !== role.data) return fail(503, 'READ_UNAVAILABLE');
      return parsed;
    };
    // Rental history is opt-in for the Map. Existing purchase reports retain
    // their projection until rental reporting is separately implemented.
    if (!excel && rentalCommandsEnabled()) {
      const caps = await client.rpc('crm_v2_rental_capabilities');
      if (caps.error) rpcFailure(caps.error);
      if (caps.data?.enabled !== true || caps.data?.contract_version !== RENTAL_COMMAND_VERSION) return fail(503, 'SETUP_REQUIRED');
      rentalPages = [await readRentalPage(0)];
      while (rentalPages[rentalPages.length - 1].hasMore) {
        if (rentalPages.length >= PROJECT_MAP_MAX_PAGES) return fail(503, 'READ_UNAVAILABLE');
        const page = await readRentalPage(rentalPages.length);
        if (page.snapshotRevision !== rentalPages[0].snapshotRevision) return fail(503, 'READ_UNAVAILABLE');
        rentalPages.push(page);
      }
    }
    // Same caller JWT and existing RLS. No service key, new grants, customer-table reads or writes.
    const project = await client.from('projects').select('name,layout_data').eq('name', scope.projectName).maybeSingle();
    if (project.error) rpcFailure(project.error);
    if (!project.data || project.data.name !== scope.projectName) return fail(503, 'READ_UNAVAILABLE');
    const plotReply = await client.from('plots').select('id,plot_name,project_name,has_customer,is_completed,sale_status', { count: 'exact' })
      .eq('project_name', scope.projectName).order('id').range(0, PROJECT_MAP_MAX_PLOTS - 1);
    if (plotReply.error) rpcFailure(plotReply.error);
    if (!Array.isArray(plotReply.data) || plotReply.count !== plotReply.data.length || plotReply.count > PROJECT_MAP_MAX_PLOTS) return fail(503, 'READ_UNAVAILABLE');
    const plots = plotReply.data.map(plot => {
      if (plot.project_name !== scope.projectName) return fail(503, 'READ_UNAVAILABLE');
      return { id: plot.id, name: plot.plot_name || plot.id, hasCustomer: plot.has_customer, isCompleted: plot.is_completed, saleStatus: plot.sale_status };
    });
    if (rentalPages) {
      // A start/end/conversion or profile change during the multi-query read
      // must not silently skip a history page or paint an occupied plot vacant.
      const current = await readRentalPage(0);
      if (current.snapshotRevision !== rentalPages[0].snapshotRevision) return fail(503, 'READ_UNAVAILABLE');
    }
    const mapSnapshot = parseProjectMapSnapshot({ projectName: scope.projectName, actor: snapshot.actor,
      layout: parseStoredProjectMapLayout(project.data.layout_data), plots, salePages, ...(rentalPages ? { rentalPages } : {}) }, scope.projectName!);
    if (excel) {
      // Existing plot/house-type RLS and the same caller JWT. Never read legacy sales or customer tables.
      const catalogReply = await client.from('plots')
        .select('id,project_name,selling_price,land_appraisal_price,house_types(is_infrastructure)', { count: 'exact' })
        .eq('project_name', scope.projectName).order('id').range(0, PROJECT_MAP_MAX_PLOTS - 1);
      if (catalogReply.error) rpcFailure(catalogReply.error);
      if (!Array.isArray(catalogReply.data) || catalogReply.count !== catalogReply.data.length
        || catalogReply.count !== plots.length || request.signal.aborted) return fail(503, 'READ_UNAVAILABLE');
      const houseDetails = await readExcelHouseDetails(client, scope.projectName!, plots.map(plot => plot.id), request.signal);
      const catalog = catalogReply.data.map(plot => {
        if (plot.project_name !== scope.projectName) return fail(503, 'READ_UNAVAILABLE');
        // A missing joined type is unknown, not an assertion that the plot is saleable.
        const relation: unknown = plot.house_types;
        const type = relation === null ? null : bookingRecord(Array.isArray(relation) && relation.length === 1 ? relation[0] : relation);
        // Both legacy catalog columns default to zero. Without entry evidence zero
        // is unknown, not a verified free house/appraisal. Actual sale money is separate.
        return { plotId: plot.id, basePrice: plot.selling_price === 0 ? null : plot.selling_price,
          appraisalPrice: plot.land_appraisal_price === 0 ? null : plot.land_appraisal_price,
          isInfrastructure: type?.is_infrastructure ?? null, houseDetails: houseDetails.get(plot.id) };
      });
      const evidenceReply = await client.rpc('crm_v2_excel_evidence', { p_project_name: scope.projectName });
      if (evidenceReply.error) rpcFailure(evidenceReply.error);
      const amountsReply = await client.rpc('crm_v2_excel_booking_amounts', { p_project_name: scope.projectName });
      if (amountsReply.error) rpcFailure(amountsReply.error);
      const amounts = parseExcelBookingAmounts(amountsReply.data, mapSnapshot);
      return json({ data: parseExcelReportProject({ map: mapSnapshot, catalog,
        evidence: { ...bookingRecord(evidenceReply.data), bookingAmounts: amounts } }, scope.projectName!) }, 200);
    }
    return json({ data: mapSnapshot }, 200);
  } catch (failure) {
    const safe = failure instanceof ReadError ? failure : failure instanceof ProjectSalesInputError ? new ReadError(400, 'INVALID_INPUT') : new ReadError(503, 'READ_UNAVAILABLE');
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
