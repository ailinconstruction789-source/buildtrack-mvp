import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import type { SalesStartupData } from '@/types/salesStartup';
import { useBuildTrackData } from '@/hooks/useBuildTrackData';

const mocks = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), select: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('next/dynamic', () => ({ default: () => function StaffOptions({ isOpen, salesOwners }: {
  isOpen?: boolean; salesOwners?: { userId: string; displayName: string }[];
}) {
  return isOpen ? <select aria-label="Sales staff options">
    {salesOwners?.map(owner => <option key={owner.userId} value={owner.displayName}>{owner.displayName}</option>)}
  </select> : null;
} }));

const user = { username: 'PIEW', role: 'Sales', id: 'U1' };
const projects = [{ name: 'Project A' }];
const base: SalesStartupData = {
  leads: [{ id: 'L1', customer_name: 'Startup Customer', project_name: 'Project A',
    interested_plot_id: 'P1', sales_owner: 'PIEW', status: 'New',
    booking_date: '2026-01-01', created_at: '2026-01-01', updated_at: '2026-01-01' }],
  plots: [{ id: 'P1', plot_name: '1', project_name: 'Project A', house_types: { type_name: 'Type A' } }],
};

function deferred() {
  let resolve!: (value: SalesStartupData) => void;
  const promise = new Promise<SalesStartupData>(accept => { resolve = accept; });
  return { resolve, promise };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockImplementation((table: string) => Promise.resolve(table === 'leads' ? base.leads : table === 'plots' ? base.plots : []));
  mocks.select.mockResolvedValue({ data: [{ id: 1, username: 'PIEW', role: 'Sales' }], error: null });
  mocks.from.mockReturnValue({ select: mocks.select });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Sales Hub startup sharing', () => {
  it('saves a new customer inline using agent_name from the live native Lead schema', async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'new-lead' }, error: null }) }) });
    mocks.from.mockImplementation((table: string) => table === 'leads' ? { insert } : { select: mocks.select });
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่ม Lead ใหม่' }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย รักดี'), { target: { value: 'New Native Customer' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก Lead ใหม่' }));
    await waitFor(() => expect(insert).toHaveBeenCalledOnce());
    const payload = insert.mock.calls[0][0][0];
    expect(payload).toMatchObject({ customer_name: 'New Native Customer', agent_name: 'PIEW', created_by_agent: 'PIEW', status: 'New' });
    expect(payload).not.toHaveProperty('sales_owner');
    expect(await screen.findByText(/บันทึก Lead ใหม่ "New Native Customer" สำเร็จ/)).toBeInTheDocument();
  });

  it('does not report successful intake when the database returns no created Lead ID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: null }) }) });
    mocks.from.mockImplementation((table: string) => table === 'leads' ? { insert } : { select: mocks.select });
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่ม Lead ใหม่' }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย รักดี'), { target: { value: 'Not Yet Saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก Lead ใหม่' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('ไม่ได้รับรหัสลูกค้าหลังบันทึก')));
    expect(screen.getByRole('button', { name: 'บันทึก Lead ใหม่' })).toBeInTheDocument();
    expect(screen.queryByText(/บันทึก Lead ใหม่ "Not Yet Saved" สำเร็จ/)).not.toBeInTheDocument();
  });

  it('shows and scopes the assigned Sales employee from native agent_name in table and Kanban', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve(table === 'leads' ? [{ ...base.leads[0], sales_owner: undefined, agent_name: 'PIEW' }]
      : table === 'plots' ? base.plots : []));
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    fireEvent.click(screen.getByTitle('มุมมองการ์ดบอร์ด (Kanban View)'));
    expect(screen.getByText('Startup Customer')).toBeInTheDocument();
    expect(screen.getByText('คุณดูแล')).toBeInTheDocument();
  });

  it('keeps an old sale without a Lead under unknown year instead of counting its import year as booking year', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve(table === 'leads' ? base.leads : table === 'plots' ? base.plots : table === 'sales' ? [{
      id: 'S-old', lead_id: null, customer_name: 'Old Sale Customer', contract_status: 'Transferred',
      plots: { id: 'P1', plot_name: '1', project_name: 'Project A' }, plot_id: 'P1', agent_name: 'PIEW',
      created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:00:00Z',
    }] : []));
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer'); expect(screen.queryByText('Old Sale Customer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^ทั้งหมด/ }));
    const option = screen.getByRole('option', { name: '📅 ไม่มีวันที่เดิมระบุปี' });
    fireEvent.change(option.closest('select')!, { target: { value: 'unknown' } });
    expect(await screen.findByText('Old Sale Customer')).toBeInTheDocument(); expect(screen.queryByText('Startup Customer')).not.toBeInTheDocument();
    fireEvent.change(option.closest('select')!, { target: { value: 'all' } });
    expect(screen.getByText('Old Sale Customer')).toBeInTheDocument(); expect(screen.getByText('Startup Customer')).toBeInTheDocument();
  });
  it('offers only sales-role staff even when construction/admin accounts are returned', async () => {
    mocks.select.mockResolvedValue({ data: [
      { id: 1, username: 'PIEW', role: 'Sales' },
      { id: 2, username: 'SALE_ALIAS', role: 'sale' },
      { id: 3, username: 'SALES_CASE', role: ' SALES ' },
      { id: 4, username: 'FOREMAN', role: 'Foreman' },
      { id: 5, username: 'ADMIN', role: 'Admin' },
      { id: 6, username: 'OWNER', role: 'Owner' },
      { id: 7, username: 'UNKNOWN', role: null },
      { id: 8, username: 'SUPPORT', role: 'Sales Support' },
    ], error: null });
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    fireEvent.click(screen.getByRole('button', { name: 'ติดตาม' }));
    const select = screen.getByRole('combobox', { name: 'Sales staff options' });
    expect(within(select).getAllByRole('option').map(option => option.textContent))
      .toEqual(['PIEW', 'SALE_ALIAS', 'SALES_CASE']);
  });

  it('reads only real staff columns from users', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    expect(mocks.from).toHaveBeenCalledWith('users');
    expect(mocks.select).toHaveBeenCalledWith('id, username, role');
    expect(mocks.from).not.toHaveBeenCalledWith('app_users');
  });

  it('reports a failed staff read and recovers after retry instead of showing an empty successful load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.select.mockResolvedValueOnce({ data: null, error: { message: 'staff unavailable' } });
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดข้อมูลไม่สำเร็จ');
    expect(screen.queryByText('ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText('Startup Customer');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('keeps the last complete snapshot visibly marked when a refresh fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn().mockResolvedValueOnce(base).mockRejectedValueOnce(new Error('later page failed')).mockResolvedValue(base);
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={load} />);
    await screen.findByText('Startup Customer');
    fireEvent.click(screen.getByTitle('รีเฟรชข้อมูล'));
    expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลเดิมที่แสดงอาจไม่ใช่ข้อมูลล่าสุด');
    expect(screen.getByText('Startup Customer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(load).toHaveBeenLastCalledWith({ fresh: true });
    vi.restoreAllMocks();
  });

  it('does not show an error from a previous account request', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<SalesStartupData>((_, fail) => { reject = fail; });
    const load = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(base);
    const { rerender } = render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={load} />);
    rerender(<MySalesWorkspace currentUser={{ ...user, id: 'U2' }} projects={projects} loadStartupData={load} />);
    await screen.findByText('Startup Customer');
    await act(async () => { reject(new Error('old account failed')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps all stages visible in Kanban and separates cancelled bookings from pre-booking lost leads', async () => {
    const stages = ['Active', 'Visit', 'Loan', 'Booked', 'Transferred', 'Rented', 'Lost', 'Cancelled', 'Closed_Lost'];
    const leads = stages.map((status, index) => ({ ...base.leads[0],
      id: `stage-${index}`, customer_name: `Customer ${status}`, status,
      project_name: status === 'Cancelled' ? 'Project B' : 'Project A',
    }));
    render(<MySalesWorkspace currentUser={user} projects={[...projects, { name: 'Project B' }]}
      loadStartupData={vi.fn().mockResolvedValue({ ...base, leads })} />);
    await screen.findByText('Customer Active');
    fireEvent.click(screen.getByTitle('มุมมองการ์ดบอร์ด (Kanban View)'));
    for (const lead of leads) expect(screen.getByText(lead.customer_name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '🚫 ยกเลิกจอง 1' }));
    const cancelled = screen.getByRole('region', { name: 'ลูกค้ายกเลิกจอง' });
    expect(within(cancelled).getByText('Customer Cancelled')).toBeInTheDocument();
    expect(cancelled.className).toContain('order-first');
    fireEvent.click(screen.getByRole('button', { name: '❌ ยุติการซื้อ 2' }));
    const lost = screen.getByRole('region', { name: 'ลูกค้ายุติการซื้อ' });
    expect(within(lost).getAllByRole('button', { name: 'ตาม' })).toHaveLength(2);
    expect(lost.className).toContain('order-first');
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Project A' } });
    expect(within(lost).getAllByRole('button', { name: 'ตาม' })).toHaveLength(2);
    expect(screen.queryByText('Customer Cancelled')).not.toBeInTheDocument();
    expect(within(lost).getByText('Customer Lost')).toBeInTheDocument();
    expect(within(lost).getByText('Customer Closed_Lost')).toBeInTheDocument();
  });

  it('starts keyed child reads after the parent commits the new account context', async () => {
    let rows = base;
    mocks.from.mockImplementation((table: string) => {
      const data = table === 'leads' ? rows.leads : table === 'plots' ? rows.plots : [];
      const response = Promise.resolve({ data, error: null });
      return {
        select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        then: response.then.bind(response),
      };
    });
    function Parent({ account }: { account: typeof user | null }) {
      const core = useBuildTrackData(account, undefined, true);
      return account ? <MySalesWorkspace key={account.id} currentUser={account}
        projects={projects} loadStartupData={core.loadSalesStartupData} /> : null;
    }
    const { rerender } = render(<Parent account={null} />);
    rerender(<Parent account={user} />);
    await screen.findByText('Startup Customer');
    rows = { ...base, leads: [{ ...base.leads[0], sales_owner: 'BELL', customer_name: 'Committed Account Customer' }] };
    rerender(<Parent account={{ username: 'BELL', role: 'Sales', id: 'U2' }} />);
    await screen.findByText('Committed Account Customer');
    expect(screen.queryByText('Startup Customer')).not.toBeInTheDocument();
  });
  it('renders the same customer table and counts with shared rows as with independent reads', async () => {
    const standalone = render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    const previous = standalone.container.innerHTML;
    standalone.unmount();
    vi.clearAllMocks();
    const load = vi.fn().mockResolvedValue(base);
    const shared = render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={load} />);
    await screen.findByText('Startup Customer');
    expect(shared.container.innerHTML).toBe(previous);
    expect(load).toHaveBeenCalledWith({ fresh: false });
    expect(mocks.read.mock.calls.map(([table]) => table)).toEqual(['sales']);
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['users']);
  });

  it('requests a fresh shared snapshot when the user refreshes', async () => {
    const load = vi.fn().mockResolvedValueOnce(base).mockResolvedValue({ ...base,
      leads: [{ ...base.leads[0], customer_name: 'Fresh Customer' }],
    });
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={load} />);
    await screen.findByText('Startup Customer');
    fireEvent.click(screen.getByTitle('รีเฟรชข้อมูล'));
    await screen.findByText('Fresh Customer');
    expect(load).toHaveBeenLastCalledWith({ fresh: true });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('ignores a late response from the previous account', async () => {
    const pending = deferred();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ...base,
      leads: [{ ...base.leads[0], customer_name: 'Second Account Customer', sales_owner: 'BELL' }],
    });
    const { rerender } = render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={load} />);
    rerender(<MySalesWorkspace currentUser={{ username: 'BELL', role: 'Sales', id: 'U2' }} projects={projects} loadStartupData={load} />);
    await screen.findByText('Second Account Customer');
    await act(async () => { pending.resolve(base); });
    expect(screen.queryByText('Startup Customer')).not.toBeInTheDocument();
    expect(screen.getByText('Second Account Customer')).toBeInTheDocument();
  });

  it('keeps standalone usage working without a shared loader and omits the unused project read', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('Startup Customer');
    expect(mocks.read.mock.calls.map(([table]) => table)).toEqual(['leads', 'plots', 'sales']);
    await waitFor(() => expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['users']));
  });
});
