// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
import { BookingApiError, bookingApi } from '../bookingClient';
import { bid, bookingContext, bookingInput, bookingResult } from './bookingFixtures';
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue({ data: { session: { access_token: 'test', user: { id: bid(8) } } }, error: null }); });
afterEach(() => vi.unstubAllGlobals());
describe('booking client receipts', () => {
  it('blocks a changed account before sending booking intent', async () => {
    await expect(bookingApi.save(bookingInput(), bid(70))).rejects.toMatchObject({ code: 'ACTOR_CHANGED', definitelyNotSaved: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses one no-store authenticated command request', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: bookingResult() }, { status: 201 }));
    expect(await bookingApi.save(bookingInput(), bid(8))).toEqual(bookingResult());
    expect(fetchMock).toHaveBeenCalledWith('/api/sales-crm/bookings', expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'omit' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(bookingInput());
  });
  it('keeps dropped replies and invalid receipts uncertain', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network')); await expect(bookingApi.save(bookingInput(), bid(8))).rejects.toMatchObject({ definitelyNotSaved: false });
    fetchMock.mockResolvedValue(Response.json({ data: { ...bookingResult(), customerId: bid(99) } }, { status: 201 }));
    await expect(bookingApi.save(bookingInput(), bid(8))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', definitelyNotSaved: false });
  });
  it('validates status and replay indicator together', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { ...bookingResult(), replayed: true } }, { status: 200 }));
    expect((await bookingApi.save(bookingInput(), bid(8))).replayed).toBe(true);
    fetchMock.mockResolvedValue(Response.json({ data: bookingResult() }, { status: 200 }));
    await expect(bookingApi.save(bookingInput(), bid(8))).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
  });
  it('reads validated historical snapshots without inventing amounts', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: bookingContext() })); expect(await bookingApi.read(bid(2), 0)).toEqual(bookingContext());
  });
  it('does not treat an idempotency conflict or unexpected error as not saved', () => {
    expect(new BookingApiError('IDEMPOTENCY_CONFLICT', 'conflict', 409).definitelyNotSaved).toBe(false);
    expect(new BookingApiError('UNKNOWN_RESULT', 'unknown', 400).definitelyNotSaved).toBe(false);
    expect(new BookingApiError('PLOT_UNAVAILABLE', 'plot', 409).definitelyNotSaved).toBe(true);
  });
});
