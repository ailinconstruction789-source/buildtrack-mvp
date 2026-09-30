'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import type SalesDashboardExcelStyle from './SalesDashboardExcelStyle';
import type SalesReportsView from './SalesReportsView';
import type SalesIntelligenceView from './SalesIntelligenceView';
import { useSalesWorkspaceMode } from './SalesWorkspaceModeProvider';
import CentralExcelReportWorkspace from './CentralExcelReportWorkspace';

const LegacyDashboard = dynamic(() => import('./SalesDashboardExcelStyle'));
const LegacyReports = dynamic(() => import('./SalesReportsView'));
const LegacyIntelligence = dynamic(() => import('./SalesIntelligenceView'));
const LegacySummary = dynamic(() => import('./SalesSummaryTable'));
const LegacyOwner = dynamic(() => import('./OwnerAnalyticsDashboard'));
type Props =
  | ({ surface: 'dashboard'; active: boolean } & ComponentProps<typeof SalesDashboardExcelStyle>)
  | ({ surface: 'reports' } & ComponentProps<typeof SalesReportsView>)
  | ({ surface: 'intelligence' } & ComponentProps<typeof SalesIntelligenceView>)
  | { surface: 'summary' | 'owner' };

/** Bounded release: never mount legacy readers in central mode, even in hidden panels.
 * Reporting remains unavailable until its separate reviewed release. */
export default function SalesReportingEntry(props: Props) {
  const mode = useSalesWorkspaceMode();
  if (mode === 'legacy') {
    switch (props.surface) {
      case 'dashboard': return <LegacyDashboard project={props.project} onViewDefects={props.onViewDefects} />;
      case 'reports': return <LegacyReports project={props.project} viewType={props.viewType} />;
      case 'intelligence': return <LegacyIntelligence project={props.project} projects={props.projects} onBack={props.onBack} />;
      case 'summary': return <LegacySummary />;
      case 'owner': return <LegacyOwner />;
    }
  }
  if (props.surface === 'dashboard' && !props.active) return null;
  if (mode === 'blocked') return <main className="mx-auto max-w-3xl space-y-4 p-8">
    <h1 className="text-2xl font-bold">ยังไม่พร้อมเปลี่ยนรายงานฝ่ายขาย</h1>
    <p role="alert">ต้องตรวจการตั้งค่าระบบส่วนกลางก่อน ไม่ดึงรายงานเดิมหรือตัวเลขตัวอย่างมาทดแทน</p>
    <Link href="/sales-crm" prefetch={false}>ไป Lead ส่วนกลาง →</Link>
  </main>;
  const projectName = 'project' in props && typeof props.project?.name === 'string' && props.project.name.trim() ? props.project.name : null;
  if (props.surface === 'dashboard' || props.surface === 'summary') return <CentralExcelReportWorkspace surface={props.surface} initialProjectName={projectName} />;
  return <main className="mx-auto max-w-3xl space-y-4 p-8">
    <h1 className="text-2xl font-bold">รอบนี้เปิดเฉพาะ Lead ส่วนกลางและการจอง</h1>
    <p>รายงานและ KPI ยังไม่เปิดใช้งาน ไม่แสดงข้อมูลเดิมปนกับข้อมูลส่วนกลาง</p>
    <Link href="/sales-crm" prefetch={false} className="block text-blue-700 underline">ไป Lead ส่วนกลาง →</Link>
    <Link href={`/sales-crm/projects${projectName ? `?${new URLSearchParams({ projectName })}` : ''}`} prefetch={false} className="block text-blue-700 underline">ดูลูกค้าจองและประวัติโครงการ →</Link>
  </main>;
}
