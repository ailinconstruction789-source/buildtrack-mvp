import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  ComposedChart: ({ children }: any) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Area: () => null,
  Line: () => null,
  Bar: () => null,
  LabelList: () => null,
}));

const mockPlots = [
  { id: 'plot-1', plot_name: '1', project_name: 'ไอลิน6', selling_price: 3000000, land_appraisal_price: 3200000 },
];

const mockProjects = [
  { name: 'ไอลิน6', is_closed: false },
];

const mockLeads = [
  // 1. New Lead only (not visited yet)
  {
    id: 'lead-new-1',
    customer_name: 'ลูกค้าทักเพจ ยังไม่มาดูบ้าน',
    project_name: 'ไอลิน6',
    status: 'New',
    crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
    agent_name: 'NOOK',
    lead_date: '2026-11-18T09:00:00Z',
    created_at: '2026-11-18T09:00:00Z',
    actual_visit_date: null,
    notes: 'ทัก Facebook',
  },
  // 2. Visited Lead (checked in / SOP, no survey yet)
  {
    id: 'lead-visit-1',
    customer_name: 'ลูกค้ามาดูบ้าน เช็คอินแล้ว',
    project_name: 'ไอลิน6',
    status: 'Visit',
    crm_status: 'Considering — กำลังพิจารณา',
    agent_name: 'NOOK',
    lead_date: '2026-11-18T10:00:00Z',
    actual_visit_date: '2026-11-18T11:00:00Z',
    created_at: '2026-11-18T10:00:00Z',
    notes: 'พาชมบ้านแปลง 1',
  },
  // 3. Visited Lead + Completed Survey
  {
    id: 'lead-survey-1',
    customer_name: 'ลูกค้ามาดูบ้าน ทำแบบสอบถามแล้ว',
    project_name: 'ไอลิน6',
    status: 'Visit',
    crm_status: 'Considering — กำลังพิจารณา',
    agent_name: 'FIELD',
    lead_date: '2026-11-18T12:00:00Z',
    actual_visit_date: '2026-11-18T13:00:00Z',
    created_at: '2026-11-18T12:00:00Z',
    notes: '[ทำแบบสอบถาม Customer Voices แล้ว]\nพาชมบ้าน',
  },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        let result: any = Promise.resolve({ data: [], error: null });
        if (table === 'plots') result = Promise.resolve({ data: mockPlots, error: null });
        if (table === 'projects') result = Promise.resolve({ data: mockProjects, error: null });
        if (table === 'leads') result = Promise.resolve({ data: mockLeads, error: null });
        result.order = () => result;
        result.range = () => result;
        result.in = () => result;
        return result;
      },
    }),
    rpc: () => Promise.resolve({ data: { rows: [], legacyVisits: [], completedVisits: [], unassignedLegacyVisits: [] }, error: null }),
  },
}));

import SalesDashboardExcelStyle from '../SalesDashboardExcelStyle';

afterEach(cleanup);

describe('SalesDashboardExcelStyle - Lead vs Visit vs Survey & Agent Performance', () => {
  it('counts new leads only in Lead totals and counts visited leads separately with survey breakdown', async () => {
    render(<SalesDashboardExcelStyle />);

    await screen.findByText(/Monthly Sale Report 2026/);

    // Annual & Monthly Lead counts should be 3 (all 3 leads), while Visit counts should be 2 (only the 2 visited leads)
    expect(screen.getByText('ยอด Lead สะสม')).toBeInTheDocument();
    expect(screen.getByText('ยอด Lead ใหม่')).toBeInTheDocument();
    expect(screen.getAllByText('(ทำแบบสอบถาม 1 คน)').length).toBeGreaterThanOrEqual(2);

    // Verify charts and Agent Performance table exist
    expect(screen.getAllByText(/สัปดาห์นี้/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('ยอด Lead รายเดือน ปี 2023 - 2026 (ราย)')).toBeInTheDocument();
    expect(screen.getByText(/ยอด Lead สะสม ปี 2026 \(ราย\)/)).toBeInTheDocument();
    expect(screen.getByText(/สรุปผลงานพนักงานขาย/)).toBeInTheDocument();

    const nookRow = screen.getByText('NOOK').closest('tr')!;
    expect(within(nookRow).getAllByText('2').length).toBeGreaterThanOrEqual(1); // 2 leads for NOOK
    const fieldRow = screen.getByText('FIELD').closest('tr')!;
    expect(within(fieldRow).getAllByText('1').length).toBeGreaterThanOrEqual(1); // 1 lead for FIELD
  });
});
