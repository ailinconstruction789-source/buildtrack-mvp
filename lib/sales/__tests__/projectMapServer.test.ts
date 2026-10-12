// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), projects: vi.fn(), plots: vi.fn(), rentalsEnabled:vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
vi.mock('@/lib/sales/rentalCommandServer',()=>({rentalCommandsEnabled:mock.rentalsEnabled}));
import * as route from '@/app/api/sales-crm/project-map/route';
import { projectMapSnapshot } from './projectMapFixtures';
import { pid, projectSale, projectScope, projectSnapshot } from './projectSalesFixtures';
const request = (query = '?projectName=โครงการ A', authenticated = true) => new Request(`https://test.invalid/api/sales-crm/project-map${query}`, { headers: authenticated ? { authorization: 'Bearer fake-token' } : {} });
const flags = ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES'];
beforeEach(() => {
  vi.resetAllMocks(); mock.rentalsEnabled.mockReturnValue(false); flags.forEach(flag => vi.stubEnv(`SALES_CRM_${flag}_ENABLED`, 'true'));
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_booking');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: pid(8), user_metadata: { role: 'admin' } } }, error: null });
  mock.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === 'crm_v2_role' ? 'sales'
    : name === 'crm_v2_project_sales_capabilities' ? { enabled: true, contract_version: 'project_sales_v1' }
    : projectSnapshot(projectScope({ tab: 'all', page: args.p_page })) }));
  const snapshot = projectMapSnapshot();
  mock.projects.mockResolvedValue({ data: { name: 'โครงการ A', layout_data: [{ type: 'config', cols: 6, rows: 4 }, ...snapshot.layout.cells] }, error: null });
  mock.plots.mockResolvedValue({ data: snapshot.plots.map(p => ({ id: p.id, plot_name: p.name, project_name: 'โครงการ A', has_customer: p.hasCustomer, is_completed: p.isCompleted, sale_status: p.saleStatus })), count: 2, error: null });
  mock.from.mockImplementation(table => {
    const builder = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: mock.projects, range: mock.plots };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.order.mockReturnValue(builder);
    if (!['plots', 'projects'].includes(table)) throw new Error('Unexpected direct table read');
    return builder;
  });
});

function rentalRow(n=1000){return{contractId:pid(n),customerId:pid(20),interestId:pid(21),ownerUserId:pid(8),projectName:'โครงการ A',plotId:'P-2',customerName:'ลูกค้าเช่าสังเคราะห์',customerPhone:null,programType:'program_b',status:'ended',revision:pid(n+10000),startDate:'2025-01-01',endDate:'2025-12-31',endedDate:'2025-06-01',convertedSaleId:null};}
function rentalPage(page=0,hasMore=false){return{projectName:'โครงการ A',actor:{userId:pid(8),role:'sales'},snapshotRevision:'a'.repeat(32),page,hasMore,rows:hasMore?Array.from({length:50},(_,n)=>rentalRow(1000+page*50+n)):[rentalRow(1000+page*50)]};}
function enableRentals(read:(page:number)=>unknown=rentalPage){
 mock.rentalsEnabled.mockReturnValue(true);const normal=mock.rpc.getMockImplementation()!;
 mock.rpc.mockImplementation(async(name,args)=>name==='crm_v2_rental_capabilities'?{data:{enabled:true,contract_version:'rental_lifecycle_v1'},error:null}:name==='crm_v2_rental_project_context'?{data:read(args.p_page),error:null}:normal(name,args));
}

