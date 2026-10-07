import { notFound } from 'next/navigation';
import Link from 'next/link';
import AccountAccessDirectoryDemo from '@/components/dev/AccountAccessDirectoryDemo';

export const metadata={title:'ตัวอย่างหน้าตรวจสิทธิ์ | BuildTrack',robots:{index:false,follow:false}};
export default function AccountAccessDirectoryDemoPage() {
  if (process.env.NODE_ENV!=='development') notFound();
  return <main lang="th" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/dev/account-access" prefetch={false} className="text-sm text-blue-700 underline">← กลับตัวอย่างแบน–ปลดแบน–รับรอง</Link>
      <h1 className="text-2xl font-bold">ตัวอย่างหน้าตรวจสิทธิ์ฝ่ายขาย</h1>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">ข้อมูลสมมติ 5 บัญชี ไม่เชื่อม Supabase ใช้หน้ารายการและแบบรับรองเดียวกับที่เตรียมให้ Admin ลองรับรอง Sales ตัวอย่าง B ได้ การเปลี่ยนแปลงอยู่ในหน้านี้เท่านั้น รีเฟรชแล้วเริ่มใหม่ ไม่แก้ไขบัญชีจริง</p>
      <AccountAccessDirectoryDemo/>
    </div>
  </main>;
}
