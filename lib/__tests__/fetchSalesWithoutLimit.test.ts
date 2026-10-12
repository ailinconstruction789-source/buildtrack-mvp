import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSalesWithoutLimit } from '../sales/fetchWithoutLimit';

interface Request {
  table: string;
  select: string;
  filters: [string, unknown][];
  orders: { column: string; ascending: boolean }[];
  from: number;
  to: number;
}

const mocks = vi.hoisted(() => ({ read: vi.fn(), requests: [] as Request[] }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const request: Request = { table, select: '*', filters: [], orders: [], from: 0, to: 0 };
    const query = {
      select(columns: string) { request.select = columns; return query; },
      eq(column: string, value: unknown) { request.filters.push([column, value]); return query; },
      order(column: string, options: { ascending: boolean }) {
        request.orders.push({ column, ascending: options.ascending }); return query;
      },
      range(from: number, to: number) {
        request.from = from; request.to = to;
        mocks.requests.push(request);
        return Promise.resolve(mocks.read(request));
      },
    };
    return query;
  },
} }));

const missingOrder = { code: '42703', message: 'column leads.created_at does not exist' };
beforeEach(() => { mocks.read.mockReset(); mocks.requests.length = 0; });

describe('complete filtered sales reads', () => {
  it('loads beyond 1,000 rows with stable ordering and the same filter on every page', async () => {
    const rows = Array.from({ length: 1003 }, (_, id) => ({ id, project_name: 'A' }));
    mocks.read.mockImplementation((q: Request) => ({ data: rows.slice(q.from, q.to + 1), error: null }));
    expect(await fetchSalesWithoutLimit('leads', { filterCol: 'project_name', filterVal: 'A' })).toEqual(rows);
    expect(mocks.requests.map(q => [q.from, q.to])).toEqual([[0, 999], [1000, 1999]]);
    for (const q of mocks.requests) {
      expect(q.filters).toEqual([['project_name', 'A']]);
      expect(q.orders).toEqual([{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }]);
    }
  });

  it('checks an empty final page when the previous page was full', async () => {
    mocks.read.mockImplementation((q: Request) => ({ data: q.from === 0 ? [{ id: 1 }, { id: 2 }] : [], error: null }));
    expect(await fetchSalesWithoutLimit('sales', { chunkSize: 2 })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mocks.requests).toHaveLength(2);
  });

  it('returns an empty successful read without falling back', async () => {
    mocks.read.mockResolvedValue({ data: [], error: null });
    expect(await fetchSalesWithoutLimit('leads')).toEqual([]);
    expect(mocks.requests).toHaveLength(1);
  });

  it.each([0, 2])('rejects failure at offset %i instead of publishing an empty or partial list', async offset => {
    mocks.read.mockImplementation((q: Request) => q.from === offset
      ? { data: null, error: { code: '42501', message: 'permission denied' } }
      : { data: [{ id: 1 }, { id: 2 }], error: null });
    await expect(fetchSalesWithoutLimit('leads', { chunkSize: 2 })).rejects.toThrow('permission denied');
    expect(mocks.requests).toHaveLength(offset === 0 ? 1 : 2);
  });

  it('does not retry a transport exception', async () => {
    mocks.read.mockRejectedValue(new Error('network failed'));
    await expect(fetchSalesWithoutLimit('leads')).rejects.toThrow('network failed');
    expect(mocks.requests).toHaveLength(1);
  });

  it('keeps the project filter and selection when falling back to id order', async () => {
    const rows = [{ id: 1, project_name: 'A' }, { id: 2, project_name: 'B' }];
    mocks.read.mockImplementation((q: Request) => q.orders[0].column === 'created_at'
      ? { data: null, error: missingOrder }
      : { data: rows.filter(row => q.filters.every(([column, value]) => column === 'project_name' && row.project_name === value)), error: null });
    expect(await fetchSalesWithoutLimit('leads', { filterCol: 'project_name', filterVal: 'A', select: 'id, project_name' }))
      .toEqual([{ id: 1, project_name: 'A' }]);
    expect(mocks.requests[1]).toMatchObject({ select: 'id, project_name', filters: [['project_name', 'A']], orders: [{ column: 'id', ascending: false }], from: 0 });
  });

  it('restarts all pages when fallback changes the ordering after a full page', async () => {
    const sortedById = [{ id: 3 }, { id: 2 }, { id: 1 }];
    mocks.read.mockImplementation((q: Request) => {
      if (q.orders[0].column === 'created_at') return q.from === 0
        ? { data: [{ id: 1 }, { id: 3 }], error: null } : { data: null, error: missingOrder };
      return { data: sortedById.slice(q.from, q.to + 1), error: null };
    });
    expect(await fetchSalesWithoutLimit('leads', { chunkSize: 2 })).toEqual(sortedById);
    expect(mocks.requests.map(q => q.from)).toEqual([0, 2, 0, 2]);
  });

  it('accepts an empty successful fallback', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: missingOrder }).mockResolvedValue({ data: [], error: null });
    expect(await fetchSalesWithoutLimit('leads')).toEqual([]);
    expect(mocks.requests).toHaveLength(2);
  });

  it('rejects a failed fallback without looping', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: missingOrder })
      .mockResolvedValue({ data: null, error: { code: '42703', message: 'column leads.id does not exist' } });
    await expect(fetchSalesWithoutLimit('leads')).rejects.toThrow('leads.id');
    expect(mocks.requests).toHaveLength(2);
  });

  it('does not mask an unrelated missing selected column', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { code: '42703', message: 'column leads.phone does not exist' } });
    await expect(fetchSalesWithoutLimit('leads')).rejects.toThrow('leads.phone');
    expect(mocks.requests).toHaveLength(1);
  });

  it.each([0, 1001, 1.5])('rejects invalid page size %s before issuing a query', async chunkSize => {
    await expect(fetchSalesWithoutLimit('leads', { chunkSize })).rejects.toThrow('Invalid sales pagination');
    expect(mocks.requests).toHaveLength(0);
  });
});
