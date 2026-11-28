import { describe, expect, it, vi } from 'vitest';
import {
  classifySalesDeal,
  isLegacyPurchaseLeadHolder,
  matchLeadPlotReference,
  resolveCanonicalPlotId,
} from '../dealClassification';
import { cancelRentalBooking } from '../cancelRentalBooking';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

describe('classifySalesDeal (Phase 1 unified deal classification)', () => {
  const pendingRentalFixture = {
    id: 'lead-rent-pending-1',
    status: 'Reserved',
    deal_type: 'rent',
    rental_status: 'PendingContract',
    crm_status: 'จองเช่า — รอทำสัญญา (แบบ A: เช่าปกติ)',
    interested_plot_id: 'plot-10',
    interested_plot_name: '10',
    project_name: 'ไอลิน 6',
  };

  it('classifies the required PendingContract rental fixture as rental_pending and blocks purchase modal', () => {
    const result = classifySalesDeal(pendingRentalFixture);
    expect(result.category).toBe('rental_pending');
    expect(result.isRentalPending).toBe(true);
    expect(result.isRentalActive).toBe(false);
    expect(result.isPurchaseFlow).toBe(false);
    expect(result.blocksPurchaseModal).toBe(true);
    expect(result.isConflict).toBe(false);
  });

  it('classifies normal purchase bookings as purchase and allows purchase modal', () => {
    const bookedPurchase = classifySalesDeal({
      status: 'Booked',
      deal_type: 'buy',
      crm_status: 'Booked — จองแล้ว',
    });
    expect(bookedPurchase.category).toBe('purchase');
    expect(bookedPurchase.isPurchaseFlow).toBe(true);
    expect(bookedPurchase.blocksPurchaseModal).toBe(false);

    const reservedLegacyPurchase = classifySalesDeal({
      status: 'Reserved',
      crm_status: 'Booked — จองแล้ว',
    });
    expect(reservedLegacyPurchase.category).toBe('purchase');
    expect(reservedLegacyPurchase.isPurchaseFlow).toBe(true);
    expect(reservedLegacyPurchase.blocksPurchaseModal).toBe(false);
  });

  it.each(['Active', 'Renewed'])('classifies rental_status=%s as rental_active', rentalStatus => {
    const result = classifySalesDeal({
      status: 'Rented',
      deal_type: 'rent',
      rental_status: rentalStatus,
      crm_status: 'Rented / Active — ทำสัญญาเช่าแล้ว',
    });
    expect(result.category).toBe('rental_active');
    expect(result.isRentalActive).toBe(true);
    expect(result.isRentalPending).toBe(false);
    expect(result.blocksPurchaseModal).toBe(true);
  });

  it('keeps ConvertedToBuy in purchase flow even when legacy CRM text contains "เช่า"', () => {
    const converted = classifySalesDeal({
      status: 'Booked',
      deal_type: 'buy',
      rental_status: 'ConvertedToBuy',
      crm_status: 'ConvertedToBuy — เปลี่ยนจากเช่าเป็นซื้อ',
    });
    expect(converted.category).toBe('converted_to_buy');
    expect(converted.isConvertedToBuy).toBe(true);
    expect(converted.isPurchaseFlow).toBe(true);
    expect(converted.isRentalActive).toBe(false);
    expect(converted.isRentalPending).toBe(false);
    expect(converted.blocksPurchaseModal).toBe(false);

    // Even if stale crm_status still mentions Rented/เช่า while structured rental_status is ConvertedToBuy
    const convertedWithStaleCrm = classifySalesDeal({
      status: 'Contracted',
      deal_type: 'buy',
      rental_status: 'ConvertedToBuy',
      crm_status: 'Rented / Active — ทำสัญญาเช่าแล้ว',
    });
    expect(convertedWithStaleCrm.category).toBe('converted_to_buy');
    expect(convertedWithStaleCrm.isRentalActive).toBe(false);
    expect(convertedWithStaleCrm.isPurchaseFlow).toBe(true);
  });

  it.each([
    { status: 'MovedOut', rental_status: 'MovedOut', crm_status: 'Rented / Active — ทำสัญญาเช่าแล้ว' },
    { status: 'Cancelled', deal_type: 'rent', rental_status: 'Cancelled', crm_status: 'จองเช่า — รอทำสัญญา (แบบ A)' },
    { status: 'Lost', deal_type: 'rent', crm_status: 'Rented — เช่าปกติ' },
    { status: 'Follow Up', rental_status: 'Expired', crm_status: 'เช่าปกติ' },
  ])('never pulls terminal rental record ($status / $rental_status) back into active or pending rental', row => {
    const result = classifySalesDeal(row);
    expect(result.category).toBe('rental_ended');
    expect(result.isRentalEnded).toBe(true);
    expect(result.isRentalActive).toBe(false);
    expect(result.isRentalPending).toBe(false);
    expect(result.isTerminal).toBe(true);
  });

  it('supports legacy rental records without structured deal_type/rental_status', () => {
    const legacyPending = classifySalesDeal({
      status: 'Reserved',
      crm_status: 'จองเช่า — รอทำสัญญา (แบบ A)',
    });
    expect(legacyPending.category).toBe('rental_pending');

    const legacyActive = classifySalesDeal({
      status: 'Follow Up',
      crm_status: 'Rented / Active — ทำสัญญาเช่าแล้ว',
    });
    expect(legacyActive.category).toBe('rental_active');
  });

  it.each([
    {
      label: 'active sale + PendingContract rental',
      row: { status: 'Reserved', deal_type: 'rent', rental_status: 'PendingContract', saleId: 'sale-1' },
    },
    {
      label: 'deal_type=buy + rental_status=Active',
      row: { status: 'Booked', deal_type: 'buy', rental_status: 'Active' },
    },
    {
      label: 'deal_type=rent + Transferred purchase status',
      row: { status: 'Transferred', deal_type: 'rent', rental_status: 'PendingContract' },
    },
    {
      label: 'PendingContract + active_rental_contract_id already linked',
      row: { status: 'Reserved', deal_type: 'rent', rental_status: 'PendingContract', active_rental_contract_id: 'rc-99' },
    },
    {
      label: 'status=Rented + rental_status=ConvertedToBuy',
      row: { status: 'Rented', rental_status: 'ConvertedToBuy' },
    },
  ])('returns conflict and blocks write actions when structured fields contradict ($label)', ({ row }) => {
    const result = classifySalesDeal(row);
    expect(result.category).toBe('conflict');
    expect(result.isConflict).toBe(true);
    expect(result.blocksWriteActions).toBe(true);
    expect(result.blocksPurchaseModal).toBe(true);
  });
});

