// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import * as route from '@/app/api/sales-crm/customer-deal/details/route';
import { editId, editInput, editResult, editSnapshot } from './customerDealEditFixtures';
const flags = ['SALES_CRM_V2_ENABLED','SALES_CRM_LEAD_WORK_ENABLED','SALES_CRM_LIFECYCLE_ENABLED','SALES_CRM_BOOKING_ENABLED',
  'SALES_CRM_POST_BOOKING_ENABLED','SALES_CRM_CUSTOMER_DEAL_DETAILS_ENABLED'];
const get = (query = `?saleId=${editId(1)}&projectName=A`, token = true) => new Request('https://test.invalid/'+query,
  { headers: token ? { authorization: 'Bearer synthetic-token' } : {} });
const post = (body: unknown = editInput(), headers: Record<string,string> = {}) => new Request('https://test.invalid/', {
  method: 'POST', headers: { authorization: 'Bearer synthetic-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
function configure(role = 'sales', overrides: Record<string,unknown> = {}) {
  const snapshot=editSnapshot(); snapshot.actor.role=role as never;
  if(role==='owner') {snapshot.customer.canEdit=false;snapshot.deal.canEdit=false;}
  mock.rpc.mockImplementation(async name => overrides[name] ?? { data: name==='crm_v2_role' ? role
    : name==='crm_v2_customer_deal_details_capabilities' ? {enabled:true,contract_version:'customer_deal_details_v1'}
      : name==='crm_v2_customer_deal_details_command' ? editResult() : snapshot, error:null });
}
beforeEach(() => {
  vi.clearAllMocks(); flags.forEach(f=>vi.stubEnv(f,'true')); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','publishable-test');
  mock.createClient.mockReturnValue({auth:{getUser:mock.getUser},rpc:mock.rpc,from:mock.from});
  mock.getUser.mockResolvedValue({data:{user:{id:editId(6),user_metadata:{role:'admin'}}},error:null});configure();
});
afterEach(()=>{expect(mock.from).not.toHaveBeenCalled();vi.unstubAllEnvs();});
async function error(response:Response,status:number,code:string) {
  expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');const b=await response.json();expect(b.error.code).toBe(code);
  expect(JSON.stringify(b)).not.toMatch(/synthetic-token|private payload/);
}
describe('customer/deal correction caller JWT boundary',()=>{
  it.each(flags)('checks flag %s before constructing a client',async f=>{
    vi.stubEnv(f,'false');await error(await route.GET(get()),503,'FEATURE_DISABLED');await error(await route.POST(post()),503,'FEATURE_DISABLED');
    expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('GET reads one exact scoped snapshot without triggering writes',async()=>{
    const response=await route.GET(get());expect(response.status).toBe(200);expect((await response.json()).data).toEqual(editSnapshot());
    expect(mock.rpc.mock.calls.map(c=>c[0])).toEqual(['crm_v2_role','crm_v2_customer_deal_details_capabilities','crm_v2_customer_deal_details_context']);
    expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_customer_deal_details_context',{p_sale_id:editId(1),p_project_name:'A'});
  });
  it('sends one exact atomic command and recognizes only matching replay receipt',async()=>{
    expect((await route.POST(post())).status).toBe(201);
    const {requestId,...payload}=editInput();expect(mock.rpc).toHaveBeenLastCalledWith('crm_v2_customer_deal_details_command',{p_request_id:requestId,p_payload:payload});
    expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer synthetic-token');
    configure('sales',{crm_v2_customer_deal_details_command:{data:editResult(editInput(),true),error:null}});
    expect((await route.POST(post())).status).toBe(200);
  });
  it.each(['sales','admin','owner'])('allows trusted %s to read',async role=>{configure(role);expect((await route.GET(get())).status).toBe(200);});
  it('Owner cannot write and user-editable metadata grants no permission',async()=>{
    configure('owner');await error(await route.POST(post()),403,'FORBIDDEN');configure('contractor');await error(await route.POST(post()),403,'FORBIDDEN');
    expect(mock.rpc.mock.calls.some(c=>c[0]==='crm_v2_customer_deal_details_command')).toBe(false);
  });
  it('requires verified current user and a bearer',async()=>{
    await error(await route.GET(get(undefined,false)),401,'UNAUTHENTICATED');
    mock.getUser.mockResolvedValue({data:{user:null},error:{}});await error(await route.POST(post()),401,'UNAUTHENTICATED');
  });
  it.each([{enabled:false,contract_version:'customer_deal_details_v1'},{enabled:true,contract_version:'post_booking_v3'},null])('requires exact readiness %j',async data=>{
    configure('sales',{crm_v2_customer_deal_details_capabilities:{data,error:null}});await error(await route.POST(post()),503,'SETUP_REQUIRED');
  });
  it.each(['sb_secret_forbidden',`x.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.x`])('refuses privileged key %s',async key=>{
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY',key);await error(await route.POST(post()),503,'SETUP_REQUIRED');expect(mock.createClient).not.toHaveBeenCalled();
  });
  it.each([{role:'admin'},{paymentMethod:'cash'},{stage:'transferred'},{leadId:editId(99)},{reason:''}])('rejects business/identity injection %j',async patch=>{
    await error(await route.POST(post({...editInput(),...patch})),400,'INVALID_INPUT');expect(mock.createClient).not.toHaveBeenCalled();
  });
  it('checks media type and declared/actual payload limits',async()=>{
    await error(await route.POST(post(editInput(),{'content-type':'text/plain'})),415,'UNSUPPORTED_MEDIA_TYPE');
    await error(await route.POST(post(editInput(),{'content-length':'16385'})),413,'PAYLOAD_TOO_LARGE');
    await error(await route.POST(post({...editInput(),reason:'ก'.repeat(16385)})),413,'PAYLOAD_TOO_LARGE');
  });
  it.each(['STALE_STATE','CONFLICT','IDEMPOTENCY_CONFLICT'])('maps exact database rejection %s',async code=>{
    configure('sales',{crm_v2_customer_deal_details_command:{data:null,error:{code:'P0001',message:'CRM_CUSTOMER_DEAL_DETAILS_'+code}}});
    await error(await route.POST(post()),409,code);
  });
  it('retains uncertainty for a malformed receipt or transport failure',async()=>{
    configure('sales',{crm_v2_customer_deal_details_command:{data:{...editResult(),saleId:editId(99)},error:null}});
    await error(await route.POST(post()),503,'UNKNOWN_RESULT');mock.rpc.mockRejectedValue(new Error('private payload'));
    await error(await route.POST(post()),503,'UNKNOWN_RESULT');
  });
});
