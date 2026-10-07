import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const mock = vi.hoisted(() => ({ enabled: vi.fn(), workspace: vi.fn() }));
vi.mock('@/lib/sales/projectSalesFlags', () => ({ salesReportsEnabled: mock.enabled }));
vi.mock('../SalesReportsWorkspace', () => ({ default: mock.workspace }));
import ReportsPage from '@/app/sales-crm/reports/page';
mock.workspace.mockImplementation(() => <p>central report</p>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('report page gate', () => {
  it('does not mount a reader while disabled', async () => {
    mock.enabled.mockReturnValue(false); render(await ReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('ยังไม่เปิดรายงานจาก Lead ส่วนกลาง')).toBeInTheDocument(); expect(mock.workspace).not.toHaveBeenCalled();
  });
  it('passes a validated cohort and project to the client', async () => {
    mock.enabled.mockReturnValue(true); const query = { projectName: 'โครงการ A', fromDate: '2024-02-29', toDate: '2024-03-01' };
    render(await ReportsPage({ searchParams: Promise.resolve(query) }));
    expect(mock.workspace.mock.calls[0][0]).toEqual({ initialScope: query });
  });
  it.each([{ projectName: ['A', 'B'] }, { fromDate: '2026-01-01' }, { role: 'admin' }])('blocks ambiguous URL %j', async query => {
    mock.enabled.mockReturnValue(true); render(await ReportsPage({ searchParams: Promise.resolve(query) }));
    expect(screen.getByText('ลิงก์รายงานไม่ถูกต้อง')).toBeInTheDocument(); expect(mock.workspace).not.toHaveBeenCalled();
  });
});
