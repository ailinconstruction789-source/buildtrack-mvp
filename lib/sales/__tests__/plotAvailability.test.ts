import { describe, expect, it } from 'vitest';
import { filterAvailablePlots, searchAvailablePlots, type InterestedPlot } from '../plotAvailability';

const plot = (id: string, overrides: Partial<InterestedPlot> = {}): InterestedPlot => ({
  id, plot_name: id, project_name: 'โครงการ A', has_customer: false, sale_status: 'active', ...overrides,
});

describe('interested plot stock rules', () => {
  it('includes only vacant plots in the selected project and sorts naturally', () => {
    const input = [plot('A10'), plot('A2'), plot('other', { project_name: 'โครงการ B' }),
      plot('reserved', { has_customer: true }), plot('transferred', { sale_status: 'Transferred' }),
      plot('sold', { sale_status: 'sold' }), plot('unknown', { sale_status: 'new-unreviewed-status' }),
      plot('missing', { has_customer: null })];
    expect(filterAvailablePlots(input, [], 'โครงการ A').map(p => p.id)).toEqual(['A2', 'A10']);
    expect(input).toHaveLength(8);
    expect(filterAvailablePlots(input, [], '')).toEqual([]);
    expect(filterAvailablePlots(input, [], 'all')).toEqual([]);
  });

  it('checks sales even when the legacy has_customer flag says vacant', () => {
    const input = [plot('booked'), plot('rejected'), plot('unknown'), plot('cancelled'), plot('both')];
    const sales = [
      { plot_id: 'booked', contract_status: 'Reserved' },
      { plot_id: 'rejected', contract_status: 'Rejected' },
      { plot_id: 'unknown', contract_status: null },
      { plot_id: 'cancelled', contract_status: ' Cancelled ' },
      { plot_id: 'both', contract_status: 'Cancelled' },
      { plot_id: 'both', contract_status: 'Transferred' },
    ];
    expect(filterAvailablePlots(input, sales, 'โครงการ A').map(p => p.id)).toEqual(['cancelled']);
  });

  it('supports existing text IDs without requiring UUID conversion', () => {
    const plots = [plot('ไอลิน 6-A01', { plot_name: 'A-01' }), plot('ไอลิน 6-B02')];
    expect(searchAvailablePlots(plots, ' a-01 ')).toEqual([plots[0]]);
    expect(searchAvailablePlots(plots, 'ไอลิน 6-b02')).toEqual([plots[1]]);
    expect(searchAvailablePlots(plots, 'missing')).toEqual([]);
  });
});
