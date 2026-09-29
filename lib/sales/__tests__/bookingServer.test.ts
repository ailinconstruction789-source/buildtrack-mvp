// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
import { GET, POST } from '@/app/api/sales-crm/bookings/route';
import { GET as SEARCH } from '@/app/api/sales-crm/bookings/search/route';
import { bid, bookingContext, bookingInput, bookingResult } from './bookingFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED'];
const request = (input?: unknown) => new Request(`https://local.test/api/sales-crm/bookings?customerId=${bid(2)}`, {
  method: input ? 'POST' : 'GET', headers: { authorization: 'Bearer fake-token', 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
function configure(role = 'sales', override: Record<string, unknown> = {}) {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name in override) return override[name];
    return { data: name === 'crm_v2_role' ? role : name === 'crm_v2_booking_capabilities' ? { contract_version: 'booking_history_v1', enabled: true }
      : name === 'crm_v2_booking_command' ? bookingResult() : name === 'crm_v2_booking_search' ? { customers: [], page: 0, hasMore: false } : bookingContext(), error: null };
  });
}
beforeEach(() => {
  vi.clearAllMocks(); flags.forEach(flag => vi.stubEnv(flag, 'true'));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-public-key');
  mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from });
  mocks.getUser.mockResolvedValue({ data: { user: { id: bid(8), user_metadata: { role: 'admin' } } }, error: null }); configure();
});
afterEach(() => { expect(mocks.from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
async function check(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Authorization');
  const body = await response.json(); expect(body.error.code).toBe(code); expect(JSON.stringify(body)).not.toContain('fake-token');
}
describe('booking server boundary (mocked only)', () => {
  it('returns validated imported evidence but fails closed on an unproven unknown round', async () => {
    const context = bookingContext();
    Object.assign(context.sales[0], { bookingRound: null, canResume: false, importedHistory: {
      source: 'customer_sheet', batchId: bid(90), sourceRow: 966, sourceStage: 'cancelled',
      bookedDate: '2024-07-22', cancelledDate: null, transferredDate: null } });
    configure('sales', { crm_v2_booking_context: { data: context, error: null } });
    const response = await GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.sales[0]).toEqual(context.sales[0]);
    delete context.sales[0].importedHistory;
    await check(await GET(request()), 503, 'SETUP_REQUIRED');
  });
  it.each(flags)('blocks %s before constructing any network client', async flag => {
    vi.stubEnv(flag, 'false'); await check(await GET(request()), 503, 'FEATURE_DISABLED'); await check(await POST(request(bookingInput())), 503, 'FEATURE_DISABLED');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('rejects missing auth and privileged key configuration', async () => {
    await check(await GET(new Request('https://test.invalid')), 401, 'UNAUTHENTICATED');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_not-a-real-key'); await check(await GET(request()), 503, 'SETUP_REQUIRED');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('uses verified JWT and role RPC, never metadata authorization', async () => {
    configure('visitor'); await check(await POST(request(bookingInput())), 403, 'FORBIDDEN');
    expect(mocks.getUser).toHaveBeenCalledWith('fake-token');
  });
  it('keeps Owner read-only and checks DB capability version/enablement', async () => {
    configure('owner'); await check(await POST(request(bookingInput())), 403, 'FORBIDDEN');
    configure('sales', { crm_v2_booking_capabilities: { data: { contract_version: 'wrong', enabled: true }, error: null } });
    await check(await GET(request()), 503, 'SETUP_REQUIRED');
  });
  it('projects typed history and keeps unknowns, without legacy queries', async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect((await response.json()).data).toEqual(bookingContext());
    expect(mocks.rpc).toHaveBeenCalledWith('crm_v2_booking_context', { p_customer_id: bid(2), p_page: 0 });
  });
  it('search dispatches only the bounded literal-search RPC', async () => {
    const response = await SEARCH(new Request('https://test.invalid/?q=ลูกค้า&page=0', { headers: { authorization: 'Bearer fake-token' } }));
    expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith('crm_v2_booking_search', { p_query: 'ลูกค้า', p_page: 0 });
  });
  it('binds snapshot actor to authenticated user', async () => {
    const data = bookingContext(); data.actor.userId = bid(70); configure('sales', { crm_v2_booking_context: { data } });
    await check(await GET(request()), 503, 'SETUP_REQUIRED');
  });
  it('executes one transaction RPC with the same request key, no split writes', async () => {
    const input = bookingInput(); const { requestId, ...payload } = input;
    const response = await POST(request(input)); expect(response.status).toBe(201); expect((await response.json()).data).toEqual(bookingResult());
    expect(mocks.rpc).toHaveBeenCalledWith('crm_v2_booking_command', { p_request_id: requestId, p_payload: payload });
  });
  it('reports an invalid receipt as uncertain, not a safe-to-resubmit new command', async () => {
    configure('sales', { crm_v2_booking_command: { data: { ...bookingResult(), saleId: 'bad' } } });
    await check(await POST(request(bookingInput())), 503, 'UNKNOWN_RESULT');
  });
  it.each(['STALE_STATE', 'PLOT_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT', 'DUPLICATE_REVIEW_REQUIRED'])('sanitizes %s', async code => {
    configure('sales', { crm_v2_booking_command: { error: { code: 'P0001', message: `CRM_BOOKING_${code}`, details: 'private customer' } } });
    await check(await POST(request(bookingInput())), 409, code);
  });
  it('rejects unknown fields, malformed body, content type and size before any RPC', async () => {
    await check(await POST(request({ ...bookingInput(), actorUserId: bid(8) })), 400, 'INVALID_INPUT');
    await check(await POST(new Request('https://test.invalid', { method: 'POST', body: 'bad' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await check(await POST(request({ ...bookingInput(), reason: 'x'.repeat(17000) })), 413, 'PAYLOAD_TOO_LARGE');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