describe('complete rental history in the project Map',()=>{
 it('does not query rentals while its server gate is off',async()=>{
  expect((await route.GET(request())).status).toBe(200);
  expect(mock.rpc.mock.calls.some(call=>String(call[0]).startsWith('crm_v2_rental'))).toBe(false);
 });
 it('reads all rental pages under the same JWT and rechecks their revision after plot reads',async()=>{
  enableRentals(page=>rentalPage(page,page===0));
  const response=await route.GET(request());expect(response.status).toBe(200);
  expect((await response.json()).data.rentalPages).toHaveLength(2);
  expect(mock.rpc.mock.calls.filter(call=>call[0]==='crm_v2_rental_project_context').map(call=>call[1].p_page)).toEqual([0,1,0]);
  expect(mock.from.mock.calls.map(call=>call[0])).toEqual(['projects','plots']);
 });
 it.each(['changed-between-pages','changed-after-plots','wrong-actor','duplicate-id','partial-page'])('refuses ambiguous rental reads: %s',async mode=>{
  let page0=0;enableRentals(page=>{
   const result=rentalPage(page,page===0);if(page===0)page0++;
   if(mode==='changed-between-pages'&&page===1)result.snapshotRevision='b'.repeat(32);
   if(mode==='changed-after-plots'&&page===0&&page0===2)result.snapshotRevision='b'.repeat(32);
   if(mode==='wrong-actor'&&page===1)result.actor.userId=pid(99);
   if(mode==='duplicate-id'&&page===1)result.rows[0].contractId=pid(1000);
   if(mode==='partial-page'&&page===0)result.rows=[];
   return result;
  });
  await error(await route.GET(request()),503);
 });
 it('refuses a later rental RPC failure without returning a partial Map',async()=>{
  enableRentals(page=>rentalPage(page,page===0));const normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name,args)=>name==='crm_v2_rental_project_context'&&args.p_page===1?{error:{code:'P0001',message:'CRM_RENTAL_FORBIDDEN'}}:normal(name,args));
  await error(await route.GET(request()),403);expect(mock.from).not.toHaveBeenCalled();
 });
 it('requires the exact enabled rental RPC version before any rental read',async()=>{
  enableRentals();const normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name,args)=>name==='crm_v2_rental_capabilities'?{data:{enabled:true,contract_version:'old'},error:null}:normal(name,args));
  await error(await route.GET(request()),503);expect(mock.rpc.mock.calls.some(call=>call[0]==='crm_v2_rental_project_context')).toBe(false);
 });
 it('stops at the bounded page limit instead of returning incomplete rental history',async()=>{
  enableRentals(page=>rentalPage(page,true));await error(await route.GET(request()),503);
  const pages=mock.rpc.mock.calls.filter(call=>call[0]==='crm_v2_rental_project_context').map(call=>call[1].p_page);
  expect(pages).toHaveLength(100);expect(Math.max(...pages)).toBe(99);expect(mock.from).not.toHaveBeenCalled();
 });
});
afterEach(() => vi.unstubAllEnvs());
async function error(response: Response, status: number) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  expect(await response.text()).not.toMatch(/fake-token|private detail|layout_data|customerName/);
}
describe('read-only project map authorization and complete data', () => {
  it('exposes GET only and projects explicit geometry/fields with caller JWT', async () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    const response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(projectMapSnapshot());
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer fake-token');
    expect(mock.from.mock.calls.map(c => c[0])).toEqual(['projects', 'plots']);
  });
  it.each(flags)('keeps %s feature gate before database access', async flag => {
    vi.stubEnv(`SALES_CRM_${flag}_ENABLED`, 'false'); await error(await route.GET(request()), 503);
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('requires valid auth and trusted sales role, not editable metadata', async () => {
    await error(await route.GET(request('', false)), 400);
    await error(await route.GET(request('?projectName=โครงการ A', false)), 401);
    mock.rpc.mockResolvedValue({ data: 'contractor', error: null });
    await error(await route.GET(request()), 403); expect(mock.from).not.toHaveBeenCalled();
  });
  it.each(['?projectName=A&projectName=B', '?projectName=A&tab=booked', '?projectName=A&page=1', '?projectName='])('rejects filters that could paint partial data %s', async query => {
    await error(await route.GET(request(query)), 400); expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('reads every page, ignores table search filters, and refuses duplicate pagination', async () => {
    const first = { ...projectSnapshot(projectScope({ tab: 'all' })), hasMore: true,
      rows: Array.from({ length: 50 }, (_, n) => projectSale({ saleId: pid(n + 100), plotId: null, stage: 'cancelled' })) };
    const normal = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => name === 'crm_v2_project_sales' && args.p_page === 0 ? { data: first, error: null } : normal(name, args));
    let response = await route.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.salePages).toHaveLength(2);
    expect(mock.rpc).toHaveBeenCalledWith('crm_v2_project_sales', { p_project_name: 'โครงการ A', p_tab: 'all', p_query: '', p_page: 1 });
    first.rows[0].saleId = pid(1);
    response = await route.GET(request()); await error(response, 503);
  });
  it('fails closed if a later page fails, before reading layout', async () => {
    const normal = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name, args) => {
      if (name !== 'crm_v2_project_sales') return normal(name, args);
      if (args.p_page) return { error: { message: 'private detail', code: 'unknown' } };
      return { data: { ...projectSnapshot(projectScope({ tab: 'all' })), hasMore: true,
        rows: Array.from({ length: 50 }, (_, n) => projectSale({ saleId: pid(n + 100), plotId: null, stage: 'cancelled' })) } };
    });
    await error(await route.GET(request()), 503); expect(mock.from).not.toHaveBeenCalled();
  });
  it('rejects truncated plot results, missing project, and layout read failures', async () => {
    mock.plots.mockResolvedValueOnce({ data: [], count: 2, error: null }); await error(await route.GET(request()), 503);
    mock.projects.mockResolvedValueOnce({ data: null, error: null }); await error(await route.GET(request()), 503);
    mock.projects.mockResolvedValueOnce({ error: { code: '42501', message: 'private detail' } }); await error(await route.GET(request()), 403);
  });
  it('rejects cross-project data even with successful HTTP from upstream', async () => {
    mock.projects.mockResolvedValueOnce({ data: { name: 'B', layout_data: [] }, error: null });
    await error(await route.GET(request()), 503);
  });
  it('rejects service credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_test');
    await error(await route.GET(request()), 503); expect(mock.createClient).not.toHaveBeenCalled();
  });
});
