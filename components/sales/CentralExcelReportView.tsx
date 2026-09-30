'use client';

import React, { useMemo, useState } from 'react';
import { BarChart3, Building2, Calendar, ChevronDown, ChevronUp, RefreshCw, TrendingUp, Users, X } from 'lucide-react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
import type { SaleStage } from '@/lib/sales/workflow';
import { bangkokReportDay, buildExcelReport, formatReportMoney, sumReportMoney, type ExcelSaleRow, type ExcelStockRow } from '@/lib/sales/excelReportMetrics';

interface Props {
  data: ExcelReportData;
  surface: 'dashboard' | 'summary';
  projectName: string | null;
  onProjectChange: (name: string | null) => void;
  onRefresh: () => void;
}
const panel = 'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm';
const cell = 'whitespace-nowrap p-3';
const stockLabels = { available: 'ว่าง', booked: 'รอโอน', transferred: 'โอนแล้ว', unknown: 'ต้องตรวจสอบ' };
const stageLabels: Record<SaleStage, string> = { booked: 'จองแล้ว', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร', loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ไม่ผ่าน', loan_approved: 'กู้อนุมัติ', transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบ', cancelled: 'ยกเลิกจอง' };
const dayLabel = (day: string | null) => day ?? 'ไม่ทราบ';
const money = formatReportMoney;
function Stat({ label, value, tone = 'text-blue-900' }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-gray-600">{label}</span><span className={`text-xl font-black ${tone}`}>{value}</span></div>;
}
function EventList({ title, rows, red = false }: { title: string; rows: ExcelSaleRow[]; red?: boolean }) {
  return <div><h3 className={`mb-3 text-center text-xs font-bold ${red ? 'text-red-600' : 'text-slate-700'}`}>{title}</h3>
    <ul className={`space-y-1 text-xs ${red ? 'text-red-600' : 'text-sky-700'}`}>{rows.map(({ sale }) => <li key={sale.saleId}>{sale.projectName} / {sale.plotName ?? 'ไม่ทราบแปลง'}</li>)}</ul>
    {!rows.length && <p className="text-center text-xs text-slate-400">ไม่มีรายการที่ทราบวันที่ในช่วงนี้</p>}
  </div>;
}
function StockTable({ stocks }: { stocks: ExcelStockRow[] }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
    <table aria-label="ตารางสรุปฝั่งขาย" className="min-w-[1200px] w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['แปลง', 'ลูกค้า', 'สถานะ', 'เซลล์รับผิดชอบ', 'ราคาขายเซล (Sale)', 'ราคาตั้ง (Base)', 'ราคาประเมินทะเบียนแปลง', 'วันโอนคาดการณ์', 'วันโอนจริง'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{stocks.map(row => <tr key={`${row.projectName}:${row.plotId}`} className="hover:bg-slate-50">
        <td className={`${cell} font-bold text-slate-700`}>{row.plotName}<span className="block text-xs font-normal text-slate-400">{row.projectName}</span></td>
        <td className={cell}>{row.sale?.customerName ?? (row.status === 'available' ? 'ไม่มีลูกค้า' : 'ต้องตรวจสอบ')}</td>
        <td className={cell}><span className={`rounded-lg px-2 py-1 text-xs font-bold ${row.status === 'transferred' ? 'bg-blue-100 text-blue-700' : row.status === 'booked' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{stockLabels[row.status]}</span></td>
        <td className={cell}>{row.sale?.ownerName ?? '—'}</td>
        <td className={`${cell} bg-emerald-50/30 font-bold text-emerald-700`}>{row.sale ? money(row.sale.salePrice) : row.status === 'available' ? '—' : 'ไม่ทราบ'}</td>
        <td className={cell}>{money(row.basePrice)}</td>
        <td className={`${cell} bg-rose-50/30 text-rose-600`}>{money(row.appraisalPrice)}</td>
        <td className={cell}>{row.status === 'booked' ? dayLabel(row.expectedTransferDate) : '—'}</td>
        <td className={`${cell} bg-blue-50/30 font-bold text-blue-700`}>{row.status === 'transferred' ? dayLabel(row.transferredDate) : '—'}</td>
      </tr>)}{!stocks.length && <tr><td colSpan={9} className="p-8 text-center text-slate-500">ไม่มีแปลงบ้านในขอบเขตนี้</td></tr>}</tbody>
    </table>
  </div>;
}

/** Presentation only. All inputs come from the authenticated central reader; no legacy queries or writes. */
export default function CentralExcelReportView({ data, surface, projectName, onProjectChange, onRefresh }: Props) {
  const [cutoff, setCutoff] = useState(() => bangkokReportDay(data.loadedAt));
  const [cumulativeYear, setCumulativeYear] = useState(() => bangkokReportDay(data.loadedAt).slice(0, 4));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showBreakdown, setShowBreakdown] = useState(false);
  const report = useMemo(() => buildExcelReport(data, projectName, cutoff, cumulativeYear), [data, projectName, cutoff, cumulativeYear]);
  const year = cutoff.slice(0, 4);
  const activeStocks = report.stocks.filter(row => row.status === 'booked' || row.status === 'transferred');
  const saleTotal = report.unknownStock > 0 ? null : sumReportMoney(activeStocks.map(row => row.sale?.salePrice ?? null));
  const baseTotal = sumReportMoney(report.stocks.map(row => row.basePrice));
  const appraisalTotal = sumReportMoney(report.stocks.map(row => row.appraisalPrice));
  const stockCount = (status: ExcelStockRow['status']) => report.stocks.filter(row => row.status === status).length;
  const stockValue = (status: ExcelStockRow['status']) => sumReportMoney(report.stocks.filter(row => row.status === status).map(row => row.basePrice));
  const monthlyProjects = report.groups.map(group => ({ project: group.projectName,
    booked: report.monthly.booked.filter(row => row.sale.projectName === group.projectName).length,
    transferred: report.monthly.transferred.filter(row => row.sale.projectName === group.projectName).length }));
  const toggle = (name: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  return <div className="h-full overflow-y-auto bg-[#f8fafc]">
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">
      <header className={`${panel} flex flex-wrap items-center justify-between gap-5`}>
        <div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-900 font-serif text-2xl font-bold text-white">A</div><div>
          <h1 className="text-2xl font-black tracking-tight text-blue-900">{surface === 'dashboard' ? `Monthly Sale Report ${year}` : 'ตารางสรุปฝั่งขาย (Sales Summary)'}</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">SOMSAMAI PROPERTY COMPANY LIMITED</p>
        </div></div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">เลือกโครงการ: <select aria-label="เลือกโครงการ" value={projectName ?? ''} onChange={event => onProjectChange(event.target.value || null)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-800">
            <option value="">ทุกโครงการ</option>{data.projects.map(project => <option key={project.map.projectName} value={project.map.projectName}>{project.map.projectName}</option>)}
          </select></label>
          {surface === 'dashboard' && <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm"><Calendar size={18} className="text-blue-600"/><span>ข้อมูลเหตุการณ์ถึง</span><input aria-label="ข้อมูลเหตุการณ์ถึงวันที่" type="date" value={cutoff} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) { setCutoff(event.target.value); setCumulativeYear(event.target.value.slice(0, 4)); } }} className="bg-transparent font-bold"/></label>}
          <button onClick={onRefresh} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-blue-700"><RefreshCw size={16}/>โหลดใหม่</button>
        </div>
      </header>

      <section aria-label="ขอบเขตข้อมูลรายงาน" className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p>ข้อมูลจาก Lead–การจองส่วนกลางเท่านั้น · สถานะแปลงเป็นปัจจุบัน ณ {bangkokReportDay(data.loadedAt)} ไม่ใช่ภาพย้อนหลังตามวันที่เลือก</p>
        <p>ยอดจองสุทธิหักรายการที่ยกเลิกแล้ว · ประวัติยกเลิกยังคงอยู่ · ไม่ทราบราคา/วันที่จะไม่แทนด้วยศูนย์หรือวันนำเข้า</p>
        <p>ราคาประเมินจากทะเบียนแปลง ไม่ใช่ราคา ท.ด. ของสัญญา · วันที่คอลัมน์ A เป็นวันเข้าชม/รับ Lead เดิม และคอลัมน์ Q เป็นวันโอนคาดการณ์ ไม่ใช่วันโอนจริง</p>
        <p>หลักฐานเข้าชมในขอบเขตนี้: ข้อมูลเดิม {report.legacyVisits} ครั้ง · Visit ใหม่ที่ส่ง Customer Voices แล้ว {report.completedVisits} ครั้ง · ข้อมูลเดิมไม่ใช่การยืนยันว่าแบบสอบถามใหม่เสร็จแล้ว</p>
        {report.pendingLegacyRows > 0 && <p>ข้อมูลเดิมรอ Admin ตรวจ {report.pendingLegacyRows} รายการ ยังไม่รวมเป็นผลงานที่ยืนยันแล้ว</p>}
        {report.unassignedLegacyVisits > 0 && <p>รวมประวัติเข้าชมเดิมที่ไม่ระบุโครงการ {report.unassignedLegacyVisits} ครั้ง เฉพาะยอดทุกโครงการ</p>}
        {report.unknownLegacyDates > 0 && <p>ข้อมูลเดิมที่ไม่ทราบวันเข้าชม {report.unknownLegacyDates} รายการ ยังไม่จัดลงเดือนหรือปี</p>}
        {report.unknownStock > 0 && <p className="font-bold">มีแปลงต้องตรวจสอบ {report.unknownStock} แปลง ไม่จัดเป็นแปลงว่างอัตโนมัติ</p>}
      </section>

      {surface === 'summary' ? <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">{[
          ['ยอดรวมราคาตั้ง', money(baseTotal)], ['ยอดรวมขายได้ (จอง + โอน)', money(saleTotal)], ['ยอดรวมราคาประเมินทะเบียน', money(appraisalTotal)],
          ['โอนแล้ว', `${stockCount('transferred')} แปลง`], ['รอดำเนินการ', `${stockCount('booked')} แปลง`], ['ว่าง (ยังไม่มีลูกค้า)', `${stockCount('available')} แปลง`],
        ].map(([label, value]) => <div className={panel} key={label}><div className="mb-2 text-xs font-semibold text-slate-500">{label}</div><div className="text-lg font-bold text-slate-800">{value}</div></div>)}</div>
        <StockTable stocks={report.stocks}/>
      </> : <>
        <div className="flex flex-wrap gap-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><div><p className="text-xs font-bold text-indigo-800">ยอดขายปัจจุบัน (จอง + โอน)</p><p className="mt-1 text-2xl font-black text-indigo-700">{money(saleTotal)}</p></div><div className="border-l border-indigo-200 pl-6"><p className="text-xs font-bold text-rose-600">ยอด ท.ด. ตามสัญญา</p><p className="mt-1 text-xl font-bold text-rose-600">ยังไม่เชื่อม</p></div></div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <section className={`${panel} space-y-4`}><h2 className="border-b border-gray-100 pb-3 font-bold text-gray-800">ยอดสะสมประจำปี {year}</h2><Stat label="ยอดเข้าชมสะสม (ครั้ง)" value={report.yearly.visits.length}/><Stat label="ยอดจองสุทธิสะสม" value={report.yearly.booked.length}/><Stat label="ยอดโอนสะสม" value={report.yearly.transferred.length}/><Stat label="ยอดยกเลิกสะสม" value={report.yearly.cancelled.length} tone="text-red-600"/></section>
          <section className={`${panel} space-y-4`}><h2 className="flex items-center gap-2 border-b border-gray-100 pb-3 font-bold text-gray-800"><Calendar size={18}/>ประจำเดือน {cutoff.slice(5, 7)}/{year}</h2><Stat label="ยอดเข้าชม (ครั้ง)" value={report.monthly.visits.length}/><Stat label="ยอดจองสุทธิ" value={report.monthly.booked.length}/><Stat label="ยอดโอน" value={report.monthly.transferred.length} tone="text-emerald-600"/><Stat label="ยอดยกเลิก" value={report.monthly.cancelled.length} tone="text-red-600"/></section>
          <section className="rounded-2xl bg-gradient-to-br from-blue-900 to-indigo-900 p-5 text-white shadow-md"><h2 className="text-sm font-medium text-blue-100">ภาพรวมการโอนเดือนนี้ (สำเร็จ + คาดการณ์)</h2><p className="my-3 text-4xl font-black">{report.monthly.transferred.length + report.forecast.length} <span className="text-base text-blue-200">หลัง</span></p><p className="text-sm text-blue-100">โอนแล้วถึง {cutoff}: {report.monthly.transferred.length} หลัง</p><p className="mt-3 rounded bg-white/10 p-2 font-bold">{money(sumReportMoney([...report.monthly.transferred, ...report.forecast].map(row => row.sale.salePrice)))}</p><p className="mt-4 border-t border-white/20 pt-3 text-sm text-amber-200">คาดการณ์รอโอนในเดือน: {report.forecast.length} หลัง</p><p className="mt-2 text-xs text-blue-200">แสดงแผนที่ยังไม่โอนในปัจจุบัน ไม่ใช่ยอดโอนสำเร็จ</p></section>
          <section className={`${panel} space-y-3`}><button onClick={() => setShowBreakdown(true)} className="w-full text-left text-sm font-bold text-gray-700 underline underline-offset-4">บ้านทั้งหมด (สถานะปัจจุบัน) · ดูรายละเอียด</button><p className="text-xl font-black text-gray-800">{money(baseTotal)}</p><Stat label="ทั้งหมด" value={`${report.stocks.length} หลัง`}/><Stat label="โอนแล้ว" value={stockCount('transferred')} tone="text-emerald-600"/><Stat label="รอโอน" value={stockCount('booked')}/><Stat label="ว่าง" value={stockCount('available')} tone="text-slate-600"/><p className="text-xs text-slate-500">มูลค่าแปลงว่างตามราคาตั้ง: {money(stockValue('available'))}</p></section>
        </div>

        <section className={panel}><h2 className="mb-5 flex items-center gap-2 font-bold text-gray-800"><BarChart3 size={20} className="text-blue-600"/>ยอดจองสุทธิและโอนประจำเดือน แต่ละโครงการ</h2><div className="h-64"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={monthlyProjects}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="project" tick={{ fontSize: 12 }}/><YAxis allowDecimals={false}/><Tooltip/><Legend/><Bar dataKey="booked" name="ยอดจองสุทธิ" fill="#93c5fd" radius={[4,4,0,0]}/><Bar dataKey="transferred" name="ยอดโอน" fill="#3b82f6" radius={[4,4,0,0]}/></ComposedChart></ResponsiveContainer></div></section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12"><section className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm xl:col-span-8"><h2 className="px-4 pt-4 font-bold text-gray-800">สถานะแปลงปัจจุบัน แยกโครงการ</h2><table className="w-full text-sm" aria-label="สถานะแปลงแยกโครงการ"><thead className="bg-gray-50 text-gray-700"><tr>{['โครงการ', 'โอน', 'รอโอน', 'ว่าง', 'ทั้งหมด'].map(label => <th className={cell} key={label}>{label}</th>)}</tr></thead><tbody>{report.groups.map(group => <React.Fragment key={group.projectName}><tr className="border-b border-gray-100"><td className={cell}><button className="flex items-center gap-2 font-bold" aria-expanded={expanded.has(group.projectName)} onClick={() => toggle(group.projectName)}>{expanded.has(group.projectName) ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} {group.projectName}</button>{group.unknown > 0 && <span className="block text-xs text-amber-700">ต้องตรวจสอบ {group.unknown} แปลง</span>}</td><td className={`${cell} text-center text-emerald-600`}>{group.transferred}</td><td className={`${cell} text-center text-blue-600`}>{group.booked}</td><td className={`${cell} text-center text-gray-500`}>{group.available}</td><td className={`${cell} bg-gray-50 text-center font-bold`}>{group.total}</td></tr>{expanded.has(group.projectName) && <tr className="bg-slate-50"><td className={cell}>รายชื่อแปลง:</td>{(['transferred', 'booked', 'available'] as const).map(status => <td className={`${cell} text-center align-top text-xs`} key={status}>{group.stocks.filter(stock => stock.status === status).map(stock => <div key={stock.plotId}>{stock.plotName}</div>)}</td>)}<td className={`${cell} text-xs`}>{group.stocks.filter(stock => stock.status === 'unknown').map(stock => <div key={stock.plotId}>{stock.plotName} (ตรวจสอบ)</div>)}</td></tr>}</React.Fragment>)}<tr className="bg-blue-50 font-black text-blue-900"><td className={cell}>Grand Total</td><td className={`${cell} text-center`}>{stockCount('transferred')}</td><td className={`${cell} text-center`}>{stockCount('booked')}</td><td className={`${cell} text-center`}>{stockCount('available')}</td><td className={`${cell} text-center`}>{report.stocks.length}</td></tr></tbody></table></section>
          <section className={`${panel} xl:col-span-4`}><div className="grid grid-cols-3 gap-3"><EventList title="รายการจองสุทธิในเดือน" rows={report.monthly.booked}/><EventList title="รายการโอนในเดือน" rows={report.monthly.transferred}/><EventList title="รายการยกเลิกในเดือน" rows={report.monthly.cancelled} red/></div></section></div>

        <section className="space-y-5 border-t border-gray-200 pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-3 text-xl font-bold text-gray-800"><TrendingUp className="text-emerald-600"/>สรุปยอดรายเดือนและยอดสะสม</h2><label className="text-sm font-bold text-gray-600">เลือกปี: <input type="number" aria-label="ปีกราฟสะสม" min="1900" max="9999" value={cumulativeYear} onChange={event => { if (/^[1-9]\d{3}$/.test(event.target.value)) setCumulativeYear(event.target.value); }} className="w-24 rounded-lg border border-gray-200 bg-white p-2 text-emerald-700"/></label></div>
          <p className="text-sm text-gray-500">แสดงเฉพาะเหตุการณ์ที่มีวันที่ถึง {cutoff} ไม่สร้างวันที่ย้อนหลังให้ข้อมูลเก่า</p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{([
            ['booked', 'ยอดจองสุทธิรายเดือน', '#3b82f6'], ['transferred', 'ยอดโอนรายเดือน', '#6366f1'],
            ['cumulativeBooked', 'ยอดจองสุทธิสะสม', '#3b82f6'], ['cumulativeTransferred', 'ยอดโอนสะสม', '#10b981'],
            ['visits', 'ยอดเข้าชมรายเดือน', '#a855f7'], ['cumulativeVisits', 'ยอดเข้าชมสะสม', '#a855f7'],
          ] as const).map(([key, label, color]) => <section key={key} className={panel}><h3 className="mb-4 text-center font-bold text-gray-700">{label} ปี {cumulativeYear} ({key === 'visits' || key === 'cumulativeVisits' ? 'ครั้ง' : 'หลัง'})</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={report.charts}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month" tick={{ fontSize: 11 }}/><YAxis allowDecimals={false}/><Tooltip/><Area type="monotone" dataKey={key} name={label} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={3} connectNulls={false}/></ComposedChart></ResponsiveContainer></div></section>)}</div>
          <div className={`${panel} text-center`}><h3 className="font-bold text-gray-700">หลักฐานยอดเข้าชม</h3><p className="mt-3 text-sm text-slate-500">นับวันเข้าชมเดิมจากคอลัมน์ A และ Visit ใหม่ที่ส่ง Customer Voices แล้ว ไม่ใช้จำนวน Lead แทนยอดเข้าชม</p></div>
        </section>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" aria-label="วันที่ที่ไม่ทราบ"><h2 className="font-bold">รายการที่ยังจัดลงเดือนหรือปีไม่ได้</h2><p>ไม่ทราบวันจอง {report.unknownDates.booked} รายการ · ไม่ทราบวันยกเลิก {report.unknownDates.cancelled} รายการ · ไม่ทราบวันโอน {report.unknownDates.transferred} รายการ</p><p>รายการเหล่านี้ยังอยู่ในประวัติและสถานะแปลงปัจจุบัน ไม่ถูกนับเป็นศูนย์หรือใช้วันนำเข้าแทน</p></section>
        <section className={panel}><h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-800"><Building2 className="text-blue-600"/>รายละเอียดรอโอน</h2><p className="text-sm text-slate-500">แสดงสถานะปัจจุบันจากการจองส่วนกลางและวันโอนคาดการณ์ตามหลักฐาน ไม่เปิดคำสั่งแก้ไขนัดตรวจบ้านจากรายงาน</p><div className="my-4 grid gap-4 sm:grid-cols-3"><EventList title="คาดการณ์โอนในเดือน" rows={report.forecast}/><EventList title="คาดการณ์ค้างจากเดือนก่อน" rows={report.carriedOver}/><p className="text-sm text-amber-700">ยังไม่ทราบวันโอนคาดการณ์ {report.unknownForecast} รายการ</p></div><div className="mt-4"><StockTable stocks={report.stocks.filter(row => row.status === 'booked')}/></div></section>
        <section>
          <h2 className="mb-5 flex items-center gap-3 text-xl font-bold text-gray-800"><Users className="text-blue-600"/>รายชื่อลูกค้า / ประวัติการจอง (Customer List)</h2>
          <p className="mb-3 text-sm text-gray-500">หนึ่งแถวต่อประวัติการจอง รวมรายการยกเลิก ไม่ใช่จำนวนลูกค้าไม่ซ้ำ · วันรับ Lead เดิมอ้างอิงคอลัมน์ A แยกจากวันจอง</p>
          <div className="max-h-96 overflow-auto rounded-2xl border border-gray-100 bg-white">
            <table className="w-full text-left text-sm" aria-label="ประวัติการจองลูกค้า">
              <thead className="sticky top-0 bg-gray-50 text-gray-700"><tr>{['ลำดับ', 'วันรับ Lead / วันจอง', 'รายชื่อลูกค้า', 'เบอร์โทร', 'โครงการ/บ้านเลขที่', 'ราคาขาย', 'Sale', 'สถานะปัจจุบัน'].map(label => <th className={cell} key={label}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">{report.rows.map((row, index) => <tr key={row.sale.saleId}>
                <td className={cell}>{index + 1}</td>
                <td className={cell}><span className="block text-xs text-slate-500">Lead: {dayLabel(row.leadDate)}</span><span className="block">จอง: {dayLabel(row.bookedDate)}</span></td>
                <td className={`${cell} font-medium`}>{row.sale.customerName}</td><td className={cell}>{row.sale.phone ?? 'ไม่ทราบ'}</td>
                <td className={cell}>{row.sale.projectName} / {row.sale.plotName ?? 'ไม่ทราบแปลง'}</td>
                <td className={`${cell} font-medium text-blue-600`}>{money(row.sale.salePrice)}</td><td className={cell}>{row.sale.ownerName}</td><td className={cell}>{stageLabels[row.sale.stage]}</td>
              </tr>)}{!report.rows.length && <tr><td colSpan={8} className="p-6 text-center text-gray-500">ไม่มีประวัติการจองในขอบเขตนี้</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </>}
    </div>
    {showBreakdown && <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="รายละเอียดรวมบ้านทั้งหมด" className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"><header className="flex items-center justify-between gap-4 border-b border-gray-100 p-6"><div><h2 className="text-xl font-black text-gray-800">รายละเอียดรวมบ้านทั้งหมด (สถานะปัจจุบัน)</h2><p className="text-sm text-gray-500">ราคาตั้งจากทะเบียนแปลง ไม่ใช่ยอดขายตามสัญญา</p></div><button aria-label="ปิดรายละเอียด" onClick={() => setShowBreakdown(false)} className="rounded-full p-2 hover:bg-gray-100"><X/></button></header><div className="overflow-auto p-5"><StockTable stocks={report.stocks}/></div></section></div>}
  </div>;
}
