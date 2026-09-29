// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mock.getSession }, from: mock.from, rpc: mock.rpc } }));
import { projectMapApi } from '../projectMapClient';
import { projectMapSnapshot } from './projectMapFixtures';
import { pid } from './projectSalesFixtures';
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('fetch', mock.fetch);
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: pid(8) }, access_token: 'fake-token' } }, error: null });
  mock.fetch.mockResolvedValue(Response.json({ data: projectMapSnapshot() }));
});
afterEach(() => { vi.unstubAllGlobals(); expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled(); });
describe('project map browser boundary', () => {
  it('uses GET/no-store only and one project without list filters', async () => {
    expect(await projectMapApi.read('โครงการ A')).toEqual(projectMapSnapshot());
    const [url, init] = mock.fetch.mock.calls[0];
    expect(new URL(url, 'https://test.invalid').searchParams.get('projectName')).toBe('โครงการ A');
    expect(init).toEqual({ method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fake-token' } });
  });
  it('does not read without a session or for invalid project names', async () => {
    await expect(projectMapApi.read('')).rejects.toThrow();
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(projectMapApi.read('โครงการ A')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it('binds project and actor, rejects incomplete snapshots without falling back', async () => {
    const snapshot = projectMapSnapshot(); snapshot.actor = { ...snapshot.actor, userId: pid(99) };
    mock.fetch.mockResolvedValue(Response.json({ data: snapshot }));
    await expect(projectMapApi.read('โครงการ A')).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    mock.fetch.mockResolvedValue(Response.json({ data: projectMapSnapshot() }));
    await expect(projectMapApi.read('โครงการ B')).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
  });
  it.each([new Response('private failure'), Response.json({ error: { code: 'UNKNOWN', message: 'private detail' } }, { status: 500 }),
    Response.json({ data: projectMapSnapshot(), error: {} })])('sanitizes failures and never retries', async response => {
    mock.fetch.mockResolvedValue(response);
    await expect(projectMapApi.read('โครงการ A')).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
});
