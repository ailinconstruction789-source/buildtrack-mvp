// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const getSession=vi.hoisted(()=>vi.fn());vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession}}}));
import {rentalCommandApi,RentalCommandApiError} from '../rentalCommandClient';
import {rentalId,rentalInput,rentalResult,rentalScope,rentalSnapshot} from './rentalCommandFixtures';
const fetchMock=vi.fn();
const session=(id=rentalId(6))=>({data:{session:{access_token:'fixture-token',user:{id}}},error:null});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',fetchMock);getSession.mockResolvedValue(session());});
afterEach(()=>vi.unstubAllGlobals());
describe('canonical rental client',()=>{
  it('reads exact actor scoped context with AbortSignal and no cache',async()=>{
    const signal=new AbortController().signal;fetchMock.mockResolvedValue(Response.json({data:rentalSnapshot()}));
    expect(await rentalCommandApi.read(rentalScope(),{signal})).toEqual(rentalSnapshot());
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/rentals?customerId=${rentalId(2)}&projectName=A&contractId=${rentalId(1)}&contractPage=0&eventPage=0&paymentPage=0&plotPage=0`,
      expect.objectContaining({signal,credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer fixture-token'}}));
  });
  it('sends normalized command only once and validates receipt',async()=>{
    fetchMock.mockResolvedValue(Response.json({data:rentalResult()},{status:201}));
    expect(await rentalCommandApi.save(rentalInput(),rentalId(6))).toEqual(rentalResult());expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(rentalInput());
  });
  it('requires replay status 200 rather than guessing success',async()=>{
    fetchMock.mockResolvedValueOnce(Response.json({data:rentalResult(rentalInput(),true)}));
    expect((await rentalCommandApi.save(rentalInput(),rentalId(6))).replayed).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({data:rentalResult()}));
    await expect(rentalCommandApi.save(rentalInput(),rentalId(6))).rejects.toMatchObject({code:'UNKNOWN_RESULT',definitelyNotSaved:false});
  });
  it('does not send with changed actor or unavailable session',async()=>{
    await expect(rentalCommandApi.save(rentalInput(),rentalId(99))).rejects.toMatchObject({code:'ACTOR_CHANGED',definitelyNotSaved:true});
    getSession.mockResolvedValue({data:{session:null},error:null});await expect(rentalCommandApi.save(rentalInput(),rentalId(6))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects an old-account read and keeps a potentially committed write uncertain',async()=>{
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(rentalId(99)));
    fetchMock.mockResolvedValueOnce(Response.json({data:rentalSnapshot()}));await expect(rentalCommandApi.read(rentalScope())).rejects.toMatchObject({code:'READ_UNAVAILABLE'});
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(rentalId(99)));
    fetchMock.mockResolvedValueOnce(Response.json({data:rentalResult()},{status:201}));
    await expect(rentalCommandApi.save(rentalInput(),rentalId(6))).rejects.toMatchObject({code:'UNKNOWN_RESULT',definitelyNotSaved:false});
  });
  it('prevents an already aborted read from making a request',async()=>{
    const controller=new AbortController();controller.abort();await expect(rentalCommandApi.read(rentalScope(),{signal:controller.signal})).rejects.toMatchObject({code:'READ_UNAVAILABLE'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['IDEMPOTENCY_CONFLICT','UNKNOWN_RESULT'])('does not call %s definitely unsaved',code=>{
    expect(new RentalCommandApiError(code,'fixture',409).definitelyNotSaved).toBe(false);
  });
});
