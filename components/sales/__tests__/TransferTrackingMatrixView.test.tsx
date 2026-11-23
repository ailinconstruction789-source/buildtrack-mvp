import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import TransferTrackingMatrixView from '../TransferTrackingMatrixView';

function getCurrentBangkokYM() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find(p => p.type === 'year')?.value) || new Date().getFullYear();
  const month = Number(parts.find(p => p.type === 'month')?.value) || (new Date().getMonth() + 1);
  return { year, month, ym: `${year}-${String(month).padStart(2, '0')}` };
}

// Mock Supabase
vi.mock('@/lib/supabase', () => {
  const chain: any = {
    order: vi.fn().mockImplementation(() => chain),
    range: vi.fn().mockImplementation(() => Promise.resolve({ data: [{ name: 'ไอลิน สันทราย', is_closed: false }, { name: 'ไอลิน 4', is_closed: false }] })),
    eq: vi.fn().mockImplementation(() => chain),
    in: vi.fn().mockImplementation(() => Promise.resolve({ data: [] })),
    then: (resolve: any) => Promise.resolve({ data: [{ name: 'ไอลิน สันทราย', is_closed: false }, { name: 'ไอลิน 4', is_closed: false }] }).then(resolve)
  };
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => chain)
      }))
    }
  };
});

