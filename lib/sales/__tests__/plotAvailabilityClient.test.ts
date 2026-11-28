import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, query, range } = vi.hoisted(() => {
  const range = vi.fn();
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), in: vi.fn(), range };
  for (const method of [query.select, query.eq, query.order, query.in]) method.mockReturnValue(query);
  return { from: vi.fn<(table: string) => typeof query>(() => query), query, range };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { loadAvailablePlots, recheckInterestedPlot } from '../plotAvailabilityClient';

const available = { id: 'โครงการ-A1', plot_name: 'A1', project_name: 'โครงการ', has_customer: false, sale_status: 'active' };

describe('read-only stock lookup (Phase 4 unified plots + sales + rental_contracts)', () => {
  beforeEach(() => { vi.clearAllMocks(); range.mockReset(); });

  it('does not query without a selected project or optional plot', async () => {
    expect(await loadAvailablePlots('all')).toEqual([]);
    expect(await recheckInterestedPlot('', null)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('reads plots, sales, and rental_contracts by plot with no write methods available', async () => {
    range
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    expect(await loadAvailablePlots('โครงการ')).toEqual([available]);
    expect(from.mock.calls.map(call => call[0])).toEqual(['plots', 'sales', 'rental_contracts']);
    expect(query.in).toHaveBeenCalledWith('plot_id', [available.id]);
  });

  it('fails closed when sales lookup fails', async () => {
    range
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'RLS' } });
    await expect(loadAvailablePlots('โครงการ')).rejects.toThrow('รายการจอง');
  });

  it('fails closed when rental_contracts lookup fails (never falls back to available)', async () => {
    range
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'RLS rental_contracts' } });
    await expect(loadAvailablePlots('โครงการ')).rejects.toThrow('สัญญาเช่า');
  });

  it('rejects a plot that was booked for purchase OR PendingContract/Active rental after opening the form', async () => {
    // 1. Purchase sale
    range
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'sale', plot_id: available.id, contract_status: 'Reserved' }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(recheckInterestedPlot('โครงการ', available.id)).rejects.toThrow('ไม่ว่างแล้ว');

    // 2. PendingContract rental booking (even if plots.has_customer is still false!)
    range
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'rc-pending', plot_id: available.id, status: 'PendingContract' }], error: null });
    await expect(recheckInterestedPlot('โครงการ', available.id)).rejects.toThrow('ไม่ว่างแล้ว');

    // 3. Renewed rental contract
    range
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'rc-renewed', plot_id: available.id, status: 'Renewed' }], error: null });
    await expect(recheckInterestedPlot('โครงการ', available.id)).rejects.toThrow('ไม่ว่างแล้ว');
  });

  it('paginates plots and batches sales + rental_contracts checks instead of assuming first page is complete', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...available, id: `plot-${i}` }));
    range
      .mockResolvedValueOnce({ data: many, error: null })
      .mockResolvedValueOnce({ data: [available], error: null })
      .mockResolvedValue({ data: [], error: null });
    expect(await loadAvailablePlots('โครงการ')).toHaveLength(501);
    // 6 batches x 2 tables (sales + rental_contracts) = 12 batched .in() lookups
    expect(query.in).toHaveBeenCalledTimes(12);
    expect(range).toHaveBeenCalledWith(500, 999);
  });
});
