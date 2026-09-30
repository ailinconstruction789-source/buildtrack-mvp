import Link from 'next/link';
import VisitSopWorkspace from '@/components/sales/VisitSopWorkspace';
import { parseVisitSopPageQuery, type VisitSopAnchor } from '@/lib/sales/visitSopContracts';
import { visitSopEnabled } from '@/lib/sales/visitSopServer';
import { visitFollowUpEnabled } from '@/lib/sales/leadWorkServer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SOP เตรียมบ้านและพาชม | BuildTrack' };
export default async function VisitSopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!visitSopEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิด SOP จาก Lead ส่วนกลาง</h1>
    <p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p><Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  let anchor: VisitSopAnchor;
  try { anchor = parseVisitSopPageQuery(await searchParams); }
  catch { return <main className="space-y-4 p-8"><h1>ลิงก์นัดหมายหรือ Visit ไม่ถูกต้อง</h1><Link href="/sales-crm" prefetch={false}>เลือก Lead จากส่วนกลางอีกครั้ง</Link></main>; }
  return <VisitSopWorkspace anchor={anchor} followUpEnabled={visitFollowUpEnabled()} />;
}
