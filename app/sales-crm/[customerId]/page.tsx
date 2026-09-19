import Link from 'next/link';
import LeadWorkView from '@/components/sales/LeadWorkView';
import { parseLeadWorkScopeQuery, type LeadWorkScope } from '@/lib/sales/leadWorkReadContracts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'งานติดตามลูกค้า | BuildTrack' };

interface Props {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function Unavailable({ invalid = false }: { invalid?: boolean }) {
  return <main className="min-h-screen bg-slate-50 px-4 py-10">
    <section className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-white p-6 space-y-4">
      <h1 className="text-xl font-bold text-slate-900">{invalid ? 'ลิงก์งานติดตามไม่ถูกต้อง' : 'ยังไม่เปิดงานติดตามลูกค้า'}</h1>
      <p className="text-sm text-slate-600">{invalid ? 'กรุณาเลือกลูกค้าและโครงการจากหน้า Lead ส่วนกลางอีกครั้ง' :
        'ส่วนนี้อยู่ระหว่างเตรียมระบบ ยังไม่อ่านหรือบันทึกข้อมูลการติดตาม และไม่สร้างรายการลงระบบเก่าแทน'}</p>
      <Link href="/sales-crm" prefetch={false} className="inline-block text-sm font-semibold text-blue-700 hover:underline">← กลับ Lead ส่วนกลาง</Link>
    </section>
  </main>;
}

export default async function LeadWorkPage({ params, searchParams }: Props) {
  // Private server switches gate the component before browser auth/read effects.
  // The API and direct-RPC database switches remain independent enforcement layers.
  if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true') return <Unavailable />;
  const [{ customerId }, query] = await Promise.all([params, searchParams]);
  if (Object.keys(query).some(key => key !== 'interestId') || Array.isArray(query.interestId)) return <Unavailable invalid />;
  let scope: LeadWorkScope | null = null;
  try {
    const search = new URLSearchParams({ customerId });
    if (query.interestId !== undefined) search.set('interestId', query.interestId);
    scope = parseLeadWorkScopeQuery(`https://buildtrack.invalid/api/sales-crm/lead-work?${search}`);
  } catch { /* Malformed route data must never reach the browser's read effect. */ }
  if (!scope) return <Unavailable invalid />;
  return <LeadWorkView scope={scope} lifecycleEnabled={process.env.SALES_CRM_LIFECYCLE_ENABLED === 'true'} />;
}
