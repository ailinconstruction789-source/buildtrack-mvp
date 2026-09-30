// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, onAuthStateChange } = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange } } }));
import { customerVoicesApi, customerVoicePublicApi, CustomerVoicesApiError } from '../customerVoicesClient';
import { voiceId, voiceInput, voiceResult, voiceScope, voiceSnapshot, voiceSubmission, voiceToken } from './customerVoicesFixtures';
const fetchMock = vi.fn(), session = (id = voiceId(5)) => ({ data: { session: { access_token: 'synthetic-jwt', user: { id } } }, error: null });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(session()); });
afterEach(() => vi.unstubAllGlobals());
describe('Customer Voices isolated staff and public clients', () => {
  it('reads only the exact Visit scope with staff JWT and checks the actor again', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: voiceSnapshot() })); expect(await customerVoicesApi.read(voiceScope())).toEqual(voiceSnapshot());
    expect(fetchMock).toHaveBeenCalledWith(`/api/sales-crm/customer-voices?customerId=${voiceId(1)}&interestId=${voiceId(2)}&visitId=${voiceId(3)}`, {
      method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer synthetic-jwt' },
    }); expect(getSession).toHaveBeenCalledTimes(2);
  });
  it.each(['issue', 'revoke'] as const)('posts normalized %s with expected actor and validates receipt', async command => {
    const input = { ...voiceInput(), command, ...(command === 'revoke' ? { token: null, expectedTokenId: voiceId(40) } : {}) };
    fetchMock.mockResolvedValue(Response.json({ data: voiceResult(input) }, { status: 201 })); expect(await customerVoicesApi.save(input, voiceId(5))).toEqual(voiceResult(input));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input); expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-jwt');
  });
  it('blocks malformed scope, input and changed account before write', async () => {
    await expect(customerVoicesApi.read({ ...voiceScope(), visitId: 'bad' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(customerVoicesApi.save({ ...voiceInput(), reason: '' }, voiceId(5))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(customerVoicesApi.save(voiceInput(), voiceId(99))).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects changed identity, other scopes and leaked answers on staff reads', async () => {
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(voiceId(99))); fetchMock.mockResolvedValue(Response.json({ data: voiceSnapshot() }));
    await expect(customerVoicesApi.read(voiceScope())).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
    const other = voiceSnapshot(); other.scope.visitId = voiceId(99); fetchMock.mockResolvedValue(Response.json({ data: other }));
    await expect(customerVoicesApi.read(voiceScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it('opens public link without reading auth, credentials, Authorization or query capability', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { formVersion: 'customer_voices_v1', expiresAt: '2026-09-25T10:00:00Z' } }));
    await customerVoicePublicApi.request({ command: 'open', token: voiceToken }); expect(getSession).not.toHaveBeenCalled(); expect(onAuthStateChange).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/customer-voices', { method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'open', token: voiceToken }) });
  });
  it('submits public answers without auth and requires proper replay status', async () => {
    const input = voiceSubmission(); fetchMock.mockResolvedValueOnce(Response.json({ data: { submitted: true, replayed: false } }, { status: 201 }));
    expect(await customerVoicePublicApi.request(input)).toEqual({ submitted: true, replayed: false });
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submitted: true, replayed: true } })); expect(await customerVoicePublicApi.request(input)).toEqual({ submitted: true, replayed: true });
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submitted: true, replayed: false } })); await expect(customerVoicePublicApi.request(input)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    expect(getSession).not.toHaveBeenCalled();
  });
  it('rejects public identity fields and optional prefilled data outside the contract before send', async () => {
    await expect(customerVoicePublicApi.request({ ...voiceSubmission(), answers: { ...voiceSubmission().answers, customer_name: 'secret' } } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(customerVoicePublicApi.request({ command: 'open', token: 'invalid' })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    () => Promise.reject(new Error('network secret')),
    () => Promise.resolve(new Response('broken secret', { status: 502 })),
    () => Promise.resolve(Response.json({ data: { ...voiceResult(), visitId: voiceId(99) } }, { status: 201 })),
    () => Promise.resolve(Response.json({ data: voiceResult(), error: { code: 'INVALID_INPUT', message: 'secret' } }, { status: 400 })),
  ])('keeps ambiguous staff result %# uncertain and sanitizes errors', async response => {
    fetchMock.mockImplementation(response); await expect(customerVoicesApi.save(voiceInput(), voiceId(5))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('does not reflect server error messages; 410 is terminal only before any uncertainty', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'TOKEN_UNAVAILABLE', message: voiceToken } }, { status: 410 }));
    try { await customerVoicePublicApi.request(voiceSubmission()); throw new Error('expected rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'TOKEN_UNAVAILABLE', definitelyNotSaved: true }); expect((error as Error).message).not.toContain(voiceToken); }
    expect(new CustomerVoicesApiError('TOKEN_UNAVAILABLE', 409).definitelyNotSaved).toBe(false);
    expect(new CustomerVoicesApiError('IDEMPOTENCY_CONFLICT', 409).definitelyNotSaved).toBe(false);
  });
  it('watches real staff identity changes and releases the asynchronously loaded subscription', async () => {
    const changed = vi.fn(), stop = vi.fn(); onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: stop } } });
    const unsubscribe = customerVoicesApi.watchIdentity!(changed); await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledOnce());
    const callback = onAuthStateChange.mock.calls[0][0]; callback('INITIAL_SESSION', { user: { id: voiceId(5) } }); callback('TOKEN_REFRESHED', { user: { id: voiceId(5) } });
    expect(changed).not.toHaveBeenCalled(); callback('SIGNED_OUT', null); expect(changed).toHaveBeenCalledOnce(); unsubscribe(); expect(stop).toHaveBeenCalledOnce();
  });
  it('does not subscribe when disposed before dynamic auth import completes', async () => {
    const unsubscribe = customerVoicesApi.watchIdentity!(vi.fn()); unsubscribe(); await new Promise(resolve => setTimeout(resolve, 0)); expect(onAuthStateChange).not.toHaveBeenCalled();
  });
});
