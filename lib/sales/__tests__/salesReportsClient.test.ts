// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), from: vi.fn(), rpc: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mock.getSession }, from: mock.from, rpc: mock.rpc } }));
import { salesReportsApi } from '../salesReportsClient';
import { reportActor, reportScope, reportSnapshot } from './salesReportsFixtures';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', mock.fetch);
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: reportActor }, access_token: 'fake-token' } }, error: null });
  mock.fetch.mockResolvedValue(Response.json({ data: reportSnapshot() }));
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe('aggregate report browser client', () => {
  it('fetches a whole aggregate using only GET/caller JWT and no-store', async () => {
    expect(await salesReportsApi.read(reportScope())).toEqual(reportSnapshot());
    expect(mock.fetch).toHaveBeenCalledWith('/api/sales-crm/reports?', { method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fake-token' } });
  });
  it('serializes all cohort filters and exact special project names', async () => {
    const scope = reportScope({ projectName: 'โครงการ & B', fromDate: '2024-02-29', toDate: '2024-03-01' });
    mock.fetch.mockResolvedValue(Response.json({ data: reportSnapshot(scope) })); await salesReportsApi.read(scope);
    expect(Object.fromEntries(new URL(mock.fetch.mock.calls[0][0], 'https://test.invalid').searchParams)).toEqual(scope);
  });
  it('rejects invalid scope and missing session before fetch', async () => {
    await expect(salesReportsApi.read(reportScope({ fromDate: '2026-01-01' }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    mock.getSession.mockResolvedValue({ data: { session: null } });
    await expect(salesReportsApi.read(reportScope())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it('binds response to current session actor and requested scope', async () => {
    const raw = reportSnapshot(); raw.actor.userId = '20000000-0000-4000-8000-000000000099';
    mock.fetch.mockResolvedValue(Response.json({ data: raw })); await expect(salesReportsApi.read(reportScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    mock.fetch.mockResolvedValue(Response.json({ data: reportSnapshot(reportScope({ projectName: 'โครงการ A' })) }));
    await expect(salesReportsApi.read(reportScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it('shows setup errors without automatic retry or fallback', async () => {
    mock.fetch.mockResolvedValue(Response.json({ error: { code: 'SETUP_REQUIRED', message: 'ยังไม่พร้อม' } }, { status: 503 }));
    await expect(salesReportsApi.read(reportScope())).rejects.toMatchObject({ code: 'SETUP_REQUIRED', status: 503 }); expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([Response.json({ data: reportSnapshot(), error: {} }), Response.json({ data: reportSnapshot() }, { status: 201 }), new Response('not json')])('rejects ambiguous replies', async reply => {
    mock.fetch.mockResolvedValue(reply); await expect(salesReportsApi.read(reportScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it('does not silently retry a network failure', async () => {
    mock.fetch.mockRejectedValue(new Error('offline')); await expect(salesReportsApi.read(reportScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' }); expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
});
