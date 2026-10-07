import Link from 'next/link';
import AccountAccessWorkspace from '@/components/admin/AccountAccessWorkspace';
import { accountAccessReadEnabled } from '@/lib/auth/accountAccessServer';
import { accountAccessRestoreEnabled } from '@/lib/auth/accountRestoreServer';

export const metadata = { title:'ตรวจสิทธิ์ฝ่ายขาย | BuildTrack', robots:{index:false,follow:false} };
export default function AccountAccessPage() {
  const enabled=accountAccessReadEnabled();
  const restoreEnabled=accountAccessRestoreEnabled();
  return <main lang="th" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/" prefetch={false} className="text-sm text-blue-700 underline">กลับ BuildTrack</Link>
      <header><h1 className="text-2xl font-bold">ตรวจสิทธิ์ฝ่ายขาย</h1>
        <p className="mt-2 text-sm text-slate-600">สำหรับ Admin ที่ได้รับสิทธิ์จัดการบัญชี · บัญชี Sales ในรายการรับรองเท่านั้น ไม่ใช่รายชื่อพนักงานทั้งหมด</p></header>
      <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{restoreEnabled?'รับรองคืนสิทธิ์ Sales เดิมที่ปลดแบนและรอทบทวนเท่านั้น':'อ่านอย่างเดียว ยังไม่เปิดคำสั่งรับรอง'} · ไม่ปลดแบน ไม่เปลี่ยนบทบาท ไม่ย้าย Lead และไม่ลบประวัติลูกค้า</p>
      {enabled ? <AccountAccessWorkspace restoreEnabled={restoreEnabled}/> : <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">เตรียมหน้าจอแล้ว ยังไม่เปิดอ่านข้อมูลจริง</h2>
        <p role="status" className="text-sm text-slate-600">ต้องตรวจและติดตั้งส่วนอ่านสิทธิ์ที่ฐานข้อมูลก่อน หน้านี้จึงยังไม่เรียก Supabase และไม่ใช้ข้อมูลจำลองแทนบัญชีจริง</p>
        {process.env.NODE_ENV==='development' && <Link href="/dev/account-access" prefetch={false} className="inline-block text-blue-700 underline">เปิดหน้าทดลองด้วยบัญชีสมมติ →</Link>}
      </section>}
    </div>
  </main>;
}
