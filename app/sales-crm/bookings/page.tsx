import Link from 'next/link';
import BookingWorkspace from '@/components/sales/BookingWorkspace';
import { bookingsEnabled } from '@/lib/sales/bookingServer';
import { bookingUuid } from '@/lib/sales/bookingContracts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'การจองและประวัติลูกค้า | BuildTrack' };
interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }
export default async function BookingPage({ searchParams }: Props) {
  if (!bookingsEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดระบบจองส่วนกลาง</h1>
    <p>ต้องตรวจรับฐานข้อมูล สิทธิ์ และการเปลี่ยนจากระบบเดิมก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p>
    <Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  const query = await searchParams;
  let customerId: string | null = null;
  try {
    if (Object.keys(query).some(key => key !== 'customerId') || Array.isArray(query.customerId)) throw new Error('invalid');
    if (query.customerId !== undefined) customerId = bookingUuid(query.customerId);
  } catch {
    return <main className="space-y-4 p-8"><h1>ลิงก์การจองไม่ถูกต้อง</h1><Link href="/sales-crm" prefetch={false}>เลือกลูกค้าจาก Lead ส่วนกลางอีกครั้ง</Link></main>;
  }
  return <BookingWorkspace initialCustomerId={customerId} />;
}
