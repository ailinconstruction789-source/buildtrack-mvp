import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import * as route from '@/app/api/admin/account-access/route';
import { aid,snapshot } from './accountAccessFixtures';
const mocks=vi.hoisted(()=>({create:vi.fn(),getUser:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.create}));
const request=(query='',token=true)=>new Request(`http://local/api/admin/account-access${query}`,{headers:token?{Authorization:'Bearer test-token'}:{}});
const actor=()=>({contract:'buildtrack.actor.v1',authUserId:aid(1),legacyUserId:1,username:'Admin สมมติ',role:'Admin',canManageAccounts:true});
beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED','true');vi.stubEnv('ACCOUNT_ACCESS_READ_ENABLED','true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:9');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_publishable_synthetic');
  mocks.create.mockReturnValue({auth:{getUser:mocks.getUser},rpc:mocks.rpc,from:mocks.from});
  mocks.getUser.mockResolvedValue({data:{user:{id:aid(1),user_metadata:{role:'Admin'}}},error:null});
  mocks.rpc.mockImplementation(async name=>({data:name==='app_current_actor'?actor():snapshot(),error:null}));
});
afterEach(()=>{expect(mocks.from).not.toHaveBeenCalled();vi.unstubAllEnvs();});
describe('Admin account GET boundary (mocked)',()=>{
  it('only exports GET, verifies identity and forwards caller token with no-store',async()=>{
    expect(Object.keys(route)).toEqual(['GET']); const result=await route.GET(request());
    expect(result.status).toBe(200);expect(await result.json()).toEqual({data:snapshot()});
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getUser).toHaveBeenCalledWith('test-token');
    expect(mocks.create.mock.calls[0][2].global.headers.Authorization).toBe('Bearer test-token');
    expect(mocks.rpc.mock.calls.map(call=>call[0])).toEqual(['app_current_actor','app_sales_account_access']);
  });
  it.each(['NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED','ACCOUNT_ACCESS_READ_ENABLED'])('closed gate %s never constructs a client',async name=>{
    vi.stubEnv(name,'false');expect((await route.GET(request())).status).toBe(503);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects bad query and missing token before client creation',async()=>{
    expect((await route.GET(request('?role=Admin'))).status).toBe(400);
    expect((await route.GET(request('',false))).status).toBe(401);expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['sb_secret_bad','bad',`a.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.c`])('never uses privileged or invalid key %s',async key=>{
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY',key);expect((await route.GET(request())).status).toBe(503);expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{role:'Sales',canManageAccounts:false},{role:'Owner',canManageAccounts:false},{role:'Admin',canManageAccounts:false}])('requires reviewed account-admin permission %j',async role=>{
    mocks.rpc.mockResolvedValueOnce({data:{...actor(),...role},error:null});
    expect((await route.GET(request())).status).toBe(403);expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('checks RPC authorization again and hides all raw error diagnostics',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:actor(),error:null}).mockResolvedValueOnce({data:null,error:{code:'42501',message:'private database details'}});
    const response=await route.GET(request());expect(response.status).toBe(403);expect(await response.text()).not.toContain('private');
  });
  it('requires actual Auth verification, not metadata',async()=>{
    mocks.getUser.mockResolvedValueOnce({data:{user:null},error:new Error('secret')});
    expect((await route.GET(request())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['PGRST202','42883'])('reports missing setup %s without legacy fallback',async code=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message:'secret'}});
    const response=await route.GET(request());expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('SETUP_REQUIRED');
  });
  it('strips unknown fields and rejects another actor snapshot',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:actor(),error:null}).mockResolvedValueOnce({data:{...snapshot(),actorId:aid(9),email:'secret'},error:null});
    const result=await route.GET(request());expect(result.status).toBe(503);expect(await result.text()).not.toContain('secret');
  });
});
