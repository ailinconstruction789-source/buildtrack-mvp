'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import type SalesKanban from './SalesKanban';
import ProjectSalesWorkspace from './ProjectSalesWorkspace';
import { useSalesWorkspaceMode } from './SalesWorkspaceModeProvider';

const LegacySalesKanban = dynamic(() => import('./SalesKanban'));
type Props = ComponentProps<typeof SalesKanban>;

/** Gate the whole old workspace, not just its Lead tab: its map/import/panels also write legacy data. */
export default function SalesWorkspaceEntry(props: Props) {
  const mode = useSalesWorkspaceMode();
  if (mode === 'legacy') return <LegacySalesKanban {...props} />;
  if (mode === 'blocked') return <main className="mx-auto max-w-3xl space-y-4 p-8">
    <h1 className="text-2xl font-bold">ยังไม่พร้อมเปลี่ยนระบบฝ่ายขาย</h1>
    <p role="alert">ต้องตรวจการตั้งค่าหน้าส่วนกลางก่อน หน้านี้จะไม่เปิดระบบเก่ามาเขียนข้อมูลแทน</p>
    {props.onBack && <button className="text-blue-700 underline" onClick={props.onBack}>กลับหน้าก่อนหน้า</button>}
  </main>;
  const projectName = typeof props.project?.name === 'string' && props.project.name.trim() ? props.project.name : null;
  if (props.initialTab === 'daily_visits') {
    const params = projectName ? `?${new URLSearchParams({ projectName })}` : '';
    return <main className="mx-auto max-w-3xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">รอบนี้เปิดเฉพาะ Lead ส่วนกลางและการจอง</h1>
      <p>ระบบนัดหมายและ Visit ยังไม่เปิดใช้งาน รับลูกค้าใหม่ที่ Lead ส่วนกลางโดยไม่สร้าง Lead ซ้ำในโครงการ</p>
      <Link href="/sales-crm" prefetch={false} className="block text-blue-700 underline">เปิด Lead ส่วนกลาง →</Link>
      <Link href={`/sales-crm/projects${params}`} prefetch={false} className="block text-blue-700 underline">ดูลูกค้าจองของโครงการ →</Link>
      {props.onBack && <button className="text-blue-700 underline" onClick={props.onBack}>กลับหน้าก่อนหน้า</button>}
    </main>;
  }
  return <ProjectSalesWorkspace initialProjectName={projectName} initialTab={props.initialTab === 'transferred' ? 'transferred' : 'booked'} initialView={props.initialTab === 'transferred' || props.initialTab === 'booked' ? 'list' : 'map'} onBack={props.onBack} />;
}
