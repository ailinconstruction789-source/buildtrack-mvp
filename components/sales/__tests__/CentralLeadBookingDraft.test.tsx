import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CentralLeadBookingModal from '../CentralLeadBookingModal';

const mocks = vi.hoisted(() => ({ plot: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query; },
    or: (value: string) => { filters.or = value; return query; },
    maybeSingle: () => table === 'plots' ? mocks.plot(filters) : Promise.resolve({ data: { overall_progress: 100 }, error: null }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(mocks.read(table, filters)).then(resolve, reject),
  };
  return query;
} } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: async () => [
  { id: 'P1', plot_name: 'P1', project_name: 'Project A', has_customer: false, sale_status: 'available' },
  { id: 'P2', plot_name: 'P2', project_name: 'Project A', has_customer: false, sale_status: 'available' },
] }));
vi.mock('../LeadPicker', () => ({ default: () => null }));
const customer = { id: 'L1', name: 'Customer One', status: 'Visit' };
const actor = { id: 'U1', username: 'Sales One' };
const price = () => screen.getByPlaceholderText('เช่น 2,793,000');
function props() { return { isOpen: true, onClose: vi.fn(), customer: { ...customer }, currentUser: { ...actor },
  initialInterest: { projectName: 'Project A', plotId: 'P1' }, projects: ['Project A'], salesOwners: [{ userId: 'U1', displayName: 'Sales One' }] }; }
function plot(selling_price = 2793000) { return { data: { id: 'P1', plot_name: 'P1', project_name: 'Project A', selling_price, house_type_id: 'HT1', sale_status: 'ready_for_sale' }, error: null }; }
beforeEach(() => { vi.clearAllMocks(); mocks.plot.mockResolvedValue(plot()); mocks.read.mockResolvedValue({ data: [], error: null }); });
afterEach(cleanup);

describe('booking draft lifetime', () => {
  it('retains loaded price when a focus refresh recreates props for the same booking', async () => {
    const view = render(<CentralLeadBookingModal {...props()} />);
    await waitFor(() => expect(price()).toHaveValue('2,793,000'));
    fireEvent(window, new Event('blur'));
    view.rerender(<CentralLeadBookingModal {...props()} />);
    fireEvent(window, new Event('focus'));
    expect(price()).toHaveValue('2,793,000'); expect(mocks.plot).toHaveBeenCalledOnce();
  });
  it('keeps edited price, deposit and notes across equivalent parent refreshes', async () => {
    const view = render(<CentralLeadBookingModal {...props()} />);
    await waitFor(() => expect(price()).toHaveValue('2,793,000'));
    fireEvent.change(price(), { target: { value: '2,650,000' } });
    fireEvent.change(screen.getByPlaceholderText('10000'), { target: { value: '25000' } });
    const note = screen.getByPlaceholderText(/ระบุโปรโมชั่น เช่น/);
    fireEvent.change(note, { target: { value: 'Unsubmitted draft' } });
    view.rerender(<CentralLeadBookingModal {...props()} />);
    expect(price()).toHaveValue('2,650,000'); expect(screen.getByPlaceholderText('10000')).toHaveValue('25000');
    expect(note).toHaveValue('Unsubmitted draft'); expect(mocks.plot).toHaveBeenCalledOnce();
  });
  it('loads the same plot again when the dialog is closed and reopened', async () => {
    const initial = props(); const view = render(<CentralLeadBookingModal {...initial} />);
    await waitFor(() => expect(price()).toHaveValue('2,793,000'));
    fireEvent.change(price(), { target: { value: 'Edited old draft' } });
    view.rerender(<CentralLeadBookingModal {...initial} isOpen={false} />);
    view.rerender(<CentralLeadBookingModal {...initial} isOpen />);
    await waitFor(() => expect(price()).toHaveValue('2,793,000')); expect(mocks.plot).toHaveBeenCalledTimes(2);
  });
  it('loads a newly selected plot price and keeps that selection through a parent refresh', async () => {
    mocks.plot.mockResolvedValueOnce(plot()).mockResolvedValueOnce({ data: { ...plot(3100000).data, id: 'P2', plot_name: 'P2' }, error: null });
    const view = render(<CentralLeadBookingModal {...props()} />);
    await waitFor(() => expect(price()).toHaveValue('2,793,000'));
    const selector = screen.getAllByRole('combobox').find(element => within(element).queryByRole('option', { name: /P2/ }))!;
    const option = within(selector).getByRole('option', { name: /P2/ }) as HTMLOptionElement;
    fireEvent.change(selector, { target: { value: option.value } });
    await waitFor(() => expect(price()).toHaveValue('3,100,000'));
    view.rerender(<CentralLeadBookingModal {...props()} />);
    expect(selector).toHaveValue(option.value); expect(price()).toHaveValue('3,100,000'); expect(mocks.plot).toHaveBeenCalledTimes(2);
  });
  it('resets and reloads when the actual account changes even if username and plot are the same', async () => {
    const view = render(<CentralLeadBookingModal {...props()} />);
    await waitFor(() => expect(price()).toHaveValue('2,793,000'));
    fireEvent.change(screen.getByPlaceholderText('10000'), { target: { value: '25000' } });
    view.rerender(<CentralLeadBookingModal {...props()} currentUser={{ ...actor, id: 'U2' }} />);
    await waitFor(() => expect(mocks.plot).toHaveBeenCalledTimes(2));
    expect(screen.getByPlaceholderText('10000')).toHaveValue('10000');
    await waitFor(() => expect(price()).toHaveValue('2,793,000'));
  });
  it('does not let a pending price from a previous customer replace the new customer context', async () => {
    let resolve!: (result: ReturnType<typeof plot>) => void;
    mocks.plot.mockReturnValueOnce(new Promise(accept => { resolve = accept; })).mockResolvedValueOnce(plot(3100000));
    const view = render(<CentralLeadBookingModal {...props()} />);
    await waitFor(() => expect(mocks.plot).toHaveBeenCalledOnce());
    view.rerender(<CentralLeadBookingModal {...props()} customer={{ ...customer, id: 'L2' }} />);
    await waitFor(() => expect(price()).toHaveValue('3,100,000'));
    await act(async () => resolve(plot())); expect(price()).toHaveValue('3,100,000');
  });
  it('ignores old promotions that finish after the booking customer changes', async () => {
    let resolve!: (result: unknown) => void; let calls = 0;
    mocks.read.mockImplementation((table: string) => table !== 'plot_promotions' ? { data: [], error: null }
      : ++calls === 1 ? new Promise(accept => { resolve = accept; })
      : { data: [{ category: 'เครื่องใช้ไฟฟ้า', item_name: 'New context promotion', quantity: 1 }], error: null });
    const view = render(<CentralLeadBookingModal {...props()} />);
    await waitFor(() => expect(calls).toBe(1));
    view.rerender(<CentralLeadBookingModal {...props()} customer={{ ...customer, id: 'L2' }} />);
    await screen.findByText(/New context promotion/);
    await act(async () => resolve({ data: [{ category: 'เครื่องใช้ไฟฟ้า', item_name: 'Old context promotion', quantity: 1 }], error: null }));
    expect(screen.getByText(/New context promotion/)).toBeInTheDocument(); expect(screen.queryByText(/Old context promotion/)).not.toBeInTheDocument();
  });
});
