// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
import { visitsApi, VisitsApiError } from '../visitsClient';
import { VISIT_COMMANDS } from '../visitsContracts';
import { actorId, vid, visitInput, visitResult, visitsScope, visitsSnapshot } from '../../../components/sales/__tests__/visitsFixtures';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token', user: { id: actorId } } }, error: null });
});
afterEach(() => vi.unstubAllGlobals());
describe('visits JWT client', () => {
  it('reads only the requested scope with three page cursors and no cache', async () => {
    const scope = visitsScope({ appointmentPage: 2, visitPage: 3, eventPage: 4 });
    fetchMock.mockResolvedValue(Response.json({ data: visitsSnapshot(scope) }));
    expect(await visitsApi.read(scope)).toEqual(visitsSnapshot(scope));
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/visits?customerId=${scope.customerId}&interestId=${scope.interestId}&appointmentPage=2&visitPage=3&eventPage=4`, {
      method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token' },
    });
  });
  it.each(VISIT_COMMANDS)('sends one normalized %s command and validates its receipt', async command => {
    const input = visitInput(command); fetchMock.mockResolvedValue(Response.json({ data: visitResult(input) }, { status: 201 }));
    expect(await visitsApi.save(input, actorId)).toEqual(visitResult(input));
    expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/visits', expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'omit' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });
  it('requires status 200 for replay and 201 for a new result', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: visitResult(visitInput(), true) }));
    expect((await visitsApi.save(visitInput(), actorId)).replayed).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ data: visitResult() }));
    await expect(visitsApi.save(visitInput(), actorId)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('rejects changed actors, missing sessions and invalid input before network writes', async () => {
    await expect(visitsApi.save(visitInput(), vid(99))).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true });
    await expect(visitsApi.save({ ...visitInput(), occurredAt: '2026-09-23' }, actorId)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(visitsApi.read(visitsScope({ visitPage: -1 }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(visitsApi.save(visitInput(), actorId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    () => Promise.reject(new Error('network interrupted')),
    () => Promise.resolve(new Response('<html>error</html>', { status: 502 })),
    () => Promise.resolve(Response.json({ data: { ...visitResult(), interestId: vid(99) } }, { status: 201 })),
    () => Promise.resolve(Response.json({ data: visitResult(), error: { code: 'INVALID_INPUT', message: 'contradictory' } }, { status: 400 })),
  ])('keeps ambiguous responses uncertain %#', async reply => {
    fetchMock.mockImplementation(reply); await expect(visitsApi.save(visitInput(), actorId)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('matches definitive codes to HTTP status without treating idempotency conflicts as failed writes', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'STALE_STATE', message: 'โหลดใหม่' } }, { status: 409 }));
    await expect(visitsApi.save(visitInput(), actorId)).rejects.toMatchObject({ code: 'STALE_STATE', definitelyNotSaved: true });
    expect(new VisitsApiError('STALE_STATE', 'x', 500).definitelyNotSaved).toBe(false);
    expect(new VisitsApiError('SCOPE_CLOSED', 'x', 409).definitelyNotSaved).toBe(true);
    expect(new VisitsApiError('IDEMPOTENCY_CONFLICT', 'x', 409).definitelyNotSaved).toBe(false);
  });
  it('rejects wrong actor and scope snapshots', async () => {
    const snapshot = visitsSnapshot(); snapshot.actor.userId = vid(99); snapshot.scope.canEdit = false;
    fetchMock.mockResolvedValueOnce(Response.json({ data: snapshot })); await expect(visitsApi.read(visitsScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    fetchMock.mockResolvedValueOnce(Response.json({ data: visitsSnapshot(visitsScope({ appointmentPage: 1 })) }));
    await expect(visitsApi.read(visitsScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
});
