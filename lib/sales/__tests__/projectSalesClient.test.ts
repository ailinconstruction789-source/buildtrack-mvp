// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), from: vi.fn(), rpc: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mock.getSession }, from: mock.from, rpc: mock.rpc } }));
import { projectSalesApi } from '../projectSalesClient';
import { pid, projectScope, projectSnapshot } from './projectSalesFixtures';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', mock.fetch);
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: pid(8) }, access_token: 'fake-token' } }, error: null });
  mock.fetch.mockResolvedValue(Response.json({ data: projectSnapshot() }));
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe('project sales browser read client', () => {
  it('uses only GET/no-store with session JWT and serialized project scope', async () => {
    expect(await projectSalesApi.read(projectScope())).toEqual(projectSnapshot());
    const [url, options] = mock.fetch.mock.calls[0];
    expect(new URL(url, 'https://test.invalid').searchParams.get('projectName')).toBe('โครงการ A');
    expect(options).toEqual({ method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fake-token' } });
  });
  it('rejects invalid scopes and missing sessions before any fetch', async () => {
    await expect(projectSalesApi.read(projectScope({ page: -1 }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(projectSalesApi.read(projectScope())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it('binds rows to requested project and snapshot actor to session actor', async () => {
    const snapshot = projectSnapshot(); snapshot.actor.userId = pid(60);
    mock.fetch.mockResolvedValue(Response.json({ data: snapshot }));
    await expect(projectSalesApi.read(projectScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    mock.fetch.mockResolvedValue(Response.json({ data: projectSnapshot(projectScope({ projectName: 'โครงการ B' })) }));
    await expect(projectSalesApi.read(projectScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it('keeps setup/permission errors visible without legacy fallback or automatic retry', async () => {
    mock.fetch.mockResolvedValue(Response.json({ error: { code: 'SETUP_REQUIRED', message: 'ยังไม่พร้อม' } }, { status: 503 }));
    await expect(projectSalesApi.read(projectScope())).rejects.toMatchObject({ code: 'SETUP_REQUIRED', status: 503 });
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([Response.json({ data: projectSnapshot(), error: {} }), Response.json({ data: projectSnapshot() }, { status: 201 }), new Response('not json')])('rejects ambiguous envelope/status', async response => {
    mock.fetch.mockResolvedValue(response); await expect(projectSalesApi.read(projectScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it('does not retry failed network reads silently', async () => {
    mock.fetch.mockRejectedValue(new Error('offline')); await expect(projectSalesApi.read(projectScope())).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
});
