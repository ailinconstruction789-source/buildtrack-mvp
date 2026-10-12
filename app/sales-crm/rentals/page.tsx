import Link from 'next/link';
import CanonicalRentalWorkspace from '@/components/sales/CanonicalRentalWorkspace';
import { parseRentalCommandPageQuery } from '@/lib/sales/rentalCommandContracts';
import { rentalCommandsEnabled } from '@/lib/sales/rentalCommandServer';
export const dynamic='force-dynamic';
export const metadata={title:'สัญญาเช่า A / B / C | BuildTrack'};
export default async function CanonicalRentalPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  if(!rentalCommandsEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดสัญญาเช่าส่วนกลาง</h1><p>ต้องตรวจรับฐานข้อมูล สิทธิ์ และการเปลี่ยนจากระบบเดิมก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p><Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  try {const scope=parseRentalCommandPageQuery(await searchParams);return <CanonicalRentalWorkspace {...scope}/>;}
  catch {return <main className="space-y-4 p-8"><h1>ลิงก์ลูกค้าหรือสัญญาไม่ถูกต้อง</h1><Link href="/sales-crm" prefetch={false}>เลือกลูกค้าอีกครั้ง</Link></main>;}
}
