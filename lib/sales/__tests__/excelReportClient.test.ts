// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), index: vi.fn(), fetch: vi.fn(), watch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mock.getSession } } }));
vi.mock('../projectSalesClient', () => ({ projectSalesApi: { read: mock.index } }));
vi.mock('../centralClient', () => ({ centralApi: { watchIdentity: mock.watch } }));
import { excelReportApi } from '../excelReportClient';
import { projectMapSnapshot } from './projectMapFixtures';
import { pid } from './projectSalesFixtures';
const map = projectMapSnapshot();
const session = (id = map.actor.userId) => ({ data: { session: { user: { id }, access_token: 'fake-token' } }, error: null });
const data = () => ({ map, catalog: map.plots.map(plot => ({ plotId: plot.id, basePrice: null, appraisalPrice: null, isInfrastructure: false })),
  evidence: { contractVersion: 'excel_evidence_v1', projectName: map.projectName, actor: map.actor,
    legacyVisits: [], completedVisits: [], forecasts: [], pendingLegacyRows: 0, pendingLegacyKeys: [], unknownLegacyDates: 0,
    unassignedLegacyVisits: [], unknownUnassignedLegacyDates: 0 } });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('fetch', mock.fetch);
  mock.getSession.mockResolvedValue(session());
  mock.index.mockResolvedValue({ actor: map.actor, projects: [{ name: map.projectName }] });
  mock.fetch.mockImplementation(async () => Response.json({ data: data() }));
});
afterEach(() => vi.unstubAllGlobals());
describe('complete Excel report read', () => {
  it('uses caller JWT GET only, no cache, and returns a complete validated snapshot', async () => {
    expect((await excelReportApi.read(null)).projects).toEqual([data()]);
    expect(mock.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fake-token' } });
  });
  it('rejects all results if a later project fails instead of returning partial totals', async () => {
    mock.index.mockResolvedValue({ actor: map.actor, projects: [{ name: map.projectName }, { name: 'B' }] });
    mock.fetch.mockResolvedValueOnce(Response.json({ data: data() })).mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(excelReportApi.read(null)).rejects.toThrow('โหลดสรุปไม่ครบ'); expect(mock.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a different actor at either end of the read', async () => {
    mock.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(pid(99)));
    await expect(excelReportApi.read(null)).rejects.toThrow();
    mock.getSession.mockResolvedValue(session()); mock.index.mockResolvedValue({ actor: { ...map.actor, userId: pid(99) }, projects: [] });
    await expect(excelReportApi.read(null)).rejects.toThrow();
  });
  it('rejects aborted requests, unsigned users and missing project scopes', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(excelReportApi.read(null, controller.signal)).rejects.toThrow();
    await expect(excelReportApi.read('unknown')).rejects.toThrow(); expect(mock.fetch).not.toHaveBeenCalled();
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(excelReportApi.read(null)).rejects.toThrow('เข้าสู่ระบบ');
  });
});
