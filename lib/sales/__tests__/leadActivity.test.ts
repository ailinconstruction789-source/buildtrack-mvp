import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
import { readLeadActivitySnapshot, writeLeadActivitySummary } from '../leadActivity';
interface Query { table: string; patch?: unknown; filters: [string, unknown][] }
const customer = { id: 'L1', customer_name: 'Fixture only' };
const row = { ...customer, status: 'Visit', notes: 'latest notes', updated_at: 'revision-1' };
let queries: Query[];
beforeEach(() => {
  vi.clearAllMocks(); queries = [];
  mocks.execute.mockImplementation((q: Query) => ({ data: q.patch ? { id: 'L1' } : q.table === 'leads' ? row : [], error: null }));
  mocks.from.mockImplementation((table: string) => {
    const query: Query = { table, filters: [] }; queries.push(query);
    const api = {
      select: () => api, update: (patch: unknown) => { query.patch = patch; return api; },
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return api; },
      is: (key: string, value: unknown) => { query.filters.push([key, value]); return api; },
      single: () => api, limit: () => api,
      then: (done: (result: unknown) => unknown) => Promise.resolve(mocks.execute(query)).then(done),
    }; return api;
  });
});
describe('fresh exact-ID activity snapshots and compare-and-set (mock database only)', () => {
  it('reads one exact Lead, purchase and rental history, using fresh notes instead of the displayed snapshot', async () => {
    const result = await readLeadActivitySnapshot({ ...customer, notes: 'stale' });
    expect(result.lead.notes).toBe('latest notes'); expect(result.historyExists).toBe(false);
    expect(queries.map(q => [q.table, q.filters])).toEqual([
      ['leads', [['id', 'L1']]], ['sales', [['lead_id', 'L1']]], ['rental_contracts', [['lead_id', 'L1']]],
    ]);
  });
  it.each(['sales', 'rental_contracts'])('protects a stale Visit Lead with %s history', async table => {
    mocks.execute.mockImplementation((q: Query) => ({ data: q.table === 'leads' ? row : q.table === table ? [{ id: 'history' }] : [], error: null }));
    expect((await readLeadActivitySnapshot(customer)).historyExists).toBe(true);
  });
  it.each(['leads', 'sales', 'rental_contracts'])('fails closed if %s cannot be read', async table => {
    mocks.execute.mockImplementation((q: Query) => q.table === table ? { data: null, error: new Error('read denied') } : { data: q.table === 'leads' ? row : [], error: null });
    await expect(readLeadActivitySnapshot(customer)).rejects.toThrow('read denied');
    expect(queries.some(q => q.patch)).toBe(false);
  });
  it('does not read or write an unlinked CRM customer using its unrelated ID', async () => {
    await expect(readLeadActivitySnapshot({ id: 'CRM1' })).rejects.toThrow('เชื่อม'); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects a mismatched response identity', async () => {
    mocks.execute.mockReturnValue({ data: { ...row, id: 'OTHER' }, error: null });
    await expect(readLeadActivitySnapshot(customer)).rejects.toThrow('Lead ล่าสุด');
  });
  it.each(['revision-1', null])('guards the write against the exact loaded revision %s', async updated_at => {
    await writeLeadActivitySummary({ lead: { ...row, updated_at }, historyExists: false }, { status: 'Lost' });
    expect(queries[0].filters).toEqual([['id', 'L1'], ['updated_at', updated_at]]);
  });
  it('does not report a successful save when RLS/CAS returns no row', async () => {
    mocks.execute.mockReturnValue({ data: null, error: null });
    await expect(writeLeadActivitySummary({ lead: row, historyExists: false }, { status: 'Lost' })).rejects.toThrow('เปลี่ยนแล้ว');
  });
});
