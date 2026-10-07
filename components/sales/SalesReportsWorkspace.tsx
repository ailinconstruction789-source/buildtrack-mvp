'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { salesReportsApi, SalesReportsApiError, type SalesReportsApi } from '@/lib/sales/salesReportsClient';
import { formatReportMoney, parseSalesReportScope, type SalesReportScope, type SalesReportSnapshot } from '@/lib/sales/salesReportsContracts';
import { SALE_STAGES, type SaleStage } from '@/lib/sales/workflow';

interface Props { initialScope?: SalesReportScope; onBack?: () => void; api?: SalesReportsApi }
const defaultScope: SalesReportScope = { projectName: null, fromDate: null, toDate: null };
const field = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
const button = 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50';
const stages: Record<SaleStage, string> = {
  booked: 'จอง', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร',
  loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ถูกปฏิเสธ (ยังไม่ยกเลิก)', loan_approved: 'กู้อนุมัติ',
  transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบแล้ว', cancelled: 'ยกเลิก',
};
export default function SalesReportsWorkspace(props: Props) {
  return <ReportSession key={JSON.stringify(props.initialScope ?? defaultScope)} {...props} />;
}
function ReportSession({ initialScope = defaultScope, onBack, api = salesReportsApi }: Props) {
  const [scope, setScope] = useState(initialScope), [draft, setDraft] = useState(initialScope), [revision, setRevision] = useState(0);
  const [filterError, setFilterError] = useState('');
  const [loaded, setLoaded] = useState<{ key: string; data?: SalesReportSnapshot; error?: string }>({ key: '' });
  const [projects, setProjects] = useState<SalesReportSnapshot['projects']>([]);
  const key = JSON.stringify([scope, revision]), data = loaded.key === key ? loaded.data : undefined, error = loaded.key === key ? loaded.error : undefined;
  useEffect(() => {
    let cancelled = false;
    api.read(scope).then(snapshot => {
      if (!cancelled) { setProjects(snapshot.projects); setLoaded({ key, data: snapshot }); }
    }).catch(failure => {
      if (!cancelled) { setProjects([]); setLoaded({ key, error: failure instanceof SalesReportsApiError ? failure.message : 'โหลดรายงานไม่ได้ กรุณาลองใหม่' }); }
    });
    return () => { cancelled = true; };
  }, [api, key, scope]);
  const apply = () => {
    try { setScope(parseSalesReportScope(draft)); setRevision(value => value + 1); setFilterError(''); }
    catch { setFilterError('กรุณาระบุวันที่เริ่ม–สิ้นสุดให้ครบและเรียงลำดับ หรือเว้นว่างทั้งคู่เพื่อดูทั้งหมด'); }
  };
  const projectLink = `/sales-crm/projects${scope.projectName ? `?${new URLSearchParams({ projectName: scope.projectName, tab: 'all' })}` : ''}`;
  return <main className="mx-auto max-w-6xl space-y-5 bg-slate-50/50 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div><h1 className="text-2xl font-bold text-slate-900">รายงานจองจาก Lead ส่วนกลาง</h1>
        <p className="mt-2 text-sm text-slate-500">รวมข้อมูลทั้งชุด ไม่ใช่เฉพาะ 50 รายการที่เปิดดู · เก็บทุกรอบจองและการยกเลิก</p></div>
      <div className="flex flex-wrap gap-2">{onBack && <button type="button" className={button} onClick={onBack}>← กลับหน้าก่อนหน้า</button>}
        <Link className={button} href="/sales-crm" prefetch={false}>Lead ส่วนกลาง →</Link></div>
    </header>
    <form aria-label="ตัวกรองรายงาน" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={event => { event.preventDefault(); apply(); }}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">โครงการ
          <select className={field} value={draft.projectName ?? ''} onChange={event => setDraft(value => ({ ...value, projectName: event.target.value || null }))}>
            <option value="">ทุกโครงการ (รวม Lead ที่ยังไม่เลือกโครงการ)</option>
            {projects.map(project => <option key={project.name} value={project.name}>{project.name}</option>)}
            {draft.projectName && !projects.some(project => project.name === draft.projectName) && <option value={draft.projectName}>{draft.projectName}</option>}
          </select></label>
        <label className="flex flex-col gap-1 text-sm">วันที่เริ่มเป็น Lead ตั้งแต่ (ค.ศ.)
          <input className={field} type="date" min="0001-01-01" max="9999-12-31" value={draft.fromDate ?? ''} onChange={event => setDraft(value => ({ ...value, fromDate: event.target.value || null }))} /></label>
        <label className="flex flex-col gap-1 text-sm">ถึงวันที่ (ค.ศ.)
          <input className={field} type="date" min="0001-01-01" max="9999-12-31" value={draft.toDate ?? ''} onChange={event => setDraft(value => ({ ...value, toDate: event.target.value || null }))} /></label>
        <button className={`${button} text-blue-700`} type="submit">แสดงรายงาน</button>
        <button className={button} type="button" onClick={() => {
          const next = { projectName: draft.projectName, fromDate: null, toDate: null };
          setDraft(next); setScope(next); setRevision(value => value + 1); setFilterError('');
        }}>ทุกวันที่ Lead</button>
      </div>
      {filterError && <p role="alert" className="text-sm text-rose-700">{filterError}</p>}
      <p className="text-xs text-slate-500">ใช้วัน Lead เดิมตามเวลาไทย รวมวันเริ่ม–สิ้นสุด แล้วดูผลจองปัจจุบันของลูกค้ากลุ่มนั้น ไม่ใช่ยอดเหตุการณ์จอง/โอนที่เกิดในเดือน และไม่ใช่ภาพย้อนหลัง ณ วันสิ้นสุด</p>
    </form>
    {!data && !error && <p role="status" className="rounded-xl border bg-white p-5">กำลังรวมรายงาน…</p>}
    {error && <section role="alert" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
      <p>{error}</p><p className="text-sm">ไม่แสดงศูนย์หรือรายงานเก่าทดแทนเมื่อข้อมูลยังตรวจสอบไม่ได้</p>
      <button type="button" className={button} onClick={() => setRevision(value => value + 1)}>ลองโหลดใหม่</button>
    </section>}
    {data && <section aria-label="ผลรายงาน" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div>
        <h2 className="text-xl font-bold text-slate-900">{data.projectName ?? 'ทุกโครงการ'}</h2>
        <p className="text-sm text-slate-500">{data.fromDate ? `กลุ่ม Lead วันที่ ${data.fromDate} ถึง ${data.toDate} (เวลาไทย)` : 'ทุกวันที่ Lead รวมข้อมูลที่ไม่ทราบวันเริ่ม'}</p>
      </div><button type="button" className={button} onClick={() => setRevision(value => value + 1)}>โหลดรายงานล่าสุด</button></div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ['ลูกค้าไม่ซ้ำ', data.totals.customers, 'นับตามรหัสลูกค้า ไม่รวมคนจากชื่อหรือเบอร์'],
          ['ความสนใจโครงการ', data.totals.interests, 'ลูกค้าหนึ่งคนสนใจหลายโครงการได้'],
          ['จองทั้งหมด', data.totals.bookingRounds, 'รวมทุกรอบ รวมรอบที่ยกเลิก'],
          ['ยกเลิกจอง', data.totals.cancelledRounds, 'ยังเก็บเป็นประวัติ ไม่ลบออก'],
          ['จองสุทธิ (หลัง)', data.totals.netBookedHomes, 'จองทั้งหมด − ยกเลิก รวมบ้านที่โอนแล้ว'],
          ['อยู่ระหว่างดำเนินการ', data.totals.inProgress, 'ยังไม่โอน และไม่ถูกยกเลิก'],
          ['โอน / ส่งมอบแล้ว', data.totals.transferred, 'เป็นส่วนหนึ่งของจองสุทธิ ไม่บวกยอดซ้ำ'],
        ] as const).map(([label, value, note]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">{label}</dt><dd className="mt-2 text-2xl font-bold text-slate-900">{value.toLocaleString('th-TH')}</dd>
          <p className="mt-2 text-xs text-slate-500">{note}</p></div>)}
      </dl>
      <section aria-label="มูลค่าที่มีหลักฐาน" className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h3 className="font-bold text-blue-950">มูลค่าราคาขายบ้านของจองสุทธิ — เฉพาะที่ทราบราคา</h3>
        <p className="mt-2 break-words text-2xl font-bold text-blue-900">{data.totals.netBookedHomes > 0 && data.totals.unknownNetSaleValueCount === data.totals.netBookedHomes ? 'ไม่ทราบมูลค่า' : formatReportMoney(data.totals.knownNetSaleValue)}</p>
        <p className="mt-2 text-sm text-blue-900">ยังไม่ทราบราคา {data.totals.unknownNetSaleValueCount.toLocaleString('th-TH')} รายการ — ไม่เติมเป็นศูนย์ และไม่รวมในยอดเงินข้างต้น</p>
        <p className="mt-1 text-xs text-blue-800">เป็นราคาขายหลังส่วนลด ไม่ใช่เงินจองที่รับ กระแสเงินสด หรือรายได้ที่รับรู้ทางบัญชี</p>
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="mb-3 font-bold text-slate-900">สถานะปัจจุบันของทุกรอบจอง</h3>
          <table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">สถานะ</th><th className="py-2 text-right">รายการ</th></tr></thead>
            <tbody>{SALE_STAGES.map(stage => <tr className="border-b border-slate-100" key={stage}><td className="py-2">{stages[stage]}</td><td className="py-2 text-right font-semibold">{data.stageCounts[stage].toLocaleString('th-TH')}</td></tr>)}</tbody>
          </table></section>
        <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h3 className="font-bold">ความครบถ้วนของข้อมูล</h3>
          <p>ไม่ทราบวันที่เริ่มเป็น Lead ในขอบเขตโครงการนี้: {data.coverage.unknownLeadDateCustomers.toLocaleString('th-TH')} ลูกค้า (ก่อนกรองช่วงวัน)</p>
          <p>ตัดออกจากช่วงวันที่ที่เลือกเพราะไม่ทราบวัน Lead: {data.coverage.excludedUnknownLeadDateCustomers.toLocaleString('th-TH')} ลูกค้า</p>
          <p>รอบจองในผลนี้ที่ไม่ทราบวันจอง: {data.totals.unknownBookedAtRounds.toLocaleString('th-TH')} รายการ</p>
          <p>รอบยกเลิกในผลนี้ที่ไม่ทราบวันยกเลิก: {data.totals.unknownCancelledAtRounds.toLocaleString('th-TH')} รายการ</p>
          <p>ไม่ใช้วันที่นำเข้าหรือวันที่สร้างแถวแทนวันที่จริง และไม่ถือว่าข้อมูลขาดหมายถึง Sales ไม่ทำงาน</p>
        </section>
      </div>
      <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">รายงานนี้ยังไม่ให้คะแนน KPI รายบุคคล ไม่ยกเครดิตย้อนหลังให้เจ้าของปัจจุบัน และไม่อนุมาน Visit / ผลกู้จากการจองหรือการโอน</p>
      <Link href={projectLink} prefetch={false} className="inline-block text-sm font-semibold text-blue-700 underline">เปิดรายละเอียดการจองและประวัติโครงการ (ทุกวันที่ Lead) →</Link>
    </section>}
  </main>;
}
