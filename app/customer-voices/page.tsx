import CustomerVoicePublic from '@/components/sales/CustomerVoicePublic';
import { customerVoicesEnabled } from '@/lib/sales/customerVoicesServer';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'แบบประเมินการเข้าชม | BuildTrack', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default function CustomerVoicePage() {
  if (!customerVoicesEnabled()) return <main lang="th" className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดแบบประเมินผ่าน QR</h1><p>กรุณาติดต่อ Sales ที่ดูแลคุณ หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p></main>;
  return <CustomerVoicePublic />;
}
