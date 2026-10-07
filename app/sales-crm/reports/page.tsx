import Link from 'next/link';
import SalesReportsWorkspace from '@/components/sales/SalesReportsWorkspace';
import { parseSalesReportPageQuery } from '@/lib/sales/salesReportsContracts';
import { salesReportsEnabled } from '@/lib/sales/projectSalesFlags';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'รายงานจองจาก Lead ส่วนกลาง | BuildTrack' };
export default async function SalesReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!salesReportsEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8">
    <h1 className="text-2xl font-bold">ยังไม่เปิดรายงานจาก Lead ส่วนกลาง</h1>
    <p>ต้องตรวจรับฐานข้อมูล การเชื่อมข้อมูลเก่า และสิทธิ์ก่อน หน้านี้ยังไม่อ่านหรือเปลี่ยนข้อมูล</p>
    <Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link>
  </main>;
  let scope;
  try { scope = parseSalesReportPageQuery(await searchParams); }
  catch { return <main className="space-y-4 p-8"><h1>ลิงก์รายงานไม่ถูกต้อง</h1><Link href="/sales-crm/reports" prefetch={false}>เลือกช่วงรายงานอีกครั้ง</Link></main>; }
  return <SalesReportsWorkspace initialScope={scope} />;
}
