import React, { Suspense } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const legacy = vi.hoisted(() => ({ dashboard: vi.fn(() => <p>legacy-dashboard</p>), reports: vi.fn<(props: Record<string, unknown>) => React.JSX.Element>(() => <p>legacy-reports</p>),
  intelligence: vi.fn(() => <p>legacy-intelligence</p>), summary: vi.fn(() => <p>legacy-summary</p>), owner: vi.fn(() => <p>legacy-owner</p>) }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => React.lazy(loader) }));
vi.mock('../SalesDashboardExcelStyle', () => ({ default: legacy.dashboard }));
vi.mock('../SalesReportsView', () => ({ default: legacy.reports }));
vi.mock('../SalesIntelligenceView', () => ({ default: legacy.intelligence }));
vi.mock('../SalesSummaryTable', () => ({ default: legacy.summary }));
vi.mock('../OwnerAnalyticsDashboard', () => ({ default: legacy.owner }));
import SalesReportingEntry from '../SalesReportingEntry';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import type { ProjectWorkspaceMode } from '@/lib/sales/projectSalesFlags';

function show(element: React.ReactNode, mode: ProjectWorkspaceMode = 'central', reportsEnabled = false) {
  return render(<SalesWorkspaceModeProvider mode={mode} reportsEnabled={reportsEnabled}><Suspense fallback={<p>loading</p>}>{element}</Suspense></SalesWorkspaceModeProvider>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('bounded reporting navigation', () => {
  it.each(['summary', 'owner'] as const)('preserves legacy %s with no redirect when mode is legacy', async surface => {
    show(<SalesReportingEntry surface={surface} />, 'legacy');
    await screen.findByText(`legacy-${surface}`);
    expect(legacy[surface]).toHaveBeenCalled();
    expect(screen.queryByText('รอบนี้เปิดเฉพาะ Lead ส่วนกลางและการจอง')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('preserves legacy dashboard keep-alive and report props', async () => {
    show(<SalesReportingEntry surface="dashboard" active={false} project={null} />, 'legacy');
    await screen.findByText('legacy-dashboard');
    cleanup();
    show(<SalesReportingEntry surface="reports" project={null} viewType="agent" />, 'legacy');
    await screen.findByText('legacy-reports');
    expect(legacy.reports.mock.calls[0]?.[0]).toMatchObject({ project: null, viewType: 'agent' });
  });
  it('does not mount hidden legacy dashboard after central cutover', async () => {
    const view = show(<SalesReportingEntry surface="dashboard" active={false} project={null} />);
    expect(view.container).toBeEmptyDOMElement();
    await waitFor(() => expect(legacy.dashboard).not.toHaveBeenCalled());
  });
  it.each([false, true])('keeps report release closed even when a future flag is %s', reportsEnabled => {
    show(<SalesReportingEntry surface="summary" />, 'central', reportsEnabled);
    expect(screen.getByText('รอบนี้เปิดเฉพาะ Lead ส่วนกลางและการจอง')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ดูลูกค้าจอง/ })).toHaveAttribute('href', '/sales-crm/projects');
    for (const callback of Object.values(legacy)) expect(callback).not.toHaveBeenCalled();
  });
  it('shows a closed configuration warning instead of legacy fallbacks', () => {
    show(<SalesReportingEntry surface="owner" />, 'blocked');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(legacy.owner).not.toHaveBeenCalled();
  });
});
