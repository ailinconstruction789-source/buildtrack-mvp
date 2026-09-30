import Link from 'next/link';
import VisitsWorkspace from '@/components/sales/VisitsWorkspace';
import { parseVisitsPageQuery } from '@/lib/sales/visitsContracts';
import { visitsEnabled } from '@/lib/sales/visitsServer';
import { visitSopEnabled } from '@/lib/sales/visitSopServer';
import { customerVoicesEnabled } from '@/lib/sales/customerVoicesServer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'นัดหมายและเข้าชมโครงการ | BuildTrack' };
export default async function VisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!visitsEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดนัดหมายและเข้าชมจากส่วนกลาง</h1>
    <p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p><Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  let customerId: string, interestId: string;
  try {
    ({ customerId, interestId } = parseVisitsPageQuery(await searchParams));
  } catch { return <main className="space-y-4 p-8"><h1>ลิงก์ลูกค้าหรือโครงการที่สนใจไม่ถูกต้อง</h1><Link href="/sales-crm" prefetch={false}>เลือก Lead อีกครั้ง</Link></main>; }
  return <VisitsWorkspace customerId={customerId} interestId={interestId} sopEnabled={visitSopEnabled()} voicesEnabled={customerVoicesEnabled()} />;
}
