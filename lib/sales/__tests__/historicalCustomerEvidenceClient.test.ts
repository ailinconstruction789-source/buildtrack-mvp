// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), watch: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mocks.session, onAuthStateChange: mocks.watch } } }));
import { historicalCustomerEvidenceApi } from '../historicalCustomerEvidenceClient';
import { evidenceSnapshot, historyScope } from './historicalCustomerEvidenceFixtures';
import { bid } from './bookingFixtures';
const fetchMock = vi.fn(), login = (id = bid(8)) => ({ data: { session: { access_token: 'fixture-token', user: { id } } }, error: null });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); mocks.session.mockResolvedValue(login()); fetchMock.mockResolvedValue(Response.json({ data: evidenceSnapshot() })); });
afterEach(() => vi.unstubAllGlobals());
describe('history client only reads and rejects changed identities', () => {
  it('uses authenticated no-store GET with exact null scope and cancellation', async () => {
    const controller = new AbortController(); await historicalCustomerEvidenceApi.read(historyScope, { signal: controller.signal });
    const [url, options] = fetchMock.mock.calls[0]; expect(url).toContain('interestId=&saleId=&page=0');
    expect(options).toMatchObject({ cache:'no-store', credentials:'omit', signal:controller.signal }); expect(options).not.toHaveProperty('body');
  });
  it('never sends a request without session or after cancellation', async () => {
    mocks.session.mockResolvedValueOnce({data:{session:null},error:null}); await expect(historicalCustomerEvidenceApi.read(historyScope)).rejects.toThrow();
    const controller = new AbortController(); controller.abort(); await expect(historicalCustomerEvidenceApi.read(historyScope,{signal:controller.signal})).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects another account after loading, including a reply with the original actor', async () => {
    mocks.session.mockResolvedValueOnce(login()).mockResolvedValueOnce(login(bid(99)));
    await expect(historicalCustomerEvidenceApi.read(historyScope)).rejects.toThrow('บัญชีเปลี่ยน');
  });
  it('rejects a reply for another actor', async () => {
    const data=evidenceSnapshot(); data.actor.userId=bid(99); fetchMock.mockResolvedValue(Response.json({data}));
    await expect(historicalCustomerEvidenceApi.read(historyScope)).rejects.toThrow('บัญชีเปลี่ยน');
  });
  it.each([401,403,409,503])('does not leak server errors on HTTP %s', async status => {
    fetchMock.mockResolvedValue(Response.json({error:{message:'private source detail'}},{status}));
    await expect(historicalCustomerEvidenceApi.read(historyScope)).rejects.toThrow('โหลดประวัติจากต้นทางไม่สำเร็จ');
  });
  it('identity watcher reports initial identity, logout and account changes, ignoring token refresh', () => {
    let callback: (_event:string, session:{user:{id:string}}|null)=>void = () => {}; mocks.watch.mockImplementation(fn=>{callback=fn; return {data:{subscription:{unsubscribe:mocks.unsubscribe}}};});
    const changed=vi.fn(), stop=historicalCustomerEvidenceApi.watchIdentity!(changed);
    callback('INITIAL_SESSION',{user:{id:bid(8)}}); callback('TOKEN_REFRESHED',{user:{id:bid(8)}}); callback('SIGNED_OUT',null); callback('SIGNED_IN',{user:{id:bid(99)}}); stop();
    expect(changed.mock.calls).toEqual([[bid(8)],[null],[bid(99)]]); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
