import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPlotOccupancy,
  filterAvailablePlots,
  type InterestedPlot,
} from '@/lib/sales/plotAvailability';
import { buildProjectMap, parseProjectMapSnapshot } from '@/lib/sales/projectMapContracts';
import { buildExcelReport } from '@/lib/sales/excelReportMetrics';
import { projectMapSnapshot } from '@/lib/sales/__tests__/projectMapFixtures';
import { pid, projectSale } from '@/lib/sales/__tests__/projectSalesFixtures';
import SalesMap from '../SalesMap';
import SalesKanban from '../SalesKanban';

const mapFixture = vi.hoisted(() => ({
  layout: [
    { type: 'config', cols: 4, rows: 2 },
    { type: 'plot', plotId: 'P-VACANT', x: 0, y: 0 },
    { type: 'plot', plotId: 'P-RLS-OCCUPIED', x: 1, y: 0 },
    { type: 'plot', plotId: 'P-RENT-PENDING', x: 2, y: 0 },
    { type: 'plot', plotId: 'P-CONFLICT', x: 3, y: 0 },
  ],
  plots: [] as any[],
  rentals: [] as any[],
  plotsError: null as any,
}));

const kanbanReads = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({
  fetchSalesWithoutLimit: (...args: any[]) => kanbanReads.read(...args),
}));

vi.mock('@/hooks/useSalesStaffOptions', () => ({
  useSalesStaffOptions: () => [],
}));

vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../CentralLeadBookingModal', () => ({ default: () => <div>Booking form opened</div> }));
vi.mock('../SalesDealStatusModal', () => ({ default: () => <div>Sales deal modal</div> }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  isPlotEligibleForSampleHouse: () => ({ eligible: false, reason: 'occupied' }),
  toggleSampleHouse: vi.fn(),
  fetchTodayInspectionStatus: async () => null,
  fetchTodayInspectionMap: async () => ({}),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result =
        table === 'projects'
          ? { data: { layout_data: mapFixture.layout }, error: null }
          : table === 'plots'
            ? { data: mapFixture.plotsError ? null : mapFixture.plots, error: mapFixture.plotsError }
            : table === 'rental_contracts'
              ? { data: mapFixture.rentals, error: null }
              : { data: [], error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        not: () => chain,
        in: () => chain,
        order: () => chain,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    rpc: async () => ({ data: { rows: [] }, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const mkPlot = (id: string, overrides: Partial<InterestedPlot> = {}): InterestedPlot => ({
  id,
  plot_name: id,
  project_name: 'ไอลิน6',
  has_customer: false,
  sale_status: 'ready_for_sale',
  ...overrides,
});

describe('Phase 4 Regression Matrix: Unified Plot Occupancy, Maps, Pickers, RLS & Dashboards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapFixture.plotsError = null;
    mapFixture.plots = [];
    mapFixture.rentals = [];
    kanbanReads.read.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('covers full lifecycle matrix in classifyPlotOccupancy & filterAvailablePlots', () => {
    // 1. Normal purchase booking & transfer
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P1', { has_customer: true, sale_status: 'ready_for_sale' }),
        sales: [{ plot_id: 'P1', contract_status: 'Reserved', crm_stage: 'booked' }],
      })
    ).toMatchObject({ status: 'purchase_booked', isAvailable: false, isOccupied: true });

    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P1', { has_customer: true, sale_status: 'transferred' }),
        sales: [{ plot_id: 'P1', contract_status: 'Transferred', crm_stage: 'transferred' }],
      })
    ).toMatchObject({ status: 'purchase_transferred', isAvailable: false, isOccupied: true });

    // 2. PendingContract rental booking (even if plots.has_customer is still false!)
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P2', { has_customer: false, sale_status: 'ready_for_sale' }),
        rentalContracts: [{ id: 'rc-p', plot_id: 'P2', status: 'PendingContract' }],
      })
    ).toMatchObject({ status: 'rental_pending', isAvailable: false, isOccupied: true });

    // 3. Active & Renewed rental
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P3', { has_customer: true, sale_status: 'rented' }),
        rentalContracts: [{ id: 'rc-a', plot_id: 'P3', status: 'Active' }],
      })
    ).toMatchObject({ status: 'rental_active', isAvailable: false, isOccupied: true });

    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P3R', { has_customer: true, sale_status: 'rented' }),
        rentalContracts: [{ id: 'rc-r', plot_id: 'P3R', status: 'Renewed' }],
      })
    ).toMatchObject({ status: 'rental_active', isAvailable: false, isOccupied: true });

    // 4. Cancelled booking & MovedOut -> vacant ONLY when plot flags & rental metadata are cleanly cleared
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P4', { has_customer: false, sale_status: 'ready_for_sale' }),
        sales: [{ plot_id: 'P4', contract_status: 'Cancelled', crm_stage: 'cancelled' }],
        rentalContracts: [{ id: 'rc-c', plot_id: 'P4', status: 'Cancelled' }],
      })
    ).toMatchObject({ status: 'available', isAvailable: true, isOccupied: false });

    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P5', { has_customer: false, sale_status: 'ready_for_sale' }),
        rentalContracts: [{ id: 'rc-m', plot_id: 'P5', status: 'MovedOut' }],
      })
    ).toMatchObject({ status: 'available', isAvailable: true, isOccupied: false });

    // 5. Rental ConvertedToBuy -> stays occupied as purchase_booked (zero vacant gap)
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P6', { has_customer: true, sale_status: 'ready_for_sale' }),
        sales: [{ plot_id: 'P6', contract_status: 'Reserved', crm_stage: 'booked' }],
        rentalContracts: [{ id: 'rc-conv', plot_id: 'P6', status: 'ConvertedToBuy' }],
      })
    ).toMatchObject({ status: 'purchase_booked', isAvailable: false, isOccupied: true });

    // 6. Legacy plots (has_customer=true + Rented, OR has_customer=false + lease_start_date / rental_program, OR null has_customer)
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P7', { has_customer: true, sale_status: 'Rented', current_tenant_name: null, rental_program: null }),
      })
    ).toMatchObject({ status: 'rental_active', isAvailable: false, isOccupied: true });

    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P7B', { has_customer: false, sale_status: 'ready_for_sale', lease_start_date: '2026-01-01' }),
      })
    ).toMatchObject({ status: 'rental_active', isAvailable: false, isOccupied: true });

    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P7C', { has_customer: null, sale_status: 'ready_for_sale' }),
      })
    ).toMatchObject({ status: 'unknown', isAvailable: false, isConflictOrUnknown: true });

    // 7. RLS-hidden lead (no lead, no sale, no contract visible, yet has_customer=true + ready_for_sale!) -> occupied_restricted, NEVER available!
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P8', { has_customer: true, sale_status: 'ready_for_sale' }),
      })
    ).toMatchObject({ status: 'occupied_restricted', isAvailable: false, isOccupied: true });

    // 8. Conflicts & incomplete read -> ALWAYS unknown, NEVER available
    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P9', { has_customer: true, sale_status: 'ready_for_sale' }),
        sales: [{ plot_id: 'P9', contract_status: 'Reserved' }],
        rentalContracts: [{ id: 'rc-x', plot_id: 'P9', status: 'PendingContract' }],
      })
    ).toMatchObject({ status: 'unknown', isAvailable: false, isConflictOrUnknown: true });

    expect(
      classifyPlotOccupancy({
        plot: mkPlot('P10', { has_customer: false, sale_status: 'ready_for_sale' }),
        readIncomplete: true,
      })
    ).toMatchObject({ status: 'unknown', isAvailable: false, isConflictOrUnknown: true });

    // filterAvailablePlots returns ONLY truly vacant plot P4
    const available = filterAvailablePlots(
      [
        mkPlot('P1', { has_customer: true, sale_status: 'ready_for_sale' }),
        mkPlot('P2', { has_customer: false, sale_status: 'ready_for_sale' }),
        mkPlot('P4', { has_customer: false, sale_status: 'ready_for_sale' }),
        mkPlot('P7B', { has_customer: false, sale_status: 'ready_for_sale', lease_start_date: '2026-01-01' }),
      ],
      [{ plot_id: 'P1', contract_status: 'Reserved' }],
      'ไอลิน6',
      [{ id: 'rc-p2', plot_id: 'P2', status: 'PendingContract' }]
    );
    expect(available.map(p => p.id)).toEqual(['P4']);
  });

  it('Central V2 Project Map & Excel Report treat legacy rental metadata & Phase 2 rental statuses consistently without counting rentals as vacant', () => {
    const snapshot = projectMapSnapshot();
    // P-2 has hasCustomer=false & saleStatus='ready_for_sale' BUT carries legacy rental metadata -> MUST NOT be available!
    snapshot.plots[1].hasLegacyRentalMetadata = true;
    const parsed = parseProjectMapSnapshot(snapshot, 'โครงการ A');
    const built = buildProjectMap(parsed);
    expect(built.regions[1].status).toBe('unknown');

    // Phase 2 RPC sets sale_status='reserved' on booked plots & 'rented' on active rental plots
    const snap2 = projectMapSnapshot();
    snap2.plots[0].saleStatus = 'reserved';
    snap2.plots[1].hasCustomer = true;
    snap2.plots[1].saleStatus = 'rented';
    snap2.rentalPages = [
      {
        projectName: 'โครงการ A',
        actor: snap2.actor,
        snapshotRevision: 'a'.repeat(32),
        page: 0,
        hasMore: false,
        rows: [
          {
            contractId: pid(70),
            customerId: pid(71),
            interestId: pid(72),
            ownerUserId: snap2.actor.userId,
            projectName: 'โครงการ A',
            plotId: 'P-2',
            customerName: 'ผู้เช่า V2',
            customerPhone: null,
            programType: 'program_b',
            status: 'active',
            revision: pid(73),
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            endedDate: null,
            convertedSaleId: null,
          },
        ],
      },
    ];
    const map2 = buildProjectMap(parseProjectMapSnapshot(snap2, 'โครงการ A'));
    expect(map2.regions[0].status).toBe('booked');
    expect(map2.regions[1].status).toBe('rented');

    // Central Excel report never counts rented or legacy-dirty plots as available
    const report = buildExcelReport(
      {
        loadedAt: '2026-11-26T00:00:00Z',
        projects: [
          {
            map: snap2,
            catalog: [
              { plotId: 'P-1', basePrice: 3000000, appraisalPrice: 2800000, isInfrastructure: false },
              { plotId: 'P-2', basePrice: 2900000, appraisalPrice: 2700000, isInfrastructure: false },
            ],
            evidence: {
              contractVersion: 'excel_evidence_v1',
              projectName: 'โครงการ A',
              actor: snap2.actor,
              legacyVisits: [],
              completedVisits: [],
              forecasts: [],
              pendingLegacyRows: 0,
              pendingLegacyKeys: [],
              unknownLegacyDates: 0,
              unassignedLegacyVisits: [],
              unknownUnassignedLegacyDates: 0,
              bookingAmounts: [{ saleId: projectSale().saleId, tdPrice: 2800000 }],
            },
          },
        ],
      },
      null,
      '2026-11-26',
      '2026'
    );
    expect(report.groups[0].available).toBe(0);
    expect(report.groups[0].booked).toBe(1);
    expect(report.groups[0].unknown).toBe(1); // rental stock stays out of available & purchase sales
  });

  it('Legacy SalesMap renders RLS-hidden occupied plots as non-vacant without leaking PII, and fails closed to Unknown on conflict or read error', async () => {
    mapFixture.plots = [
      { id: 'P-VACANT', plot_name: '1', project_name: 'ไอลิน6', has_customer: false, sale_status: 'ready_for_sale' },
      // RLS hides lead, yet has_customer=true & ready_for_sale & current_tenant_name set on DB
      {
        id: 'P-RLS-OCCUPIED',
        plot_name: '2',
        project_name: 'ไอลิน6',
        has_customer: true,
        sale_status: 'ready_for_sale',
        current_tenant_name: 'ความลับผู้เช่าห้ามโชว์',
        monthly_rent: 19999,
      },
      { id: 'P-RENT-PENDING', plot_name: '3', project_name: 'ไอลิน6', has_customer: false, sale_status: 'ready_for_sale' },
      { id: 'P-CONFLICT', plot_name: '4', project_name: 'ไอลิน6', has_customer: null, sale_status: 'weird_unknown_status' },
    ];
    mapFixture.rentals = [
      { id: 'rc-pending-3', plot_id: 'P-RENT-PENDING', status: 'PendingContract' },
    ];

    const onPlotClick = vi.fn();
    render(<SalesMap projectName="ไอลิน6" leads={[]} onPlotClick={onPlotClick} />);

    await screen.findByText('P-VACANT');

    // 1. Vacant plot clicks as Available
    fireEvent.click(screen.getByText('P-VACANT'));
    expect(onPlotClick).toHaveBeenLastCalledWith('P-VACANT', 'Available', null);

    // 2. RLS-hidden occupied plot MUST NOT be Available and MUST NOT leak tenant PII in DOM/tooltips
    expect(screen.queryByText(/ความลับผู้เช่าห้ามโชว์/)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('ความลับผู้เช่าห้ามโชว์');
    fireEvent.click(screen.getByText('P-RLS-OCCUPIED'));
    expect(onPlotClick).toHaveBeenLastCalledWith('P-RLS-OCCUPIED', 'Rented', null);

    // 3. PendingContract rental booking without visible lead still renders as non-vacant Reserved with จองเช่า badge
    expect(screen.getByText('จองเช่า')).toBeInTheDocument();
    fireEvent.click(screen.getByText('P-RENT-PENDING'));
    expect(onPlotClick).toHaveBeenLastCalledWith('P-RENT-PENDING', 'Reserved', null);

    // 4. Null/unknown status renders as Unknown (ต้องตรวจสอบ), NEVER Available!
    expect(screen.getByText('ต้องตรวจสอบ')).toBeInTheDocument();
    fireEvent.click(screen.getByText('P-CONFLICT'));
    expect(onPlotClick).toHaveBeenLastCalledWith('P-CONFLICT', 'Unknown', null);

    // 5. Incomplete read (plots query error) fails closed to Unknown for every plot!
    cleanup();
    mapFixture.plotsError = { message: 'network error' };
    onPlotClick.mockReset();
    render(<SalesMap projectName="ไอลิน6" leads={[]} onPlotClick={onPlotClick} />);
    await screen.findByText('P-VACANT');
    fireEvent.click(screen.getByText('P-VACANT'));
    expect(onPlotClick).toHaveBeenLastCalledWith('P-VACANT', 'Unknown', null);
  });

  it('SalesKanban refuses to open booking form when clicking an RLS-restricted occupied or Unknown plot without a visible lead', async () => {
    mapFixture.plots = [
      { id: 'P-VACANT', plot_name: '1', project_name: 'ไอลิน6', has_customer: false, sale_status: 'ready_for_sale' },
      { id: 'P-RLS-OCCUPIED', plot_name: '2', project_name: 'ไอลิน6', has_customer: true, sale_status: 'ready_for_sale' },
      { id: 'P-CONFLICT', plot_name: '4', project_name: 'ไอลิน6', has_customer: null, sale_status: 'unknown_state' },
    ];
    kanbanReads.read.mockImplementation(async (table: string) =>
      table === 'plots' ? mapFixture.plots : []
    );

    render(
      <SalesKanban
        project={{ name: 'ไอลิน6' }}
        projects={[{ name: 'ไอลิน6' }]}
        user={{ id: 'sales-2', username: 'Sales B', role: 'Sales' }}
        initialTab="map"
      />
    );

    await waitFor(() => expect(screen.getByText('P-RLS-OCCUPIED')).toBeInTheDocument());

    // Clicking RLS-occupied plot (no visible lead) -> opens restricted notice panel, NOT booking form!
    fireEvent.click(screen.getByText('P-RLS-OCCUPIED'));
    expect(await screen.findByTestId('occupied-restricted-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /บันทึกการจอง/ })).not.toBeInTheDocument();

    // Clicking Unknown/conflict plot -> opens restricted notice panel with Unknown warning, NOT booking form!
    fireEvent.click(screen.getByText('P-CONFLICT'));
    await waitFor(() => {
      const panel = screen.getByTestId('occupied-restricted-panel');
      expect(within(panel).getByText(/ต้องตรวจสอบ/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /บันทึกการจอง/ })).not.toBeInTheDocument();
  });
});
