import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { readAccountAccess,accountAccessApi } from '../accountAccessClient';
import { aid,scope,snapshot } from './accountAccessFixtures';
const mock=vi.hoisted(()=>({getSession:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:mock}}));
const session=(n=1,token='test-token')=>({data:{session:{user:{id:aid(n)},access_token:token}},error:null});
const fetcher=vi.fn();
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);mock.getSession.mockResolvedValue(session());fetcher.mockResolvedValue(Response.json({data:snapshot()}));});
afterEach(()=>vi.unstubAllGlobals());
describe('read-only account client',()=>{
  it('uses bearer GET and never cookies, direct tables or browser persistence',async()=>{
    expect(await readAccountAccess(scope)).toEqual(snapshot());
    expect(fetcher.mock.calls[0][1]).toEqual({method:'GET',credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer test-token'}});
  });
  it('does not send a request when signed out',async()=>{
    mock.getSession.mockResolvedValue({data:{session:null},error:null});await expect(readAccountAccess(scope)).rejects.toThrow('เข้าสู่ระบบ');expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([session(2),session(1,'new-token'),{data:{session:null},error:null}])('discards response after session change %j',async after=>{
    mock.getSession.mockResolvedValueOnce(session()).mockResolvedValue(after);
    await expect(readAccountAccess(scope)).rejects.toThrow('เซสชันเปลี่ยน');
  });
  it('also checks identity after asynchronously decoding the response',async()=>{
    fetcher.mockResolvedValue({status:200,ok:true,json:async()=>{mock.getSession.mockResolvedValue(session(2));return {data:snapshot()};}});
    await expect(readAccountAccess(scope)).rejects.toThrow('เซสชันเปลี่ยน');
  });
  it('does not leak backend or SDK exception details',async()=>{
    mock.getSession.mockRejectedValueOnce(new Error('secret URL password'));
    await expect(readAccountAccess(scope)).rejects.not.toThrow('secret');
    fetcher.mockResolvedValue(Response.json({error:{code:'FORBIDDEN',message:'secret db details'}},{status:403}));
    await expect(readAccountAccess(scope)).rejects.toThrow('เฉพาะ Admin');
  });
  it('Auth callback invalidates only, without performing SDK calls',()=>{
    const unsubscribe=vi.fn();let callback!:(event:string)=>void;
    mock.onAuthStateChange.mockImplementation(fn=>{callback=fn;return {data:{subscription:{unsubscribe}}};});
    const invalidated=vi.fn();const stop=accountAccessApi.watch(invalidated);
    callback('INITIAL_SESSION');expect(invalidated).not.toHaveBeenCalled();callback('SIGNED_OUT');expect(invalidated).toHaveBeenCalledOnce();
    expect(mock.getSession).not.toHaveBeenCalled();stop();expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