describe('TransferTrackingMatrixView Component', () => {
  it('renders the header and month selectors defaulting to current month without unscheduled checkbox', () => {
    const { year, month } = getCurrentBangkokYM();
    render(<TransferTrackingMatrixView />);
    
    expect(screen.getByText(/ตารางติดตามบ้านรอโอน/i)).toBeDefined();
    expect(screen.getByText(/^เดือน:$/)).toBeDefined();
    expect(screen.getByText(/^ถึงเดือน:$/)).toBeDefined();
    expect(screen.getByText(/Export Excel/i)).toBeDefined();
    expect(screen.getAllByText(/ดูทุกเดือน/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/รวมแปลงรอโอนยังไม่ระบุวัน/i)).toBeNull();
    expect(screen.getByText('ลำดับ')).toBeDefined();
    expect(screen.getByText(/แปลง \(Plot & Picture\)/i)).toBeDefined();

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0].value).toBe(String(month));
    expect(selects[1].value).toBe(String(year));
    expect(selects[2].value).toBe(String(month));
    expect(selects[3].value).toBe(String(year));
  });

  it('renders quick status tabs including waiting and rental', () => {
    render(<TransferTrackingMatrixView />);
    expect(screen.getAllByText(/รอโอนกรรมสิทธิ์/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/บ้านเช่า/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/โอนสำเร็จแล้ว/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders project dropdown with projects passed via props and includes ลำดับ column', async () => {
    const sampleProjects = [
      { name: 'ไอลิน 3', is_closed: false },
      { name: 'ไอลิน 4', is_closed: false },
      { name: 'โครงการปิดแล้ว', is_closed: true }
    ];
    render(<TransferTrackingMatrixView projects={sampleProjects} />);

    expect(screen.getByText('ทุกโครงการ (All Projects)')).toBeDefined();
    expect(screen.getByText('ไอลิน 3')).toBeDefined();
    expect(screen.getByText('ไอลิน 4')).toBeDefined();
    expect(screen.queryByText('โครงการปิดแล้ว')).toBeNull();
    expect(screen.getByText('ลำดับ')).toBeDefined();
  });

  it('correctly qualifies and displays transferred plots and excludes waiting plots without expected transfer date', async () => {
    const { supabase } = await import('@/lib/supabase');
    const mockSupabase = supabase as any;
    const { ym } = getCurrentBangkokYM();

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [{ name: 'ไอลิน 6', is_closed: false }] })
          })
        };
      }
      if (table === 'plots') {
        const plotData = [
          {
            id: 'plot-1',
            plot_name: '17',
            project_name: 'ไอลิน 6',
            sale_status: 'transferred',
            has_customer: true,
            highlight_note: 'ลูกค้า: คุณ OLE (โอนแล้ว)',
            created_at: '2026-05-13T08:00:00Z',
            house_types: { type_name: 'บ้านเดี่ยว', is_infrastructure: false }
          },
          {
            id: 'plot-2',
            plot_name: '18',
            project_name: 'ไอลิน 6',
            sale_status: 'sold',
            has_customer: true,
            highlight_note: 'ลูกค้า: คุณสมชาย (รอโอน)',
            created_at: '2026-05-13T08:00:00Z',
            house_types: { type_name: 'บ้านเดี่ยว', is_infrastructure: false }
          },
          {
            id: 'plot-3',
            plot_name: '19',
            project_name: 'ไอลิน 6',
            sale_status: 'sold',
            has_customer: true,
            highlight_note: 'ลูกค้า: คุณสมหญิง (รอโอน)',
            created_at: '2026-05-13T08:00:00Z',
            house_types: { type_name: 'บ้านเดี่ยว', is_infrastructure: false }
          },
          {
            id: 'plot-4',
            plot_name: '20',
            project_name: 'ไอลิน 6',
            sale_status: 'transferred',
            has_customer: true,
            highlight_note: 'ลูกค้า: คุณเอก (โอนแล้ว)',
            created_at: '2026-05-13T08:00:00Z',
            house_types: { type_name: 'บ้านเดี่ยว', is_infrastructure: false }
          }
        ];
        const chain: any = {
          then: (resolve: any) => Promise.resolve({ data: plotData }).then(resolve),
          eq: vi.fn().mockResolvedValue({ data: plotData }),
          in: vi.fn().mockResolvedValue({ data: plotData }),
          order: vi.fn().mockResolvedValue({ data: plotData })
        };
        return {
          select: vi.fn().mockReturnValue(chain)
        };
      }
      if (table === 'sales') {
        const salesRows = [
          {
            plot_id: 'plot-1',
            expected_transfer_date: `${ym}-15`,
            transferred_at: `${ym}-15T10:00:00Z`,
            contract_status: 'Transferred',
            crm_stage: 'transferred'
          },
          {
            plot_id: 'plot-2',
            expected_transfer_date: null,
            transferred_at: null,
            contract_status: 'Contracted',
            crm_stage: 'transfer_pending'
          },
          {
            plot_id: 'plot-3',
            expected_transfer_date: `${ym}-20`,
            transferred_at: null,
            contract_status: 'Contracted',
            crm_stage: 'transfer_pending'
          },
          {
            plot_id: 'plot-4',
            expected_transfer_date: null,
            transferred_at: `${ym}-22T10:00:00Z`,
            contract_status: 'Transferred',
            crm_stage: 'transferred'
          }
        ];
        const chain: any = {
          then: (resolve: any) => Promise.resolve({ data: salesRows }).then(resolve),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: salesRows }),
        };
        return {
          select: vi.fn().mockReturnValue(chain)
        };
      }
      return {
        select: vi.fn(() => {
          const emptyChain: any = {
            then: (resolve: any) => Promise.resolve({ data: [] }).then(resolve),
            order: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({ data: [] }),
          };
          return emptyChain;
        })
      };
    });

    render(<TransferTrackingMatrixView initialProjectName="ไอลิน 6" />);

    // Wait for the transferred plot (17) and scheduled waiting plot (19) to render
    expect(await screen.findByText('17')).toBeDefined();
    expect(await screen.findByText('19')).toBeDefined();
    // Unscheduled waiting plot (18) and unscheduled transferred plot (20) must NOT be displayed
    expect(screen.queryByText('18')).toBeNull();
    expect(screen.queryByText('20')).toBeNull();

    // Verify "โอนแล้ว" badge appears
    const transferredBadges = await screen.findAllByText('โอนแล้ว');
    expect(transferredBadges.length).toBeGreaterThanOrEqual(1);

    // Verify tab counters
    expect(screen.getByText(/โอนสำเร็จแล้ว \(1\)/i)).toBeDefined();
    expect(screen.getByText(/รอโอนกรรมสิทธิ์ \(1\)/i)).toBeDefined();

    // Even when toggling "ดูทุกเดือน (All)", unscheduled plots (18, 20) must stay excluded
    const allMonthsCheckbox = screen.getByRole('checkbox');
    fireEvent.click(allMonthsCheckbox);
    expect(screen.queryByText('18')).toBeNull();
    expect(screen.queryByText('20')).toBeNull();
    expect(screen.getByText('17')).toBeDefined();
    expect(screen.getByText('19')).toBeDefined();
  });

  it('displays rental plots using lease_start_date with ทำสัญญาแล้ว / รอทำสัญญา badges and keeps them separate from transferred count', async () => {
    const { supabase } = await import('@/lib/supabase');
    const mockSupabase = supabase as any;
    const { year, month, ym } = getCurrentBangkokYM();
    const expectedDMY = `01/${String(month).padStart(2, '0')}/${year}`;

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [{ name: 'ไอยริว', is_closed: false }] })
          })
        };
      }
      if (table === 'plots') {
        const plotData = [
          {
            id: 'plot-rent-1',
            plot_name: '42',
            project_name: 'ไอยริว',
            sale_status: 'Rented',
            has_customer: true,
            current_tenant_name: 'นายภาคภูมิญา อุ่นเรือน',
            lease_start_date: `${ym}-01`,
            highlight_note: 'เช่า: นายภาคภูมิญา อุ่นเรือน',
            created_at: '2026-05-13T08:00:00Z',
            house_types: { type_name: 'โมจิ', is_infrastructure: false }
          },
          {
            id: 'plot-rent-2',
            plot_name: '43',
            project_name: 'ไอยริว',
            sale_status: 'available',
            has_customer: true,
            highlight_note: 'จองเช่า: (คุณทดสอบ) คาดโอน ' + `${ym}-01`,
            created_at: '2026-05-13T08:00:00Z',
            house_types: { type_name: 'โมจิ', is_infrastructure: false }
          }
        ];
        const chain: any = {
          then: (resolve: any) => Promise.resolve({ data: plotData }).then(resolve),
          eq: vi.fn().mockResolvedValue({ data: plotData }),
          in: vi.fn().mockResolvedValue({ data: plotData }),
          order: vi.fn().mockResolvedValue({ data: plotData })
        };
        return { select: vi.fn().mockReturnValue(chain) };
      }
      if (table === 'rental_contracts') {
        const rcRows = [
          {
            id: 'rc-1',
            plot_id: 'plot-rent-1',
            plot_name: '42',
            project_name: 'ไอยริว',
            tenant_name: 'นายภาคภูมิญา อุ่นเรือน',
            status: 'Active',
            lease_start_date: `${ym}-01`,
            created_at: `${ym}-01T08:00:00Z`
          }
        ];
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: rcRows })
          })
        };
      }
      return {
        select: vi.fn(() => {
          const emptyChain: any = {
            then: (resolve: any) => Promise.resolve({ data: [] }).then(resolve),
            order: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({ data: [] }),
          };
          return emptyChain;
        })
      };
    });

    render(<TransferTrackingMatrixView initialProjectName="ไอยริว" />);

    expect(await screen.findByText('42')).toBeDefined();
    expect(await screen.findByText('43')).toBeDefined();
    expect(screen.getByText('ทำสัญญาแล้ว')).toBeDefined();
    expect(screen.getByText(`ทำสัญญาแล้ว (${expectedDMY})`)).toBeDefined();
    expect(screen.getByText('รอทำสัญญา')).toBeDefined();
    expect(screen.getByText(`คาดเริ่มเช่า: ${expectedDMY}`)).toBeDefined();

    // Rental plots must be counted under บ้านเช่า (2) and NOT under โอนสำเร็จแล้ว (0) or รอโอนกรรมสิทธิ์ (0)
    expect(screen.getByText(/บ้านเช่า \(2\)/i)).toBeDefined();
    expect(screen.getByText(/โอนสำเร็จแล้ว \(0\)/i)).toBeDefined();
    expect(screen.getByText(/รอโอนกรรมสิทธิ์ \(0\)/i)).toBeDefined();

    // Clicking the read-only โอน / สัญญา badge must NOT change status
    const signedBadge = screen.getByText('ทำสัญญาแล้ว');
    fireEvent.click(signedBadge.closest('td')!);
    expect(screen.getByText('ทำสัญญาแล้ว')).toBeDefined();
  });
});
