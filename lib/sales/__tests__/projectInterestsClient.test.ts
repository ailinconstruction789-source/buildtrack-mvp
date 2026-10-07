// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, onAuthStateChange } = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange } } }));
import { projectInterestsApi, ProjectInterestsApiError } from '../projectInterestsClient';
import { piId, piInput, piResult, piScope, piSnapshot } from './projectInterestsFixtures';
const fetchMock = vi.fn();
const session = (id = piId(6)) => ({ data: { session: { access_token: 'synthetic-token', user: { id } } }, error: null });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());
describe('project interests JWT client', () => {
  it('reads exact customer/page without cache and validates the identity again afterwards', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: piSnapshot() })); expect(await projectInterestsApi.read(piScope)).toEqual(piSnapshot());
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/interests?customerId=${piId(1)}&page=0`, {
      method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token' },
    }); expect(getSession).toHaveBeenCalledTimes(2);
  });
  it('sends one normalized command bound to the current actor and validates the receipt', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: piResult() }, { status: 201 }));
    expect(await projectInterestsApi.save(piInput({ reason: '  ลูกค้าขอเข้าชมโครงการ  ' }), piId(6))).toEqual(piResult());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/interests', expect.objectContaining({ method: 'POST', credentials: 'omit', cache: 'no-store' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(piInput());
  });
  it('rejects invalid input, missing sessions and wrong actors before network writes', async () => {
    await expect(projectInterestsApi.read({ ...piScope, page: -1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(projectInterestsApi.save(piInput({ reason: '' }), piId(6))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(projectInterestsApi.save(piInput(), piId(8))).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(projectInterestsApi.save(piInput(), piId(6))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never exposes old data after account changes during the read', async () => {
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(piId(8)));
    fetchMock.mockResolvedValue(Response.json({ data: piSnapshot() }));
    await expect(projectInterestsApi.read(piScope)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
  });
  it('rejects wrong read actor/customer/page and non-200 responses', async () => {
    const actor = piSnapshot(); actor.actor.userId = piId(8); actor.customer.canAdd = false;
    const customer = piSnapshot(); customer.customer.id = piId(8);
    for (const snapshot of [actor, customer, { ...piSnapshot(), page: 1 }]) {
      fetchMock.mockResolvedValueOnce(Response.json({ data: snapshot })); await expect(projectInterestsApi.read(piScope)).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    }
    fetchMock.mockResolvedValueOnce(Response.json({ data: piSnapshot() }, { status: 201 })); await expect(projectInterestsApi.read(piScope)).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it('requires 200 for replay and 201 for a newly saved command', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: piResult(piInput(), { replayed: true }) }));
    expect((await projectInterestsApi.save(piInput(), piId(6))).replayed).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ data: piResult() }));
    await expect(projectInterestsApi.save(piInput(), piId(6))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it.each([
    () => Promise.reject(new Error('connection failed')),
    () => Promise.resolve(new Response('<html>failed</html>', { status: 502 })),
    () => Promise.resolve(Response.json({ data: piResult(piInput(), { projectName: 'different' }) }, { status: 201 })),
    () => Promise.resolve(Response.json({ error: [], data: piResult() }, { status: 400 })),
    () => Promise.resolve(Response.json({ error: [] }, { status: 400 })),
  ])('keeps ambiguous response %# uncertain', async reply => {
    fetchMock.mockImplementation(reply); await expect(projectInterestsApi.save(piInput(), piId(6))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('only trusts exact definitive code/status pairs, never idempotency conflicts', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'PROJECT_EXISTS', message: 'ใช้รายการเดิม' } }, { status: 409 }));
    await expect(projectInterestsApi.save(piInput(), piId(6))).rejects.toMatchObject({ code: 'PROJECT_EXISTS', definitelyNotSaved: true });
    expect(new ProjectInterestsApiError('PROJECT_EXISTS', 'x', 500).definitelyNotSaved).toBe(false);
    expect(new ProjectInterestsApiError('IDEMPOTENCY_CONFLICT', 'x', 409).definitelyNotSaved).toBe(false);
    expect(new ProjectInterestsApiError('unexpected', 'x', 403).definitelyNotSaved).toBe(false);
  });
  it('watches identity changes, ignores token refresh for same user and unsubscribes', () => {
    const stop = vi.fn(), changed = vi.fn();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: stop } } });
    const unsubscribe = projectInterestsApi.watchIdentity!(changed), callback = onAuthStateChange.mock.calls[0][0];
    callback('INITIAL_SESSION', { user: { id: piId(6) } }); callback('TOKEN_REFRESHED', { user: { id: piId(6) } }); expect(changed).not.toHaveBeenCalled();
    callback('SIGNED_IN', { user: { id: piId(8) } }); callback('SIGNED_OUT', null); expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe(); expect(stop).toHaveBeenCalledOnce();
  });
});
