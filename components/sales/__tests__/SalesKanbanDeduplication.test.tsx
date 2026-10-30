import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban from '../SalesKanban';
import { broadcastSalesSync } from '@/lib/sales/salesSyncBroadcast';

const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mock.read }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  isPlotEligibleForSampleHouse: () => false,
  toggleSampleHouse: vi.fn(),
  fetchTodayInspectionStatus: async () => null,
  fetchTodayInspectionMap: async () => ({}),
}));
const supabaseDb = vi.hoisted(() => ({
  leads: [] as any[],
  sales: [] as any[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let filterId: string | null = null;
      let filterLeadId: string | null = null;
      const q: any = {
        select: () => q,
        eq: (k: string, v: string) => {
          if (k === 'id') filterId = v;
          if (k === 'lead_id') filterLeadId = v;
          return q;
        },
        order: () => q,
        in: () => q,
        neq: () => q,
        ilike: () => q,
        is: () => q,
        not: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (table === 'leads') {
            const found = supabaseDb.leads.find(l => l.id === filterId);
            return { data: found || null, error: null };
          }
          if (table === 'sales') {
            const found = supabaseDb.sales.find(s => s.id === filterId || (filterLeadId && s.lead_id === filterLeadId));
            return { data: found || null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'leads') {
            const found = supabaseDb.leads.find(l => l.id === filterId);
            return { data: found || null, error: null };
          }
          if (table === 'sales') {
            const found = supabaseDb.sales.find(s => s.id === filterId || (filterLeadId && s.lead_id === filterLeadId));
            return { data: found || null, error: null };
          }
          return { data: null, error: null };
        },
        then: (fn: any) => {
          if (table === 'sales' && filterLeadId) {
            const found = supabaseDb.sales.filter(s => s.lead_id === filterLeadId);
            return Promise.resolve({ data: found, error: null }).then(fn);
          }
          return Promise.resolve({ data: [], error: null }).then(fn);
        },
      };
      return new Proxy(q, {
        get: (target, prop) => (prop in target ? target[prop] : () => q)
      });
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
    supabaseDb.leads = JSON.parse(JSON.stringify(leads));
    supabaseDb.sales = JSON.parse(JSON.stringify(legacySales));
    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2];
      if (table === 'sales') return supabaseDb.sales;
      if (table === 'leads') return supabaseDb.leads;
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
    render(<SalesKanban project={{ name: 'โยริว' }} user={{ id: 'user-1', role: 'Sales' }} initialTab="booked" />);

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

  it('Finding C: preserves user uncommitted draft edits in editCustomerForm during background data refresh', async () => {
    let currentLeads: any[] = [...leads];
    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2];
      if (table === 'sales') return legacySales;
      if (table === 'leads') return currentLeads;
      return [];
    });

    render(<SalesKanban project={{ name: 'โยริว' }} initialTab="transferred" />);

    // Wait for customer and click row to open edit profile
    const row = await screen.findByText('นางสาวพจณีย์ สมสงวน');
    fireEvent.click(row);

    // Verify customer edit panel is open
    const nameInput = (await screen.findByLabelText('ชื่อลูกค้า')) as HTMLInputElement;
    expect(nameInput.value).toBe('นางสาวพจณีย์ สมสงวน');

    // User modifies name input into an uncommitted draft
    fireEvent.change(nameInput, { target: { value: 'นางสาวพจณีย์ ฉบับร่างกำลังพิมพ์' } });
    expect(nameInput.value).toBe('นางสาวพจณีย์ ฉบับร่างกำลังพิมพ์');

    // Simulate background server change
    currentLeads = [
      {
        ...leads[0],
        customer_name: 'นางสาวพจณีย์ อัปเดตจากเครื่องอื่น'
      },
      leads[1]
    ];

    // Trigger background sync event
    act(() => {
      broadcastSalesSync({ type: 'sales_deal_saved', timestamp: Date.now() });
    });

    // Wait for debounce and re-fetch to complete
    await new Promise(r => setTimeout(r, 300));

    // The user's uncommitted draft MUST NOT be overwritten by the background refresh
    expect(nameInput.value).toBe('นางสาวพจณีย์ ฉบับร่างกำลังพิมพ์');
  });

  it('Finding C: strictly matches lead by explicit id and never falls back to another lead sharing the same plot', async () => {
    let currentLeads = [
      leads[0], // lead-1 on plot-1
      leads[1]
    ];

    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2];
      if (table === 'sales') return legacySales;
      if (table === 'leads') return currentLeads;
      return [];
    });

    render(<SalesKanban project={{ name: 'โยริว' }} initialTab="transferred" />);

    const row = await screen.findByText('นางสาวพจณีย์ สมสงวน');
    fireEvent.click(row);

    const nameInput = (await screen.findByLabelText('ชื่อลูกค้า')) as HTMLInputElement;
    expect(nameInput.value).toBe('นางสาวพจณีย์ สมสงวน');

    // Background refresh where lead-1 is removed and an unrelated lead on plot-1 arrives
    currentLeads = [
      {
        id: 'different-lead-999',
        customer_name: 'คนละคนแต่แปลง 1 เหมือนกัน',
        phone: '0899999999',
        project_name: 'โยริว',
        interested_plot_name: '1',
        interested_plot_id: 'plot-1',
        status: 'Transferred',
        transferred_date: '2024-09-27',
      },
      leads[1]
    ];

    act(() => {
      broadcastSalesSync({ type: 'sales_deal_saved', timestamp: Date.now() });
    });

    await new Promise(r => setTimeout(r, 300));

    // Must NOT adopt 'คนละคนแต่แปลง 1 เหมือนกัน' because ID does not match
    expect(nameInput.value).not.toBe('คนละคนแต่แปลง 1 เหมือนกัน');
  });

  it('Finding 2: renders conflict notice banner and resolve action button in SalesKanban custom panel when conflict occurs', async () => {
    let currentLeads: any[] = [...leads];
    mock.read.mockImplementation(async (table: string) => {
      if (table === 'plots') return [plot1, plot2];
      if (table === 'sales') return legacySales;
      if (table === 'leads') return currentLeads;
      return [];
    });

    render(<SalesKanban project={{ name: 'โยริว' }} user={{ id: 'user-1', role: 'Sales' }} initialTab="booked" />);

    // Open lead-2 (booked customer)
    const row = await screen.findByText('น.ส. กชกร อุดร');
    fireEvent.click(row);

    // Verify panel is open
    const nameInput = (await screen.findByLabelText('ชื่อลูกค้า')) as HTMLInputElement;
    expect(nameInput.value).toBe('น.ส. กชกร อุดร');

    // User edits customer to create dirty draft
    fireEvent.change(nameInput, { target: { value: 'น.ส. กชกร แก้ไขโดยผู้ใช้' } });

    // Background server change: status changed on server to LoanProcessing / loan_submitted
    currentLeads = [
      leads[0],
      {
        ...leads[1],
        crm_stage: 'loan_submitted',
        status: 'LoanProcessing'
      }
    ];
    supabaseDb.leads = currentLeads;
    const updatedSales = supabaseDb.sales.map((s, idx) =>
      idx === 1
        ? {
            ...s,
            crm_stage: 'loan_submitted',
            contract_status: 'Contracted'
          }
        : s
    );
    supabaseDb.sales = updatedSales;

    // Background sync arrives
    act(() => {
      broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-2', timestamp: Date.now() });
    });

    // Wait for conflict warning to appear in the panel
    const conflictAlert = await screen.findByText(/สถานะของลูกค้าในระบบเปลี่ยนเป็น/i);
    expect(conflictAlert).toBeInTheDocument();

    // Must display action button to resolve conflict
    const resolveBtn = await screen.findByRole('button', { name: /ยอมรับสถานะใหม่และปรับปรุงตัวเลือก/i });
    expect(resolveBtn).toBeInTheDocument();

    // Clicking resolve updates conflict and preserves draft
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      expect(screen.queryByText(/ยอมรับสถานะใหม่และปรับปรุงตัวเลือก/i)).not.toBeInTheDocument();
    });
    expect(nameInput.value).toBe('น.ส. กชกร แก้ไขโดยผู้ใช้');
  });
});
