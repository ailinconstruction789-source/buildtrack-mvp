// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const getSession=vi.hoisted(()=>vi.fn());vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession}}}));
import {customerDealEditApi,CustomerDealEditApiError} from '../customerDealEditClient';
import {editId,editInput,editResult,editScope,editSnapshot} from './customerDealEditFixtures';
const fetchMock=vi.fn();
const session=(id=editId(6))=>({data:{session:{access_token:'fixture-token',user:{id}}},error:null});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',fetchMock);getSession.mockResolvedValue(session());});
afterEach(()=>vi.unstubAllGlobals());
describe('customer/deal details client',()=>{
  it('reads exact actor scoped context with AbortSignal and no cache',async()=>{
    const signal=new AbortController().signal;fetchMock.mockResolvedValue(Response.json({data:editSnapshot()}));
    expect(await customerDealEditApi.read(editScope(),{signal})).toEqual(editSnapshot());
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/customer-deal/details?saleId=${editId(1)}&projectName=A`,
      expect.objectContaining({signal,credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer fixture-token'}}));
  });
  it('sends normalized command only once and validates receipt',async()=>{
    fetchMock.mockResolvedValue(Response.json({data:editResult()},{status:201}));
    expect(await customerDealEditApi.save(editInput(),editId(6))).toEqual(editResult());expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(editInput());
  });
  it('requires replay status 200 rather than guessing success',async()=>{
    fetchMock.mockResolvedValueOnce(Response.json({data:editResult(editInput(),true)}));
    expect((await customerDealEditApi.save(editInput(),editId(6))).replayed).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({data:editResult()}));
    await expect(customerDealEditApi.save(editInput(),editId(6))).rejects.toMatchObject({code:'UNKNOWN_RESULT',definitelyNotSaved:false});
  });
  it('does not send with changed actor or unavailable session',async()=>{
    await expect(customerDealEditApi.save(editInput(),editId(99))).rejects.toMatchObject({code:'ACTOR_CHANGED',definitelyNotSaved:true});
    getSession.mockResolvedValue({data:{session:null},error:null});await expect(customerDealEditApi.save(editInput(),editId(6))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects an old-account read and keeps a potentially committed write uncertain',async()=>{
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(editId(99)));
    fetchMock.mockResolvedValueOnce(Response.json({data:editSnapshot()}));await expect(customerDealEditApi.read(editScope())).rejects.toMatchObject({code:'READ_UNAVAILABLE'});
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(editId(99)));
    fetchMock.mockResolvedValueOnce(Response.json({data:editResult()},{status:201}));
    await expect(customerDealEditApi.save(editInput(),editId(6))).rejects.toMatchObject({code:'UNKNOWN_RESULT',definitelyNotSaved:false});
  });
  it('prevents an already aborted read from making a request',async()=>{
    const controller=new AbortController();controller.abort();await expect(customerDealEditApi.read(editScope(),{signal:controller.signal})).rejects.toMatchObject({code:'READ_UNAVAILABLE'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['IDEMPOTENCY_CONFLICT','UNKNOWN_RESULT'])('does not call %s definitely unsaved',code=>{
    expect(new CustomerDealEditApiError(code,'fixture',409).definitelyNotSaved).toBe(false);
  });
});
