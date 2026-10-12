import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CentralLeadTracker from '../CentralLeadTracker';
import CentralLeadsView from '../CentralLeadsView';
import { EMPTY_TRACKER_FILTERS } from '@/lib/sales/centralTracker';
import { CENTRAL_SEARCH_CONTRACT_VERSION, EMPTY_CENTRAL_SEARCH, type CentralSearchSnapshot } from '@/lib/sales/centralContracts';
const mocks = vi.hoisted(() => ({ read: vi.fn(), session: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, auth: { getSession: mocks.session, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function snapshot(role: 'sales' | 'owner' = 'sales'): CentralSearchSnapshot {
  return { actor: { userId: 'U1', role }, projects: [{ name: 'Project A' }], salesOwners: [], page: 0, hasMore: false,
    search: { contractVersion: CENTRAL_SEARCH_CONTRACT_VERSION, filters: EMPTY_CENTRAL_SEARCH, projects: ['Project A'], owners: [], channels: [], hasMoreChannels: false },
    customers: [
      { id: 'L1', name: 'Lost customer', intakeStatus: 'lost', notes: '🏷️ บันทึกการจอง', ownerUserId: 'U1', interests: [], phone: null, channel: null, leadCreatedAt: null },
      { id: 'L2', name: 'Transferred customer', intakeStatus: 'transferred', notes: '🏷️ บันทึกการจอง', ownerUserId: 'U1', interests: [], phone: null, channel: null, leadCreatedAt: null },
    ] };
}
function open(role: 'sales' | 'owner' = 'sales') {
  const data = snapshot(role);
  render(<CentralLeadTracker snapshot={data} filters={EMPTY_TRACKER_FILTERS} onFilterChange={vi.fn()} onApply={vi.fn()} leadWorkEnabled bookingEnabled visitsEnabled />);
}
describe('central Sales action boundaries', () => {
  it('keeps Owner lost-customer details read-only', () => {
    open('owner'); fireEvent.click(screen.getByRole('button', { name: /ไม่สนใจ \/ พักติดตาม/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ Lost customer' }));
    expect(screen.queryByRole('button', { name: /ดึงกลับ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /งานส่วนกลางของ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จองแปลง/ })).not.toBeInTheDocument(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('puts transferred customers in a separate view and only offers status details', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: '🏡 โอนแล้ว (1)' }));
    expect(screen.getByText('Transferred customer')).toBeInTheDocument(); expect(screen.queryByText('Lost customer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ Transferred customer' }));
    expect(screen.getByRole('button', { name: 'ดูสถานะ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จองแปลง/ })).not.toBeInTheDocument();
  });
  it('uses the trusted shell actor and preserves the public lead stage when mapping', async () => {
    mocks.read.mockResolvedValue([{ id: 'PUBLIC-LEAD', customer_name: 'Booked public customer', status: 'Booked', crm_status: 'Booked — จองแล้ว', project_name: 'Project A', created_at: '2026-01-01' }]);
    mocks.from.mockImplementation((table: string) => ({ select: () => table === 'users' ? Promise.resolve({ data: [], error: null }) : { order: () => Promise.resolve({ data: [{ name: 'Project A' }], error: null }) } }));
    render(<CentralLeadsView currentUser={{ id: 'TRUSTED-U1', role: 'Sales' }} embedded leadWorkEnabled bookingEnabled />);
    await screen.findByRole('table'); expect(mocks.session).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /จองแล้ว \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ Booked public customer' }));
    expect(screen.getByRole('button', { name: 'อัปเดตสถานะ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'อัปเดตสถานะ' }));
    expect(screen.getByRole('button', { name: 'บันทึกข้อมูล' })).toBeDisabled();
  });
});
