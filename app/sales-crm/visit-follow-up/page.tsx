import Link from 'next/link';
import VisitFollowUpWorkspace from '@/components/sales/VisitFollowUpWorkspace';
import { visitFollowUpEnabled } from '@/lib/sales/leadWorkServer';
import { parseLeadWorkScopeQuery, type LeadWorkScope } from '@/lib/sales/leadWorkReadContracts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'งานติดตามหลังเข้าชม | BuildTrack' };
export default async function VisitFollowUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!visitFollowUpEnabled()) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดงานติดตามหลังเข้าชม</h1>
    <p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ก่อน หน้านี้ยังไม่อ่านหรือบันทึกข้อมูล</p><Link href="/sales-crm" prefetch={false}>กลับ Lead ส่วนกลาง</Link></main>;
  let scope: LeadWorkScope;
  try {
    const query = await searchParams;
    if (Object.keys(query).some(key => key !== 'customerId' && key !== 'interestId') || typeof query.customerId !== 'string' || typeof query.interestId !== 'string') throw new Error('invalid');
    scope = parseLeadWorkScopeQuery(`https://local.invalid/?${new URLSearchParams({ customerId: query.customerId, interestId: query.interestId })}`);
    if (scope.interestId === null) throw new Error('invalid');
  } catch { return <main className="space-y-4 p-8"><h1>ลิงก์ลูกค้าหรือโครงการไม่ถูกต้อง</h1><Link href="/sales-crm" prefetch={false}>เลือก Lead และโครงการจากส่วนกลางอีกครั้ง</Link></main>; }
  return <VisitFollowUpWorkspace scope={scope} />;
}
