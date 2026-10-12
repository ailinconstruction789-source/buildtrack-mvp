// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({create:vi.fn(), user:vi.fn(), rpc:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.create}));
import * as route from '@/app/api/sales-crm/customer-history/route';
import { evidenceSnapshot, historyScope } from './historicalCustomerEvidenceFixtures';
import { bid } from './bookingFixtures';
let role:string, data:unknown, rpcError:unknown;
const request=(suffix='',auth=true)=>new Request('https://fixture.invalid/?'+new URLSearchParams({customerId:historyScope.customerId,interestId:'',saleId:'',page:'0'})+suffix,{headers:auth?{authorization:'Bearer fixture-token'}:{}});
beforeEach(()=>{
  vi.clearAllMocks();role='sales';data=evidenceSnapshot();rpcError=null;
  ['SALES_CRM_V2_ENABLED','SALES_CRM_LEAD_WORK_ENABLED','SALES_CRM_LIFECYCLE_ENABLED','SALES_CRM_BOOKING_ENABLED','SALES_CRM_PROJECT_SALES_ENABLED','SALES_CRM_HISTORICAL_EVIDENCE_ENABLED'].forEach(k=>vi.stubEnv(k,'true'));
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE','');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-key');
  mocks.user.mockResolvedValue({data:{user:{id:bid(8)}},error:null});
  mocks.rpc.mockImplementation(async name=>({data:name==='crm_v2_role'?role:name==='crm_v2_project_sales_capabilities'?{contract_version:'project_sales_v1',enabled:true}:data,error:name==='crm_v2_customer_history'?rpcError:null}));
  mocks.create.mockReturnValue({auth:{getUser:mocks.user},rpc:mocks.rpc});
});
afterEach(()=>vi.unstubAllEnvs());
async function failure(response:Response,status:number,code:string){expect(response.status).toBe(status);expect((await response.json()).error.code).toBe(code);}
describe('caller-scoped read-only history endpoint',()=>{
  it.each(['sales','admin','owner'])('retains team read for %s without privileged/private fallback',async value=>{
    role=value;data={...evidenceSnapshot(),actor:{userId:bid(8),role:value}};
    const response=await route.GET(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(['crm_v2_role','crm_v2_project_sales_capabilities','crm_v2_customer_history']);
    expect(mocks.rpc.mock.calls[2][1]).toEqual({p_customer_id:historyScope.customerId,p_interest_id:null,p_sale_id:null,p_page:0});
    expect(Object.keys(route).sort()).toEqual(['GET','dynamic','runtime']);
  });
  it('is opt-in and closed under bounded releases before auth/DB reads',async()=>{
    vi.stubEnv('SALES_CRM_HISTORICAL_EVIDENCE_ENABLED','false');await failure(await route.GET(request()),503,'FEATURE_DISABLED');
    vi.stubEnv('SALES_CRM_HISTORICAL_EVIDENCE_ENABLED','true');vi.stubEnv('SALES_CRM_RELEASE_SCOPE','central_booking');await failure(await route.GET(request()),503,'FEATURE_DISABLED');expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects guessed names and repeated IDs before DB access',async()=>{await failure(await route.GET(request('&name=Guess')),400,'INVALID_INPUT');await failure(await route.GET(request('&customerId='+bid(99))),400,'INVALID_INPUT');expect(mocks.create).not.toHaveBeenCalled();});
  it('rejects anonymous and construction actors',async()=>{await failure(await route.GET(request('',false)),401,'UNAUTHENTICATED');role='contractor';await failure(await route.GET(request()),403,'FORBIDDEN');});
  it.each(['sb_secret_fixture','header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature'])('refuses privileged public key %s',async key=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY',key);await failure(await route.GET(request()),503,'SETUP_REQUIRED');expect(mocks.create).not.toHaveBeenCalled();});
  it('fails closed for a missing projection and hides raw SQL details',async()=>{rpcError={code:'42883',message:'private details'};const response=await route.GET(request());await failure(response.clone(),503,'SETUP_REQUIRED');expect(JSON.stringify(await response.json())).not.toContain('private details');});
  it('does not trust a response for another actor or scope',async()=>{data={...evidenceSnapshot(),actor:{userId:bid(99),role:'sales'}};await failure(await route.GET(request()),409,'STALE_STATE');data={...evidenceSnapshot(),customerId:bid(99)};await failure(await route.GET(request()),503,'READ_UNAVAILABLE');});
});
