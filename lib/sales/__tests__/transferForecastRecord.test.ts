import { describe, it, expect } from 'vitest';
import { transferForecastRecord } from '../transferForecastRecord';
describe('booking-scoped transfer forecasts', () => {
  it('uses the active Sale ID despite a later imported/cancelled record on the same plot', () => {
    const plot = { id: 'plot', activeSale: { saleId: 'current', expectedTransferDate: '2026-01-01' } };
    const actual = { id: 'current', plot_id: 'plot', expectedTransfer: null, createdDate: '2025-01-01' };
    const later = { id: 'cancelled', plot_id: 'plot', expectedTransfer: '2027-01-01', createdDate: '2026-01-01', stage: 'cancelled' };
    expect(transferForecastRecord(plot, [later, actual], true)).toBe(actual);
  });
  it('never matches a guessed plot alias or Customer name', () => {
    const row = { id: 'other', plot_id: 'other-plot', plot_name: '1', project_name: 'Project', expectedTransfer: '2027-01-01' };
    expect(transferForecastRecord({ id: 'plot', plot_name: '1', project_name: 'Project' }, [row], true)).toBeUndefined();
  });
  it('does not choose from ambiguous active Sales using import dates', () => {
    expect(transferForecastRecord({ id: 'plot' }, [{ id: 'a', plot_id: 'plot', stage: 'booked' }, { id: 'b', plot_id: 'plot', stage: 'booked', createdDate: '2026-01-01' }], true)).toBeUndefined();
  });
  it('retains the existing legacy selection when canonical mode is off', () => {
    const later = { id: 'b', plot_id: 'plot', createdDate: '2026-01-01' };
    expect(transferForecastRecord({ id: 'plot' }, [{ id: 'a', plot_id: 'plot', createdDate: '2025-01-01' }, later], false)).toBe(later);
  });
});
