// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, onAuthStateChange } = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange } } }));
import { visitSopApi, VisitSopApiError } from '../visitSopClient';
import { sopId, sopInput, sopResult, sopScope, sopSnapshot } from './visitSopFixtures';
const fetchMock = vi.fn(), session = (id = sopId(5)) => ({ data: { session: { access_token: 'synthetic-token', user: { id } } }, error: null });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());
describe('SOP JWT client', () => {
  it('reads the exact appointment anchor, omits null Visit and checks actor after response', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: sopSnapshot() })); expect(await visitSopApi.read(sopScope())).toEqual(sopSnapshot());
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/sop?customerId=${sopId(1)}&interestId=${sopId(2)}&eventPage=0&appointmentId=${sopId(3)}`, {
      method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token' },
    }); expect(getSession).toHaveBeenCalledTimes(2);
  });
  it.each(['start', 'save_stage', 'complete_stage', 'start_tour'] as const)('posts only normalized %s command and validates receipt', async command => {
    const input = sopInput({ command }); fetchMock.mockResolvedValue(Response.json({ data: sopResult(input) }, { status: 201 }));
    expect(await visitSopApi.save(input, sopId(5))).toEqual(sopResult(input)); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
    expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/sop', expect.objectContaining({ method: 'POST', credentials: 'omit', cache: 'no-store' }));
  });
  it('blocks invalid scope/input and identity mismatch before send', async () => {
    await expect(visitSopApi.read({ ...sopScope(), appointmentId: null })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(visitSopApi.save({ ...sopInput(), reason: '' }, sopId(5))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(visitSopApi.save(sopInput(), sopId(99))).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects account changes during read without exposing old SOP fields', async () => {
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(sopId(99))); fetchMock.mockResolvedValue(Response.json({ data: sopSnapshot() }));
    await expect(visitSopApi.read(sopScope())).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
  });
  it('requires 200 for replay and 201 for new receipt', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { ...sopResult(), replayed: true } })); expect((await visitSopApi.save(sopInput(), sopId(5))).replayed).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ data: sopResult() })); await expect(visitSopApi.save(sopInput(), sopId(5))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it.each([
    () => Promise.reject(new Error('network interrupted')),
    () => Promise.resolve(new Response('broken', { status: 502 })),
    () => Promise.resolve(Response.json({ data: { ...sopResult(), customerId: sopId(99) } }, { status: 201 })),
    () => Promise.resolve(Response.json({ data: sopResult(), error: { code: 'INVALID_INPUT', message: 'contradiction' } }, { status: 400 })),
  ])('keeps ambiguous result %# uncertain', async response => {
    fetchMock.mockImplementation(response); await expect(visitSopApi.save(sopInput(), sopId(5))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('requires exact definitive status/code, never clears idempotency conflicts', () => {
    for (const code of ['ALREADY_STARTED', 'INCOMPLETE_STAGE', 'VISIT_REQUIRED', 'NEXT_ACTION_REQUIRED']) expect(new VisitSopApiError(code, 'x', 409).definitelyNotSaved).toBe(true);
    expect(new VisitSopApiError('VISIT_REQUIRED', 'x', 500).definitelyNotSaved).toBe(false); expect(new VisitSopApiError('IDEMPOTENCY_CONFLICT', 'x', 409).definitelyNotSaved).toBe(false);
  });
  it('watches actual identity changes only, and unsubscribes', () => {
    const changed = vi.fn(), stop = vi.fn(); onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: stop } } });
    const unsubscribe = visitSopApi.watchIdentity!(changed), callback = onAuthStateChange.mock.calls[0][0];
    callback('INITIAL_SESSION', { user: { id: sopId(5) } }); callback('TOKEN_REFRESHED', { user: { id: sopId(5) } }); expect(changed).not.toHaveBeenCalled();
    callback('SIGNED_OUT', null); expect(changed).toHaveBeenCalledOnce(); unsubscribe(); expect(stop).toHaveBeenCalledOnce();
  });
});
