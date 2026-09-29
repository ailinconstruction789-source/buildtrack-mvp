import Link from 'next/link';
import ProjectSalesWorkspace from '@/components/sales/ProjectSalesWorkspace';
import { parseProjectSalesPageQuery } from '@/lib/sales/projectSalesContracts';
import { projectSalesEnabled } from '@/lib/sales/projectSalesServer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ลูกค้าจองและประวัติโครงการ | BuildTrack' };

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ProjectSalesPage({ searchParams }: Props) {
  if (!projectSalesEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8">
    <h1 className="text-2xl font-bold">ยังไม่เปิดหน้าลูกค้าจองโครงการแบบใหม่</h1>
    <p>ต้องตรวจรับฐานข้อมูล สิทธิ์ และการเปลี่ยนจากระบบเดิมก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p>
    <Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link>
  </main>;
  let query;
  try { query = parseProjectSalesPageQuery(await searchParams); }
  catch {
    return <main className="space-y-4 p-8"><h1>ลิงก์โครงการไม่ถูกต้อง</h1>
      <Link href="/sales-crm/projects" prefetch={false}>เลือกโครงการอีกครั้ง</Link></main>;
  }
  return <ProjectSalesWorkspace initialProjectName={query.projectName} initialTab={query.tab} />;
}
