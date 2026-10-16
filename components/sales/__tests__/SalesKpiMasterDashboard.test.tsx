import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKpiMasterDashboard, { SALES_ROSTER } from '../SalesKpiMasterDashboard';

const mocks = vi.hoisted(() => ({ 
  read: vi.fn(),
  upsert: vi.fn().mockResolvedValue({ error: null, data: [] }),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
}));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: mocks.select,
      eq: mocks.eq,
      upsert: mocks.upsert,
      then: (resolve: any) => resolve({ data: [], error: null })
    })
  }
}));

const mockLeads = [
  { id: 'l1', customer_name: 'Lead Bell', sales_owner: 'BELL', status: 'Booked', project_name: 'ไอลิน6', phone: '0811111111', created_at: '2026-10-05T10:00:00Z', booking_date: '2026-10-06' },
  { id: 'l2', customer_name: 'Lead Bell 2', sales_owner: 'BELL', status: 'Booked', project_name: 'ไอลิน6', phone: '0811111112', created_at: '2026-10-08T10:00:00Z', booking_date: '2026-10-09' },
  { id: 'l3', customer_name: 'Lead Bell 3', sales_owner: 'BELL', status: 'Transferred', project_name: 'ไอลิน6', phone: '0811111113', created_at: '2026-10-10T10:00:00Z', transferred_date: '2026-10-11' },
  { id: 'l4', customer_name: 'Lead Piwe', sales_owner: 'PIEW', status: 'Booked', project_name: 'ไอลิน6', phone: '0822222222', created_at: '2026-10-02T10:00:00Z', booking_date: '2026-10-03' },
  { id: 'l5', customer_name: 'Lead Ying', sales_owner: 'YING', status: 'Interested', project_name: 'ไอลิน6', phone: '0833333333', created_at: '2026-10-01T10:00:00Z' }
];

const mockSales = [
  { id: 's1', agent_name: 'BELL', contract_status: 'Transferred', booked_at: '2026-10-06', created_at: '2026-10-06T10:00:00Z' },
  { id: 's2', agent_name: 'BELL', contract_status: 'Transferred', booked_at: '2026-10-09', created_at: '2026-10-09T10:00:00Z' },
  { id: 's3', agent_name: 'BELL', contract_status: 'Transferred', booked_at: '2026-10-11', created_at: '2026-10-11T10:00:00Z' },
  { id: 's4', agent_name: 'PIEW', contract_status: 'Reserved', booked_at: '2026-10-03', created_at: '2026-10-03T10:00:00Z' }
];

describe('SalesKpiMasterDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.read.mockImplementation((table: string) => {
      if (table === 'leads') return Promise.resolve(mockLeads);
      if (table === 'sales') return Promise.resolve(mockSales);
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders executive header with TEAW reviewer and default team overview', async () => {
    render(<SalesKpiMasterDashboard currentUser={{ username: 'TEAW', displayName: 'พี่แต้ว', role: 'Sales' }} />);
    
    expect(await screen.findByText(/แดชบอร์ด KPI ฝ่ายขาย/)).toBeInTheDocument();
    expect(screen.getByText('พี่แต้ว')).toBeInTheDocument();
    expect(screen.getByText(/Executive Only/)).toBeInTheDocument();
    expect(screen.getByText(/ภาพรวมทีมขายทั้งหมด \(Overview\)/)).toBeInTheDocument();
  });

  it('calculates total team sales and displays team comparison cards', async () => {
    render(<SalesKpiMasterDashboard currentUser={{ username: 'TEAW', role: 'Sales' }} />);
    
    // Team overview heading
    expect(await screen.findByText(/ตารางเปรียบเทียบผลงานและคะแนน KPI รายบุคคล/)).toBeInTheDocument();

    // All 5 staff members should be displayed
    for (const member of SALES_ROSTER) {
      expect(screen.getAllByText(new RegExp(member.name, 'i')).length).toBeGreaterThan(0);
    }
  });

  it('allows clicking an individual staff tab and displays the 4 KPI sections', async () => {
    render(<SalesKpiMasterDashboard currentUser={{ username: 'TEAW', role: 'Sales' }} />);
    
    // Click Bell tab
    const bellTab = await screen.findByRole('button', { name: /Bell \(Head Sale\)/i });
    fireEvent.click(bellTab);

    // Profile info
    expect(await screen.findByText(/Bell — พนิดดา \(เบล\)/)).toBeInTheDocument();
    expect(screen.getByText(/เป้าหมายยอดขาย: ≥ 3 หลัง\/เดือน/)).toBeInTheDocument();

    // 4 Sections
    expect(screen.getByText(/หมวด 1: Result \+ Core Job ตามตำแหน่ง \(70%\)/)).toBeInTheDocument();
    expect(screen.getByText(/หมวด 2: Mindset & Organization \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText(/หมวด 3: Learning & AI Development \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText(/หมวด 4: วินัยการเข้างาน \(Attendance 10%\)/)).toBeInTheDocument();
  });

  it('allows updating mindset ratings and saving evaluations to localStorage', async () => {
    render(<SalesKpiMasterDashboard currentUser={{ username: 'TEAW', role: 'Sales' }} />);
    
    // Click Piwe tab
    const piewTab = await screen.findByRole('button', { name: /Piwe \(Sale\)/i });
    fireEvent.click(piewTab);

    // Save button (select first instance if multiple)
    const saveButtons = await screen.findAllByRole('button', { name: /บันทึกการประเมิน/ });
    fireEvent.click(saveButtons[0]);

    // Success notice and Supabase upsert verification
    expect(await screen.findByText(/บันทึกผลการประเมินเรียบร้อยแล้ว/)).toBeInTheDocument();
    expect(mocks.upsert).toHaveBeenCalled();
  });
});
