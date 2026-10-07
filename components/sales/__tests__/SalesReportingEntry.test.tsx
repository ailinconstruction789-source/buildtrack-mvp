import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const mock = vi.hoisted(() => ({ legacy: vi.fn(), report: vi.fn(), project: vi.fn(), excel: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => mock.legacy }));
vi.mock('../SalesReportsWorkspace', () => ({ default: mock.report }));
vi.mock('../ProjectSalesWorkspace', () => ({ default: mock.project }));
vi.mock('../CentralExcelReportWorkspace', () => ({ default: mock.excel }));
import SalesReportingEntry from '../SalesReportingEntry';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import OwnerPage from '@/app/owner/page';
mock.legacy.mockImplementation(() => <p>legacy report</p>);
mock.report.mockImplementation(() => <p>central aggregate report</p>);
mock.project.mockImplementation(() => <p>central booked details</p>);
mock.excel.mockImplementation(() => <p>central Excel summary</p>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('legacy report replacement boundaries', () => {
  it('keeps all report readers and legacy modules unmounted in the bounded release', () => {
    render(<SalesWorkspaceModeProvider mode="central" reportsEnabled={false}><SalesReportingEntry surface="owner" /></SalesWorkspaceModeProvider>);
    expect(screen.getByText('รอบนี้เปิดเฉพาะ Lead ส่วนกลางและการจอง')).toBeInTheDocument();
    expect(mock.legacy).not.toHaveBeenCalled(); expect(mock.report).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /รายงานจองรวม/ })).not.toBeInTheDocument();
  });
  it('preserves legacy keep-alive and its props while cutover is off', () => {
    const callback = vi.fn(), project = { name: 'A' };
    render(<SalesWorkspaceModeProvider mode="legacy"><SalesReportingEntry surface="dashboard" active={false} project={project} onViewDefects={callback} /></SalesWorkspaceModeProvider>);
    expect(mock.legacy.mock.calls[0][0]).toEqual({ project, onViewDefects: callback }); expect(mock.report).not.toHaveBeenCalled();
  });
  it('does not mount old or new hidden dashboards in central mode', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesReportingEntry surface="dashboard" active={false} /></SalesWorkspaceModeProvider>);
    expect(mock.legacy).not.toHaveBeenCalled(); expect(mock.report).not.toHaveBeenCalled();
  });
  it('uses the restored Excel dashboard and preserves selected project', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesReportingEntry surface="dashboard" active={true} project={{ name: 'โครงการ A' }} /></SalesWorkspaceModeProvider>);
    expect(mock.excel.mock.calls[0][0]).toEqual({ surface: 'dashboard', initialProjectName: 'โครงการ A' }); expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('maps summary to all sale rounds, not a legacy plot-first join', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesReportingEntry surface="summary" /></SalesWorkspaceModeProvider>);
    expect(mock.excel.mock.calls[0][0]).toEqual({ surface: 'summary', initialProjectName: null }); expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('does not silently substitute general totals for individual employee KPIs', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesReportingEntry surface="reports" project={null} viewType="agent" /></SalesWorkspaceModeProvider>);
    expect(screen.getByText('รายงาน KPI รายบุคคลยังไม่พร้อม')).toBeInTheDocument(); expect(mock.legacy).not.toHaveBeenCalled(); expect(mock.report).not.toHaveBeenCalled();
  });
  it('retains scope in the explicit reports link from an unsupported intelligence surface', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesReportingEntry surface="intelligence" project={{ name: 'โครงการ & B' }} /></SalesWorkspaceModeProvider>);
    const href = screen.getByRole('link').getAttribute('href')!;
    expect(new URL(href, 'https://test.invalid').searchParams.get('projectName')).toBe('โครงการ & B'); expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('does not mount sample owner KPI data on the direct owner route in central mode', () => {
    render(<SalesWorkspaceModeProvider mode="central"><OwnerPage /></SalesWorkspaceModeProvider>);
    expect(mock.report).toHaveBeenCalledOnce(); expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('fails closed without a provider', () => {
    render(<SalesReportingEntry surface="owner" />); expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mock.legacy).not.toHaveBeenCalled(); expect(mock.report).not.toHaveBeenCalled();
  });
  it('all main-app sales reporting menus use the same server-injected boundary', () => {
    const source = readFileSync('app/page.tsx', 'utf8');
    for (const name of ['SalesReportsView', 'SalesDashboardExcelStyle', 'SalesIntelligenceView', 'SalesSummaryTable']) expect(source).not.toContain(`<${name}`);
    for (const surface of ['dashboard', 'reports', 'intelligence', 'summary']) expect(source).toContain(`<SalesReportingEntry surface="${surface}"`);
    expect(source).toContain("active={view === 'sales-dashboard-excel'}");
  });
});
