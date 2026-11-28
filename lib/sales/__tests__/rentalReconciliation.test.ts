import { describe, expect, it } from 'vitest';
import {
  buildRentalReconciliationDryRunReport,
  formatDryRunReportMarkdown,
  type ReconciliationSnapshot,
} from '@/lib/sales/rentalReconciliation';

describe('Phase 3 Read-Only / Dry-Run Rental & Plot Reconciliation', () => {
  it('classifies legacy occupied plots with verified ended history as safe_legacy_plot_release and separates ambiguous/conflicting plots', () => {
    const snapshot: ReconciliationSnapshot = {
      plots: [
        // 1. Clean vacant plot -> consistent
        {
          id: 'P1-01',
          project_name: 'ไอลิน6',
          plot_name: '01',
          has_customer: false,
          sale_status: 'ready_for_sale',
        },
        // 2. Legacy plot with has_customer=true, sale_status='Rented', incomplete rental fields,
        //    ZERO active holders, and verified MovedOut history -> safe_legacy_plot_release
        {
          id: 'P1-02',
          project_name: 'ไอลิน6',
          plot_name: '02',
          has_customer: true,
          sale_status: 'Rented',
          current_tenant_name: 'ผู้เช่าเดิม',
          rental_program: null,
          lease_start_date: null,
        },
        // 3. Ambiguous plot with has_customer=true and tenant name, ZERO active holders AND ZERO history -> manual review!
        {
          id: 'P1-03',
          project_name: 'ไอลิน6',
          plot_name: '03',
          has_customer: true,
          sale_status: 'Rented',
          current_tenant_name: 'ผู้เช่าไม่มีประวัติ',
        },
        // 4. Plot with vacant stock flags but a single unambiguous PendingContract rental -> safe_stock_sync_occupied
        {
          id: 'P1-04',
          project_name: 'ไอลิน6',
          plot_name: '04',
          has_customer: false,
          sale_status: 'ready_for_sale',
          current_tenant_name: 'ผู้จองเช่า',
          rental_program: 'program_b',
        },
        // 5. Conflict: both active purchase sale AND active rental contract on same plot -> manual review
        {
          id: 'P1-05',
          project_name: 'ไอลิน6',
          plot_name: '05',
          has_customer: true,
          sale_status: 'Reserved',
        },
        // 6. Conflict: Transferred plot still carrying rental metadata -> manual review
        {
          id: 'P1-06',
          project_name: 'ไอลิน6',
          plot_name: '06',
          has_customer: true,
          sale_status: 'Transferred',
          current_tenant_name: 'ผู้เช่าค้าง',
        },
        // 7. Ambiguous: unknown rental_contracts status -> manual review
        {
          id: 'P1-07',
          project_name: 'ไอลิน6',
          plot_name: '07',
          has_customer: true,
          sale_status: 'Rented',
        },
      ],
      sales: [
        { id: 'sale-conflict-5', lead_id: 'lead-buy-5', plot_id: 'P1-05', contract_status: 'Reserved', crm_stage: 'booked' },
      ],
      rentalContracts: [
        { id: 'rc-ended-2', lead_id: 'lead-ended-2', plot_id: 'P1-02', project_name: 'ไอลิน6', status: 'MovedOut' },
        { id: 'rc-pending-4', lead_id: 'lead-pending-4', plot_id: 'P1-04', project_name: 'ไอลิน6', status: 'PendingContract' },
        { id: 'rc-active-5', lead_id: 'lead-rent-5', plot_id: 'P1-05', project_name: 'ไอลิน6', status: 'Active' },
        { id: 'rc-unknown-7', lead_id: 'lead-unknown-7', plot_id: 'P1-07', project_name: 'ไอลิน6', status: 'SuspendedLegacy' },
      ],
      leads: [
        {
          id: 'lead-ended-2',
          project_name: 'ไอลิน6',
          customer_name: 'ผู้เช่าเดิม',
          status: 'MovedOut',
          deal_type: 'rent',
          rental_status: 'MovedOut',
          interested_plot_id: 'P1-02',
        },
        {
          id: 'lead-pending-4',
          project_name: 'ไอลิน6',
          customer_name: 'ผู้จองเช่า',
          status: 'Reserved',
          deal_type: 'rent',
          rental_status: 'PendingContract',
          interested_plot_id: 'P1-04',
        },
        // Lead/contract mismatch: PendingContract lead that already has an Active contract!
        {
          id: 'lead-rent-5',
          project_name: 'ไอลิน6',
          customer_name: 'ลูกค้าสัญญาซ้อน',
          status: 'Reserved',
          deal_type: 'rent',
          rental_status: 'PendingContract',
          interested_plot_id: 'P1-05',
        },
      ],
    };

    const report = buildRentalReconciliationDryRunReport(snapshot);

    expect(report.mode).toBe('read_only_dry_run');
    expect(report.summary.totalPlots).toBe(7);
    expect(report.summary.consistentPlots).toBe(1);

    // P1-02 is safely fixable via guard-approved sales_tx_release_legacy_plot
    expect(report.safeToReleaseLegacyPlots).toHaveLength(1);
    expect(report.safeToReleaseLegacyPlots[0]).toMatchObject({
      plotId: 'P1-02',
      reasonCode: 'ORPHANED_LEGACY_OCCUPANCY_AFTER_ENDED_DEAL',
      recommendedCommand: 'sales_tx_release_legacy_plot',
      suggestedReleasePayload: {
        projectName: 'ไอลิน6',
        plotId: 'P1-02',
        expectedHasCustomer: true,
        expectedSaleStatus: 'Rented',
      },
    });

    // P1-04 needs stock occupancy sync (single unambiguous holder)
    expect(report.safeToSyncOccupiedPlots).toHaveLength(1);
    expect(report.safeToSyncOccupiedPlots[0]).toMatchObject({
      plotId: 'P1-04',
      reasonCode: 'ACTIVE_HOLDER_MISSING_STOCK_FLAG',
    });

    // P1-03, P1-05, P1-06, P1-07 MUST ALL be separated for manual inspection (NEVER auto-released!)
    const manualPlotMap = new Map(report.needsManualReviewPlots.map(p => [p.plotId, p.reasonCode]));
    expect(manualPlotMap.get('P1-03')).toBe('OCCUPIED_PLOT_WITHOUT_DEAL_HISTORY');
    expect(manualPlotMap.get('P1-05')).toBe('MULTIPLE_ACTIVE_HOLDERS');
    expect(manualPlotMap.get('P1-06')).toBe('TRANSFERRED_PLOT_WITH_RENTAL_DATA');
    expect(manualPlotMap.get('P1-07')).toBe('UNKNOWN_CONTRACT_STATUS');
    expect(report.needsManualReviewPlots).toHaveLength(4);

    // Lead/contract mismatch detected
    expect(report.needsManualReviewLeads.some(l => l.leadId === 'lead-rent-5' && l.reasonCode === 'PENDING_LEAD_HAS_ACTIVE_CONTRACT')).toBe(true);

    // Markdown formatting includes key sections
    const md = formatDryRunReportMarkdown(report);
    expect(md).toContain('READ-ONLY DRY-RUN');
    expect(md).toContain('P1-02');
    expect(md).toContain('P1-03');
    expect(md).toContain('OCCUPIED_PLOT_WITHOUT_DEAL_HISTORY');
  });

  it('never marks a plot held by another buyer or tenant as safe to release even if an old rental ended', () => {
    const report = buildRentalReconciliationDryRunReport({
      plots: [
        {
          id: 'P1-10',
          project_name: 'ไอลิน6',
          plot_name: '10',
          has_customer: true,
          sale_status: 'Reserved',
          current_tenant_name: 'ผู้เช่าเดิมที่ย้ายออกแล้ว',
        },
      ],
      sales: [
        { id: 'sale-new-owner', lead_id: 'lead-new-buyer', plot_id: 'P1-10', contract_status: 'Reserved', crm_stage: 'booked' },
      ],
      rentalContracts: [
        { id: 'rc-old', lead_id: 'lead-old-tenant', plot_id: 'P1-10', project_name: 'ไอลิน6', status: 'MovedOut' },
      ],
      leads: [
        { id: 'lead-old-tenant', project_name: 'ไอลิน6', customer_name: 'ผู้เช่าเดิม', status: 'MovedOut', rental_status: 'MovedOut', interested_plot_id: 'P1-10' },
      ],
    });

    expect(report.safeToReleaseLegacyPlots).toHaveLength(0);
    expect(report.needsManualReviewPlots).toHaveLength(1);
    expect(report.needsManualReviewPlots[0].reasonCode).toBe('PURCHASE_HOLDER_WITH_STALE_RENTAL_PLOT_DATA');
  });

  it('Acceptance A: NEVER classifies plot with legacy purchase Reserved/Booked lead (no sales row) + ended rental history as safe_legacy_plot_release', () => {
    const report = buildRentalReconciliationDryRunReport({
      plots: [
        // Stale Rented plot + ended rental history + new purchase Reserved lead without a sales row
        {
          id: 'P1-A1',
          project_name: 'ไอลิน6',
          plot_name: 'A1',
          has_customer: true,
          sale_status: 'Rented',
          current_tenant_name: 'ผู้เช่าเก่า',
        },
        // Reserved plot + ended rental history + purchase Booked lead without a sales row
        {
          id: 'P1-A2',
          project_name: 'ไอลิน6',
          plot_name: 'A2',
          has_customer: true,
          sale_status: 'Reserved',
        },
      ],
      sales: [],
      rentalContracts: [
        { id: 'rc-ended-a1', lead_id: 'lead-old-rent-a1', plot_id: 'P1-A1', project_name: 'ไอลิน6', status: 'MovedOut' },
        { id: 'rc-ended-a2', lead_id: 'lead-old-rent-a2', plot_id: 'P1-A2', project_name: 'ไอลิน6', status: 'Cancelled' },
      ],
      leads: [
        { id: 'lead-old-rent-a1', project_name: 'ไอลิน6', status: 'MovedOut', deal_type: 'rent', rental_status: 'MovedOut', interested_plot_id: 'P1-A1' },
        { id: 'lead-new-buy-a1', project_name: 'ไอลิน6', status: 'Reserved', deal_type: 'buy', interested_plot_id: 'P1-A1' },
        { id: 'lead-old-rent-a2', project_name: 'ไอลิน6', status: 'Cancelled', deal_type: 'rent', rental_status: 'Cancelled', interested_plot_id: 'P1-A2' },
        { id: 'lead-new-buy-a2', project_name: 'ไอลิน6', status: 'Booked', deal_type: 'buy', interested_plot_id: 'P1-A2' },
      ],
    });

    expect(report.safeToReleaseLegacyPlots).toHaveLength(0);
    expect(report.needsManualReviewPlots).toHaveLength(1);
    expect(report.needsManualReviewPlots[0]).toMatchObject({
      plotId: 'P1-A1',
      reasonCode: 'PURCHASE_HOLDER_WITH_STALE_RENTAL_PLOT_DATA',
    });
    expect(report.needsManualReviewPlots[0].evidence.activePurchaseLeadIds).toEqual(['lead-new-buy-a1']);
    expect(report.summary.consistentPlots).toBe(1); // P1-A2 has matching Reserved plot & legacy purchase lead
  });

  it('Acceptance B: New/Follow Up/Appointment interested leads do NOT create fake purchase claims, yet release still requires ended deal history', () => {
    const report = buildRentalReconciliationDryRunReport({
      plots: [
        // B1: occupied plot + inquiry leads ONLY + NO ended history -> manual review (not safe release, not active purchase!)
        { id: 'P1-B1', project_name: 'ไอลิน6', plot_name: 'B1', has_customer: true, sale_status: 'Rented' },
        // B2: occupied plot + inquiry leads ONLY + verified MovedOut contract -> safe_legacy_plot_release
        { id: 'P1-B2', project_name: 'ไอลิน6', plot_name: 'B2', has_customer: true, sale_status: 'Rented' },
        // B3: occupied plot + ConvertedToBuy contract ONLY (NOT vacating!) -> manual review
        { id: 'P1-B3', project_name: 'ไอลิน6', plot_name: 'B3', has_customer: true, sale_status: 'Reserved' },
      ],
      sales: [],
      rentalContracts: [
        { id: 'rc-moved-b2', lead_id: 'lead-ended-b2', plot_id: 'P1-B2', project_name: 'ไอลิน6', status: 'MovedOut' },
        { id: 'rc-conv-b3', lead_id: 'lead-conv-b3', plot_id: 'P1-B3', project_name: 'ไอลิน6', status: 'ConvertedToBuy' },
      ],
      leads: [
        { id: 'inq-new', project_name: 'ไอลิน6', status: 'New', deal_type: 'buy', interested_plot_id: 'P1-B1' },
        { id: 'inq-fu', project_name: 'ไอลิน6', status: 'Follow Up', deal_type: 'buy', interested_plot_id: 'P1-B1' },
        { id: 'inq-appt', project_name: 'ไอลิน6', status: 'Appointment', deal_type: 'buy', interested_plot_id: 'P1-B2' },
      ],
    });

    expect(report.safeToReleaseLegacyPlots.map(p => p.plotId)).toEqual(['P1-B2']);
    expect(report.safeToReleaseLegacyPlots[0].evidence.activePurchaseLeadIds).toEqual([]);

    const manualByPlot = new Map(report.needsManualReviewPlots.map(p => [p.plotId, p]));
    expect(manualByPlot.get('P1-B1')?.reasonCode).toBe('OCCUPIED_PLOT_WITHOUT_DEAL_HISTORY');
    expect(manualByPlot.get('P1-B1')?.evidence.activePurchaseLeadIds).toEqual([]);
    expect(manualByPlot.get('P1-B3')?.reasonCode).toBe('OCCUPIED_PLOT_WITHOUT_DEAL_HISTORY');
  });

  it('Canonical ID & Project Scope: bare plot_name or missing/mismatched project scope becomes manual_review_ambiguous (never guesses & releases)', () => {
    const report = buildRentalReconciliationDryRunReport({
      plots: [
        // Legacy purchase lead matches only by bare plot_name '88' in same project -> manual_review_ambiguous
        { id: 'ไอลิน6-88', project_name: 'ไอลิน6', plot_name: '88', has_customer: true, sale_status: 'Rented' },
        // Legacy purchase lead has missing project_name and bare plot_name '89' -> manual_review_ambiguous
        { id: 'ไอลิน6-89', project_name: 'ไอลิน6', plot_name: '89', has_customer: true, sale_status: 'Rented' },
        // Another project has bare plot_name '90' Reserved lead -> MUST NOT block ไอลิน6-90!
        { id: 'ไอลิน6-90', project_name: 'ไอลิน6', plot_name: '90', has_customer: true, sale_status: 'Rented' },
      ],
      sales: [],
      rentalContracts: [
        { id: 'rc-88', lead_id: 'old-88', plot_id: 'ไอลิน6-88', project_name: 'ไอลิน6', status: 'MovedOut' },
        { id: 'rc-89', lead_id: 'old-89', plot_id: 'ไอลิน6-89', project_name: 'ไอลิน6', status: 'MovedOut' },
        { id: 'rc-90', lead_id: 'old-90', plot_id: 'ไอลิน6-90', project_name: 'ไอลิน6', status: 'MovedOut' },
      ],
      leads: [
        { id: 'lead-bare-name-88', project_name: 'ไอลิน6', status: 'Reserved', deal_type: 'buy', interested_plot_id: null, interested_plot_name: '88' },
        { id: 'lead-no-proj-89', project_name: null, status: 'Booked', deal_type: 'buy', interested_plot_id: '89', interested_plot_name: '89' },
        { id: 'lead-other-proj-90', project_name: 'โยริว', status: 'Reserved', deal_type: 'buy', interested_plot_id: '90', interested_plot_name: '90' },
      ],
    });

    expect(report.safeToReleaseLegacyPlots.map(p => p.plotId)).toEqual(['ไอลิน6-90']);
    const manualByPlot = new Map(report.needsManualReviewPlots.map(p => [p.plotId, p.reasonCode]));
    expect(manualByPlot.get('ไอลิน6-88')).toBe('AMBIGUOUS_LEGACY_PLOT_REFERENCE');
    expect(manualByPlot.get('ไอลิน6-89')).toBe('AMBIGUOUS_LEGACY_PLOT_REFERENCE');
  });
});
