import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RentalManagementWorkspace from '../RentalManagementWorkspace';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../RentalActionModal', () => ({ default: ({ contractId }: { contractId: string }) => <div data-testid="action-contract">{contractId}</div> }));
vi.mock('../RentalContractModal', () => ({ default: () => null }));
vi.mock('../RentalPaymentLedgerModal', () => ({ default: () => null }));
vi.mock('../RentalMaintenanceModal', () => ({ default: () => null }));
vi.mock('../TenantPortalModal', () => ({ default: () => null }));
vi.mock('../AdminDeleteCustomerModal', () => ({ default: () => null }));
vi.mock('../RentalReceiptModal', () => ({ default: () => null }));
const base = { lead_id: 'same-lead', project_name: 'Project', plot_id: 'plot-1', plot_name: '1', agent_name: 'Sales A',
  program_type: 'program_a', monthly_rent: 15000, lease_start_date: '2026-01-01', lease_end_date: '2030-01-01' };
const contracts = [
  { ...base, id: 'active-1', tenant_name: 'Active tenant', status: 'Active' },
  { ...base, id: 'renewed-2', tenant_name: 'Renewed tenant', status: 'Renewed' },
  { ...base, id: 'closed-3', tenant_name: 'Closed tenant', status: 'MovedOut' }
];
beforeEach(() => {
  mocks.from.mockReset().mockImplementation((table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query, or: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === 'rental_contracts' ? contracts : [], error: null }).then(resolve) };
    return query;
  });
});
describe('Rental management row action', () => {
  it.each(['table', 'grid'])('passes the clicked Renewed contract ID and disables the closed contract in %s view', async mode => {
    render(<RentalManagementWorkspace user={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} />);
    await screen.findByText('Renewed tenant');
    if (mode === 'grid') fireEvent.click(screen.getByTitle('การ์ด (Grid View)'));
    const buttons = screen.getAllByTitle(mode === 'grid'
      ? 'ดำเนินการสัญญา (ซื้อบ้าน/ต่อสัญญา/ย้ายออก)' : 'ดำเนินการ: เปลี่ยนเป็นซื้อบ้าน / ต่อสัญญา / ย้ายออก');
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeEnabled();
    expect(buttons[2]).toBeDisabled();
    fireEvent.click(buttons[1]);
    expect(screen.getByTestId('action-contract')).toHaveTextContent('renewed-2');
  });
  it('includes Renewed contracts when filtering ongoing rentals', async () => {
    render(<RentalManagementWorkspace user={{ username: 'Sales A', role: 'Sales' }} />);
    await screen.findByText('Renewed tenant');
    const activeFilter = screen.getByRole('button', { name: /กำลังเช่า/ });
    fireEvent.click(activeFilter);
    await waitFor(() => expect(screen.queryByText('Closed tenant')).not.toBeInTheDocument());
    expect(screen.getByText('Active tenant')).toBeInTheDocument();
    expect(screen.getByText('Renewed tenant')).toBeInTheDocument();
  });
});