describe('resolveCanonicalPlotId', () => {
  const plots = [
    { id: 'ailin6-10', plot_name: '10', project_name: 'ไอลิน 6' },
    { id: 'ailin4-10', plot_name: '10', project_name: 'ไอลิน 4' },
  ];

  it('resolves canonical plot ID by unique plot_name within the matching project', () => {
    expect(
      resolveCanonicalPlotId(
        { project_name: 'ไอลิน 6', interested_plot_name: '10' },
        plots
      )
    ).toBe('ailin6-10');

    expect(
      resolveCanonicalPlotId(
        { project_name: 'ไอลิน 4', interested_plot_name: '10' },
        plots
      )
    ).toBe('ailin4-10');
  });

  it('prefers exact plot ID match over plot name', () => {
    expect(
      resolveCanonicalPlotId(
        { project_name: 'ไอลิน 6', interested_plot_id: 'ailin6-10', interested_plot_name: '10' },
        plots
      )
    ).toBe('ailin6-10');
  });
});

describe('cancelRentalBooking guard boundaries', () => {
  it('blocks read-only roles before making any database query', async () => {
    mocks.from.mockClear();
    const result = await cancelRentalBooking({
      lead: { id: 'lead-1', status: 'Reserved', deal_type: 'rent', rental_status: 'PendingContract' },
      actorId: 'viewer-1',
      actorRole: 'Owner',
      canManage: false,
    });
    expect(result.status).toBe('error');
    expect(result.shouldRefresh).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('refuses to cancel an Active rental contract when server state became Active (stale state)', async () => {
    mocks.rpc.mockReset().mockResolvedValueOnce({
      data: null,
      error: { message: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL' },
    });

    const result = await cancelRentalBooking({
      lead: {
        id: 'lead-active-1',
        customer_name: 'ผู้เช่าปัจจุบัน',
        status: 'Reserved',
        deal_type: 'rent',
        rental_status: 'PendingContract',
      },
      actorId: 'sales-1',
      actorRole: 'Sales',
      canManage: true,
      reason: 'ลูกค้าขอยกเลิกจองเช่า',
      confirm: () => true,
    });

    expect(result.status).toBe('stale_state');
    expect(result.message).toMatch(/Active/);
    expect(result.shouldRefresh).toBe(true);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('isLegacyPurchaseLeadHolder & matchLeadPlotReference (Issue 1)', () => {
  it('recognizes committed purchase leads without a sales row and excludes inquiry/terminal/rental leads', () => {
    expect(isLegacyPurchaseLeadHolder({ status: 'Reserved', deal_type: 'buy' })).toBe(true);
    expect(isLegacyPurchaseLeadHolder({ status: 'Booked', deal_type: null })).toBe(true);
    expect(isLegacyPurchaseLeadHolder({ status: 'Contracted', deal_type: 'buy' })).toBe(true);
    expect(isLegacyPurchaseLeadHolder({ status: 'LoanProcessing', deal_type: 'buy' })).toBe(true);
    expect(isLegacyPurchaseLeadHolder({ status: 'Booked', deal_type: 'rent', rental_status: 'ConvertedToBuy' })).toBe(true);

    // Pre-booking / inquiry stages MUST NOT create artificial purchase ownership!
    expect(isLegacyPurchaseLeadHolder({ status: 'New', deal_type: 'buy' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'Follow Up', deal_type: 'buy' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'Appointment', deal_type: 'buy' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'Visit', deal_type: 'buy' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'Loan', deal_type: 'buy' })).toBe(false);

    // Terminal / ended / pure rental leads MUST NOT be purchase holders
    expect(isLegacyPurchaseLeadHolder({ status: 'Cancelled', deal_type: 'buy' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'Lost', deal_type: 'buy' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'MovedOut', deal_type: 'rent', rental_status: 'MovedOut' })).toBe(false);
    expect(isLegacyPurchaseLeadHolder({ status: 'Reserved', deal_type: 'rent', rental_status: 'PendingContract' })).toBe(false);
  });

  it('distinguishes canonical plot+project matches from ambiguous bare-name and project-scope mismatches', () => {
    const plot = { id: 'ไอลิน6-10', plot_name: '10', project_name: 'ไอลิน6' };

    expect(
      matchLeadPlotReference({ interested_plot_id: 'ไอลิน6-10', project_name: 'ไอลิน6' }, plot)
    ).toBe('canonical');
    expect(
      matchLeadPlotReference({ interested_plot_id: null, interested_plot_name: '10', project_name: 'ไอลิน6' }, plot)
    ).toBe('ambiguous_legacy_name');
    expect(
      matchLeadPlotReference({ interested_plot_id: '10', project_name: 'ไอลิน6' }, plot)
    ).toBe('ambiguous_legacy_name');
    expect(
      matchLeadPlotReference({ interested_plot_id: 'ไอลิน6-10', project_name: 'โยริว' }, plot)
    ).toBe('ambiguous_project_mismatch');
    expect(
      matchLeadPlotReference({ interested_plot_id: '10', project_name: null }, plot)
    ).toBe('ambiguous_missing_project');
    expect(
      matchLeadPlotReference({ interested_plot_id: '10', interested_plot_name: '10', project_name: 'โยริว' }, plot)
    ).toBe('none');
  });
});
