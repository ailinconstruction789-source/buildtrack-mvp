import Link from 'next/link';
import PostBookingWorkspace from '@/components/sales/PostBookingWorkspace';
import { parsePostBookingPageQuery } from '@/lib/sales/postBookingContracts';
import { postBookingEnabled } from '@/lib/sales/postBookingServer';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'สัญญา สินเชื่อ และโอนหลังจอง | BuildTrack' };
export default async function PostBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!postBookingEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดงานสัญญา สินเชื่อ และโอนจากส่วนกลาง</h1>
    <p>ต้องตรวจรับฐานข้อมูล สิทธิ์ และการเปลี่ยนจากระบบเดิมก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p>
    <Link href="/sales-crm/projects" prefetch={false}>กลับรายการจองโครงการ</Link></main>;
  let saleId: string;
  try { saleId = parsePostBookingPageQuery(await searchParams); }
  catch { return <main className="space-y-4 p-8"><h1>ลิงก์รายการจองไม่ถูกต้อง</h1><Link href="/sales-crm/projects" prefetch={false}>เลือกการจองอีกครั้ง</Link></main>; }
  return <PostBookingWorkspace saleId={saleId} />;
}
