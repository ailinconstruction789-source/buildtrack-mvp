import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban, { stageToKanbanStatus } from '../SalesKanban';

const mocks = vi.hoisted(() => ({ read: vi.fn(), mutation: vi.fn(), chosen: null as any }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../SalesMap', () => ({ default: ({ onPlotClick, leads }: any) => <><button onClick={() => onPlotClick('plot-1', 'Available')}>Open vacant plot</button><button onClick={() => onPlotClick('plot-1', 'Reserved', leads?.[0])}>Open occupied plot</button></> }));
vi.mock('../LeadPicker', () => ({ default: ({ onSelectLead }: any) => <button onClick={() => onSelectLead(mocks.chosen)}>Pick fixture lead</button> }));
vi.mock('../SalesDealStatusModal', () => ({ default: ({ lead, onSaved }: any) => <div data-testid="shared-customer-editor" data-lead-id={lead.leadId || ''} data-sale-id={lead.saleId || ''}><button onClick={() => onSaved('Shared update completed')}>Complete shared update</button></div> }));
vi.mock('../CentralLeadBookingModal', () => ({ default: () => <div>Booking form opened</div> }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false, isPlotEligibleForSampleHouse: () => false,
  toggleSampleHouse: vi.fn(), fetchTodayInspectionStatus: async () => null,
}));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => {
    const response = Promise.resolve({ data: [], error: null });
    const query = { select: () => query, eq: () => query, order: () => query, in: () => query,
      maybeSingle: async () => ({ data: null, error: null }), then: response.then.bind(response),
      update: (...args: any[]) => { mocks.mutation(...args); return { eq: async () => ({ error: { message: 'write denied' } }) }; },
    };
    return query;
  },
  rpc: async () => ({ data: { rows: [] }, error: null }),
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));

const plot = { id: 'plot-1', plot_name: 'A1', project_name: 'Project A', has_customer: false, sale_status: 'available' };
const interested = { id: 'lead-1', customer_name: 'Interested A', status: 'Visit', phone: '0812345678', interested_plot_id: 'plot-1' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chosen = interested;
  mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads' ? [interested] : []);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openPlot() {
  render(<SalesKanban project={{ name: 'Project A' }} projects={[{ name: 'Project A' }]} initialTab="map" />);
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Open vacant plot' }));
  await screen.findByRole('button', { name: /บันทึกการจอง/ });
}

describe('Kanban actions target valid deal stages', () => {
  it.each(['Booked', 'Transferred', 'Rented', 'Cancelled'])('prevents a new reservation for %s selected from the picker', async status => {
    mocks.chosen = { ...interested, status };
    await openPlot();
    fireEvent.click(screen.getByRole('button', { name: 'Pick fixture lead' }));
    expect(screen.getByRole('button', { name: /บันทึกการจอง/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /บันทึกการจอง/ }));
    expect(screen.queryByText('Booking form opened')).not.toBeInTheDocument();
  });

  it('lets an interest row select the customer, then uses the single booking command', async () => {
    await openPlot();
    const choices = await screen.findAllByRole('button', { name: 'เลือกลูกค้ารายนี้' });
    fireEvent.click(choices[0]);
    expect(screen.queryByRole('button', { name: /^⚡ จอง$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Booking form opened')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /บันทึกการจอง/ }));
    expect(await screen.findByText('Booking form opened')).toBeInTheDocument();
  });

  it('exposes the edit command for narrow screens and keyboard focus', async () => {
    render(<SalesKanban project={{ name: 'Project A' }} initialTab="list" />);
    const button = await screen.findByRole('button', { name: /Edit Profile/ });
    expect(button.className).toContain('opacity-100');
    expect(button.className).toContain('group-focus-within:opacity-100');
  });

  it('opens a raw Booked lead in the native Reserved editor without an undefined icon crash', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads' ? [{ ...interested, status: 'Booked' }] : []);
    render(<SalesKanban project={{ name: 'Project A' }} initialTab="list" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Profile/ }));
    expect(screen.getByTestId('shared-customer-editor')).toHaveAttribute('data-lead-id', 'lead-1');
    expect(screen.getByTestId('shared-customer-editor')).toHaveAttribute('data-sale-id', '');
  });

  it('routes sale-backed editing to the common command rather than the obsolete native writer', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'sales' ? [{ id: 'sale-1', plot_id: 'plot-1', customer_name: 'Sale A', contract_status: 'Reserved' }] : []);
    render(<SalesKanban project={{ name: 'Project A' }} initialTab="list" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Profile/ }));
    expect(screen.getByTestId('shared-customer-editor')).toHaveAttribute('data-sale-id', 'sale-1');
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it('opens the same shared editor with exact linked IDs from an occupied map plot', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads' ? [interested] : [{ id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', customer_name: 'Old Sale Name', contract_status: 'Reserved', crm_stage: 'booked' }]);
    render(<SalesKanban project={{ name: 'Project A' }} user={{ id: 'U1', role: 'Sales' }} initialTab="map" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('leads', expect.anything()));
    fireEvent.click(await screen.findByRole('button', { name: 'Open occupied plot' }));
    expect(screen.getByTestId('shared-customer-editor')).toHaveAttribute('data-lead-id', 'lead-1');
    expect(screen.getByTestId('shared-customer-editor')).toHaveAttribute('data-sale-id', 'sale-1');
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it('reloads both customer and sale data after the shared editor saves', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads' ? [{ ...interested, status: 'Booked' }] : []);
    render(<SalesKanban project={{ name: 'Project A' }} user={{ id: 'U1', role: 'Sales' }} initialTab="list" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Profile/ }));
    const reads = mocks.read.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Complete shared update' }));
    await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThan(reads));
    expect(screen.queryByTestId('shared-customer-editor')).not.toBeInTheDocument();
    expect(window.alert).toHaveBeenCalledWith('Shared update completed');
  });

});

describe('post-booking map categories', () => {
  it('keeps transfer pending and mortgage rejection distinct from approval and cancellation', () => {
    expect(stageToKanbanStatus('transfer_pending')).toBe('TransferPending');
    expect(stageToKanbanStatus('loan_rejected')).toBe('LoanRejected');
  });
  it('uses terminal native state over stale CRM progress and opens the common editor', async () => {
    mocks.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'sales' ? [{ id: 'sale-1', plot_id: 'plot-1', customer_name: 'Transferred A', contract_status: 'Transferred', crm_stage: 'booked' }] : []);
    render(<SalesKanban project={{ name: 'Project A' }} user={{ id: 'U1', role: 'Sales' }} initialTab="list" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Profile/ }));
    expect(screen.getByTestId('shared-customer-editor')).toHaveAttribute('data-sale-id', 'sale-1');
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
