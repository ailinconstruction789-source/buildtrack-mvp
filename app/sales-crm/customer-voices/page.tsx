import Link from 'next/link';
import CustomerVoicesWorkspace from '@/components/sales/CustomerVoicesWorkspace';
import { parseVoiceScope, type VoiceScope } from '@/lib/sales/customerVoicesContracts';
import { customerVoicesEnabled } from '@/lib/sales/customerVoicesServer';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer Voices ราย Visit | BuildTrack' };
export default async function CustomerVoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!customerVoicesEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิด Customer Voices ราย Visit</h1><p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p><Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  let scope: VoiceScope;
  try { scope = parseVoiceScope(await searchParams); }
  catch { return <main className="space-y-4 p-8"><h1>ลิงก์ Visit ไม่ถูกต้อง</h1><Link href="/sales-crm" prefetch={false}>เลือก Visit จาก Lead ส่วนกลางอีกครั้ง</Link></main>; }
  return <CustomerVoicesWorkspace scope={scope} />;
}
