import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSalesStatusHistory, mergeSalesTimeline } from '../salesStatusHistory';
const mock = vi.hoisted(() => ({ pages: {} as Record<string, unknown[]>, error: false, reads: vi.fn(), orders: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { filters[key] = value; return query; },
    order: (key: string, options: unknown) => { mock.orders(key, options); return query; },
    range: async (from: number, to: number) => {
      mock.reads({ ...filters }, from, to);
      return { data: mock.pages[`${filters.entity_type}:${filters.entity_id}:${from}`] || [], error: mock.error ? { message: 'history unavailable' } : null };
    },
  }; return query;
} } }));
beforeEach(() => { mock.pages = {}; mock.error = false; mock.reads.mockClear(); mock.orders.mockClear(); });
const row = (id: string, type = 'lead', entity = 'L1') => ({ id, entity_type: type, entity_id: entity, new_status: 'contracted', created_at: '2026-10-12T05:00:00Z', changed_by: 'Sales' });
describe('scoped Sales status history', () => {
  it('reads both exact parent types and IDs without unrelated customer history', async () => {
    mock.pages['lead:L1:0'] = [row('H1'), row('OTHER', 'lead', 'L2')];
    mock.pages['sale:S1:0'] = [row('H2', 'sale', 'S1')];
    expect((await loadSalesStatusHistory('L1', 'S1')).map(item => item.id)).toEqual(['H1', 'H2']);
    expect(mock.reads.mock.calls).toEqual([
      [{ entity_type: 'lead', entity_id: 'L1' }, 0, 999],
      [{ entity_type: 'sale', entity_id: 'S1' }, 0, 999],
    ]);
  });
  it('paginates the selected parent with a deterministic timestamp and ID order', async () => {
    mock.pages['lead:L1:0'] = Array.from({ length: 1000 }, (_, i) => row(`H${i}`));
    mock.pages['lead:L1:1000'] = [row('H1000')];
    expect(await loadSalesStatusHistory('L1', null)).toHaveLength(1001);
    expect(mock.reads.mock.calls[1]).toEqual([{ entity_type: 'lead', entity_id: 'L1' }, 1000, 1999]);
    expect(mock.orders.mock.calls).toEqual([
      ['created_at', { ascending: false }], ['id', { ascending: false }],
      ['created_at', { ascending: false }], ['id', { ascending: false }],
    ]);
  });
  it('makes no history request without an exact parent ID', async () => {
    expect(await loadSalesStatusHistory(null, null)).toEqual([]);
    expect(mock.reads).not.toHaveBeenCalled();
  });
  it('reports read failures instead of treating them as an empty timeline', async () => {
    mock.error = true;
    await expect(loadSalesStatusHistory('L1', null)).rejects.toThrow('history unavailable');
  });
  it('keeps repeated real transitions while removing only equivalent date fallbacks', () => {
    const recorded = [
      { id: 'H1', status: 'Reserved', timestamp: '2026-10-11T18:00:00Z', note: 'Sales' },
      { id: 'H2', status: 'Reserved', timestamp: '2026-10-12T05:00:00Z', note: 'Sales' },
    ];
    const result = mergeSalesTimeline(recorded, [
      { status: 'Reserved', timestamp: '2026-10-12', note: '' },
      { status: 'Transferred', timestamp: '2026-10-13', note: '' },
    ]);
    expect(result).toHaveLength(3);
    expect(result.map(item => item.id || item.status)).toEqual(['Transferred', 'H2', 'H1']);
  });
});
