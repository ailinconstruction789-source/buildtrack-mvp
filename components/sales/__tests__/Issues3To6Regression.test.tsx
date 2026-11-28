import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyPlotOccupancy, type InterestedPlot } from '@/lib/sales/plotAvailability';
import { getLeadStage } from '@/lib/sales/leadStage';
import {
  appendDeduplicatedOrphanRentalRecords,
  classifyDashboardPlotBucket,
  classifyDashboardRecord,
  findActiveOrPendingRentalContract,
} from '@/lib/sales/dashboardRentalClassification';
import { cancelRentalBooking } from '@/lib/sales/cancelRentalBooking';
import { cancelRentalBookingTx } from '@/lib/sales/rentalTxClient';
import CancelRentalBookingModal from '../CancelRentalBookingModal';
import SalesKanban from '../SalesKanban';
import SalesDealStatusModal from '../SalesDealStatusModal';
import LeadTrackerView from '../LeadTrackerView';
import CentralLeadTracker from '../CentralLeadTracker';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  rpc: vi.fn(),
  mutation: vi.fn(),
  tableData: {} as Record<string, any[]>,
}));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({
  fetchSalesWithoutLimit: (...args: any[]) => mocks.read(...args),
}));

vi.mock('@/hooks/useSalesStaffOptions', () => ({
  useSalesStaffOptions: () => [{ userId: 'sales-1', displayName: 'Sales A' }],
}));

vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../CentralLeadBookingModal', () => ({ default: () => <div>Booking modal</div> }));
vi.mock('../RentalContractModal', () => ({ default: () => <div>Rental contract modal</div> }));
vi.mock('../RentalActionModal', () => ({ default: () => <div>Rental action modal</div> }));
vi.mock('../RentalPaymentLedgerModal', () => ({ default: () => null }));
vi.mock('../AdminDeleteCustomerModal', () => ({ default: () => null }));
vi.mock('../LeadPicker', () => ({ default: () => null }));
vi.mock('../SalesMap', () => ({
  default: ({ onPlotClick, leads }: any) => (
    <button
      type="button"
      onClick={() => onPlotClick(leads?.[0]?.plot || 'plot-conflict', 'Reserved', leads?.[0])}
    >
      Open fixture plot
    </button>
  ),
}));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  isPlotEligibleForSampleHouse: () => false,
  toggleSampleHouse: vi.fn(),
  fetchTodayInspectionStatus: async () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = mocks.tableData[table] ?? [];
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
        insert: (...args: any[]) => {
          mocks.mutation(table, 'insert', ...args);
          return chain;
        },
        update: (...args: any[]) => {
          mocks.mutation(table, 'update', ...args);
          return chain;
        },
        delete: (...args: any[]) => {
          mocks.mutation(table, 'delete', ...args);
          return chain;
        },
      };
      return chain;
    },
    rpc: (...args: any[]) => mocks.rpc(...args),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const mkPlot = (id: string, overrides: Partial<InterestedPlot> = {}): InterestedPlot => ({
  id,
  plot_name: id,
  project_name: 'ไอลิน 6',
  has_customer: false,
  sale_status: 'ready_for_sale',
  ...overrides,
});

