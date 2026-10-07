'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FlaskConical, History, ShieldCheck, RotateCcw } from 'lucide-react';
import { applyDemoAction, demoAccess, initialDemoAccounts, type DemoAccount, type DemoAction, type DemoReviewer } from '@/lib/dev/accountAccessDemo';

const buttonStyle = 'rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';
const fieldStyle = 'mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100';

function ReviewForm({ account, reviewer, onAction }: {
  account: DemoAccount; reviewer: DemoReviewer; onAction: (action: DemoAction) => void;
}) {
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const available = reviewer === 'admin' && !account.banned && !account.crmActive;
  const canSubmit = available && !!reason.trim() && !!reference.trim() && confirmed;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) onAction({ type: 'review', reviewer, expectedRevision: account.reviewRevision, reason, reference, confirmed });
  };
  return <form aria-label="รับรองสิทธิ์ฝ่ายขายตัวอย่าง" onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} className="text-blue-600" /> Admin รับรองสิทธิ์ใหม่</h2>
    <p className="text-sm text-slate-600">บัญชีที่ตรวจ: <strong>{account.name}</strong> · รุ่นสิทธิ์ {account.reviewRevision}</p>
    {!available && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
      {reviewer !== 'admin' ? 'Owner และ Sales ดูตัวอย่างได้ แต่รับรองสิทธิ์ไม่ได้'
        : account.banned ? 'บัญชียังถูกแบน ต้องปลดแบนก่อนรับรองสิทธิ์' : 'บัญชีมีสิทธิ์ฝ่ายขายแล้ว ไม่ต้องรับรองซ้ำ'}
    </p>}
    <fieldset disabled={!available} className="space-y-4">
      <label className="block text-sm font-semibold">เหตุผลที่เปิดสิทธิ์ใหม่ *
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required rows={3} className={fieldStyle} />
      </label>
      <label className="block text-sm font-semibold">หลักฐานอ้างอิงการตรวจ *
        <input value={reference} onChange={event => setReference(event.target.value)} maxLength={120} required className={fieldStyle} placeholder="เช่น บันทึกตรวจสอบ DEMO-001" />
      </label>
      <p className="text-xs text-slate-500">ใช้ข้อความสมมติเท่านั้น ห้ามใส่รหัสผ่าน คีย์ หรือข้อมูลส่วนตัวจริง</p>
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0" />
        ตรวจแล้วว่าบัญชีนี้เป็นคนที่รับรอง และควรได้รับสิทธิ์ฝ่ายขายคืน
      </label>
    </fieldset>
    <button type="submit" disabled={!canSubmit} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">รับรองและเปิดสิทธิ์ (ทดลอง)</button>
  </form>;
}

