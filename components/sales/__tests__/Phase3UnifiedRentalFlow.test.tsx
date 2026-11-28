import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RentalContractModal from '../RentalContractModal';
import RentalActionModal from '../RentalActionModal';
import RentalManagementWorkspace from '../RentalManagementWorkspace';
import { cancelRentalBooking } from '@/lib/sales/cancelRentalBooking';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  mutationCalls: [] as Array<{ table: string; op: string; payload: any }>,
}));

vi.mock('@/hooks/useSalesStaffOptions', () => ({
  useSalesStaffOptions: () => [{ userId: 'sales-1', displayName: 'Sales A' }],
}));

vi.mock('../LeadPicker', () => ({
  default: () => null,
}));

vi.mock('../RentalPaymentLedgerModal', () => ({ default: () => null }));
vi.mock('../RentalMaintenanceModal', () => ({ default: () => null }));
vi.mock('../TenantPortalModal', () => ({ default: () => null }));
vi.mock('../AdminDeleteCustomerModal', () => ({ default: () => null }));
vi.mock('../RentalReceiptModal', () => ({ default: () => null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mocks.rpc(...args),
    from: (table: string) => mocks.from(table),
  },
}));

function buildReadTableMock(tableData: Record<string, any[]>) {
  return (table: string) => {
    const rows = tableData[table] ?? [];
    const response = Promise.resolve({ data: rows, error: null });
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: response.then.bind(response),
      insert: (payload: any) => {
        mocks.mutationCalls.push({ table, op: 'insert', payload });
        return chain;
      },
      update: (payload: any) => {
        mocks.mutationCalls.push({ table, op: 'update', payload });
        return chain;
      },
      delete: () => {
        mocks.mutationCalls.push({ table, op: 'delete', payload: null });
        return chain;
      },
    };
    return chain;
  };
}

