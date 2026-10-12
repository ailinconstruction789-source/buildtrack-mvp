// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), rpc: vi.fn(), from: vi.fn(), sale: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }));
import * as route from '@/app/api/sales-crm/customer-deal/route';
import { bid, bookingContext } from './bookingFixtures';
import { projectSnapshot, projectSale } from './projectSalesFixtures';
import { editSnapshot } from './customerDealEditFixtures';
import { evidenceSnapshot, historyScope } from './historicalCustomerEvidenceFixtures';
const scope = { saleId: bid(5), projectName: 'โครงการ A' };
const request = (query: Record<string,string> = scope, auth = true) => new Request('https://fixture.invalid/?'+new URLSearchParams(query), { headers: auth ? { authorization: 'Bearer fixture-token' } : {} });
let sale: Record<string,unknown>, role: string;
let overrides: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks(); role = 'sales'; overrides = {};
  ['SALES_CRM_V2_ENABLED','SALES_CRM_LEAD_WORK_ENABLED','SALES_CRM_LIFECYCLE_ENABLED','SALES_CRM_BOOKING_ENABLED','SALES_CRM_PROJECT_SALES_ENABLED'].forEach(k => vi.stubEnv(k,'true'));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-key');
  sale = { id: bid(5), project_interest_id: bid(3), plot_id: 'A-01', lead_id: null, booking_revision: bid(6), bank_name: null, plots: { project_name: scope.projectName } };
  mocks.sale.mockImplementation(async () => ({ data: sale, error: null }));
  mocks.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: mocks.sale }) }) }));
  mocks.user.mockResolvedValue({ data: { user: { id: bid(8), user_metadata: { role: 'admin' } } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name in overrides) return overrides[name];
    const ctx = bookingContext(); ctx.actor.role = role as never;
    if (role === 'owner') { ctx.sales.forEach(row => { row.canResume = false; row.canCancel = false; }); ctx.interests.forEach(row => { row.canEdit = false; }); }
    const project = projectSnapshot({ projectName: scope.projectName, tab: 'all', query: '', page: 0 });
    project.actor = { userId: bid(8), role: role as never };
    project.rows = [projectSale({ saleId: bid(5), customerId: bid(2), interestId: bid(3), projectName: scope.projectName,
      plotId: 'A-01', stage: 'cancelled', paymentMethod: null, bookingRound: 1, salePrice: null })];
    return { data: name === 'crm_v2_role' ? role : name === 'crm_v2_project_sales_capabilities' ? { contract_version: 'project_sales_v1', enabled: true }
      : name === 'crm_v2_project_sales' ? project : ctx, error: null };
  });
  mocks.create.mockReturnValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: mocks.from });
});
afterEach(() => vi.unstubAllEnvs());
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect((await response.json()).error.code).toBe(code);
}
describe('read canonical customer/deal through authorized RPCs without a historical Lead', () => {
  it.each(['sales','admin','owner'])('permits trusted %s read-only access with null Lead and missing dates', async value => {
    role = value;
    const response = await route.GET(request()); expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body.customer).toMatchObject({ id: bid(2), name: 'ลูกค้าทดสอบ' }); expect(body.deal).toMatchObject({ id: bid(5), leadId: null, stage: 'cancelled' });
    expect(body.history.every((h: { date: unknown }) => h.date === null)).toBe(true); expect(body.readOnly).toBe(true);
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('vary')).toBe('Authorization');
    expect(mocks.from.mock.calls.map(c => c[0])).toEqual(['sales', 'sales']);
    expect(Object.keys(route).sort()).toEqual(['GET','dynamic','runtime']);
  });
  it('never creates a client when the existing release gate is disabled', async () => {
    vi.stubEnv('SALES_CRM_PROJECT_SALES_ENABLED','false'); await error(await route.GET(request()),503,'FEATURE_DISABLED'); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects anonymous or client-metadata role claims', async () => {
    await error(await route.GET(request(scope,false)),401,'UNAUTHENTICATED'); role = 'contractor'; await error(await route.GET(request()),403,'FORBIDDEN');
  });
  it.each(['sb_secret_no', `header.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`])('refuses privileged public key %s', async key => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY',key); await error(await route.GET(request()),503,'SETUP_REQUIRED'); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects name-based or duplicate scope before reading any data', async () => {
    await error(await route.GET(request({ ...scope, name: 'Guess' })),400,'INVALID_INPUT'); expect(mocks.rpc).not.toHaveBeenCalled();
    await error(await route.GET(new Request(request().url+'&saleId='+bid(5))),400,'INVALID_INPUT');
  });
  it('does not substitute a sale from another project or identity', async () => {
    sale.project_interest_id = bid(99); await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('does not mix a stale revision with fresh customer context', async () => {
    sale.booking_revision = bid(99); await error(await route.GET(request()),409,'STALE_STATE');
  });
  function releasedCancellation() {
    sale.plot_id = null; sale.plots = null; sale.crm_stage = 'cancelled';
    const ctx = bookingContext(); ctx.sales[0].plotId = null;
    overrides.crm_v2_booking_context = { data: ctx, error: null };
    const p = projectSnapshot({ projectName: scope.projectName, tab: 'all', query: '', page: 0 });
    p.actor = { userId: bid(8), role: 'sales' };
    p.rows = [projectSale({ saleId: bid(5), customerId: bid(2), interestId: bid(3), projectName: scope.projectName,
      plotId: null, plotName: null, stage: 'cancelled', paymentMethod: null, bookingRound: 1, salePrice: null })];
    overrides.crm_v2_project_sales = { data: p, error: null };
    return { ctx, p };
  }
  it('reads a released cancelled plot only through matching canonical customer, Interest and project', async () => {
    releasedCancellation(); const response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.deal).toMatchObject({ plotId: null, stage: 'cancelled', customerId: bid(2), interestId: bid(3), projectName: scope.projectName });
  });
  it('rejects a plotless booking whose raw state is not cancelled', async () => {
    releasedCancellation(); sale.crm_stage = 'booked'; await error(await route.GET(request()),404,'NOT_FOUND');
  });
  it('rejects another canonical customer for a released cancelled Interest', async () => {
    const { p } = releasedCancellation(); p.rows[0].customerId = bid(99);
    // The booking contract itself refuses a different returned Customer UUID.
    await error(await route.GET(request()),503,'READ_UNAVAILABLE');
  });
  it('rejects another canonical project for a released cancelled Interest', async () => {
    const { ctx } = releasedCancellation(); ctx.sales[0].projectName = 'โครงการอื่น';
    ctx.interests[0].projectName = 'โครงการอื่น'; ctx.projects.push({name:'โครงการอื่น'});
    await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('discards a released cancellation if its plot or state changes during reading', async () => {
    releasedCancellation(); mocks.sale.mockResolvedValueOnce({ data: { ...sale }, error: null })
      .mockResolvedValueOnce({ data: { ...sale, plot_id: 'A-01', plots: { project_name: scope.projectName } }, error: null });
    await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('discards a bank or profile snapshot when the sale changes between authorized reads', async () => {
    mocks.sale.mockResolvedValueOnce({ data: { ...sale }, error: null })
      .mockResolvedValueOnce({ data: { ...sale, bank_name: 'Changed bank' }, error: null });
    await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('discards a handover day changed between shared Lead/Map detail reads', async () => {
    mocks.sale.mockResolvedValueOnce({ data: { ...sale }, error: null })
      .mockResolvedValueOnce({ data: { ...sale, crm_handover_date: '2026-09-23' }, error: null });
    await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('rejects reader replies for another actor', async () => {
    const ctx = bookingContext(); ctx.actor.userId = bid(99); overrides.crm_v2_booking_context = { data: ctx, error: null };
    await error(await route.GET(request()),503,'SETUP_REQUIRED');
  });
  it('returns setup required for a missing database reader, without exposing raw errors', async () => {
    overrides.crm_v2_booking_context = { data: null, error: { code: '42883', message: 'private fixture detail' } };
    const response = await route.GET(request()); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private fixture');
  });
  function correctedContext() {
    vi.stubEnv('SALES_CRM_POST_BOOKING_ENABLED','true'); vi.stubEnv('SALES_CRM_CUSTOMER_DEAL_DETAILS_ENABLED','true');
    const d=editSnapshot();d.actor.userId=bid(8);d.customer={...d.customer,id:bid(2),name:'ลูกค้าทดสอบ',sourceName:'ลูกค้าทดสอบ',ownerUserId:bid(8),revision:bid(9)};
    d.deal={...d.deal,id:bid(5),customerId:bid(2),interestId:bid(3),ownerUserId:bid(8),projectName:scope.projectName,
      plotId:'A-01',stage:'cancelled',revision:bid(6),interestRevision:bid(4),salePrice:null,sourceSalePrice:null,bankName:'กสิกรไทย',paymentMethod:null,canEdit:false};
    overrides.crm_v2_customer_deal_details_capabilities={data:{contract_version:'customer_deal_details_v1',enabled:true},error:null};
    overrides.crm_v2_customer_deal_details_context={data:d,error:null};
    const p=projectSnapshot({projectName:scope.projectName,tab:'all',query:'',page:0});p.actor={userId:bid(8),role:'sales'};
    p.rows=[projectSale({saleId:bid(5),customerId:bid(2),interestId:bid(3),projectName:scope.projectName,plotId:'A-01',stage:'cancelled',customerName:'ลูกค้าทดสอบ',phone:null})];
    overrides.crm_v2_project_sales={data:p,error:null};return d;
  }
  it('reads corrected selected bank instead of the sealed raw bank',async()=>{
    correctedContext();const response=await route.GET(request());expect(response.status).toBe(200);
    expect((await response.json()).data.deal.bankName).toBe('กสิกรไทย');
    expect(mocks.rpc.mock.calls.filter(c=>c[0]==='crm_v2_customer_deal_details_context')).toHaveLength(2);
  });
  it('rejects a correction revision changed without any raw sale change',async()=>{
    const d=correctedContext(),original=mocks.rpc.getMockImplementation()!;let reads=0;
    mocks.rpc.mockImplementation(async(name:string,...args)=>name==='crm_v2_customer_deal_details_context'
      ?{data:++reads===1?d:{...d,customer:{...d.customer,detailsRevision:bid(99)}},error:null}:original(name,...args));
    await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('rejects divergent corrected profile between booking and Project Map',async()=>{
    const d=correctedContext();d.customer.name='Changed elsewhere';await error(await route.GET(request()),409,'STALE_STATE');
  });
  function enableImportedVisit() {
    vi.stubEnv('SALES_CRM_HISTORICAL_EVIDENCE_ENABLED','true');
    const history={source:'customer_sheet' as const,batchId:bid(10),sourceRow:926,sourceStage:'cancelled' as const,
      bookedDate:'2026-09-03',cancelledDate:'2026-10-07',transferredDate:null};
    const ctx=bookingContext();ctx.sales[0]={...ctx.sales[0],bookingRound:null,canResume:false,importedHistory:history};
    overrides.crm_v2_booking_context={data:ctx,error:null};
    const p=projectSnapshot({projectName:scope.projectName,tab:'all',query:'',page:0});p.actor={userId:bid(8),role:'sales'};
    p.rows=[projectSale({saleId:bid(5),customerId:bid(2),interestId:bid(3),projectName:scope.projectName,plotId:'A-01',stage:'cancelled',paymentMethod:null,bookingRound:null,salePrice:null,importedHistory:history})];
    overrides.crm_v2_project_sales={data:p,error:null};
    const evidence=evidenceSnapshot({...historyScope,interestId:bid(3),saleId:bid(5)});
    overrides.crm_v2_customer_history={data:evidence,error:null};return evidence;
  }
  it('adds only the exact imported Sale visit day without invented Lead or instant',async()=>{
    enableImportedVisit();const response=await route.GET(request());expect(response.status).toBe(200);
    const data=(await response.json()).data;expect(data.history[0]).toEqual({event:'visited',date:'2026-08-23',occurredAt:null,precision:'day',source:'historical_record'});
    expect(data.deal.leadId).toBeNull();expect(data.history.find((h:{event:string})=>h.event==='contracted').date).toBeNull();
    expect(mocks.rpc.mock.calls.filter(c=>c[0]==='crm_v2_customer_history')).toHaveLength(2);
  });
  it('does not call the new RPC until the installation opt-in is enabled',async()=>{
    enableImportedVisit();vi.stubEnv('SALES_CRM_HISTORICAL_EVIDENCE_ENABLED','false');const response=await route.GET(request());expect(response.status).toBe(200);
    expect((await response.json()).data.history[0].date).toBeNull();expect(mocks.rpc.mock.calls.some(c=>c[0]==='crm_v2_customer_history')).toBe(false);
  });
  it('does not mix revised history changed while reading an otherwise identical Sale',async()=>{
    const evidence=enableImportedVisit(),original=mocks.rpc.getMockImplementation()!;let reads=0;
    mocks.rpc.mockImplementation(async(name:string,...args)=>name==='crm_v2_customer_history'?{data:++reads===1?evidence:{...evidence,records:[{...evidence.records[0],events:[{kind:'visited',date:'2026-08-24',precision:'day'}]}]},error:null}:original(name,...args));
    await error(await route.GET(request()),409,'STALE_STATE');
  });
  it('refuses historical visit replies from a different Sale, Interest or project',async()=>{
    for(const change of ['sale','interest','project']){const evidence=enableImportedVisit();if(change==='sale')evidence.records[0].saleId=bid(99);if(change==='interest')evidence.records[0].interestId=bid(99);if(change==='project')evidence.records[0].projectName='โครงการอื่น';
      const response=await route.GET(request());expect([409,503]).toContain(response.status);}
  });
});
