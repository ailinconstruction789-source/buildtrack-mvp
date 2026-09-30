// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, onAuthStateChange, unsubscribe, rpc, from } = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), unsubscribe: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange }, rpc, from } }));
import { visitFollowUpApi } from '../visitFollowUpClient';
import type { LeadWorkInput } from '../leadWorkContracts';
const USER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', ID = '00000000-0000-4000-8000-000000000001';
const scope = { customerId: ID, interestId: ID };
const input: LeadWorkInput = { ...scope, requestId: ID, command: 'set_next_action', expectedActionId: null,
  nextAction: { action: 'ติดตาม', dueAt: '2026-10-10T12:00:00Z' }, reason: 'ลูกค้าขอนัด' };
const result = { nextActionId: ID, activityId: null, replayed: false };
function snapshot() { return { actor: { userId: USER, role: 'admin' }, scope, customer: { id: ID, name: 'ลูกค้า', phone: null, leadCreatedAt: null },
  projectName: 'โครงการ', owner: { userId: USER, displayName: null, active: true }, scopeClosed: false, lifecycleRevision: ID, canWrite: false,
  asOf: '2026-09-29T12:00:00Z', currentAction: null, actions: [], activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } }; }
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue({ data: { session: { user: { id: USER }, access_token: 'token' } }, error: null }); });
afterEach(() => { vi.unstubAllGlobals(); expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); });
describe('narrow Visit follow-up transport', () => {
  it('reads the fixed scoped API and permits read-only Admin response', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: snapshot() })); expect(await visitFollowUpApi.read(scope)).toEqual(snapshot());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/sales-crm/visit-follow-up?customerId=${ID}&interestId=${ID}`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });
  it('rejects forged write authority on read', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { ...snapshot(), canWrite: true } })); await expect(visitFollowUpApi.read(scope)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
  });
  it('requires interest and set-next-action before session/network access', async () => {
    await expect(visitFollowUpApi.read({ ...scope, interestId: null })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(visitFollowUpApi.save({ ...input, interestId: null }, USER)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(visitFollowUpApi.save({ ...input, command: 'record_attempt', attempt: { action: 'โทร', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-29T12:00:00Z' } }, USER)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getSession).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps request identity unchanged on explicit uncertain retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')); await expect(visitFollowUpApi.save(input, USER)).rejects.toMatchObject({ code: 'NETWORK_ERROR', definitelyNotSaved: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(Response.json({ data: { ...result, replayed: true } })); await expect(visitFollowUpApi.save(input, USER)).resolves.toMatchObject({ replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[0][0]).toBe('/api/sales-crm/visit-follow-up');
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });
  it('blocks a changed actor before POST', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: ID }, access_token: 'token' } }, error: null });
    await expect(visitFollowUpApi.save(input, USER)).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('discards a read response after switching accounts', async () => {
    fetchMock.mockImplementation(async () => {
      getSession.mockResolvedValue({ data: { session: { user: { id: ID }, access_token: 'new-token' } }, error: null });
      return Response.json({ data: snapshot() });
    });
    await expect(visitFollowUpApi.read(scope)).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
  });
  it('subscribes to actual account changes and unsubscribes on cleanup', () => {
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    const changed = vi.fn(), stop = visitFollowUpApi.watchIdentity(changed);
    const callback = onAuthStateChange.mock.calls[0][0];
    callback('INITIAL_SESSION', { user: { id: USER } }); callback('TOKEN_REFRESHED', { user: { id: USER } }); expect(changed).not.toHaveBeenCalled();
    callback('SIGNED_IN', { user: { id: ID } }); callback('SIGNED_OUT', null); expect(changed).toHaveBeenCalledTimes(2);
    stop(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
