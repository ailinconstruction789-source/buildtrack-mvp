// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: session } } }));
import { customerDealReadApi } from '../customerDealReadClient';
import { customerHistoryTimeline } from '../customerHistory';
import { bid } from './bookingFixtures';
const scope = { saleId: bid(5), projectName: 'โครงการ A' };
const fetchMock = vi.fn();
const login = (id = bid(8)) => ({ data: { session: { access_token: 'fixture-token', user: { id } } }, error: null });
const snapshot = () => ({ actor: { userId: bid(8), role: 'sales' }, customer: { id: bid(2), name: 'ลูกค้าเก่า', phone: null },
  deal: { id: bid(5), customerId: bid(2), interestId: bid(3), projectName: scope.projectName, plotId: 'A-01', stage: 'transferred',
    leadId: null, origin: 'historical', revision: bid(6), salePrice: null, bankName: null, paymentMethod: null },
  history: customerHistoryTimeline({}, undefined, { transferred: '2025-03-01' }), readOnly: true });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); session.mockResolvedValue(login()); fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); });
afterEach(() => vi.unstubAllGlobals());
describe('read-only historical CRM detail client', () => {
  it('uses only the scoped authenticated no-store GET, with no Lead creation', async () => {
    const result = await customerDealReadApi.read(scope);
    expect(result.deal.leadId).toBeNull(); expect(result.history.find(h => h.event === 'contracted')?.date).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]; expect(new URL(url, 'https://fixture.invalid').searchParams.get('saleId')).toBe(scope.saleId);
    expect(options).toMatchObject({ cache: 'no-store', credentials: 'omit' }); expect(options).not.toHaveProperty('body');
  });
  it('rejects missing session before sending any request', async () => {
    session.mockResolvedValue({ data: { session: null }, error: null });
    await expect(customerDealReadApi.read(scope)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not start a cancelled detail read and forwards active cancellation to fetch', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(customerDealReadApi.read(scope, { signal: controller.signal })).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
    const active = new AbortController(); await customerDealReadApi.read(scope, { signal: active.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(active.signal);
  });
  it('discards the reply if the account changed while loading', async () => {
    session.mockResolvedValueOnce(login()).mockResolvedValueOnce(login(bid(99)));
    await expect(customerDealReadApi.read(scope)).rejects.toThrow('บัญชีเปลี่ยน');
  });
  it('discards replies for another actor, sale or customer', async () => {
    for (const change of ['actor','sale','customer']) {
      const data = snapshot();
      if (change === 'actor') data.actor.userId = bid(99);
      if (change === 'sale') data.deal.id = bid(99);
      if (change === 'customer') data.deal.customerId = bid(99);
      fetchMock.mockResolvedValue(Response.json({ data })); await expect(customerDealReadApi.read(scope)).rejects.toThrow();
    }
  });
  it.each([401,403,409,503])('fails closed on HTTP %s without leaking server errors', async status => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'private database detail' } }, { status }));
    await expect(customerDealReadApi.read(scope)).rejects.toThrow('โหลดข้อมูลลูกค้า CRM ไม่สำเร็จ');
  });
});
