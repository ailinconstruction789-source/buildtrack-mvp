import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import * as route from '@/app/api/admin/account-access/restore/route';
import {command,receipt} from './accountRestoreFixtures';
import {aid} from './accountAccessFixtures';
const mocks=vi.hoisted(()=>({create:vi.fn(),getUser:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.create}));
const actor=()=>({contract:'buildtrack.actor.v1',authUserId:aid(1),legacyUserId:1,username:'Admin สมมติ',role:'Admin',canManageAccounts:true});
const request=(body:unknown=command(),headers:Record<string,string>={})=>new Request('http://local/api/admin/account-access/restore',{
  method:'POST',headers:{Authorization:'Bearer test-token','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.resetAllMocks();for(const key of ['NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED','ACCOUNT_ACCESS_READ_ENABLED','ACCOUNT_ACCESS_RESTORE_ENABLED'])vi.stubEnv(key,'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:9');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_publishable_synthetic');
  mocks.create.mockReturnValue({auth:{getUser:mocks.getUser},rpc:mocks.rpc,from:mocks.from});
  mocks.getUser.mockResolvedValue({data:{user:{id:aid(1)}},error:null});
  mocks.rpc.mockImplementation(async name=>({data:name==='app_current_actor'?actor():receipt(),error:null}));
});
afterEach(()=>{expect(mocks.from).not.toHaveBeenCalled();vi.unstubAllEnvs();});
describe('Admin restore POST boundary (mocked)',()=>{
  it('only exports POST; validates Auth and bounded command; no cookies/service role',async()=>{
    expect(Object.keys(route)).toEqual(['POST']);const response=await route.POST(request());
    expect(response.status).toBe(200);expect(await response.json()).toEqual({data:receipt()});expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getUser).toHaveBeenCalledWith('test-token');expect(mocks.rpc).toHaveBeenLastCalledWith('app_restore_sales_account_access',{
      p_request_id:aid(99),p_actor_id:aid(1),p_user_id:aid(2),p_expected_revision:1,p_expected_username:command().expectedUsername,p_reason:command().reason,p_confirmed:true});
    expect(mocks.create.mock.calls[0][2].global.headers.Authorization).toBe('Bearer test-token');
  });
  it.each(['NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED','ACCOUNT_ACCESS_READ_ENABLED','ACCOUNT_ACCESS_RESTORE_ENABLED'])('closed flag %s makes no SDK call',async key=>{
    vi.stubEnv(key,'false');expect((await route.POST(request())).status).toBe(503);expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{role:'Admin'},{confirmed:false},{reason:'x'.repeat(9000)}])('rejects invalid/oversized body %j',async patch=>{
    expect((await route.POST(request({...command(),...patch}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects missing bearer, non-JSON, cross-site and mismatched Origin',async()=>{
    for(const [headers,status] of [[{Authorization:''},401],[{'Content-Type':'text/plain'},400],[{Origin:'https://evil.invalid'},403],[{'sec-fetch-site':'cross-site'},403]] as const)
      expect((await route.POST(request(command(),headers))).status).toBe(status);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['sb_secret_bad',`a.${Buffer.from('{"role":"service_role"}').toString('base64url')}.c`])('rejects privileged key %s',async key=>{
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY',key);expect((await route.POST(request())).status).toBe(503);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects different signed-in user before actor RPC',async()=>{
    mocks.getUser.mockResolvedValue({data:{user:{id:aid(2)}}});expect((await route.POST(request())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{role:'Sales',canManageAccounts:false},{role:'Owner',canManageAccounts:false},{role:'Admin',canManageAccounts:false}])('requires canonical Admin %j',async patch=>{
    mocks.rpc.mockResolvedValueOnce({data:{...actor(),...patch},error:null});expect((await route.POST(request())).status).toBe(403);expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each([['42501','secret','FORBIDDEN',403],['22023','ACCOUNT_RESTORE_STATE_CHANGED','STATE_CHANGED',409],['22023','ACCOUNT_RESTORE_REQUEST_CONFLICT','REQUEST_CONFLICT',409],['PGRST202','secret','SETUP_REQUIRED',503],['57014','secret','RESULT_UNKNOWN',503]])('maps safe error %s',async(code,message,expected,status)=>{
    mocks.rpc.mockResolvedValueOnce({data:actor()}).mockResolvedValueOnce({error:{code,message}});
    const response=await route.POST(request());expect(response.status).toBe(status);const body=await response.json();expect(body.error.code).toBe(expected);expect(body.error.message).not.toContain('secret');
  });
  it('malformed receipt after possible commit is uncertain, never retry or fallback',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:actor()}).mockResolvedValueOnce({data:{...receipt(),actorId:aid(9)}});
    expect((await (await route.POST(request())).json()).error.code).toBe('RESULT_UNKNOWN');expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
