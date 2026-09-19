import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
import { CentralApiError, centralApi } from '../centralClient';
import type { CentralCreateInput } from '../centralContracts';

const input: CentralCreateInput = {
  requestId: '00000000-0000-4000-8000-000000000001', name: 'ลูกค้า', phone: '0812345678', channel: 'โทร', notes: '', interests: [],
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'caller-token' } }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('central browser transport', () => {
  it('requires a session without making a network request', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(centralApi.read(0)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends the current bearer token, with no cache or cookies', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { customers: [] } }));
    await centralApi.read(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/central?page=2', {
      method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer caller-token' },
    });
  });
  it('preserves the request ID and does not retry or fall back to a legacy write', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { customerId: input.requestId, replayed: true } }));
    await expect(centralApi.create(input)).resolves.toMatchObject({ replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/central', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }));
  });
  it.each([
    ['FEATURE_DISABLED', 503, true], ['SETUP_REQUIRED', 503, true], ['PLOT_UNAVAILABLE', 409, true],
    ['DUPLICATE_REVIEW_REQUIRED', 409, true], ['IDEMPOTENCY_CONFLICT', 409, false], ['SERVICE_UNAVAILABLE', 503, false],
  ])('classifies %s without treating uncertain outcomes as safe to recreate', async (code, status, definitelyNotSaved) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code, message: 'ข้อความจากระบบ' } }, { status: Number(status) }));
    const error = await centralApi.create(input).catch(failure => failure as CentralApiError);
    expect(error).toBeInstanceOf(CentralApiError);
    expect(error).toHaveProperty('definitelyNotSaved', definitelyNotSaved);
  });
  it.each(['<html>gateway failure</html>', '{}', '{"data":null}'])('never treats an invalid response as a safe failed write: %s', async body => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
    await expect(centralApi.create(input)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it.each([null, {}, { customerId: 'not-a-uuid', replayed: false }])('does not show success for malformed HTTP 200 data: %j', async data => {
    fetchMock.mockResolvedValue(Response.json({ data }));
    await expect(centralApi.create(input)).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
});