describe('Issues 3–6 Regression Suite (A: Conflict/Project Map, B: Availability, C: Dashboard Legacy Pending, D: Unified Cancel Reason)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tableData = {};
    mocks.read.mockResolvedValue([]);
    mocks.rpc.mockResolvedValue({ data: { rows: [] }, error: null });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // PART A: Project Map conflict & rental_ended & SalesDealStatusModal guards
  // =========================================================================
  describe('A. Project Map conflict & rental_ended read-only enforcement', () => {
    it('renders read-only conflict panel with zero writable sales actions for key fixture (deal_type=rent, rental_status=PendingContract, active saleId)', async () => {
      const plotRow = {
        id: 'ไอลิน 6-12',
        plot_name: '12',
        project_name: 'ไอลิน 6',
        has_customer: true,
        sale_status: 'reserved',
      };
      const conflictLead = {
        id: 'lead-conflict-1',
        customer_name: 'คุณขัดแย้ง ซื้อเช่า',
        phone: '0811111111',
        project_name: 'ไอลิน 6',
        status: 'Reserved',
        deal_type: 'rent',
        rental_status: 'PendingContract',
        interested_plot_id: 'ไอลิน 6-12',
        interested_plot_name: '12',
      };
      const activeSale = {
        id: 'sale-conflict-1',
        lead_id: 'lead-conflict-1',
        plot_id: 'ไอลิน 6-12',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2990000,
      };

      mocks.read.mockImplementation(async (table: string) =>
        table === 'plots' ? [plotRow] : table === 'leads' ? [conflictLead] : table === 'sales' ? [activeSale] : []
      );

      render(
        <SalesKanban
          project={{ name: 'ไอลิน 6' }}
          projects={[{ name: 'ไอลิน 6' }]}
          user={{ id: 'admin-1', username: 'Admin', role: 'Admin' }}
          initialTab="map"
        />
      );

      await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('leads', expect.anything()));
      fireEvent.click(screen.getByRole('button', { name: 'Open fixture plot' }));

      const conflictBanner = await screen.findByTestId('project-map-deal-conflict');
      expect(conflictBanner).toHaveTextContent(/ขัดแย้ง/);
      expect(conflictBanner).toHaveTextContent('active_sale_conflicts_with_rental');

      // ZERO writable purchase controls, ZERO save button, ZERO Admin switch-to-rental button, ZERO mutations!
      expect(screen.queryByRole('button', { name: /บันทึกการเปลี่ยนแปลง/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /เปลี่ยนเป็นสัญญาเช่า/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /โอนกรรมสิทธิ์/ })).not.toBeInTheDocument();
      expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it('keeps rental_ended in read-only panel and blocks falling through into purchase mutation path', async () => {
      const plotRow = {
        id: 'ไอลิน 6-15',
        plot_name: '15',
        project_name: 'ไอลิน 6',
        has_customer: false,
        sale_status: 'ready_for_sale',
      };
      const endedRentalLead = {
        id: 'lead-ended-1',
        customer_name: 'คุณย้ายออก เช่าจบแล้ว',
        phone: '0822222222',
        project_name: 'ไอลิน 6',
        status: 'MovedOut',
        deal_type: 'rent',
        rental_status: 'MovedOut',
        interested_plot_id: 'ไอลิน 6-15',
        interested_plot_name: '15',
      };

      mocks.read.mockImplementation(async (table: string) =>
        table === 'plots' ? [plotRow] : table === 'leads' ? [endedRentalLead] : []
      );

      render(
        <SalesKanban
          project={{ name: 'ไอลิน 6' }}
          projects={[{ name: 'ไอลิน 6' }]}
          user={{ id: 'sales-1', username: 'Sales A', role: 'Sales' }}
          initialTab="map"
        />
      );

      await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('leads', expect.anything()));
      fireEvent.click(screen.getByRole('button', { name: 'Open fixture plot' }));

      expect(await screen.findByTestId('project-map-rental-ended')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /บันทึกการเปลี่ยนแปลง/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /โอนกรรมสิทธิ์/ })).not.toBeInTheDocument();
      expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it('re-checks live server state before mutating a pre-booking Visit lead and aborts if server became PendingContract/conflict', async () => {
      const plotRow = {
        id: 'ไอลิน 6-18',
        plot_name: '18',
        project_name: 'ไอลิน 6',
        has_customer: false,
        sale_status: 'ready_for_sale',
      };
      const visitLead = {
        id: 'lead-visit-1',
        customer_name: 'คุณเยี่ยมชม ก่อนจอง',
        phone: '0833333333',
        project_name: 'ไอลิน 6',
        status: 'Visit',
        deal_type: 'buy',
        interested_plot_id: 'ไอลิน 6-18',
        interested_plot_name: '18',
      };

      mocks.read.mockImplementation(async (table: string) =>
        table === 'plots' ? [plotRow] : table === 'leads' ? [visitLead] : []
      );
      // Server state changed to PendingContract rental after panel opened!
      mocks.tableData = {
        leads: [{ ...visitLead, deal_type: 'rent', rental_status: 'PendingContract', status: 'Reserved' }],
        sales: [],
        rental_contracts: [{ id: 'rc-new-1', status: 'PendingContract' }],
      };

      render(
        <SalesKanban
          project={{ name: 'ไอลิน 6' }}
          projects={[{ name: 'ไอลิน 6' }]}
          user={{ id: 'sales-1', username: 'Sales A', role: 'Sales' }}
          initialTab="list"
        />
      );

      fireEvent.click(await screen.findByRole('button', { name: /Edit Profile/ }));
      const nameInput = await screen.findByRole('textbox', { name: 'ชื่อลูกค้า' });
      fireEvent.change(nameInput, { target: { value: 'ชื่อใหม่หลังเปลี่ยนสถานะ' } });
      fireEvent.click(screen.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }));

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/เปลี่ยนแล้ว|ขัดแย้ง/)));
      expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it('SalesDealStatusModal directly blocks conflict fixture (deal_type=rent, rental_status=PendingContract, active saleId) with zero mutations', async () => {
      const conflictLead = {
        id: 'lead-c-modal',
        leadId: 'lead-c-modal',
        saleId: 'sale-c-modal',
        customer_name: 'ลูกค้าขัดแย้ง Modal',
        deal_type: 'rent',
        rental_status: 'PendingContract',
        status: 'Reserved',
        contract_status: 'Reserved',
      };
      mocks.tableData = {
        leads: [conflictLead],
        sales: [{ id: 'sale-c-modal', lead_id: 'lead-c-modal', plot_id: 'ไอลิน 6-12', contract_status: 'Reserved', crm_stage: 'booked' }],
      };

      render(
        <SalesDealStatusModal
          lead={conflictLead}
          currentUser={{ id: 'sales-1', role: 'Sales', username: 'Sales A' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      const alerts = await screen.findAllByRole('alert');
      expect(alerts.some(el => /ขัดแย้ง/.test(el.textContent || ''))).toBe(true);
      const saveButtons = screen.queryAllByRole('button', { name: /บันทึก/ });
      for (const btn of saveButtons) {
        expect(btn).toBeDisabled();
      }
      expect(mocks.mutation).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PART B: Availability Classifier (plotAvailability.ts + getLeadStage)
  // =========================================================================
  describe('B. Availability classifier vs getLeadStage & business loan flow', () => {
    it.each([
      { status: 'New', expectedStage: 'active' },
      { status: 'Active', expectedStage: 'active' },
      { status: 'Follow Up', expectedStage: 'active' },
      { status: 'Contacted', expectedStage: 'active' },
      { status: 'Appointment', expectedStage: 'appointment' },
      { status: 'Visit', expectedStage: 'appointment' },
      { status: 'Negotiation', expectedStage: 'active' },
      { status: 'Loan', expectedStage: 'loan' },
    ])('vacant plot with pre-booking "$status" lead (stage="$expectedStage") stays available, NOT purchase_booked', ({ status, expectedStage }) => {
      const lead = { id: `lead-${status}`, status, deal_type: 'buy' };
      expect(getLeadStage(lead)).toBe(expectedStage);

      const res = classifyPlotOccupancy({
        plot: mkPlot('P-VAC', { has_customer: false, sale_status: 'ready_for_sale' }),
        sales: [],
        rentalContracts: [],
        lead,
      });
      expect(res).toMatchObject({
        status: 'available',
        isAvailable: true,
        isOccupied: false,
      });
    });

    it.each([
      'Reserved',
      'Booked',
      'Contracted',
      'DownPayment',
      'DocumentPrep',
      'LoanProcessing',
      'LoanSubmitted',
      'LoanRejected',
      'Approved',
      'TransferPending',
    ])('committed post-booking purchase lead "$status" without sales row stays purchase_booked (consistent with Issue 1)', (status) => {
      const lead = { id: `lead-${status}`, status, deal_type: 'buy' };
      expect(getLeadStage(lead)).toBe('booked');

      const res = classifyPlotOccupancy({
        plot: mkPlot('P-LEG', { has_customer: false, sale_status: 'ready_for_sale' }),
        sales: [],
        rentalContracts: [],
        lead,
      });
      expect(res).toMatchObject({
        status: 'purchase_booked',
        isAvailable: false,
        isOccupied: true,
      });
    });

    it('committed legacy Transferred purchase lead without sales row stays purchase_transferred', () => {
      const res = classifyPlotOccupancy({
        plot: mkPlot('P-TR', { has_customer: true, sale_status: 'ready_for_sale' }),
        sales: [],
        rentalContracts: [],
        lead: { id: 'lead-tr', status: 'Transferred', deal_type: 'buy' },
      });
      expect(res).toMatchObject({
        status: 'purchase_transferred',
        isAvailable: false,
        isOccupied: true,
      });
    });
  });

  // =========================================================================
  // PART C: Dashboard Legacy PendingContract & Deduplication
  // =========================================================================
  describe('C. Dashboard legacy PendingContract classification & deduplication', () => {
    it('classifies legacy PendingContract rental (lead + rental markers, NO rental_contracts row) as rented (isPendingRental), NEVER available or purchase waiting', () => {
      const plot = mkPlot('ไอลิน 6-30', {
        plot_name: '30',
        has_customer: true,
        sale_status: 'reserved',
        highlight_note: null, // No "จองเช่า:" prefix on plot!
      });
      const legacyLead = {
        id: 'lead-legacy-rent-30',
        customer_name: 'คุณจองเช่าเก่า ไม่มีสัญญา',
        project_name: 'ไอลิน 6',
        status: 'Reserved',
        deal_type: 'rent',
        rental_status: 'PendingContract',
        rental_program: 'program_b',
        crm_status: 'จองเช่า — รอทำสัญญา',
        booking_date: '2026-11-10T00:00:00Z',
        interested_plot_id: 'ไอลิน 6-30',
      };
      const syntheticRow = {
        saleId: 'lead-lead-legacy-rent-30',
        isSyntheticLead: true,
        customerId: legacyLead.id,
        plotId: plot.id,
        stage: 'booked',
        bookDate: '2026-11-10',
        dealType: 'rent',
        rentalProgram: 'program_b',
        rentalStatus: 'PendingContract',
      };

      const recClass = classifyDashboardRecord({
        record: syntheticRow,
        matchingLead: legacyLead,
        matchingPlot: plot,
        matchingLiveContract: null,
        isCancelled: false,
        isTransferred: false,
      });
      expect(recClass).toMatchObject({
        isRental: true,
        isRentalPending: true,
        isRentalActive: false,
        isPurchase: false,
      });

      const plotBucket = classifyDashboardPlotBucket({
        plot,
        plotRecords: [{ ...syntheticRow, ...recClass, status: 'Reserved' }],
        plotContracts: [],
        plotLeads: [legacyLead],
        selectedYear: '2026',
        targetDateStr: '2026-11-26',
        isCanonical: false,
      });

      expect(plotBucket.bucket).toBe('rented');
      expect(plotBucket.isPendingRental).toBe(true);
      expect(plotBucket.canonicalOccupancy.status).toBe('rental_pending');
      expect(plotBucket.canonicalOccupancy.isConflictOrUnknown).toBe(false);
    });

    it('does NOT conflict or double-count when BOTH synthetic rental lead AND PendingContract rental_contracts row exist', () => {
      const plot = mkPlot('ไอลิน 6-31', {
        plot_name: '31',
        has_customer: true,
        sale_status: 'reserved',
      });
      const lead = {
        id: 'lead-rent-31',
        customer_name: 'คุณจองเช่าครบสองฝั่ง',
        project_name: 'ไอลิน 6',
        status: 'Reserved',
        deal_type: 'rent',
        rental_status: 'PendingContract',
        booking_date: '2026-11-12T00:00:00Z',
        interested_plot_id: 'ไอลิน 6-31',
      };
      const contract = {
        id: 'rc-pending-31',
        lead_id: 'lead-rent-31',
        project_name: 'ไอลิน 6',
        plot_id: 'ไอลิน 6-31',
        plot_name: '31',
        tenant_name: 'คุณจองเช่าครบสองฝั่ง',
        status: 'PendingContract',
        created_at: '2026-11-12T00:00:00Z',
      };
      const syntheticRecord = {
        id: 'lead-lead-rent-31',
        saleId: 'lead-lead-rent-31',
        isSyntheticLead: true,
        customerId: 'lead-rent-31',
        plot_id: 'ไอลิน 6-31',
        stage: 'booked',
        status: 'Reserved',
        bookDate: '2026-11-12',
        isRental: true,
        isRentalPending: true,
        isRentalActive: false,
        isRentalEnded: false,
        isPurchase: false,
        isConflict: false,
        rentalStatus: 'PendingContract',
        dealType: 'rent',
      };

      // Deduplication MUST keep count === 1 (NOT 2)!
      const merged = appendDeduplicatedOrphanRentalRecords([syntheticRecord], [contract], [plot]);
      expect(merged).toHaveLength(1);

      // Occupancy MUST be rental_pending (NOT PURCHASE_AND_RENTAL_CONFLICT)!
      const plotBucket = classifyDashboardPlotBucket({
        plot,
        plotRecords: merged,
        plotContracts: [contract],
        plotLeads: [lead],
        selectedYear: '2026',
        targetDateStr: '2026-11-26',
        isCanonical: false,
      });
      expect(plotBucket.bucket).toBe('rented');
      expect(plotBucket.isPendingRental).toBe(true);
      expect(plotBucket.canonicalOccupancy.status).toBe('rental_pending');
      expect(plotBucket.canonicalOccupancy.reasonCode).not.toBe('PURCHASE_AND_RENTAL_CONFLICT');
    });

    it('preserves ConvertedToBuy and year/date filters for purchase sales while ignoring ended MovedOut rental contracts', () => {
      const plot = mkPlot('ไอลิน 6-32', {
        plot_name: '32',
        has_customer: true,
        sale_status: 'transferred',
      });
      const movedOutContract = {
        id: 'rc-old-32',
        plot_id: 'ไอลิน 6-32',
        status: 'MovedOut',
      };
      expect(
        findActiveOrPendingRentalContract([movedOutContract], { plotId: 'ไอลิน 6-32' })
      ).toBeUndefined();

      const priorSale = {
        saleId: 'sale-prior-32',
        isSyntheticLead: false,
        plot_id: 'ไอลิน 6-32',
        stage: 'transferred',
        status: 'Transferred',
        transferDate: '2025-12-20',
        bookDate: '2025-11-01',
      };
      const recClass = classifyDashboardRecord({
        record: priorSale,
        matchingLead: { id: 'lead-buy-32', deal_type: 'buy', status: 'Transferred' },
        matchingPlot: plot,
        matchingLiveContract: undefined,
        isCancelled: false,
        isTransferred: true,
      });
      expect(recClass.isPurchase).toBe(true);
      expect(recClass.isRental).toBe(false);

      const in2026 = classifyDashboardPlotBucket({
        plot,
        plotRecords: [{ ...priorSale, ...recClass }],
        plotContracts: [movedOutContract],
        plotLeads: [],
        selectedYear: '2026',
        targetDateStr: '2026-11-26',
        isCanonical: false,
      });
      expect(in2026.bucket).toBe('priorTransferred');

      const in2025 = classifyDashboardPlotBucket({
        plot,
        plotRecords: [{ ...priorSale, ...recClass }],
        plotContracts: [movedOutContract],
        plotLeads: [],
        selectedYear: '2025',
        targetDateStr: '2025-12-31',
        isCanonical: false,
      });
      expect(in2025.bucket).toBe('transferred');
    });
  });

  // =========================================================================
  // PART D: Shared Cancel Reason Dialog, Strict Validation & Retry Idempotency
  // =========================================================================
  describe('D. Unified cancel reason enforcement, retry requestId reuse & Active rejection', () => {
    const pendingLead = {
      id: 'lead-cancel-1',
      leadId: 'lead-cancel-1',
      customer_name: 'คุณทดลอง ยกเลิกเช่า',
      project_name: 'ไอลิน 6',
      status: 'Reserved',
      deal_type: 'rent',
      rental_status: 'PendingContract',
      interested_plot_id: 'ไอลิน 6-40',
      interested_plot_name: '40',
      deal_revision: 'rev-1',
    };

    it('rejects empty or whitespace-only reason in cancelRentalBooking and cancelRentalBookingTx (never substitutes "ยกเลิกโดย <user>")', async () => {
      const r1 = await cancelRentalBooking({
        lead: pendingLead,
        actorId: 'Sales A',
        actorRole: 'Sales',
        canManage: true,
        reason: '   ',
        skipConfirm: true,
      });
      expect(r1.status).toBe('error');
      expect(r1.errorCode).toBe('SALES_TX_INVALID_INPUT');
      expect(r1.message).toContain('เหตุผล');
      expect(mocks.rpc).not.toHaveBeenCalled();

      await expect(
        cancelRentalBookingTx({
          requestId: 'req-empty',
          actorRole: 'Sales',
          leadId: 'lead-cancel-1',
          reason: '   \n\t  ',
        })
      ).rejects.toThrow(/เหตุผล/);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('CancelRentalBookingModal disables confirm until non-empty trimmed reason, disables while submitting, preserves reason & requestId on failure retry', async () => {
      let resolveFirst!: (val: any) => void;
      const firstPromise = new Promise(resolve => {
        resolveFirst = resolve;
      });
      mocks.rpc
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce({
          data: {
            command: 'rental_cancel_booking',
            leadId: 'lead-cancel-1',
            plotId: 'ไอลิน 6-40',
            plotReleased: true,
            rentalStatus: 'Cancelled',
          },
          error: null,
        });

      const onClose = vi.fn();
      const onCompleted = vi.fn();

      render(
        <CancelRentalBookingModal
          isOpen
          lead={pendingLead}
          actorId="Sales A"
          actorRole="Sales"
          canManage
          onClose={onClose}
          onCompleted={onCompleted}
        />
      );

      // Actor displayed separately from reason
      expect(screen.getByText('Sales A')).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/ });
      const reasonInput = screen.getByRole('textbox', { name: /เหตุผลในการยกเลิกจองเช่า/ });

      // Empty & whitespace-only MUST keep confirm button disabled
      expect(confirmBtn).toBeDisabled();
      fireEvent.change(reasonInput, { target: { value: '    ' } });
      expect(confirmBtn).toBeDisabled();

      // Enter real reason with surrounding spaces
      fireEvent.change(reasonInput, { target: { value: '  ลูกค้าเปลี่ยนใจไม่เช่าแล้ว  ' } });
      expect(confirmBtn).toBeEnabled();

      // 1st submit -> disabled while in-flight
      fireEvent.click(confirmBtn);
      expect(confirmBtn).toBeDisabled();
      expect(screen.getByText(/กำลังยกเลิก/)).toBeInTheDocument();

      // Resolve 1st attempt as transient failure
      resolveFirst({ data: null, error: { message: 'network timeout' } });
      expect(await screen.findByTestId('cancel-rental-error')).toHaveTextContent(/network timeout/);

      // Dialog stays open, typed reason preserved, not completed/closed
      expect(onCompleted).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect((reasonInput as HTMLTextAreaElement).value).toBe('  ลูกค้าเปลี่ยนใจไม่เช่าแล้ว  ');

      // Retry with same reason -> MUST reuse exact same requestId and send trimmed reason (no actor prefix!)
      fireEvent.click(screen.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/ }));
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));

      const [fn1, arg1] = mocks.rpc.mock.calls[0];
      const [fn2, arg2] = mocks.rpc.mock.calls[1];
      expect(fn1).toBe('sales_tx_cancel_rental_booking');
      expect(fn2).toBe('sales_tx_cancel_rental_booking');
      expect(arg1.p_request_id).toBe(arg2.p_request_id);
      expect(arg2.p_payload.reason).toBe('ลูกค้าเปลี่ยนใจไม่เช่าแล้ว');
      expect(arg2.p_payload.reason).not.toContain('Sales A');

      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('CancelRentalBookingModal rejects Active status transition and guides user to reload', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL' },
      });
      const onReloadRequired = vi.fn();
      const onCompleted = vi.fn();

      render(
        <CancelRentalBookingModal
          isOpen
          lead={pendingLead}
          actorId="Sales A"
          actorRole="Sales"
          canManage
          onClose={vi.fn()}
          onCompleted={onCompleted}
          onReloadRequired={onReloadRequired}
        />
      );

      fireEvent.change(screen.getByRole('textbox', { name: /เหตุผลในการยกเลิกจองเช่า/ }), {
        target: { value: 'ลูกค้าขอยกเลิก' },
      });
      fireEvent.click(screen.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/ }));

      expect(await screen.findByTestId('cancel-rental-error')).toHaveTextContent(/Active.*โหลดข้อมูลใหม่/);
      expect(onCompleted).not.toHaveBeenCalled();
      expect(onReloadRequired).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /โหลดข้อมูลใหม่และปิด/ })).toBeInTheDocument();
    });

    it('LeadTrackerView and CentralLeadTracker both open the shared CancelRentalBookingModal instead of auto-cancelling without a reason', async () => {
      // 1. LeadTrackerView
      render(
        <LeadTrackerView
          leads={[pendingLead as any]}
          plots={[{ id: 'ไอลิน 6-40', plot_name: '40', project_name: 'ไอลิน 6' }]}
          projects={[{ name: 'ไอลิน 6' }]}
          user={{ id: 'sales-1', username: 'Sales A', role: 'Sales' }}
          onRefresh={vi.fn()}
        />
      );

      fireEvent.click(await screen.findByRole('button', { name: /ยกเลิกจองเช่า/ }));
      expect(await screen.findByTestId('cancel-rental-booking-modal')).toBeInTheDocument();
      expect(mocks.rpc).not.toHaveBeenCalled();

      cleanup();

      // 2. CentralLeadTracker
      const centralCustomer = {
        id: 'lead-cancel-1',
        name: 'คุณทดลอง ยกเลิกเช่า',
        phone: '0812345678',
        ownerUserId: 'sales-1',
        channel: 'Walk in',
        leadCreatedAt: '2026-11-20T00:00:00Z',
        deal_type: 'rent',
        rental_status: 'PendingContract',
        status: 'Reserved',
        interested_plot_id: 'ไอลิน 6-40',
        interested_plot_name: '40',
        interests: [{ projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-40', intakeStatus: 'booked' }],
      };

      render(
        <CentralLeadTracker
          snapshot={{
            actor: { userId: 'sales-1', role: 'sales' },
            customers: [centralCustomer],
            salesOwners: [{ userId: 'sales-1', displayName: 'Sales A' }],
            projects: ['ไอลิน 6'],
            search: { owners: [{ userId: 'sales-1', displayName: 'Sales A' }] },
          } as any}
          filters={{ query: '', project: 'all', owner: 'all', status: 'all' } as any}
          onFilterChange={vi.fn()}
          onApply={vi.fn()}
          leadWorkEnabled
          bookingEnabled
        />
      );

      // Switch to booked tab or click customer row to open detail drawer
      fireEvent.click(screen.getByRole('button', { name: /จองแล้ว/ }));
      fireEvent.click(await screen.findByText('คุณทดลอง ยกเลิกเช่า'));
      fireEvent.click(await screen.findByRole('button', { name: /ยกเลิกการจองเช่าและคืนแปลง/ }));

      expect(await screen.findByTestId('cancel-rental-booking-modal')).toBeInTheDocument();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });
});
