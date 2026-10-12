import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CentralLeadBookingModal from '../CentralLeadBookingModal';

const mocks = vi.hoisted(() => ({ updateLead: vi.fn(), createLead: vi.fn(), insertSale: vi.fn(), readSale: vi.fn(),
  deletePromotions: vi.fn(), insertPromotions: vi.fn(), activity: vi.fn(), updatePlot: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  if (table === 'leads') return {
    update: (payload: unknown) => ({ eq: (key: string, id: string) => mocks.updateLead(payload, key, id) }),
    insert: (payload: unknown) => ({ select: () => ({ single: () => mocks.createLead(payload) }) }),
  };
  if (table === 'plot_promotions') return {
    delete: () => ({ or: (query: string) => mocks.deletePromotions(query) }),
    insert: mocks.insertPromotions,
  };
  if (table === 'lead_activities') return { insert: mocks.activity };
  if (table === 'sales') return {
    insert: (payload: unknown) => ({ select: () => ({ single: () => mocks.insertSale(payload) }) }),
    select: () => ({ eq: () => ({ maybeSingle: mocks.readSale }) }),
  };
  if (table === 'plots') return {
    update: (payload: unknown) => ({ eq: (key: string, id: string) => mocks.updatePlot(payload, key, id) }),
    select: () => ({ eq: () => ({ or: () => ({ maybeSingle: async () => ({ data: { id: 'P1', plot_name: 'P1', project_name: 'Project', selling_price: 2793000 }, error: null }) }) }) }),
  };
  const query = { select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
  return query;
} } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: async () => [{ id: 'P1', plot_name: 'P1', project_name: 'Project', has_customer: false, sale_status: 'available' }] }));
vi.mock('../LeadPicker', () => ({ default: ({ onToggleCreateNew }: { onToggleCreateNew: (value: boolean) => void }) => <button type="button" onClick={() => onToggleCreateNew(true)}>New walk-in</button> }));

const projects = ['Project'];
const owners = [{ userId: 'sales-1', displayName: 'Sales One' }];
const customer = { id: 'lead-1', customer_name: 'Customer', status: 'Visit' };
const interest = { projectName: 'Project', plotId: 'P1' };
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [mocks.updateLead, mocks.deletePromotions, mocks.insertPromotions, mocks.activity, mocks.updatePlot]) mock.mockResolvedValue({ error: null });
  mocks.createLead.mockResolvedValue({ data: { id: 'new-lead-1' }, error: null });
  mocks.insertSale.mockImplementation(async (rows: { id: string }[]) => ({ data: { id: rows[0].id }, error: null }));
  mocks.readSale.mockResolvedValue({ data: null, error: null });
});
afterEach(cleanup);

function setup(nextCustomer = customer) {
  const onSaved = vi.fn(), onClose = vi.fn();
  render(<CentralLeadBookingModal isOpen onClose={onClose} onSaved={onSaved} customer={nextCustomer}
    initialInterest={interest} projects={projects} salesOwners={owners} currentUser={{ userId: 'sales-1', displayName: 'Sales One' }} />);
  const save = async () => {
    await waitFor(() => expect(screen.getByPlaceholderText('เช่น 2,793,000')).toHaveValue('2,793,000'));
    fireEvent.submit(screen.getByRole('button', { name: /ยืนยันการจองแปลง/ }).closest('[role="dialog"]')!.querySelector('form')!);
  };
  return { onSaved, onClose, save };
}

