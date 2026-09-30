'use client';

import React, { useMemo } from 'react';
import CentralLegacyDashboard from './CentralLegacyDashboard';
import { RefreshCw } from 'lucide-react';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
import { bangkokReportDay, buildExcelReport, formatReportMoney, sumReportMoney, type ExcelStockRow } from '@/lib/sales/excelReportMetrics';

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
const dayLabel = (day: string | null) => day ?? 'ไม่ทราบ';
const money = formatReportMoney;
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
export default function CentralExcelReportView(props: Props) {
  if (props.surface === 'dashboard') return <CentralLegacyDashboard data={props.data} projectName={props.projectName} onProjectChange={props.onProjectChange} onRefresh={props.onRefresh}/>;
  return <CentralExcelSummaryView {...props}/>;
}

function CentralExcelSummaryView({ data, projectName, onProjectChange, onRefresh }: Props) {
  const cutoff = bangkokReportDay(data.loadedAt);
  const report = useMemo(() => buildExcelReport(data, projectName, cutoff, cutoff.slice(0, 4)), [data, projectName, cutoff]);
  const activeStocks = report.stocks.filter(row => row.status === 'booked' || row.status === 'transferred');
  const saleTotal = report.unknownStock > 0 ? null : sumReportMoney(activeStocks.map(row => row.sale?.salePrice ?? null));
  const baseTotal = sumReportMoney(report.stocks.map(row => row.basePrice));
  const appraisalTotal = sumReportMoney(report.stocks.map(row => row.appraisalPrice));
  const stockCount = (status: ExcelStockRow['status']) => report.stocks.filter(row => row.status === status).length;
  return <div className="h-full overflow-y-auto bg-[#f8fafc]">
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">
      <header className={`${panel} flex flex-wrap items-center justify-between gap-5`}>
        <div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-900 font-serif text-2xl font-bold text-white">A</div><div>
          <h1 className="text-2xl font-black tracking-tight text-blue-900">ตารางสรุปฝั่งขาย (Sales Summary)</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">SOMSAMAI PROPERTY COMPANY LIMITED</p>
        </div></div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">เลือกโครงการ: <select aria-label="เลือกโครงการ" value={projectName ?? ''} onChange={event => onProjectChange(event.target.value || null)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-800">
            <option value="">ทุกโครงการ</option>{data.projects.map(project => <option key={project.map.projectName} value={project.map.projectName}>{project.map.projectName}</option>)}
          </select></label>
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

      <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">{[
          ['ยอดรวมราคาตั้ง', money(baseTotal)], ['ยอดรวมขายได้ (จอง + โอน)', money(saleTotal)], ['ยอดรวมราคาประเมินทะเบียน', money(appraisalTotal)],
          ['โอนแล้ว', `${stockCount('transferred')} แปลง`], ['รอดำเนินการ', `${stockCount('booked')} แปลง`], ['ว่าง (ยังไม่มีลูกค้า)', `${stockCount('available')} แปลง`],
        ].map(([label, value]) => <div className={panel} key={label}><div className="mb-2 text-xs font-semibold text-slate-500">{label}</div><div className="text-lg font-bold text-slate-800">{value}</div></div>)}</div>
        <StockTable stocks={report.stocks}/>
      </>
    </div>
  </div>;
}
