import { describe, expect, it } from 'vitest';
import { buildProjectMap, parseProjectMapSnapshot, parseStoredProjectMapLayout } from '../projectMapContracts';
import { projectMapSnapshot } from './projectMapFixtures';
import { pid, projectSale } from './projectSalesFixtures';

describe('project map original geometry and current booking identity', () => {
  it('keeps original coordinates and separates construction completion from transfer', () => {
    const snapshot = parseProjectMapSnapshot(projectMapSnapshot(), 'โครงการ A');
    const { regions } = buildProjectMap(snapshot);
    expect(regions[0]).toMatchObject({ x: 1, y: 1, width: 1, height: 2, status: 'booked', isCompleted: true });
    expect(regions[1]).toMatchObject({ status: 'available', isCompleted: true });
  });
  it('cancelled history does not occupy an otherwise vacant plot; later booking wins', () => {
    const snapshot = projectMapSnapshot();
    snapshot.salePages[0].rows = [projectSale({ stage: 'cancelled', plotId: 'P-2' })];
    expect(buildProjectMap(snapshot).regions[1]).toMatchObject({ status: 'available', currentSale: null, history: [expect.anything()] });
    snapshot.plots[1].hasCustomer = true;
    snapshot.salePages[0].rows.push(projectSale({ saleId: pid(9), plotId: 'P-2' }));
    expect(buildProjectMap(snapshot).regions[1]).toMatchObject({ status: 'booked', currentSale: { saleId: pid(9) } });
  });
  it('transfer is based on the current sale, not completion', () => {
    const snapshot = projectMapSnapshot(); snapshot.salePages[0].rows[0].stage = 'transferred';
    snapshot.plots[0].saleStatus = 'transferred';
    expect(buildProjectMap(snapshot).regions[0].status).toBe('transferred');
  });
  it('marks conflicting plot flags and sales stages unknown in both directions', () => {
    const snapshot = projectMapSnapshot(); snapshot.plots[0].saleStatus = 'transferred';
    expect(buildProjectMap(snapshot).regions[0].status).toBe('unknown');
    snapshot.plots[0].saleStatus = 'active'; snapshot.salePages[0].rows[0].stage = 'transferred';
    expect(buildProjectMap(snapshot).regions[0].status).toBe('unknown');
  });
  it('shows duplicates, unknown occupancy and unmatched canonical IDs as unknown, never guesses names', () => {
    const snapshot = projectMapSnapshot();
    snapshot.salePages[0].rows.push(projectSale({ saleId: pid(7) }));
    expect(buildProjectMap(snapshot).regions[0].status).toBe('unknown');
    snapshot.plots[1].hasCustomer = null;
    snapshot.layout.cells.push({ x: 5, y: 1, type: 'plot', plotId: 'A1' });
    expect(buildProjectMap(snapshot).regions.map(r => r.status)).toEqual(['unknown', 'unknown', 'unknown']);
  });
  it('does not call an occupied plot or stale transferred flag vacant when sales are absent', () => {
    const snapshot = projectMapSnapshot(); snapshot.salePages[0].rows = [];
    snapshot.plots[1].saleStatus = 'transferred';
    expect(buildProjectMap(snapshot).regions.every(r => r.status === 'unknown')).toBe(true);
  });
  it('returns off-map plots separately without fabricating their positions on the map', () => {
    const snapshot = projectMapSnapshot(); snapshot.layout.cells = [];
    expect(buildProjectMap(snapshot)).toMatchObject({ regions: [], unmappedPlots: [expect.objectContaining({ plotId: 'P-1' }), expect.objectContaining({ plotId: 'P-2' })] });
  });
  it('preserves roads, parks, fences and infrastructure', () => {
    expect(parseStoredProjectMapLayout([{ type: 'config', cols: 3, rows: 2 },
      { type: 'park', x: 0, y: 0 }, { type: 'fence-h', x: 1, y: 0 }, { type: 'infra-h', x: 2, y: 0 },
    ]).cells.map(c => c.type)).toEqual(['park', 'fence-h', 'infra-h']);
    expect(parseStoredProjectMapLayout(null).cells).toEqual([]);
  });
  it('accepts original layered fences and infrastructure over plot and road cells', () => {
    const layout = parseStoredProjectMapLayout([{ type: 'config', cols: 1, rows: 1 },
      { type: 'plot', plotId: 'P-1', x: 0, y: 0 }, { type: 'fence-h', x: 0, y: 0 },
      { type: 'fence-v', x: 0, y: 0 }, { type: 'infra-h', x: 0, y: 0 },
    ]);
    expect(layout.cells).toHaveLength(4);
    expect(() => parseStoredProjectMapLayout([...layout.cells, { type: 'fence-h', x: 0, y: 0 }])).toThrow();
  });
  it.each([
    [{ type: 'config', cols: 999, rows: 1 }],
    [{ type: 'road', x: -1, y: 0 }],
    [{ type: 'road', x: 0, y: 0 }, { type: 'plot', x: 0, y: 0, plotId: 'P-1' }],
    [{ type: 'script', x: 0, y: 0 }],
  ])('rejects broken/unsafe geometry %j', (...cells) => expect(() => parseStoredProjectMapLayout(cells)).toThrow());
  it('rejects wrong project, partial pages, repeated sales and cross-actor pages', () => {
    const snapshot = projectMapSnapshot();
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ B')).toThrow();
    snapshot.salePages[0].hasMore = true;
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ A')).toThrow();
    snapshot.salePages[0].hasMore = false;
    snapshot.salePages[0].rows.push(projectSale());
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ A')).toThrow();
    snapshot.salePages[0].rows.pop(); snapshot.actor = { ...snapshot.actor, userId: pid(99) };
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ A')).toThrow();
  });
});
