'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type SalesDashboardExcelStyle from './SalesDashboardExcelStyle';
import type SalesReportsView from './SalesReportsView';
import type SalesIntelligenceView from './SalesIntelligenceView';
import CentralExcelReportWorkspace from './CentralExcelReportWorkspace';
import { useSalesWorkspaceMode } from './SalesWorkspaceModeProvider';

const LegacyDashboard = dynamic(() => import('./SalesDashboardExcelStyle'));
const LegacyReports = dynamic(() => import('./SalesReportsView'));
const LegacyIntelligence = dynamic(() => import('./SalesIntelligenceView'));
const LegacySummary = dynamic(() => import('./SalesSummaryTable'));
const LegacyOwner = dynamic(() => import('./OwnerAnalyticsDashboard'));

type Props =
  | ({ surface: 'dashboard'; active?: boolean } & ComponentProps<typeof SalesDashboardExcelStyle>)
  | ({ surface: 'reports' } & ComponentProps<typeof SalesReportsView>)
  | ({ surface: 'intelligence' } & ComponentProps<typeof SalesIntelligenceView>)
  | { surface: 'summary' | 'owner' };

export default function SalesReportingEntry(props: Props) {
  const mode = useSalesWorkspaceMode();
  if (props.surface === 'dashboard' && props.active === false) return null;

  if (mode === 'central' && (props.surface === 'dashboard' || props.surface === 'summary')) {
    const projectName = 'project' in props && typeof props.project?.name === 'string' && props.project.name.trim() ? props.project.name : null;
    return <CentralExcelReportWorkspace surface={props.surface} initialProjectName={projectName} />;
  }

  switch (props.surface) {
    case 'dashboard':
      return <LegacyDashboard project={props.project} onViewDefects={props.onViewDefects} />;
    case 'reports':
      return <LegacyReports project={props.project} viewType={props.viewType} />;
    case 'intelligence':
      return <LegacyIntelligence project={props.project} projects={props.projects} onBack={props.onBack} />;
    case 'summary':
      return <LegacySummary />;
    case 'owner':
      return <LegacyOwner />;
  }
}
