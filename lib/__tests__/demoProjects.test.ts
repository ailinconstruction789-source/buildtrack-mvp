// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  from: vi.fn(), actor: vi.fn(), getSession: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: fixture.from, auth: { getSession: fixture.getSession } } }));
vi.mock('@/lib/auth/trustedActor', () => ({ readTrustedActor: fixture.actor }));

import {
  createDemoLayout, createDemoProject, DEMO_LAYERS, listDemoProjects,
  parseDemoLayout, parseDemoProject, saveDemoProject, validateDemoProjectName,
} from '../demoProjects';

const userId = 'a0250000-0000-4000-8000-000000000001';
const projectId = 'a0250000-0000-4000-8000-000000000002';
const session = { user: { id: userId }, access_token: 'test-token' };
const row = () => ({ id: projectId, name: 'สนามทดลอง', layout_data: createDemoLayout(), revision: 1,
  created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z', created_by: userId });
function reply(data: unknown, error: unknown = null) {
  const value = { data, error };
  const builder = { select: vi.fn(), order: vi.fn(), limit: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(),
    single: vi.fn().mockResolvedValue(value), maybeSingle: vi.fn().mockResolvedValue(value) };
  for (const method of ['select', 'order', 'insert', 'update', 'eq'] as const) builder[method].mockReturnValue(builder);
  builder.limit.mockResolvedValue(value);
  fixture.from.mockReturnValueOnce(builder);
  return builder;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.from.mockReset();
  fixture.actor.mockReset().mockResolvedValue({ role: 'Admin', authUserId: userId });
  fixture.getSession.mockReset().mockResolvedValue({ data: { session }, error: null });
});

describe('demo map data', () => {
  it('creates independent synthetic maps containing all layers and overlapping networks', () => {
    const first = createDemoLayout();
    expect(parseDemoLayout(first)).toEqual(first);
    expect(new Set(first.cells.map(cell => cell.kind))).toEqual(new Set(DEMO_LAYERS.map(layer => layer.kind)));
    expect(first.cells.some(cell => cell.kind === 'road' && first.cells.some(other =>
      other.kind === 'drainage' && other.x === cell.x && other.y === cell.y))).toBe(true);
    first.cells.pop();
    expect(createDemoLayout().cells.length).toBe(first.cells.length + 1);
  });
  it.each([
    null, {}, { version: 2, cols: 24, rows: 16, cells: [] },
    { version: 1, cols: 25, rows: 16, cells: [] },
    { version: 1, cols: 24, rows: 16, cells: [], extra: true },
    ...[
      { id: 'a', x: -1, y: 0, kind: 'road' },
      { id: 'a', x: 24, y: 0, kind: 'road' },
      { id: 'a', x: 0.1, y: 0, kind: 'road' },
      { id: 'a', x: 0, y: 16, kind: 'road' },
      { id: 'a', x: 0, y: 0, kind: 'fake' },
      { id: '', x: 0, y: 0, kind: 'road' },
      { id: 'a', x: 0, y: 0, kind: 'road', progress: 100 },
    ].map(cell => ({ version: 1, cols: 24, rows: 16, cells: [cell] })),
  ])('rejects malformed or unsupported geometry %j', value => {
    expect(() => parseDemoLayout(value)).toThrow();
  });
  it('rejects duplicate identities or same-layer cells but allows co-located different layers', () => {
    const base = { version: 1, cols: 24, rows: 16, cells: [
      { id: 'a', x: 1, y: 1, kind: 'road' }, { id: 'b', x: 1, y: 1, kind: 'water' },
    ] };
    expect(parseDemoLayout(base).cells).toHaveLength(2);
    expect(() => parseDemoLayout({ ...base, cells: [base.cells[0], { ...base.cells[1], kind: 'road' }] })).toThrow();
    expect(() => parseDemoLayout({ ...base, cells: [base.cells[0], { ...base.cells[1], id: 'a' }] })).toThrow();
  });
  it('validates project identity, revisions and timestamps', () => {
    expect(parseDemoProject(row())).toEqual(row());
    for (const patch of [{ id: 'bad' }, { created_by: null }, { revision: 0 }, { revision: 1.5 }, { updated_at: 'bad' }]) {
      expect(() => parseDemoProject({ ...row(), ...patch })).toThrow();
    }
  });
  it('trims names and rejects blank, control characters and oversized names', () => {
    expect(validateDemoProjectName('  Demo A  ')).toBe('Demo A');
    for (const name of ['', '   ', 'demo\nA', 'a'.repeat(101), null]) {
      expect(() => validateDemoProjectName(name)).toThrow();
    }
  });
});

describe('admin demo persistence', () => {
  it.each(['Owner', 'QC', 'Sales', 'Foreman', 'Project Engineer'])('never queries demo data for %s', async role => {
    fixture.actor.mockResolvedValue({ role, authUserId: userId });
    await expect(listDemoProjects()).rejects.toThrow('Admin');
    await expect(createDemoProject('Demo', projectId)).rejects.toThrow('Admin');
    await expect(saveDemoProject(row(), createDemoLayout())).rejects.toThrow('Admin');
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it('requires trusted auth without a browser role fallback', async () => {
    fixture.actor.mockRejectedValue(new Error('trusted auth unavailable'));
    await expect(listDemoProjects()).rejects.toThrow('trusted auth unavailable');
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it('reads only the isolated table and rejects silently truncated lists', async () => {
    reply([row()]);
    expect(await listDemoProjects()).toEqual([row()]);
    expect(fixture.from).toHaveBeenCalledExactlyOnceWith('admin_demo_projects');
    reply(Array.from({ length: 201 }, row));
    await expect(listDemoProjects()).rejects.toThrow('200');
  });
  it('discards a response after account or token changes', async () => {
    reply([row()]);
    fixture.getSession.mockResolvedValueOnce({ data: { session }, error: null })
      .mockResolvedValueOnce({ data: { session: { ...session, access_token: 'other-token' } }, error: null });
    await expect(listDemoProjects()).rejects.toThrow('บัญชีผู้ใช้เปลี่ยน');
  });
  it('reports a missing schema without falling back to real projects', async () => {
    reply(null, { code: 'PGRST205' });
    await expect(listDemoProjects()).rejects.toThrow('migration');
    expect(fixture.from).toHaveBeenCalledExactlyOnceWith('admin_demo_projects');
  });
  it('creates a project with a stable retry ID and no caller-supplied ownership', async () => {
    const query = reply(row());
    const result = await createDemoProject(' สนามทดลอง ', projectId);
    expect(result.id).toBe(projectId);
    expect(query.insert).toHaveBeenCalledWith({ id: projectId, name: 'สนามทดลอง', layout_data: createDemoLayout() });
  });
  it('recovers the same create request after an uncertain result, without overwriting it', async () => {
    reply(null, { code: '23505' });
    const recovery = reply(row());
    expect(await createDemoProject('สนามทดลอง', projectId)).toEqual(row());
    expect(recovery.eq).toHaveBeenCalledWith('id', projectId);
    expect(recovery.update).not.toHaveBeenCalled();
  });
  it('rejects retry IDs used for a different payload or creator', async () => {
    reply(null, { code: '23505' });
    reply({ ...row(), name: 'changed' });
    await expect(createDemoProject('สนามทดลอง', projectId)).rejects.toThrow('ถูกใช้แล้ว');
    reply(null, { code: '23505' });
    reply({ ...row(), created_by: 'a0250000-0000-4000-8000-000000000003' });
    await expect(createDemoProject('สนามทดลอง', projectId)).rejects.toThrow('ถูกใช้แล้ว');
  });
  it('saves only against the expected revision and detects conflicts', async () => {
    const layout = createDemoLayout();
    layout.cells.pop();
    const query = reply({ ...row(), layout_data: layout, revision: 2 });
    expect((await saveDemoProject(row(), layout)).revision).toBe(2);
    expect(query.update).toHaveBeenCalledWith({ layout_data: layout });
    expect(query.eq).toHaveBeenCalledWith('id', projectId);
    expect(query.eq).toHaveBeenCalledWith('revision', 1);
    reply(null);
    await expect(saveDemoProject(row(), layout)).rejects.toThrow('ถูกแก้ไขแล้ว');
  });
});
