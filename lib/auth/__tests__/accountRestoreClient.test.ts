import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {restoreAccountAccess} from '../accountRestoreClient';
import {command,receipt} from './accountRestoreFixtures';
import {aid} from './accountAccessFixtures';
const mock=vi.hoisted(()=>({getSession:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:mock}}));
const session=(id=aid(1),token='test-token')=>({data:{session:{user:{id},access_token:token}},error:null});
const fetcher=vi.fn();
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);mock.getSession.mockResolvedValue(session());fetcher.mockImplementation(async()=>Response.json({data:receipt()}));});
afterEach(()=>vi.unstubAllGlobals());
describe('restore client',()=>{
  it('POSTs only explicit command with caller bearer; no automatic retry',async()=>{
    expect(await restoreAccountAccess(command())).toEqual(receipt());expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'omit',cache:'no-store',body:JSON.stringify(command()),headers:{Authorization:'Bearer test-token'}});
  });
  it('never sends stale actor command under another account',async()=>{
    mock.getSession.mockResolvedValue(session(aid(2)));await expect(restoreAccountAccess(command())).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([session(aid(2)),session(aid(1),'refreshed'),{data:{session:null},error:null}])('does not display success after session change %j',async after=>{
    mock.getSession.mockResolvedValueOnce(session()).mockResolvedValue(after);await expect(restoreAccountAccess(command())).rejects.toMatchObject({code:'RESULT_UNKNOWN'});
  });
  it('rechecks session after JSON decode',async()=>{
    fetcher.mockResolvedValue({status:200,ok:true,json:async()=>{mock.getSession.mockResolvedValue(session(aid(2)));return{data:receipt()};}});
    await expect(restoreAccountAccess(command())).rejects.toMatchObject({code:'RESULT_UNKNOWN'});
  });
  it('connection lost can be retried manually with same id only',async()=>{
    fetcher.mockRejectedValueOnce(new Error('private network detail'));await expect(restoreAccountAccess(command())).rejects.toMatchObject({code:'RESULT_UNKNOWN'});
    expect(fetcher).toHaveBeenCalledOnce();await restoreAccountAccess(command());expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it('hides raw error and malformed success data',async()=>{
    fetcher.mockResolvedValueOnce(Response.json({error:{code:'STATE_CHANGED',message:'secret'}},{status:409}));
    await expect(restoreAccountAccess(command())).rejects.toMatchObject({code:'STATE_CHANGED'});
    fetcher.mockResolvedValueOnce(Response.json({data:{...receipt(),userId:aid(3)}}));await expect(restoreAccountAccess(command())).rejects.toMatchObject({code:'RESULT_UNKNOWN'});
  });
});
