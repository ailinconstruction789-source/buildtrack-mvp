// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseline = 'f404377c4e5cef2088de1f4d1805164967608539';
const root = resolve(process.env.BUILDTRACK_RELEASE_SOURCE_ROOT || resolve(__dirname, '../../..'));
const deployed = (path: string) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }).replaceAll('\r\n', '\n');
const current = (path: string) => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n');
describe('bounded release preserves deployed shared behavior', () => {
  it.each(['components/LoginView.tsx', 'components/LoginScreen.tsx', 'hooks/useBuildTrackData.ts',
    'lib/auth/accountCommands.ts', 'lib/auth/loginDirectory.ts', 'components/admin/AdminUsersView.tsx', 'components/sales/LeadTrackerView.tsx',
    'components/sales/LeadWorkView.tsx', 'components/sales/NotificationsView.tsx', 'package.json', 'package-lock.json', 'next.config.ts'])('does not change %s', path => {
    expect(current(path)).toBe(deployed(path));
  });
  it('changes only the specified sales imports and render targets in the shared app', () => {
    let expected = deployed('app/page.tsx');
    for (const name of ['SalesReportsView', 'SalesDashboardExcelStyle', 'SalesIntelligenceView', 'SalesSummaryTable']) {
      expected = expected.replace(`const ${name} = dynamic(() => import('@/components/sales/${name}'));\n`, '');
    }
    expected = expected.replace("const SalesKanban = dynamic(() => import('@/components/sales/SalesKanban'));", "const SalesWorkspaceEntry = dynamic(() => import('@/components/sales/SalesWorkspaceEntry'));\nconst SalesReportingEntry = dynamic(() => import('@/components/sales/SalesReportingEntry'));")
      .replace('<SalesDashboardExcelStyle ', '<SalesReportingEntry surface="dashboard" active={view === \'sales-dashboard-excel\'}')
      .replace('<SalesKanban', '<SalesWorkspaceEntry').replaceAll('<SalesReportsView ', '<SalesReportingEntry surface="reports" ')
      .replace('<SalesIntelligenceView ', '<SalesReportingEntry surface="intelligence"').replace('<SalesSummaryTable />', '<SalesReportingEntry surface="summary" />');
    expect(current('app/page.tsx')).toBe(expected);
  });
  it('does not import unfinished report or post-booking implementations at shared boundaries', () => {
    expect(current('app/layout.tsx')).not.toContain('postBookingServer');
    expect(current('components/sales/SalesReportingEntry.tsx')).not.toContain('SalesReportsWorkspace');
    expect(current('app/sales-crm/[customerId]/page.tsx')).not.toContain('VisitWorkspace');
  });
});
