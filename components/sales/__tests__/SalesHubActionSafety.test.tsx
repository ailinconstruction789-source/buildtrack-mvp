import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import type { SalesStartupData } from '@/types/salesStartup';
const mocks = vi.hoisted(() => ({ read: vi.fn(), select: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: mocks.select }) } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('next/dynamic', () => ({ default: (loader: () => unknown) => {
  const name = loader.toString().match(/(CentralLeadBookingModal|CentralLeadFollowUpModal|CentralVisitAppointmentModal|RentalContractModal|RentalActionModal|SalesDealStatusModal|AdminCustomerImportExportModal)/)?.[0] || 'dynamic';
  return function Modal({ lead, customer, isOpen, onClose, ...props }: Record<string, any>) {
    if (isOpen === false) return null;
    return <div data-testid={name} data-lead-id={(lead || customer)?.leadId || ''} data-sale-id={lead?.saleId || ''} data-contract-id={props.contractId || ''}><button onClick={onClose}>Close test dialog</button></div>;
  };
} }));
const user = { id: 'U1', username: 'Sales One', role: 'Sales' };
const projects = [{ name: 'Project A' }, { name: 'Project B' }];
const stages = ['Active', 'Visit', 'Loan', 'Booked', 'Transferred', 'Rented', 'Lost'];
const data: SalesStartupData = { plots: [], leads: stages.map((status, i) => ({
  id: `L${i}`, customer_name: `Customer ${status}`, project_name: i === 1 ? 'Project B' : 'Project A',
  sales_owner: 'Sales One', status, created_at: '2026-01-01',
  appointment_date: i === 0 || i === 1 ? '2026-10-08' : i === 2 || i === 3 ? '2026-10-10' : undefined,
  active_rental_contract_id: status === 'Rented' ? 'CONTRACT-6' : undefined,
})) };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-09T01:00:00Z'));
  mocks.select.mockResolvedValue({ data: [{ id: 'U1', username: 'Sales One', role: 'Sales' }], error: null });
  mocks.read.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function open(value = data) { render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={vi.fn().mockResolvedValue(value)} />); await screen.findByText('Customer Active'); }
const row = (status: string) => within(screen.getByText(`Customer ${status}`).closest('tr')!);
describe('Sales Hub actions', () => {
  it('routes booked customers to status progress without a second booking action', async () => {
    await open(); expect(row('Booked').queryByRole('button', { name: /^จอง/ })).not.toBeInTheDocument();
    fireEvent.click(row('Booked').getByRole('button', { name: 'อัปเดตสถานะ' }));
    expect(screen.getByTestId('SalesDealStatusModal')).toHaveAttribute('data-lead-id', 'L3');
    expect(screen.queryByTestId('CentralLeadBookingModal')).not.toBeInTheDocument();
  });
  it('rented action selects the existing contract rather than creating a new one', async () => {
    await open(); fireEvent.click(row('Rented').getByRole('button', { name: 'จัดการสัญญาเช่า' }));
    expect(screen.getByTestId('RentalActionModal')).toHaveAttribute('data-contract-id', 'CONTRACT-6');
    expect(screen.queryByTestId('RentalContractModal')).not.toBeInTheDocument();
  });
  it('does not offer booking for transferred or lost customers', async () => {
    await open();
    for (const status of ['Transferred', 'Lost']) expect(row(status).queryByRole('button', { name: /^จอง/ })).not.toBeInTheDocument();
    expect(row('Transferred').getByRole('button', { name: 'อัปเดตส่งมอบ' })).toBeEnabled();
  });
  it('due KPI and its resulting rows share the same predicate and preserve project selection', async () => {
    await open(); const due = screen.getByRole('button', { name: /ต้องโทรตามวันนี้/ }); expect(due).toHaveTextContent('2');
    fireEvent.click(due); expect(screen.getAllByRole('row')).toHaveLength(3); expect(screen.queryByText('Customer Loan')).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Project A' } });
    expect(due).toHaveTextContent('1'); expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.click(due); expect(due).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Customer Visit')).not.toBeInTheDocument(); expect(screen.getByText('Customer Loan')).toBeInTheDocument();
  });
  it('upcoming KPI uses dates even when customers are not in appointment stage', async () => {
    await open(); const upcoming = screen.getByRole('button', { name: /นัดหมายที่จะถึง/ }); expect(upcoming).toHaveTextContent('2');
    fireEvent.click(upcoming); expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Customer Loan')).toBeInTheDocument(); expect(screen.getByText('Customer Booked')).toBeInTheDocument();
    expect(screen.queryByText('Customer Visit')).not.toBeInTheDocument();
  });
  it('Kanban keeps the same post-booking action and removes duplicate missing-plot booking link', async () => {
    await open(); fireEvent.click(screen.getByTitle('มุมมองการ์ดบอร์ด (Kanban View)'));
    const card = screen.getByText('Customer Booked').closest<HTMLElement>('[class*="rounded-xl"]')!;
    expect(within(card).getByRole('button', { name: 'อัปเดตสถานะ' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /ยังไม่ระบุแปลง/ })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'อัปเดตสถานะ' }));
    expect(screen.getByTestId('SalesDealStatusModal')).toBeInTheDocument();
  });
  it('does not turn a name-only sales match into authority to update another sale row', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve(table === 'sales' ? [{ id: 'OTHER-SALE', customer_name: 'Customer Booked', contract_status: 'Reserved', lead_id: 'OTHER-LEAD' }] : []));
    await open(); fireEvent.click(row('Booked').getByRole('button', { name: 'อัปเดตสถานะ' }));
    expect(screen.getByTestId('SalesDealStatusModal')).toHaveAttribute('data-lead-id', 'L3');
    expect(screen.getByTestId('SalesDealStatusModal')).toHaveAttribute('data-sale-id', '');
  });
});
