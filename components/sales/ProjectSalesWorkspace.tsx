'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { projectSalesApi, ProjectSalesApiError, type ProjectSalesApi } from '@/lib/sales/projectSalesClient';
import type { ProjectSalesScope, ProjectSalesSnapshot, ProjectSalesTab } from '@/lib/sales/projectSalesContracts';
import { bookingRoundLabel, displayBookingHistoryDate } from '@/lib/sales/importedBookingHistory';
import type { SaleStage } from '@/lib/sales/workflow';
import { LeadTrackerTable } from './LeadTrackerPresentation';
import PostBookingLink from './PostBookingLink';
import { useSalesReportsEnabled } from './SalesWorkspaceModeProvider';
import ProjectSalesMap from './ProjectSalesMap';

interface Props {
  initialProjectName?: string | null;
  initialTab?: ProjectSalesTab;
  onBack?: () => void;
  api?: ProjectSalesApi;
  initialView?: 'list' | 'map';
}
const tabs: ReadonlyArray<{ value: ProjectSalesTab; label: string }> = [
  { value: 'booked', label: 'ลูกค้าจอง / อยู่ระหว่างดำเนินการ' },
  { value: 'transferred', label: 'โอนแล้ว / ส่งมอบ' },
  { value: 'cancelled', label: 'ประวัติยกเลิก' },
  { value: 'all', label: 'ประวัติทุกสถานะ' },
];
const stageLabels: Record<SaleStage, string> = {
  booked: 'จอง', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร',
  loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ถูกปฏิเสธ', loan_approved: 'กู้อนุมัติ',
  transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบ', cancelled: 'ยกเลิก',
};
const fieldClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
const buttonClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
const columns = ['No.', 'ลูกค้า / เบอร์โทร', 'ผู้ดูแลปัจจุบัน', 'แปลง / รอบจอง', 'สถานะ / หลักฐานวันที่', 'ราคา / เงินจอง', 'ประวัติอ้างอิง'];
const money = (value: number | null) => value === null ? 'ไม่ทราบ' : `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
const historyDate = (value: string | null | undefined) => value ? value.split('-').reverse().join('/') : 'ไม่ทราบ';

export default function ProjectSalesWorkspace(props: Props) {
  return <ProjectSalesSession key={JSON.stringify([props.initialProjectName ?? null, props.initialTab ?? 'booked', props.initialView ?? 'list'])} {...props} />;
}

function ProjectSalesSession({ initialProjectName = null, initialTab = 'booked', initialView = 'list', onBack, api = projectSalesApi }: Props) {
  const reportsEnabled = useSalesReportsEnabled();
  const [view, setView] = useState(initialView);
  const [scope, setScope] = useState<ProjectSalesScope>({ projectName: initialProjectName, tab: initialTab, query: '', page: 0 });
  const [queryDraft, setQueryDraft] = useState(''), [queryError, setQueryError] = useState(''), [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; snapshot?: ProjectSalesSnapshot; error?: string }>({ key: '' });
  const [projects, setProjects] = useState<ProjectSalesSnapshot['projects']>([]);
  const key = JSON.stringify([scope, refresh]);
  const snapshot = loaded.key === key ? loaded.snapshot : undefined;
  const readError = loaded.key === key ? loaded.error : undefined;
  const loading = !snapshot && !readError;

  useEffect(() => {
    let cancelled = false;
    api.read(scope).then(value => {
      if (cancelled) return;
      setProjects(value.projects);
      setLoaded({ key, snapshot: value });
    }).catch(failure => {
      if (cancelled) return;
      setProjects([]);
      setLoaded({ key, error: failure instanceof ProjectSalesApiError ? failure.message : 'อ่านข้อมูลไม่ได้ กรุณาลองใหม่อีกครั้ง' });
    });
    return () => { cancelled = true; };
  }, [api, key, scope]);

  const chooseProject = (projectName: string) => {
    setQueryDraft(''); setQueryError('');
    setScope(current => ({ projectName: projectName || null, tab: current.tab, query: '', page: 0 }));
  };
  const search = () => {
    const query = queryDraft.trim();
    const length = Array.from(query).length;
    if (length === 1 || length > 200) { setQueryError('กรุณาค้นหา 2–200 ตัวอักษร หรือเว้นว่างเพื่อดูทั้งหมด'); return; }
    if (!scope.projectName) return;
    setQueryError(''); setScope(current => ({ ...current, query, page: 0 }));
  };

  return <main className="mx-auto max-w-[1600px] space-y-4 bg-slate-50/50 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div><h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ลูกค้าจองและประวัติโครงการ</h1>
        <p className="mt-1 text-sm text-slate-500">เชื่อมลูกค้าคนเดิมจาก Lead ส่วนกลาง · แยกทุกแปลงและทุกรอบจอง · อ่านข้อมูลอย่างเดียว</p></div>
      <div className="flex flex-wrap gap-3">
        {onBack && <button type="button" onClick={onBack} className={buttonClass}>← กลับหน้าก่อนหน้า</button>}
        <Link href="/sales-crm" prefetch={false} className={`${buttonClass} text-blue-700`}>Lead ส่วนกลาง →</Link>
        {reportsEnabled && snapshot && !snapshot.prepared && <Link href={`/sales-crm/reports${scope.projectName ? `?${new URLSearchParams({ projectName: scope.projectName })}` : ''}`} prefetch={false} className={buttonClass}>รายงานจองจากส่วนกลาง →</Link>}
      </div>
    </header>

    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      ผังแปลงเชื่อมข้อมูลจองจากส่วนกลางแล้ว · แบบสอบถาม เตรียมบ้าน และโมดูลโครงการส่วนอื่นยังไม่เปิดในรอบนี้
    </p>

    {snapshot?.prepared && <section aria-label="ตัวอย่างข้อมูลเตรียมนำเข้า" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <h2 className="font-bold">ตัวอย่างข้อมูลเตรียมนำเข้า — อ่านอย่างเดียว ยังไม่ใช่รายการขายที่เปิดใช้งาน</h2>
      <p>สำเนาชีตวันที่ {historyDate(snapshot.prepared.snapshotDate)} (ค.ศ.) · ยังไม่รวมในรายงานปฏิบัติงาน / KPI</p>
      <p>ประวัติที่ยังไม่เชื่อมลูกค้า / โครงการและรอ Admin ตรวจทั้งชุด: {snapshot.prepared.pendingUnlinkedHistories} รายการ — ไม่รวมในตารางนี้</p>
      <p>วันที่ประวัติแสดงตามหลักฐานในชีตเท่านั้น ไม่ทราบเวลาเกิดเหตุการณ์ และไม่ใช้เวลานำเข้าแทน</p>
    </section>}

    <section aria-label="เลือกโครงการและค้นหาการจอง" className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold text-slate-600">โครงการ
          <select className={fieldClass} value={scope.projectName ?? ''} onChange={event => chooseProject(event.target.value)}>
            <option value="">เลือกโครงการ</option>
            {projects.map(project => <option key={project.name} value={project.name}>{project.name}</option>)}
            {scope.projectName && !projects.some(project => project.name === scope.projectName) && <option value={scope.projectName}>{scope.projectName}</option>}
          </select>
        </label>
        {view === 'list' && <form aria-label="ค้นหาการจองในโครงการ" className="flex min-w-64 flex-1 items-end gap-2" onSubmit={event => { event.preventDefault(); search(); }}>
          <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-slate-600">ค้นหาชื่อ เบอร์โทร หรือแปลง
            <input value={queryDraft} disabled={!scope.projectName} onChange={event => { setQueryDraft(event.target.value); setQueryError(''); }}
              className={fieldClass} placeholder="อย่างน้อย 2 ตัวอักษร…" maxLength={400} />
          </label>
          <button disabled={!scope.projectName} type="submit" className={buttonClass}>ค้นหา</button>
          <button disabled={!scope.projectName || (!scope.query && !queryDraft)} type="button" className={buttonClass} onClick={() => {
            setQueryDraft(''); setQueryError(''); setScope(current => ({ ...current, query: '', page: 0 }));
          }}>ล้างค้นหา</button>
        </form>}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="รูปแบบการแสดงโครงการ">
        <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} className={`${buttonClass} ${view === 'map' ? 'border-blue-600 text-blue-700' : ''}`}>ผังโครงการ (Project Map)</button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`${buttonClass} ${view === 'list' ? 'border-blue-600 text-blue-700' : ''}`}>รายการจองและประวัติ</button>
      </div>
      {queryError && <p role="alert" className="text-sm text-rose-700">{queryError}</p>}
      {view === 'list' && <div role="tablist" aria-label="สถานะการจอง" className="flex flex-wrap gap-2">
        {tabs.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={scope.tab === tab.value} disabled={!scope.projectName}
          onClick={() => { setQueryError(''); setScope(current => ({ ...current, tab: tab.value, page: 0 })); }}
          className={`rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-40 ${scope.tab === tab.value ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
          {tab.label}</button>)}
      </div>}
      <p className="text-xs text-slate-500">{view === 'map' ? 'ผังแสดงทุกแปลงโดยไม่ใช้ตัวกรองหรือตารางหน้าปัจจุบัน · กดแปลงเพื่อดูผู้จองและประวัติ' : 'ค้นหาจากรายการทั้งหมดในโครงการและสถานะที่เลือก ไม่ได้ค้นหาเฉพาะหน้าที่โหลด · การรับ Lead และติดตามลูกค้าอยู่ที่ส่วนกลาง'}</p>
    </section>

    {loading && <p role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600">กำลังโหลดข้อมูลโครงการ…</p>}
    {readError && <section role="alert" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
      <p>{readError}</p><p className="text-sm">ยังไม่แสดงรายการเก่าแทนข้อมูลล่าสุด และไม่อ่านจากระบบเก่าทดแทน</p>
      <button type="button" className={buttonClass} onClick={() => setRefresh(value => value + 1)}>ลองโหลดใหม่</button>
    </section>}
    {snapshot && !snapshot.projectName && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600">
      {snapshot.projects.length ? 'เลือกโครงการเพื่อดูรายการจองและประวัติ' : 'ยังไม่มีโครงการที่บัญชีนี้เข้าถึงได้'}
    </p>}
    {view === 'map' && snapshot?.projectName && !snapshot.prepared && <ProjectSalesMap key={snapshot.projectName} projectName={snapshot.projectName} />}
    {view === 'map' && snapshot?.prepared && <p role="status">ข้อมูลเตรียมนำเข้ายังใช้แสดงสถานะแปลงจริงไม่ได้</p>}
    {view === 'list' && snapshot && snapshot.projectName && <section aria-label={`รายการจองโครงการ ${snapshot.projectName}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div><h2 className="text-lg font-bold text-slate-900">{snapshot.projectName}</h2>
          <p className="text-xs text-slate-500">หน้า {snapshot.page + 1} · แสดง {snapshot.rows.length} รายการในหน้านี้ · ไม่เกิน 50 รายการต่อหน้า · ไม่ใช่ยอดรวม / KPI</p>
          {snapshot.query && <p className="mt-1 text-sm text-blue-700">ผลค้นหา: {snapshot.query}</p>}</div>
        <button type="button" className={buttonClass} onClick={() => setRefresh(value => value + 1)}>โหลดล่าสุด</button>
      </div>
      <LeadTrackerTable columns={columns}>
        {!snapshot.rows.length && <tr><td colSpan={columns.length} className="p-10 text-center text-slate-500">ไม่พบการจองตามเงื่อนไขนี้</td></tr>}
        {snapshot.rows.map((sale, index) => <tr key={sale.saleId} aria-label={`การจอง ${sale.saleId}`} className="align-top transition-colors hover:bg-slate-50/80">
          <td className="p-3 font-semibold text-slate-400">{snapshot.page * 50 + index + 1}</td>
          <td className="min-w-44 p-3"><p className="font-bold text-slate-900">{sale.customerName}</p><p className="mt-1 font-mono text-slate-600">{sale.phone ?? 'ไม่ทราบเบอร์โทร'}</p>
            <p className="mt-2 break-all text-[10px] text-slate-400">รหัสลูกค้า {sale.customerId}</p></td>
          <td className="min-w-32 p-3 text-slate-600"><p>{sale.ownerName}{sale.ownerUserId === snapshot.actor.userId ? ' (คุณ)' : ''}</p><p className="mt-1 text-[10px] text-slate-400">ผู้ดูแลโครงการปัจจุบัน ไม่ใช่ผู้รับผลงานย้อนหลัง</p></td>
          <td className="min-w-36 p-3"><p className="font-semibold text-indigo-700">{sale.plotName ?? sale.plotId ?? 'ไม่ทราบแปลง'}</p>
            {sale.plotName && sale.plotId && <p className="mt-1 break-all text-[10px] text-slate-400">รหัสแปลง {sale.plotId}</p>}
            <p className="mt-2 text-slate-600">{sale.bookingRound === null ? 'รอบจอง: ไม่ทราบ' : `รอบจอง ${sale.bookingRound}`}</p></td>
          <td className="min-w-52 p-3"><span className={`inline-block rounded-lg px-2 py-1 font-semibold ${sale.stage === 'cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-800'}`}>{stageLabels[sale.stage]}</span>
            <p className="mt-2 text-slate-600">วันที่จอง: {snapshot.prepared ? historyDate(sale.historyEvidence?.bookedDate) : displayBookingHistoryDate(sale.bookedAt, sale.importedHistory?.bookedDate)}</p>
            {snapshot.prepared && (sale.stage === 'transferred' || sale.stage === 'handover') && <p className="mt-2 text-slate-600">วันที่โอน: {historyDate(sale.historyEvidence?.transferredDate)}</p>}
            {sale.importedHistory && (sale.stage === 'transferred' || sale.stage === 'handover') && <p className="mt-2 text-slate-600">วันที่โอนตามข้อมูลเดิม: {displayBookingHistoryDate(null, sale.importedHistory.transferredDate)}</p>}
            {sale.stage === 'cancelled' && <div className="mt-2 space-y-1 rounded-lg bg-rose-50 p-2 text-rose-800">
              <p>วันที่ยกเลิก: {snapshot.prepared ? historyDate(sale.historyEvidence?.cancelledDate) : displayBookingHistoryDate(sale.cancelledAt, sale.importedHistory?.cancelledDate)}</p><p className="whitespace-pre-wrap break-words">เหตุผล: {sale.cancellationReason ?? 'ไม่ทราบ'}</p>
            </div>}</td>
          <td className="min-w-52 space-y-1 p-3 text-slate-600"><p>ราคาก่อนส่วนลด: {money(sale.listPrice)}</p><p>ส่วนลด: {money(sale.discountAmount)}</p>
            <p className="font-semibold text-slate-900">ราคาขายบ้าน: {money(sale.salePrice)}</p><p>เงินจองที่รับ: {money(sale.depositAmount)}</p>
            <p>การชำระ: {sale.paymentMethod === 'cash' ? 'เงินสด' : sale.paymentMethod === 'mortgage' ? 'กู้ธนาคาร' : 'ไม่ทราบ'}</p></td>
          <td className="min-w-52 max-w-64 space-y-2 p-3"><p className="break-all text-[10px] text-slate-400">รหัสจอง {sale.saleId}</p>
            {sale.previousSaleId && <p className="break-all text-[10px] text-slate-500">อ้างอิงจองเดิม {sale.previousSaleId}</p>}
            {snapshot.prepared && sale.historyEvidence && <><p className="text-xs text-slate-600">หลักฐาน: แถว {sale.historyEvidence.sourceRow} ในสำเนาชีต</p>
              {sale.historyEvidence.held && <p className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-900">พักรายการไว้ รอ Admin ตรวจ</p>}</>}
            {sale.importedHistory && <p className="text-xs text-slate-600">ประวัตินำเข้า · อ้างอิงแถว {sale.importedHistory.sourceRow} ในชีต · ไม่ใช้วันนำเข้าแทนวันเกิดเหตุการณ์</p>}
            {!snapshot.prepared && <><Link href={`/sales-crm/bookings?customerId=${encodeURIComponent(sale.customerId)}`} prefetch={false} aria-label={`ประวัติการจองของ ${sale.customerName} ${bookingRoundLabel(sale.bookingRound)}`}
              className="block rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 font-semibold text-blue-700 hover:bg-blue-100">ประวัติการจองลูกค้า →</Link>
            {!sale.importedHistory && <PostBookingLink saleId={sale.saleId} label={`งานสัญญา / สินเชื่อ / โอน ${bookingRoundLabel(sale.bookingRound)} →`} />}</>}</td>
        </tr>)}
      </LeadTrackerTable>
      <div className="flex items-center justify-between gap-3">
        <button type="button" disabled={scope.page === 0} className={buttonClass} onClick={() => setScope(current => ({ ...current, page: current.page - 1 }))}>หน้าก่อนหน้า</button>
        <span className="text-xs text-slate-500">หน้า {snapshot.page + 1}</span>
        <button type="button" disabled={!snapshot.hasMore} className={buttonClass} onClick={() => setScope(current => ({ ...current, page: current.page + 1 }))}>หน้าถัดไป</button>
      </div>
      <p className="px-1 text-xs text-slate-500">หนึ่งแถวคือหนึ่งรายการจอง ไม่รวมรอบเก่าเข้าด้วยกัน · ประวัติยกเลิกยังอยู่ครบ · ข้อมูลเก่าที่ไม่มีหลักฐานแสดง “ไม่ทราบ”</p>
      <p className="px-1 text-xs text-slate-500">เลขรอบคือลำดับที่ระบบบันทึกได้ ไม่ใช่จำนวนครั้งที่ลูกค้าเคยจองทั้งหมดเมื่อประวัติเก่าไม่ทราบรอบ</p>
    </section>}
  </main>;
}
