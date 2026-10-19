import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban from '../SalesKanban';

const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), filter: vi.fn(), result: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false, isPlotEligibleForSampleHouse: () => false,
  toggleSampleHouse: vi.fn(), fetchTodayInspectionStatus: async () => null,
}));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const response = Promise.resolve({ data: [], error: null });
    const query = { select: () => query, eq: (...args: unknown[]) => { mocks.filter(table, ...args); return query; },
      order: () => query, in: () => query, maybeSingle: async () => ({ data: null, error: null }),
      then: response.then.bind(response), single: () => mocks.result(),
      update: (payload: unknown) => { mocks.update(table, payload); return query; } };
    return query;
  },
  rpc: async () => ({ data: { rows: [] }, error: null }),
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));

const plot = { id: 'plot-a', project_name: 'Project', plot_name: '1', expected_transfer_date: '2026-12-31' };
const sale = { id: 'sale-a', plot_id: plot.id, customer_name: 'Customer A', crm_stage: 'booked', expected_transfer_date: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'sales' ? [sale] : []);
  mocks.result.mockResolvedValue({ data: { id: sale.id, expected_transfer_date: '2026-10-30' }, error: null });
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function openBooked() {
  const view = render(<SalesKanban project={{ name: 'Project' }} initialTab="booked" />);
  await screen.findByText('Customer A');
  return view.container.querySelector('input[type="date"]') as HTMLInputElement;
}

describe('per-booking forecast and actual transfer dates', () => {
  it('leaves an unknown booking forecast blank despite a date on its plot', async () => {
    expect((await openBooked()).value).toBe('');
  });
  it('updates only the exact sale and shows the confirmed returned value', async () => {
    const input = await openBooked();
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    await waitFor(() => expect(input.value).toBe('2026-10-30'));
    expect(mocks.update.mock.calls).toEqual([['sales', { expected_transfer_date: '2026-10-30' }]]);
    expect(mocks.filter).toHaveBeenCalledWith('sales', 'id', sale.id);
    expect(mocks.filter).not.toHaveBeenCalledWith('sales', 'lead_id', expect.anything());
  });
  it('clears a forecast without reviving a plot date', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'sales'
      ? [{ ...sale, expected_transfer_date: '2026-10-30' }] : []);
    mocks.result.mockResolvedValue({ data: { id: sale.id, expected_transfer_date: null }, error: null });
    const input = await openBooked();
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(input.value).toBe(''));
    expect(mocks.update).toHaveBeenCalledWith('sales', { expected_transfer_date: null });
  });
  it('retains the old date on denied or zero-row writes', async () => {
    mocks.result.mockResolvedValue({ data: null, error: { message: 'zero rows / denied' } });
    const input = await openBooked();
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(input.value).toBe('');
    expect(input).not.toBeDisabled();
  });
  it('rejects a server result for the wrong sale or date', async () => {
    mocks.result.mockResolvedValue({ data: { id: 'another-sale', expected_transfer_date: '2026-10-29' }, error: null });
    const input = await openBooked();
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(input.value).toBe('');
  });
  it('ignores an old successful request after an account change', async () => {
    let finish!: (value: unknown) => void;
    mocks.result.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<SalesKanban project={{ name: 'Project' }} user={{ id: 'user-a' }} initialTab="booked" />);
    await screen.findByText('Customer A');
    const input = view.container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    view.rerender(<SalesKanban project={{ name: 'Project' }} user={{ id: 'user-b' }} initialTab="booked" />);
    finish({ data: { id: sale.id, expected_transfer_date: '2026-10-30' }, error: null });
    await waitFor(() => {
      const currentInput = view.container.querySelector('input[type="date"]') as HTMLInputElement;
      expect(currentInput).not.toBeNull();
      expect(currentInput).not.toBeDisabled();
      expect(currentInput.value).toBe('');
    });
    expect(input.isConnected).toBe(false);
  });
  it('blocks overlapping edits until the first request completes', async () => {
    let finish!: (value: unknown) => void;
    mocks.result.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const input = await openBooked();
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: '2026-10-29' } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    finish({ data: { id: sale.id, expected_transfer_date: '2026-10-30' }, error: null });
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(input.value).toBe('2026-10-30');
  });
  it('does not allow a Lead ID to masquerade as a sale ID and saves forecast to lead', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads'
      ? [{ id: 'lead-only', customer_name: 'Customer A', status: 'Reserved', interested_plot_id: plot.id }] : []);
    const input = await openBooked();
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith('leads', expect.objectContaining({ notes: expect.stringContaining('2026-10-30') }));
    });
    expect(mocks.update).not.toHaveBeenCalledWith('sales', expect.anything());
  });
  it('shows no actual transfer date when only a forecast is known', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'sales'
      ? [{ ...sale, crm_stage: 'transferred', expected_transfer_date: '2026-10-30' }] : []);
    render(<SalesKanban project={{ name: 'Project' }} initialTab="transferred" />);
    await screen.findByText('Customer A');
    expect(screen.queryByText('2026-10-30')).not.toBeInTheDocument();
  });
  it('shows the actual transfer date independently of the forecast', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'sales'
      ? [{ ...sale, crm_stage: 'transferred', transferred_at: '2024-01-08', expected_transfer_date: '2026-10-30' }] : []);
    render(<SalesKanban project={{ name: 'Project' }} initialTab="transferred" />);
    await screen.findByText('Customer A');
    expect(screen.getByText('2024-01-08')).toBeInTheDocument();
    expect(screen.queryByText('2026-10-30')).not.toBeInTheDocument();
  });
});
