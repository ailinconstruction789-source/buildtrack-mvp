import Link from 'next/link';
import ProjectSalesWorkspace from '@/components/sales/ProjectSalesWorkspace';
import { projectSalesEnabled } from '@/lib/sales/projectSalesFlags';
import { parseProjectMapName } from '@/lib/sales/projectMapContracts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ผังโครงการฝ่ายขาย | BuildTrack' };
export default async function ProjectMapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!projectSalesEnabled()) return <main className="space-y-4 p-8"><h1>ยังไม่เปิดผังโครงการฝ่ายขาย</h1><Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  const query = await searchParams;
  let projectName: string | null = null;
  try {
    if (Object.keys(query).some(key => key !== 'projectName')) throw new Error('INVALID_INPUT');
    if (query.projectName !== undefined) projectName = parseProjectMapName(query.projectName);
  } catch {
    return <main className="space-y-4 p-8"><h1>ลิงก์โครงการไม่ถูกต้อง</h1><Link href="/sales-crm/projects/map" prefetch={false}>เลือกโครงการอีกครั้ง</Link></main>;
  }
  return <ProjectSalesWorkspace initialProjectName={projectName} initialView="map" />;
}