describe('booking transaction status/error safety', () => {
  it.each(['Booked', 'Transferred', 'Rented', 'Cancelled'])('rejects a new booking for %s before writing', async status => {
    const { save, onSaved, onClose } = setup({ ...customer, status });
    await save();
    expect(await screen.findByText(/กรุณาใช้อัปเดตสถานะลูกค้าแทน/)).toBeInTheDocument();
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.createLead).not.toHaveBeenCalled();
    expect(mocks.deletePromotions).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops downstream writes and retains the form when updating a lead resolves an error', async () => {
    mocks.updateLead.mockResolvedValue({ error: { message: 'lead denied' } });
    const { save, onSaved, onClose } = setup();
    await save();
    expect(await screen.findByText(/บันทึกข้อมูลลูกค้าไม่สำเร็จ: lead denied/)).toBeInTheDocument();
    expect(mocks.deletePromotions).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops when new walk-in creation fails and does not update the original selected lead', async () => {
    mocks.createLead.mockResolvedValue({ data: null, error: { message: 'create denied' } });
    const { save, onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New walk-in' }));
    fireEvent.change(screen.getByPlaceholderText(/ลูกค้า Walk-in/), { target: { value: 'New customer' } });
    await save();
    expect(await screen.findByText(/create denied/)).toBeInTheDocument();
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.deletePromotions).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each(['delete', 'insert', 'activity', 'plot'] as const)('does not report success for a resolved %s write error', async phase => {
    const target = { delete: mocks.deletePromotions, insert: mocks.insertPromotions, activity: mocks.activity, plot: mocks.updatePlot }[phase];
    target.mockResolvedValue({ error: { message: `${phase} denied` } });
    const { save, onSaved, onClose } = setup();
    if (phase === 'insert') fireEvent.click(screen.getByRole('button', { name: 'เลือกทั้งหมด' }));
    await save();
    expect(await screen.findByText(new RegExp(`${phase} denied`))).toHaveTextContent('บันทึกการจองบางส่วนแล้ว');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retries after plot failure without creating another walk-in lead or acknowledged booking activity', async () => {
    mocks.updatePlot.mockResolvedValueOnce({ error: { message: 'plot denied' } });
    const { save, onSaved, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New walk-in' }));
    fireEvent.change(screen.getByPlaceholderText(/ลูกค้า Walk-in/), { target: { value: 'New customer' } });
    await save();
    await screen.findByText(/plot denied/);
    expect(onClose).not.toHaveBeenCalled();
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.createLead).toHaveBeenCalledOnce();
    expect(mocks.insertSale).toHaveBeenCalledOnce();
    expect(mocks.activity).toHaveBeenCalledOnce();
    expect(mocks.deletePromotions).toHaveBeenCalledOnce();
    expect(mocks.updatePlot).toHaveBeenCalledTimes(2);
    expect(mocks.updatePlot.mock.calls.every(call => call[1] === 'id' && call[2] === 'P1')).toBe(true);
    expect(mocks.activity.mock.calls[0][0][0].customer_id).toBe('new-lead-1');
  });

  it('retrying a failed promotion insert keeps the prior acknowledged deletion and lead update', async () => {
    mocks.insertPromotions.mockResolvedValueOnce({ error: { message: 'promotion denied' } });
    const { save, onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'เลือกทั้งหมด' }));
    await save();
    await screen.findByText(/promotion denied/);
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.updateLead).toHaveBeenCalledOnce();
    expect(mocks.deletePromotions).toHaveBeenCalledOnce();
    expect(mocks.insertPromotions).toHaveBeenCalledTimes(2);
    expect(mocks.activity).toHaveBeenCalledOnce();
  });

  it('blocks changing transaction inputs after a partial save instead of mixing customers/plots', async () => {
    mocks.updatePlot.mockResolvedValue({ error: { message: 'plot denied' } });
    const { save, onSaved } = setup();
    await save();
    await screen.findByText(/plot denied/);
    fireEvent.change(screen.getByPlaceholderText('10000'), { target: { value: '20000' } });
    await save();
    expect(await screen.findByText('บันทึกการจองบางส่วนแล้ว กรุณาคงข้อมูลเดิมแล้วกดบันทึกอีกครั้งเพื่อดำเนินการส่วนที่เหลือ')).toBeInTheDocument();
    expect(mocks.updatePlot).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('records the agreed price and deposit on the exact linked native sale before updating the plot', async () => {
    const { save, onSaved } = setup();
    fireEvent.change(screen.getByPlaceholderText('10000'), { target: { value: '25000' } });
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const sale = mocks.insertSale.mock.calls[0][0][0];
    expect(sale).toMatchObject({ lead_id: 'lead-1', plot_id: 'P1', sale_price: 2793000,
      list_price: 2793000, discount_amount: 0, booking_amount: 25000, contract_status: 'Reserved',
      crm_stage: 'booked', payment_method: 'mortgage', bank_name: null });
    expect(sale.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sale.booked_at).toBe(sale.created_at);
    expect(sale).not.toHaveProperty('project_interest_id');
    expect(sale).not.toHaveProperty('customer_name');
    expect(sale).not.toHaveProperty('closing_sales_user_id');
    expect(mocks.insertSale.mock.invocationCallOrder[0]).toBeLessThan(mocks.updatePlot.mock.invocationCallOrder[0]);
    expect(mocks.updateLead.mock.calls[0][0]).toMatchObject({ interested_plot_id: 'P1', booking_amount: 25000,
      booking_date: sale.booked_at, agent_name: 'Sales One' });
    expect(mocks.updateLead.mock.calls[0][0]).not.toHaveProperty('sales_owner');
  });

  it('keeps a failed sale insertion in the form and retries using the original sale ID', async () => {
    mocks.insertSale.mockResolvedValueOnce({ data: null, error: { message: 'sale denied' } });
    const { save, onSaved, onClose } = setup();
    await save();
    await screen.findByText(/รายการขายไม่สำเร็จ: sale denied/);
    expect(mocks.deletePromotions).not.toHaveBeenCalled();
    expect(mocks.updatePlot).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const attempted = mocks.insertSale.mock.calls[0][0][0];
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.insertSale.mock.calls[1][0][0]).toEqual(attempted);
    expect(mocks.updateLead).toHaveBeenCalledOnce();
    expect(mocks.readSale).toHaveBeenCalledOnce();
  });

  it('recovers a committed sale after an uncertain response without inserting a second sale', async () => {
    mocks.insertSale.mockImplementationOnce(async (rows: { id: string; lead_id: string; plot_id: string }[]) => {
      mocks.readSale.mockResolvedValueOnce({ data: { ...rows[0] }, error: null });
      return { data: null, error: { message: 'response interrupted' } };
    });
    const { save, onSaved } = setup();
    await save(); await screen.findByText(/response interrupted/);
    await save(); await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.insertSale).toHaveBeenCalledOnce();
    expect(mocks.updateLead).toHaveBeenCalledOnce();
    expect(mocks.updatePlot).toHaveBeenCalledOnce();
  });

  it('does not acknowledge an insert that returns a different sale ID', async () => {
    mocks.insertSale.mockResolvedValueOnce({ data: { id: 'other-sale' }, error: null });
    const { save, onSaved, onClose } = setup();
    await save(); await screen.findByText(/ไม่ได้รับรหัสรายการขายที่ตรงกัน/);
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.updatePlot).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses recovery when the sale ID belongs to a different customer or plot', async () => {
    mocks.insertSale.mockImplementationOnce(async (rows: { id: string }[]) => {
      mocks.readSale.mockResolvedValueOnce({ data: { id: rows[0].id, lead_id: 'different-lead', plot_id: 'P1' }, error: null });
      return { data: null, error: { message: 'response interrupted' } };
    });
    const { save, onSaved } = setup();
    await save(); await screen.findByText(/response interrupted/);
    await save(); await screen.findByText(/รหัสรายการขายไม่ตรงกับลูกค้าหรือแปลง/);
    expect(mocks.insertSale).toHaveBeenCalledOnce();
    expect(mocks.updatePlot).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  });
});
