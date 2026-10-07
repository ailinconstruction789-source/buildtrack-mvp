// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
import { postBookingApi, PostBookingApiError } from '../postBookingClient';
import { pbid, pbInput, pbLoanResult, pbResult, pbScope, pbSnapshot, pbSubmit, pbTransfer } from './postBookingFixtures';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token', user: { id: pbid(6) } } }, error: null });
});
afterEach(() => vi.unstubAllGlobals());
describe('post-booking caller JWT client', () => {
  it('reads an independently paged, actor-bound snapshot with no cache', async () => {
    const scope = pbScope({ attemptPage: 2, eventPage: 3 });
    fetchMock.mockResolvedValue(Response.json({ data: pbSnapshot(scope) }));
    expect(await postBookingApi.read(scope)).toEqual(pbSnapshot(scope));
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/post-booking?saleId=${scope.saleId}&attemptPage=2&eventPage=3`, {
      method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token' },
    });
  });
  it.each([pbInput(), pbSubmit(), pbLoanResult(), pbTransfer()])('sends one normalized command and validates its receipt: $command', async input => {
    fetchMock.mockResolvedValue(Response.json({ data: pbResult(input) }, { status: 201 }));
    expect(await postBookingApi.save(input, pbid(6))).toEqual(pbResult(input));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/post-booking', expect.objectContaining({
      method: 'POST', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });
  it('accepts replay only together with status 200', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: pbResult(pbInput(), true) }));
    expect((await postBookingApi.save(pbInput(), pbid(6))).replayed).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ data: pbResult() }));
    await expect(postBookingApi.save(pbInput(), pbid(6))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('does not send with no session or a changed actor', async () => {
    await expect(postBookingApi.save(pbInput(), pbid(99))).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(postBookingApi.save(pbInput(), pbid(6))).rejects.toMatchObject({ code: 'UNAUTHENTICATED', definitelyNotSaved: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects invalid commands and scopes before auth/fetch', async () => {
    await expect(postBookingApi.save({ ...pbInput(), occurredAt: '2026-09-23' }, pbid(6))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(postBookingApi.read(pbScope({ eventPage: -1 }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    () => Promise.reject(new Error('dropped connection')),
    () => Promise.resolve(new Response('<html>proxy error</html>', { status: 502 })),
    () => Promise.resolve(Response.json({ data: { ...pbResult(), saleId: pbid(90) } }, { status: 201 })),
    () => Promise.resolve(Response.json({ data: pbResult(), error: { code: 'INVALID_INPUT', message: 'contradictory' } }, { status: 400 })),
  ])('keeps missing or contradictory replies uncertain %#', async reply => {
    fetchMock.mockImplementation(reply);
    await expect(postBookingApi.save(pbInput(), pbid(6))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('checks known error code/status pairs but never treats idempotency conflict as not saved', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'STALE_STATE', message: 'โหลดใหม่' } }, { status: 409 }));
    await expect(postBookingApi.save(pbInput(), pbid(6))).rejects.toMatchObject({ code: 'STALE_STATE', definitelyNotSaved: true });
    expect(new PostBookingApiError('STALE_STATE', 'x', 500).definitelyNotSaved).toBe(false);
    expect(new PostBookingApiError('IDEMPOTENCY_CONFLICT', 'x', 409).definitelyNotSaved).toBe(false);
  });
  it('does not accept another transfer day or a dropped response as a failed write', async () => {
    const input = pbTransfer();
    fetchMock.mockResolvedValueOnce(Response.json({ data: { ...pbResult(input), transferDate: '2026-09-22' } }, { status: 201 }));
    await expect(postBookingApi.save(input, pbid(6))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(postBookingApi.save(input, pbid(6))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('does not render another actor or another page as the requested snapshot', async () => {
    const snapshot = pbSnapshot(); snapshot.actor.userId = pbid(90); snapshot.sale.canEdit = false;
    fetchMock.mockResolvedValueOnce(Response.json({ data: snapshot }));
    await expect(postBookingApi.read(pbScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    fetchMock.mockResolvedValueOnce(Response.json({ data: pbSnapshot(pbScope({ eventPage: 1 })) }));
    await expect(postBookingApi.read(pbScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
});
