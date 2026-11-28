import { describe, expect, it } from 'vitest';
import {
  buildSalesIntelligenceRecords,
  computeSalesIntelligenceMetrics,
} from '../salesIntelligenceMetrics';

describe('salesIntelligenceMetrics', () => {
  const plots = [
    { id: 'ailin6-1', plot_name: '1', project_name: 'ไอลิน6', house_type_id: 'ht-1', land_size: 55, selling_price: 3200000, land_appraisal_price: 2900000 },
    { id: 'ailin6-2', plot_name: '2', project_name: 'ไอลิน6', house_type_id: 'ht-1', land_size: 55, selling_price: 3400000, land_appraisal_price: 3000000 },
    { id: 'ailin6-3', plot_name: '3', project_name: 'ไอลิน6', house_type_id: 'ht-2', land_size: 62, selling_price: 4100000, land_appraisal_price: 3800000 },
    { id: 'ailin6-4', plot_name: '4', project_name: 'ไอลิน6', house_type_id: 'ht-1', land_size: 50, selling_price: 2800000, land_appraisal_price: 2500000 },
    { id: 'yorio-42', plot_name: '42', project_name: 'โยริว', house_type_id: 'ht-2', land_size: 40, selling_price: 1972000, land_appraisal_price: 1800000 },
    { id: 'ailin4-10', plot_name: '10', project_name: 'ไอลิน 4', house_type_id: 'ht-1', land_size: 52, selling_price: 2950000, land_appraisal_price: 2600000 },
    { id: 'ailin4-11', plot_name: '11', project_name: 'ไอลิน 4', house_type_id: 'ht-1', land_size: 52, selling_price: 2600000, land_appraisal_price: 2400000 },
  ];

  const houseTypes = [
    { id: 'ht-1', type_name: 'Type A (2 ชั้น)' },
    { id: 'ht-2', type_name: 'Type B (ชั้นเดียว)' },
  ];

  it('resolves real transfer revenue across sales.sale_price, lead notes, plot selling_price, and standalone legacy sales', () => {
    const leads = [
      // 1. Transferred with linked sale.sale_price
      {
        id: 'lead-1',
        customer_name: 'ลูกค้า 1',
        project_name: 'ไอลิน6',
        status: 'Transferred',
        interested_plot_id: 'ailin6-1',
        booking_date: '2026-01-10',
        transferred_date: '2026-03-15',
      },
      // 2. Transferred legacy lead with NO sales row, price in notes
      {
        id: 'lead-2',
        customer_name: 'ลูกค้า 2',
        project_name: 'ไอลิน6',
        status: 'Transferred',
        interested_plot_id: 'ailin6-2',
        booking_date: '2026-02-01',
        transferred_date: '2026-04-10',
        notes: '• ราคาขายสุทธิ: ฿3,350,000 บาท',
      },
      // 3. Transferred legacy lead with NO sales row and NO notes price -> falls back to plot.selling_price
      {
        id: 'lead-3',
        customer_name: 'ลูกค้า 3',
        project_name: 'ไอลิน6',
        status: 'Handover',
        interested_plot_name: '3',
        booking_date: '2026-02-15',
        transferred_date: '2026-05-01',
      },
    ];

    const sales = [
      {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'ailin6-1',
        sale_price: 3150000,
        contract_status: 'Transferred',
        crm_stage: 'transferred',
        booked_at: '2026-01-10T00:00:00Z',
        transferred_at: '2026-03-15T00:00:00Z',
      },
      // 4. Standalone legacy imported sale with NO lead row (lead_id = null)
      {
        id: 'sale-legacy-standalone',
        lead_id: null,
        plot_id: 'ailin4-10',
        sale_price: 2900000,
        contract_status: 'Transferred',
        crm_stage: 'transferred',
        booking_route: 'legacy_import',
        booked_at: '2025-11-01T00:00:00Z',
        transferred_at: '2026-01-20T00:00:00Z',
      },
    ];

    const records = buildSalesIntelligenceRecords({ leads, sales, plots, houseTypes });
    const metrics = computeSalesIntelligenceMetrics(records, [
      { name: 'ไอลิน6', is_closed: false, plotCount: 4 },
      { name: 'ไอลิน 4', is_closed: true, plotCount: 1 },
    ]);

    expect(metrics.transfers).toBe(4);
    expect(metrics.bookings).toBe(4);
    // 3,150,000 + 3,350,000 + 4,100,000 + 2,900,000 = 13,500,000
    expect(metrics.totalRevenue).toBe(13500000);
    // Historical velocity for closed project ไอลิน 4 must be computed (> 0 months) because transferDate is preserved
    const closedProj = metrics.projectPredictions.find(p => p.name === 'ไอลิน 4');
    expect(closedProj?.isCompleted).toBe(true);
    expect(closedProj?.monthsTo100).toBeGreaterThan(2);
  });

  it('counts current CRM booking statuses accurately and excludes rental deals from purchase KPIs', () => {
    const leads = [
      { id: 'l-booked', customer_name: 'A', project_name: 'ไอลิน6', status: 'Booked', interested_plot_id: 'ailin6-1', booking_date: '2026-05-01' },
      { id: 'l-contracted', customer_name: 'B', project_name: 'ไอลิน6', status: 'Contracted', interested_plot_id: 'ailin6-2', booking_date: '2026-04-01' },
      { id: 'l-approved', customer_name: 'C', project_name: 'ไอลิน6', status: 'Approved', interested_plot_id: 'ailin6-3', booking_date: '2026-06-01' },
      { id: 'l-visit', customer_name: 'D', project_name: 'ไอลิน6', status: 'Visit', created_at: '2026-06-02' },
      // Rental pending & active deals must NOT pollute purchase bookings/revenue
      { id: 'l-rent-pending', customer_name: 'R1', project_name: 'โยริว', status: 'Reserved', deal_type: 'rent', rental_status: 'PendingContract', interested_plot_id: 'yorio-42' },
      { id: 'l-rent-active', customer_name: 'R2', project_name: 'โยริว', status: 'Rented', deal_type: 'rent', rental_status: 'Active', interested_plot_id: 'yorio-42' },
    ];

    const records = buildSalesIntelligenceRecords({ leads, sales: [], plots, houseTypes });
    const metrics = computeSalesIntelligenceMetrics(records);

    expect(metrics.bookings).toBe(3);
    expect(metrics.totalVisits).toBe(4);
    expect(metrics.rentalDeals).toBe(2);
    // Seasonality must be sorted chronologically (Apr -> May -> Jun)
    expect(metrics.seasonality.map(s => s.month)).toEqual(['Apr 26', 'May 26', 'Jun 26']);
  });

  it('calculates real lostRevenue, accurate bankRejectRate, and never fabricates bank rejection when cancelReason is empty', () => {
    const leads = [
      // Active booking
      { id: 'l-ok', customer_name: 'OK', project_name: 'ไอลิน6', status: 'Booked', interested_plot_id: 'ailin6-1' },
      // Cancelled due to bank reject via lost_reason (no sales row -> falls back to plot selling_price 3.4M)
      { id: 'l-rej', customer_name: 'Rej', project_name: 'ไอลิน6', status: 'Cancelled', interested_plot_id: 'ailin6-2', lost_reason: 'กู้ไม่ผ่าน ติดภาระหนี้' },
      // Cancelled with blank reason -> MUST show 'ไม่ระบุเหตุผล' (NOT fabricated bank rejection)
      { id: 'l-blank', customer_name: 'Blank', project_name: 'ไอลิน6', status: 'Cancelled', interested_plot_id: 'ailin6-4', lost_reason: '' },
      // LoanRejected status (still in pipeline)
      { id: 'l-loanrej', customer_name: 'LoanRej', project_name: 'ไอลิน 4', status: 'LoanRejected', interested_plot_id: 'ailin4-11' },
      // Pre-booking Lost inquiry (never booked) -> must NOT inflate lostRevenue or cancels
      { id: 'l-lost-inq', customer_name: 'Inq', project_name: 'ไอลิน6', status: 'Lost', lost_reason: 'ไกลที่ทำงาน' },
    ];

    const records = buildSalesIntelligenceRecords({ leads, sales: [], plots, houseTypes });
    const metrics = computeSalesIntelligenceMetrics(records);

    // 2 cancelled bookings: ailin6-2 (3.4M) + ailin6-4 (2.8M) = 6.2M
    expect(metrics.cancelledBookings).toBe(2);
    expect(metrics.lostRevenue).toBe(6200000);

    // 2 bank rejects (l-rej + l-loanrej) out of 4 committed deals (2 active/loanrej + 2 cancelled bookings) = 50%
    expect(metrics.bankRejects).toBe(2);
    expect(metrics.rejectRate).toBe(50);

    // Blank cancel reason must be labeled 'ไม่ระบุเหตุผล', never fabricated as 'กู้ไม่ผ่าน (เครดิต/ภาระหนี้)'
    expect(metrics.cancellationData).toEqual(
      expect.arrayContaining([
        { name: 'กู้ไม่ผ่าน ติดภาระหนี้', count: 1 },
        { name: 'ไม่ระบุเหตุผล', count: 1 },
      ])
    );
    expect(metrics.cancellationData.some(c => c.name === 'กู้ไม่ผ่าน (เครดิต/ภาระหนี้)')).toBe(false);
  });
});
