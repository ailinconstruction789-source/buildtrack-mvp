import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban from '../SalesKanban';

const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mock.read }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  isPlotEligibleForSampleHouse: () => false,
  toggleSampleHouse: vi.fn(),
  fetchTodayInspectionStatus: async () => null,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        in: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (fn: any) => Promise.resolve({ data: [], error: null }).then(fn),
      };
      return q;
    },
    rpc: async () => ({ data: { rows: [] }, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

describe('SalesKanban legacy sales & leads deduplication', () => {
  const plot1 = { id: 'plot-1', project_name: 'โยริว', plot_name: '1' };
  const plot2 = { id: 'plot-2', project_name: 'โยริว', plot_name: '2' };

  // Legacy sales imported without lead_id and without customer_name
  const legacySales = [
    {
      id: 'sale-1',
      plot_id: 'plot-1',
      lead_id: null,
      customer_name: null,
      crm_stage: 'transferred',
      contract_status: 'Transferred',
      transferred_at: null,
    },
    {
      id: 'sale-2',
      plot_id: 'plot-2',
      lead_id: null,
      customer_name: null,
      crm_stage: 'booked',
      contract_status: 'Reserved',
      booked_at: null,
    },
  ];

  // Matching leads imported into leads table
  const leads = [
    {
      id: 'lead-1',
      customer_name: 'นางสาวพจณีย์ สมสงวน',
      phone: '0812345678',
      project_name: 'โยริว',
      interested_plot_name: '1',
      interested_plot_id: 'plot-1',
      status: 'Transferred',
      transferred_date: '2024-09-27',
    },
    {
      id: 'lead-2',
      customer_name: 'น.ส. กชกร อุดร',
      phone: '0898765432',
      project_name: 'โยริว',
      interested_plot_name: '2',
      interested_plot_id: 'plot-2',
      status: 'Reserved',
      booking_date: '2024-09-20',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2];
      if (table === 'sales') return legacySales;
      if (table === 'leads') return leads;
      return [];
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('merges legacy transferred sale with matching lead and does not display duplicate rows or ลูกค้าไม่ระบุชื่อ in transferred tab', async () => {
    render(<SalesKanban project={{ name: 'โยริว' }} initialTab="transferred" />);

    // Customer name should be displayed
    expect(await screen.findByText('นางสาวพจณีย์ สมสงวน')).toBeInTheDocument();

    // "ลูกค้าไม่ระบุชื่อ" should NOT be in the document
    expect(screen.queryByText('ลูกค้าไม่ระบุชื่อ')).toBeNull();

    // Plot 1 label should appear only once in the table
    const plotBadges = screen.getAllByText('1');
    expect(plotBadges).toHaveLength(1);

    // Transfer date should be displayed
    expect(screen.getByText('2024-09-27')).toBeInTheDocument();
  });

  it('merges legacy booked sale with matching lead and does not display duplicate rows or ลูกค้าไม่ระบุชื่อ in booked tab', async () => {
    render(<SalesKanban project={{ name: 'โยริว' }} initialTab="booked" />);

    // Customer name should be displayed
    expect(await screen.findByText('น.ส. กชกร อุดร')).toBeInTheDocument();

    // "ลูกค้าไม่ระบุชื่อ" should NOT be in the document
    expect(screen.queryByText('ลูกค้าไม่ระบุชื่อ')).toBeNull();

    // Plot 2 label should appear only once in the table
    const plotBadges = screen.getAllByText('2');
    expect(plotBadges).toHaveLength(1);
  });

  it('renders the ลูกค้าที่เช่า tab before ลูกค้าที่โอนแล้ว and displays rental customers correctly', async () => {
    const rentalLead = {
      id: 'lead-3',
      customer_name: 'นายสมชาย เช่าดี',
      phone: '0855555555',
      project_name: 'โยริว',
      interested_plot_name: '3',
      interested_plot_id: 'plot-3',
      status: 'Rented',
      deal_type: 'rent',
      rental_status: 'Active',
      rental_program: 'program_a',
      rental_monthly_rent: 12000,
      rental_deposit: 24000,
      rental_start_date: '2026-01-01',
      rental_end_date: '2027-01-01',
    };
    const plot3 = { id: 'plot-3', project_name: 'โยริว', plot_name: '3' };

    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2, plot3];
      if (table === 'sales') return legacySales;
      if (table === 'leads') return [...leads, rentalLead];
      return [];
    });

    render(<SalesKanban project={{ name: 'โยริว' }} initialTab="rented" />);

    // Verify tab button exists
    expect(screen.getByText('ลูกค้าที่เช่า')).toBeInTheDocument();

    // Verify tenant name is displayed
    expect(await screen.findByText('นายสมชาย เช่าดี')).toBeInTheDocument();

    // Verify monthly rent is displayed
    expect(screen.getByText(/฿12,000/)).toBeInTheDocument();

    // Verify lease period is displayed
    expect(screen.getByText(/2026-01-01 ถึง 2027-01-01/)).toBeInTheDocument();
  });

  it('Bug E: displays active rental deal even when lead has a past cancelled sale with matching lead_id', async () => {
    const plot4 = { id: 'plot-4', project_name: 'โยริว', plot_name: '4' };
    const rentalLeadWithPastCancelledSale = {
      id: 'lead-has-cancelled-sale',
      customer_name: 'คุณกิตติศักดิ์ เช่าหลังยกเลิกซื้อ',
      phone: '0877777777',
      project_name: 'โยริว',
      interested_plot_name: '4',
      interested_plot_id: 'plot-4',
      status: 'Rented',
      deal_type: 'rent',
      rental_status: 'Active',
      rental_program: 'program_b',
      rental_monthly_rent: 16000,
      rental_deposit: 32000,
      rental_start_date: '2026-03-01',
      rental_end_date: '2027-03-01',
    };

    const pastCancelledSale = {
      id: 'sale-cancelled-past',
      plot_id: 'plot-4',
      lead_id: 'lead-has-cancelled-sale',
      customer_name: 'คุณกิตติศักดิ์ เช่าหลังยกเลิกซื้อ',
      crm_stage: 'cancelled',
      contract_status: 'Cancelled',
      created_at: '2025-01-01',
    };

    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2, plot4];
      if (table === 'sales') return [...legacySales, pastCancelledSale];
      if (table === 'leads') return [...leads, rentalLeadWithPastCancelledSale];
      return [];
    });

    render(<SalesKanban project={{ name: 'โยริว' }} initialTab="rented" />);

    // Verify tenant name is displayed in rented tab, not hidden by past cancelled sale!
    expect(await screen.findByText('คุณกิตติศักดิ์ เช่าหลังยกเลิกซื้อ')).toBeInTheDocument();
    expect(screen.getByText(/฿16,000/)).toBeInTheDocument();
  });
});