export default function AccountAccessDemo() {
  const [accounts, setAccounts] = useState(initialDemoAccounts);
  const [selectedId, setSelectedId] = useState('example-a');
  const [reviewer, setReviewer] = useState<DemoReviewer>('admin');
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const account = accounts.find(item => item.id === selectedId)!;
  const access = demoAccess(account);
  const act = (action: DemoAction) => {
    const result = applyDemoAction(account, action);
    setAccounts(previous => previous.map(item => item.id === selectedId ? result.account : item));
    setNotice({ message: result.message, error: result.error });
  };
  const reset = () => {
    setAccounts(initialDemoAccounts()); setSelectedId('example-a'); setReviewer('admin');
    setNotice({ message: 'เริ่มข้อมูลสมมติใหม่แล้ว ไม่มีข้อมูลจริงถูกลบ', error: false });
  };
  return <main lang="th" className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-8 sm:py-10">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-widest text-blue-600">BuildTrack · Development only</p>
          <h1 className="text-2xl font-bold sm:text-3xl">ทดลองการคืนสิทธิ์ฝ่ายขาย</h1>
          <p className="mt-2 text-sm text-slate-600">แบนบัญชี → ปลดแบน → Admin ตรวจและรับรองใหม่</p>
        </div>
        <button onClick={reset} className={`${buttonStyle} flex items-center gap-2`}><RotateCcw size={16} />เริ่มตัวอย่างใหม่</button>
      </header>
      <aside aria-label="ขอบเขตการทดลอง" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <FlaskConical size={22} className="shrink-0" />
        <div><p className="font-bold">ข้อมูลสมมติเท่านั้น — ไม่เชื่อม Supabase และไม่เปลี่ยนบัญชีจริง</p>
          <p className="mt-1">ทดลองได้โดยไม่ล็อกอิน ข้อมูลอยู่ในหน้านี้และหายเมื่อรีเฟรช ยังไม่ใช่ระบบเปิดสิทธิ์จริงหรือผลทดสอบความปลอดภัยของฐานข้อมูล</p></div>
      </aside>
      <Link href="/dev/account-access/directory" prefetch={false} className="inline-block text-sm font-semibold text-blue-700 underline">ลองหน้ารายการบัญชีและตัวกรองสถานะ →</Link>
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <label className="text-sm font-semibold">เลือกบัญชี Sales สมมติ
          <select className={fieldStyle} value={selectedId} onChange={event => { setSelectedId(event.target.value); setNotice(null); }}>
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">ทดลองมุมมองผู้ตรวจ
          <select className={fieldStyle} value={reviewer} onChange={event => { setReviewer(event.target.value as DemoReviewer); setNotice(null); }}>
            <option value="admin">Admin ตัวอย่าง (มีสิทธิ์จัดการบัญชี)</option>
            <option value="owner">Owner ตัวอย่าง</option><option value="sales">Sales ตัวอย่าง</option>
          </select>
        </label>
      </div>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${notice.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>{notice.message}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section aria-label="สถานะบัญชีตัวอย่าง" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-lg font-bold">{account.name}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <dt className="text-slate-500">บัญชี Auth</dt><dd className="font-semibold">{account.banned ? 'ถูกแบน' : 'ใช้ได้'}</dd>
              <dt className="text-slate-500">สิทธิ์ฝ่ายขาย</dt><dd className={`font-semibold ${account.crmActive ? 'text-emerald-700' : 'text-amber-700'}`}>{account.crmActive ? 'เปิดใช้งาน' : 'พักสิทธิ์ / รอรับรองใหม่'}</dd>
              <dt className="text-slate-500">เซสชันตัวอย่าง</dt><dd>{account.signedIn ? 'มีเซสชัน (ไม่ใช่หลักฐานสิทธิ์)' : 'ออกจากระบบแล้ว'}</dd>
              <dt className="text-slate-500">ใช้ CRM ด้วยเซสชันนี้</dt><dd>{access.canUseCrm ? 'ใช้ได้ในตัวอย่าง' : 'ใช้ไม่ได้ในตัวอย่าง'}</dd>
            </dl>
          </section>
          <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-100 p-5">
            <h2 className="font-bold">ตัวควบคุมสถานการณ์สมมติ</h2>
            <p className="mt-1 text-xs text-slate-600">ปุ่มต่อไปนี้แทนเหตุการณ์จากระบบ Auth ไม่ใช่สิทธิ์ที่เพิ่มให้ Admin / Owner / Sales ในแอปจริง</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className={buttonStyle} disabled={account.banned} onClick={() => act({ type: 'ban' })}>จำลองแบนบัญชี</button>
              <button className={buttonStyle} disabled={!account.banned} onClick={() => act({ type: 'unban' })}>จำลองปลดแบน</button>
              <button className={buttonStyle} disabled={!account.signedIn} onClick={() => act({ type: 'logout' })}>จำลองออกจากระบบ</button>
              <button className={buttonStyle} disabled={account.signedIn || account.banned} onClick={() => act({ type: 'login' })}>จำลองเข้าสู่ระบบ</button>
            </div>
          </section>
        </div>
        <ReviewForm key={`${account.id}:${account.reviewRevision}:${account.banned}:${reviewer}`} account={account} reviewer={reviewer} onAction={act} />
      </div>
      <section aria-label="ผลต่องานลูกค้า" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="font-bold">ผลต่องานลูกค้าในสถานการณ์นี้</h2>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div><h3 className="font-semibold">ตัวเลือกเจ้าของ Lead</h3><p className="mt-1 text-slate-600">{access.ownerEligible ? 'เลือกเป็นเจ้าของได้' : 'ไม่ให้เลือกเป็นเจ้าของใหม่'}</p></div>
          <div><h3 className="font-semibold">QR ของงาน</h3><p className="mt-1 text-slate-600">{access.ownerEligible ? 'ผ่านเงื่อนไขเจ้าของพร้อมทำงาน' : 'ไม่ผ่านเงื่อนไขเจ้าของพร้อมทำงาน'}</p></div>
          <div><h3 className="font-semibold">งานแจ้งเตือน</h3><p className="mt-1 text-slate-600">{access.ownerEligible ? 'เจ้าของพร้อมให้ระบบประมวลผลงาน' : 'ระบบประมวลผลต้องพักงานและถอนแจ้งเตือนที่เกี่ยวข้อง'}</p></div>
        </div>
        <p className="mt-4 text-xs text-slate-500">หน้านี้ไม่สร้าง Lead / QR หรือส่งแจ้งเตือนจริง เงื่อนไขอายุ QR, Visit และเวลาทำงานยังต้องตรวจในระบบจริงแยกต่างหาก</p>
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">ประวัติ Lead / จอง / ยกเลิก / โอนเดิมไม่ถูกลบ และไม่ย้ายเจ้าของงานอัตโนมัติ</p>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-bold"><History size={18} />รายการที่ลองในหน้านี้ · {account.name}</h2>
        <p className="mt-1 text-xs text-slate-500">ไม่ใช่บันทึกตรวจสอบของฐานข้อมูลจริง</p>
        {account.events.length === 0 ? <p className="mt-4 text-sm text-slate-500">ยังไม่ได้ทำรายการ ลองแบนแล้วปลดแบนเพื่อดูว่าสิทธิ์ไม่กลับมาเอง</p>
          : <ol className="mt-4 space-y-3">{[...account.events].reverse().map(event => <li key={event.sequence} className="break-words border-l-2 border-blue-200 pl-4 text-sm">
            <p className="font-semibold">{event.sequence}. {event.label}</p>
            {event.reason && <p className="mt-1 text-slate-600">เหตุผล: {event.reason}</p>}
            {event.reference && <p className="text-slate-600">อ้างอิง: {event.reference}</p>}
          </li>)}</ol>}
      </section>
    </div>
  </main>;
}