describe('Phase 3 Unified Transactional Rental Flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.mutationCalls.length = 0;
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('RentalContractModal booking calls sales_tx_book_rental, keeps modal & inputs on error, and reuses requestId on retry', async () => {
    mocks.from.mockImplementation(
      buildReadTableMock({
        plots: [
          {
            id: 'ไอลิน6-10',
            plot_name: '10',
            project_name: 'ไอลิน6',
            has_customer: false,
            sale_status: 'ready_for_sale',
            selling_price: 2990000,
            monthly_rent: 15000,
          },
        ],
      })
    );

    // 1st attempt fails transiently; 2nd attempt succeeds
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } })
      .mockResolvedValueOnce({
        data: {
          command: 'rental_book',
          leadId: 'lead-10',
          contractId: 'rc-10',
          plotId: 'ไอลิน6-10',
          projectName: 'ไอลิน6',
          rentalStatus: 'PendingContract',
          replayed: false,
        },
        error: null,
      });

    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <RentalContractModal
        isOpen
        onClose={onClose}
        onSaved={onSaved}
        defaultMode="booking"
        projectName="ไอลิน6"
        plotId="ไอลิน6-10"
        user={{ id: 'sales-1', username: 'Sales A', role: 'Sales' }}
        lead={{
          id: 'lead-10',
          customer_name: 'คุณสมชาย เช่าดี',
          phone: '0811112222',
          project_name: 'ไอลิน6',
          status: 'Visit',
          agent_name: 'Sales A',
          updated_at: '2026-11-25T10:00:00Z',
        } as any}
      />
    );

    const notesInput = await screen.findByPlaceholderText(/ระบุรายละเอียด|เงื่อนไข|หมายเหตุ/i).catch(() =>
      document.querySelector('textarea') as HTMLTextAreaElement
    );
    expect(notesInput).toBeTruthy();
    fireEvent.change(notesInput, { target: { value: 'นัดโอนเงินจองพรุ่งนี้' } });

    const submitBtn = await screen.findByRole('button', { name: /ยืนยันบันทึกการจองเช่า/ });

    // 1st submit -> fails
    fireEvent.click(submitBtn);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/network timeout/)).toBeInTheDocument();
    // Modal must stay open, form preserved, onSaved/onClose NOT called
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('นัดโอนเงินจองพรุ่งนี้')).toBeInTheDocument();

    // 2nd submit (retry) -> reuses EXACT same p_request_id!
    fireEvent.click(submitBtn);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));

    const [rpcName1, args1] = mocks.rpc.mock.calls[0];
    const [rpcName2, args2] = mocks.rpc.mock.calls[1];
    expect(rpcName1).toBe('sales_tx_book_rental');
    expect(rpcName2).toBe('sales_tx_book_rental');
    expect(args1.p_request_id).toBe(args2.p_request_id);
    expect(args2.p_payload).toMatchObject({
      projectName: 'ไอลิน6',
      plotId: 'ไอลิน6-10',
      leadId: 'lead-10',
      tenantName: 'คุณสมชาย เช่าดี',
      expectedLeadUpdatedAt: '2026-11-25T10:00:00Z',
    });

    // ZERO direct table writes on plots/leads/sales/rental_contracts!
    expect(mocks.mutationCalls).toHaveLength(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('RentalActionModal move_out calls sales_tx_move_out_rental with zero direct plot writes and preserves inputs on stale state', async () => {
    mocks.from.mockImplementation(
      buildReadTableMock({
        rental_contracts: [
          {
            id: 'rc-active-1',
            lead_id: 'lead-active-1',
            project_name: 'ไอลิน6',
            plot_id: 'ไอลิน6-22',
            plot_name: '22',
            tenant_name: 'คุณวิภา ผู้เช่า',
            program_type: 'program_b',
            monthly_rent: 15000,
            security_deposit: 30000,
            accumulated_savings: 25000,
            base_price: 2990000,
            lease_duration_months: 12,
            lease_start_date: '2026-01-01',
            lease_end_date: '2026-12-31',
            status: 'Active',
            deal_revision: 'rev-c-1',
          },
        ],
      })
    );

    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'SALES_TX_STALE_STATE' } })
      .mockResolvedValueOnce({
        data: {
          command: 'rental_move_out',
          contractId: 'rc-active-1',
          leadId: 'lead-active-1',
          plotId: 'ไอลิน6-22',
          depositRefunded: 30000,
          plotReleased: true,
          rentalStatus: 'MovedOut',
        },
        error: null,
      });

    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <RentalActionModal
        isOpen
        onClose={onClose}
        onSaved={onSaved}
        contractId="rc-active-1"
        user={{ id: 'sales-1', username: 'Sales A', role: 'Sales' }}
        lead={{ id: 'lead-active-1', customer_name: 'คุณวิภา ผู้เช่า', deal_revision: 'rev-l-1' } as any}
      />
    );

    // Wait for contract to load and switch to Move Out tab
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /สิ้นสุดสัญญา \/ ย้ายออก/ }));

    const moveOutBtn = await screen.findByRole('button', { name: /ยืนยันการย้ายออก/ });
    fireEvent.click(moveOutBtn);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/มีการเปลี่ยนแปลงระหว่างเปิดหน้าจอ/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Retry reuses same requestId and succeeds
    fireEvent.click(moveOutBtn);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));

    expect(mocks.rpc.mock.calls[0][0]).toBe('sales_tx_move_out_rental');
    expect(mocks.rpc.mock.calls[0][1].p_request_id).toBe(mocks.rpc.mock.calls[1][1].p_request_id);
    expect(mocks.rpc.mock.calls[1][1].p_payload).toMatchObject({
      contractId: 'rc-active-1',
      leadId: 'lead-active-1',
      expectedContractRevision: 'rev-c-1',
      expectedLeadRevision: 'rev-l-1',
    });
    expect(mocks.mutationCalls).toHaveLength(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancelRentalBooking handles stale state (PendingContract -> Active on server) without cancelling Active or touching plots directly', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL' },
    });

    const result = await cancelRentalBooking({
      lead: {
        id: 'lead-stale-1',
        customer_name: 'คุณสมหญิง รอสัญญา',
        status: 'Reserved',
        deal_type: 'rent',
        rental_status: 'PendingContract',
        deal_revision: 'rev-old',
      },
      actorId: 'Sales A',
      actorRole: 'Sales',
      canManage: true,
      reason: 'ลูกค้าไม่สะดวกเข้าอยู่',
      confirm: () => true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'sales_tx_cancel_rental_booking',
      expect.objectContaining({
        p_request_id: expect.any(String),
        p_payload: expect.objectContaining({
          leadId: 'lead-stale-1',
          expectedLeadRevision: 'rev-old',
        }),
      })
    );
    expect(result.status).toBe('stale_state');
    expect(result.shouldRefresh).toBe(true);
    expect(result.message).toContain('Active');
    expect(mocks.mutationCalls).toHaveLength(0);
  });

  it('RentalManagementWorkspace deduplicates PendingContract rows, uses shared cancelRentalBooking, and enforces Owner read-only permissions', async () => {
    const sharedPendingLead = {
      id: 'lead-p-99',
      customer_name: 'คุณณัฐ จองเช่า',
      phone: '0899990000',
      project_name: 'ไอลิน6',
      status: 'Reserved',
      deal_type: 'rent',
      rental_status: 'PendingContract',
      rental_program: 'program_a',
      rental_monthly_rent: 14000,
      booking_amount: 5000,
      interested_plot_id: 'ไอลิน6-99',
      interested_plot_name: '99',
    };
    const sharedPendingContract = {
      id: 'rc-p-99',
      lead_id: 'lead-p-99',
      project_name: 'ไอลิน6',
      plot_id: 'ไอลิน6-99',
      plot_name: '99',
      tenant_name: 'คุณณัฐ จองเช่า',
      program_type: 'program_a',
      monthly_rent: 14000,
      security_deposit: 28000,
      lease_start_date: '2026-12-01',
      lease_end_date: '2027-11-30',
      status: 'PendingContract',
    };

    mocks.from.mockImplementation(
      buildReadTableMock({
        rental_contracts: [sharedPendingContract],
        rental_payments: [],
        leads: [sharedPendingLead],
      })
    );
    mocks.rpc.mockResolvedValue({
      data: {
        command: 'rental_cancel_booking',
        leadId: 'lead-p-99',
        contractId: 'rc-p-99',
        plotId: 'ไอลิน6-99',
        plotReleased: true,
        rentalStatus: 'Cancelled',
      },
      error: null,
    });

    // 1. Sales user sees single deduplicated row + Sign Contract + Cancel Booking (NO Admin Delete button!)
    render(
      <RentalManagementWorkspace
        projects={[{ id: 'p1', name: 'ไอลิน6' }]}
        user={{ id: 'sales-1', username: 'Sales A', role: 'Sales' }}
      />
    );

    const tenantCells = await screen.findAllByText('คุณณัฐ จองเช่า');
    expect(tenantCells).toHaveLength(1);
    expect(screen.getByRole('button', { name: /ทำสัญญาเช่าจริง/ })).toBeInTheDocument();
    const cancelBtn = screen.getByRole('button', { name: /^ยกเลิกจอง$/ });
    expect(screen.queryByTitle(/ลบข้อมูลการจอง/)).not.toBeInTheDocument();

    fireEvent.click(cancelBtn);
    const reasonInput = await screen.findByRole('textbox', { name: /เหตุผลในการยกเลิกจองเช่า/ });
    fireEvent.change(reasonInput, { target: { value: 'ลูกค้าขอยกเลิกจองเช่าเนื่องจากย้ายงาน' } });
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/ }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'sales_tx_cancel_rental_booking',
        expect.objectContaining({
          p_payload: expect.objectContaining({
            leadId: 'lead-p-99',
            contractId: 'rc-p-99',
            reason: 'ลูกค้าขอยกเลิกจองเช่าเนื่องจากย้ายงาน',
          }),
        })
      )
    );

    cleanup();

    // 2. Read-only Owner sees row but ZERO write buttons
    render(
      <RentalManagementWorkspace
        projects={[{ id: 'p1', name: 'ไอลิน6' }]}
        user={{ id: 'owner-1', username: 'Owner', role: 'Owner' }}
      />
    );
    await screen.findByText('คุณณัฐ จองเช่า');
    expect(screen.queryByRole('button', { name: /ทำสัญญาเช่าใหม่/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ทำสัญญาเช่าจริง/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ยกเลิกจอง$/ })).not.toBeInTheDocument();
  });
});
