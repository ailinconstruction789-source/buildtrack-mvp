import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban, { stageToKanbanStatus } from '../SalesKanban';

const mocks = vi.hoisted(() => ({ read: vi.fn(), mutation: vi.fn(), rpc: vi.fn(), chosen: null as any }));
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
  from: (table: string) => {
    const response = Promise.resolve({ data: [], error: null });
    const query: any = { select: () => query, eq: () => query, order: () => query, in: () => query,
      maybeSingle: async () => ({ data: null, error: null }), then: response.then.bind(response),
      insert: (...args: any[]) => { mocks.mutation(table, 'insert', ...args); return Promise.resolve({ data: [], error: null }); },
      update: (...args: any[]) => {
        mocks.mutation(table, 'update', ...args);
        const updChain: any = {
          eq: () => updChain,
          in: () => updChain,
          then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return updChain;
      },
    };
    return query;
  },
  rpc: (...args: any[]) => mocks.rpc(...args),
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));

const plot = { id: 'plot-1', plot_name: 'A1', project_name: 'Project A', has_customer: false, sale_status: 'available' };
const interested = { id: 'lead-1', customer_name: 'Interested A', status: 'Visit', phone: '0812345678', interested_plot_id: 'plot-1' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chosen = interested;
  mocks.rpc.mockResolvedValue({ data: { rows: [] }, error: null });
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

  it('cancels a pending rental booking via unified sales_tx_cancel_rental_booking RPC with zero direct plots/leads/contracts writes', async () => {
    const rentalLead = {
      id: 'lead-rent-1',
      customer_name: 'ผู้เช่าทดสอบ',
      status: 'Reserved',
      deal_type: 'rent',
      rental_status: 'PendingContract',
      rental_program: 'program_a',
      rental_monthly_rent: 29000,
      phone: '0812345678',
      interested_plot_id: 'Project A-42',
      interested_plot_name: '42',
      crm_status: 'จองเช่า — รอทำสัญญา (Rent (เช่า))',
    };
    mocks.rpc.mockImplementation(async (fnName: string) => {
      if (fnName === 'sales_tx_cancel_rental_booking') {
        return {
          data: {
            command: 'rental_cancel_booking',
            leadId: 'lead-rent-1',
            plotId: 'Project A-42',
            plotReleased: true,
            rentalStatus: 'Cancelled',
          },
          error: null,
        };
      }
      return { data: { rows: [] }, error: null };
    });
    mocks.read.mockImplementation(async (table: string) =>
      table === 'plots' ? [{ ...plot, id: 'Project A-42', plot_name: '42', sale_status: 'ready_for_sale', current_tenant_name: 'ผู้เช่าทดสอบ', rental_program: 'program_a' }]
      : table === 'leads' ? [rentalLead]
      : []
    );
    render(<SalesKanban project={{ name: 'Project A' }} user={{ id: 'U1', username: 'NOOK', role: 'Sales' }} initialTab="map" />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('leads', expect.anything()));
    fireEvent.click(await screen.findByRole('button', { name: 'Open occupied plot' }));

    fireEvent.click(await screen.findByRole('button', { name: /ยกเลิกจองเช่า/ }));
    const reasonBox = await screen.findByRole('textbox', { name: /เหตุผลในการยกเลิกจองเช่า/ });
    fireEvent.change(reasonBox, { target: { value: 'นักลงทุนซื้อพร้อมผู้เช่า' } });

    fireEvent.click(screen.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/ }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        'sales_tx_cancel_rental_booking',
        expect.objectContaining({
          p_request_id: expect.any(String),
          p_payload: expect.objectContaining({
            leadId: 'lead-rent-1',
            reason: 'นักลงทุนซื้อพร้อมผู้เช่า',
          }),
        })
      );
    });

    // Zero direct writes to plots, leads, or rental_contracts
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
