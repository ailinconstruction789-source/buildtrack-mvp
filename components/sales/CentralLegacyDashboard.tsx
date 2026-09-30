"use client";

import React, { useMemo, useState } from 'react';
import { Calendar, TrendingUp, Users, BarChart, ChevronDown, ChevronUp } from 'lucide-react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
import type { SaleStage } from '@/lib/sales/workflow';
import { bangkokReportDay, buildExcelReport, formatReportMoney, sumReportMoney, type ExcelSaleRow, type ExcelStockRow } from '@/lib/sales/excelReportMetrics';
import CentralLegacyWaitingDetails from './CentralLegacyWaitingDetails';

interface Props {
  data: ExcelReportData;
  projectName: string | null;
  onProjectChange: (name: string | null) => void;
  onRefresh: () => void;
}
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const YEARS = ['2023', '2024', '2025', '2026'];
const stageLabels: Record<SaleStage, string> = { booked: 'จองแล้ว', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร', loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ไม่ผ่าน', loan_approved: 'กู้อนุมัติ', transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบ', cancelled: 'ยกเลิกจอง' };
const fmtM = formatReportMoney;
const average = (value: number | null, count: number) => value === null || count === 0 ? null : value / count;
const plotPresentation = (row: ExcelStockRow) => ({
  id: row.plotId, plot_name: row.plotName, project_name: row.projectName, selling_price: row.basePrice,
});
const recordPresentation = (row: ExcelSaleRow) => ({
  id: row.sale.saleId, customer_name: row.sale.customerName, phone: row.sale.phone,
  project_name: row.sale.projectName, plot_name: row.sale.plotName, agent_name: row.sale.ownerName,
  plot: { project_name: row.sale.projectName, plot_name: row.sale.plotName },
  salePrice: row.sale.salePrice, bookDate: row.bookedDate, createdDate: row.leadDate,
  status: row.sale.stage === 'cancelled' ? 'Cancelled' : ['transferred', 'handover'].includes(row.sale.stage) ? 'Transferred' : 'Reserved',
  statusLabel: stageLabels[row.sale.stage],
});

/** Original dashboard presentation, backed exclusively by the central read-only report. */
export default function CentralLegacyDashboard({ data, projectName, onProjectChange, onRefresh }: Props) {
  const [selectedDateStr, setSelectedDateStr] = useState(() => bangkokReportDay(data.loadedAt));
  const selectedYear = selectedDateStr.slice(0, 4), selectedMonth = selectedDateStr.slice(5, 7);
  const [cumulativeYear, setCumulativeYear] = useState(selectedYear);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showTotalBreakdown, setShowTotalBreakdown] = useState(false);
  const toggleProjectExpand = (name: string) => setExpandedProjects(previous => {
    const next = new Set(previous);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const report = useMemo(() => buildExcelReport(data, projectName, selectedDateStr, cumulativeYear),
    [data, projectName, selectedDateStr, cumulativeYear]);
  const metrics = useMemo(() => {
    const projectGroups = Object.fromEntries(report.groups.map(group => {
      const transferred = group.stocks.filter(row => row.status === 'transferred');
      const waiting = group.stocks.filter(row => row.status === 'booked');
      const available = group.stocks.filter(row => row.status === 'available');
      return [group.projectName, {
        total: group.total, transferred: group.transferred, waiting: group.booked, available: group.available,
        unknown: group.unknown, totalVal: sumReportMoney(group.stocks.map(row => row.basePrice)),
        transVal: sumReportMoney(transferred.map(row => row.basePrice)),
        waitVal: sumReportMoney(waiting.map(row => row.basePrice)),
        availVal: sumReportMoney(available.map(row => row.basePrice)),
        transferredPlots: transferred.map(plotPresentation), waitingPlots: waiting.map(plotPresentation),
        availablePlots: available.map(plotPresentation),
        unknownPlots: group.stocks.filter(row => row.status === 'unknown').map(plotPresentation),
      }];
    }));
    const transferred = report.stocks.filter(row => row.status === 'transferred');
    const waiting = report.stocks.filter(row => row.status === 'booked');
    const available = report.stocks.filter(row => row.status === 'available');
    const comparison = YEARS.map(year => buildExcelReport(data, projectName, selectedDateStr, year));
    const lineData = (field: 'transferred' | 'booked' | 'visits') => MONTHS.map((month, index) => ({
      month, ...Object.fromEntries(YEARS.map((year, yearIndex) => [`y${year}`, comparison[yearIndex].charts[index][field]])),
    }));
    const cumulativeData = (field: 'cumulativeTransferred' | 'cumulativeBooked' | 'cumulativeVisits') =>
      report.charts.map((chart, index) => ({ month: MONTHS[index], cumulative: chart[field] }));
    return {
      viewsAcc: report.yearly.visits.length, bookedAcc: report.yearly.booked, cancelAcc: report.yearly.cancelled,
      viewsMonth: report.monthly.visits, bookedMonth: report.monthly.booked.map(recordPresentation),
      transferMonth: report.monthly.transferred.map(recordPresentation), cancelMonth: report.monthly.cancelled.map(recordPresentation),
      expectingTransfer: report.forecast.map(recordPresentation), projectGroups, activeProjects: Object.entries(projectGroups),
      saleTotal: report.unknownStock > 0 ? null : sumReportMoney([...transferred, ...waiting].map(row => row.sale?.salePrice ?? null)),
      sumTransVal: sumReportMoney(transferred.map(row => row.basePrice)),
      sumWaitVal: sumReportMoney(waiting.map(row => row.basePrice)),
      sumAvailVal: sumReportMoney(available.map(row => row.basePrice)),
      totalVal: sumReportMoney(report.stocks.map(row => row.basePrice)),
      sumTransAppraisal: sumReportMoney(transferred.map(row => row.appraisalPrice)),
      sumWaitAppraisal: sumReportMoney(waiting.map(row => row.appraisalPrice)),
      sumTransCnt: transferred.length, sumWaitCnt: waiting.length, sumAvailCnt: available.length, sumTotalCnt: report.stocks.length,
      projChartData: report.groups.map(group => ({
        project: group.projectName,
        booking: report.monthly.booked.filter(row => row.sale.projectName === group.projectName).length,
        transfer: report.monthly.transferred.filter(row => row.sale.projectName === group.projectName).length,
      })),
      lineChartTransfers: lineData('transferred'), lineChartBookings: lineData('booked'), lineChartViews: lineData('visits'),
      cumulativeChartTransfers: cumulativeData('cumulativeTransferred'),
      cumulativeChartBookings: cumulativeData('cumulativeBooked'), cumulativeChartViews: cumulativeData('cumulativeVisits'),
      rawValidRecords: report.rows.map(recordPresentation),
    };
  }, [report, data, projectName, selectedDateStr]);

  return (
    <div className="bg-[#f8fafc] h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* HEADER */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center">
          <div className="flex items-center gap-4">
            <div className="bg-blue-900 text-white w-12 h-12 flex items-center justify-center rounded-lg text-2xl font-bold font-serif shadow-inner">A</div>
            <div>
              <h1 className="text-2xl font-black text-blue-900 tracking-tight">Monthly Sale Report {selectedYear}</h1>
              <p className="text-sm font-semibold text-gray-500 tracking-wide uppercase mt-0.5">SOMSAMAI PROPERTY COMPANY LIMITED</p>
            </div>
          </div>
          <div className="mt-4 md:mt-0 flex flex-col md:flex-row items-start md:items-center gap-4 lg:gap-8">
            <div className="bg-indigo-50 p-3 px-5 rounded-xl border border-indigo-100 shadow-sm flex flex-col sm:flex-row gap-4 sm:gap-6">
              <div>
                <div className="text-indigo-800 text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> ยอดขายรวม (โอน + จอง)
                </div>
                <div className="flex items-baseline gap-3">
                  <div className="text-2xl font-black text-indigo-700">{fmtM(metrics.saleTotal)}</div>
                  <div className="text-xs font-medium text-indigo-600/80 hidden xl:block">
                    {metrics.sumTransCnt + metrics.sumWaitCnt} หลัง
                  </div>
                </div>
              </div>
              <div className="border-t sm:border-t-0 sm:border-l border-indigo-200/60 pt-3 sm:pt-0 sm:pl-6">
                <div className="text-rose-600 text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div> ยอด ท.ด. ตามสัญญา
                </div>
                <div className="text-2xl font-black text-rose-600">ยังไม่เชื่อม</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 bg-gray-50 p-1.5 px-3 rounded-lg border border-gray-200 shadow-sm">
              <Calendar className="w-5 h-5 text-blue-600" />
              <input 
                type="date" 
                value={selectedDateStr} 
                aria-label="ข้อมูลเหตุการณ์ถึงวันที่"
                onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { setSelectedDateStr(e.target.value); setCumulativeYear(e.target.value.slice(0, 4)); } }}
                className="bg-transparent border-none text-sm font-bold text-gray-800 focus:ring-0 cursor-pointer outline-none"
              />
            </div>
          </div>
        </div>

                <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label htmlFor="legacy-dashboard-project" className="font-medium text-gray-600">โครงการ</label>
          <select aria-label="เลือกโครงการ" id="legacy-dashboard-project" value={projectName ?? ''} onChange={event => onProjectChange(event.target.value || null)} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <option value="">ทุกโครงการ</option>
            {data.projects.map(project => <option key={project.map.projectName} value={project.map.projectName}>{project.map.projectName}</option>)}
          </select>
          <button type="button" onClick={onRefresh} className="rounded-lg border border-gray-200 bg-white px-3 py-2">โหลดใหม่</button>
        </div>
        {/* ROW 1: KPI SUMMARY CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4">
              <div className="flex justify-between items-center mb-1 pb-3 border-b border-gray-100">
                 <span className="font-bold text-gray-800 text-base">ยอดสะสมประจำปี {selectedYear}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-gray-600 text-sm">ยอดลูกค้าเข้าชมสะสม</span>
                <span className="text-2xl font-black text-blue-900">{metrics.viewsAcc}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-gray-600 text-sm">ยอดลูกค้าจองสะสม</span>
                <span className="text-2xl font-black text-blue-900">{metrics.bookedAcc.length}</span>
              </div>
              <div className="flex justify-between items-center bg-red-50 p-3 -mx-3 rounded-lg border border-red-100">
                <span className="font-bold text-red-600 text-sm">ยอดลูกค้ายกเลิกสะสม</span>
                <span className="text-2xl font-black text-red-600">{metrics.cancelAcc.length}</span>
              </div>
            </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  <span className="font-bold text-gray-800">ประจำเดือน {selectedMonth}/{selectedYear}</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดเข้าชม</span>
                  <span className="text-lg font-bold text-gray-900">{metrics.viewsMonth.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดจอง</span>
                  <span className="text-lg font-bold text-blue-600">{metrics.bookedMonth.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดโอน</span>
                  <span className="text-lg font-bold text-emerald-600">{metrics.transferMonth.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดยกเลิก</span>
                  <span className="text-lg font-bold text-red-600">{metrics.cancelMonth.length}</span>
                </div>
              </div>
            </div>
          <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-5 rounded-2xl shadow-md text-white flex flex-col">
              <div className="text-blue-100 text-sm font-medium mb-1">ภาพรวมการโอนเดือนนี้ (สำเร็จ + คาดการณ์)</div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-4xl font-black">{metrics.expectingTransfer.length + metrics.transferMonth.length}</span>
                <span className="text-blue-200 font-medium mb-1">หลัง</span>
              </div>
              <div className="text-sm text-blue-200 font-medium bg-white/10 p-2 rounded inline-block mt-2 self-start">
                {fmtM(sumReportMoney([...metrics.expectingTransfer, ...metrics.transferMonth].map(r => r.salePrice)))}
              </div>
              
              <div className="mt-4 pt-4 border-t border-white/20">
                <div className="grid grid-cols-2 gap-4">
                  {/* โอนแล้ว */}
                  <div>
                    <div className="text-emerald-400 text-xs font-bold mb-2 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                      โอนแล้ว ({metrics.transferMonth.length})
                    </div>
                    <div className="text-blue-200 text-xs font-medium space-y-1">
                      {metrics.transferMonth.length > 0 ? [...metrics.transferMonth].sort((a, b) => {
                        const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                        const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                        return nameA.localeCompare(nameB, 'th', { numeric: true });
                      }).map((r) => (
                        <div key={r.id} className="truncate text-emerald-100/90" title={r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}>
                          • {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                        </div>
                      )) : <div className="text-blue-300/50 italic">- ไม่มี -</div>}
                    </div>
                  </div>
                  
                  {/* คาดว่าจะโอน */}
                  <div>
                    <div className="text-amber-400 text-xs font-bold mb-2 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                      รอโอน ({metrics.expectingTransfer.length})
                    </div>
                    <div className="text-blue-200 text-xs font-medium space-y-1">
                      {metrics.expectingTransfer.length > 0 ? [...metrics.expectingTransfer].sort((a, b) => {
                        const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                        const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                        return nameA.localeCompare(nameB, 'th', { numeric: true });
                      }).map((r) => (
                        <div key={r.id} className="truncate text-amber-100/90" title={r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}>
                          • {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                        </div>
                      )) : <div className="text-blue-300/50 italic">- ไม่มี -</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          <div 
            className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-full cursor-pointer hover:bg-slate-50 transition-colors relative group"
            role="button"
            tabIndex={0}
            aria-label="บ้านทั้งหมด (สถานะปัจจุบัน) ดูรายละเอียด"
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShowTotalBreakdown(true); } }}
            onClick={() => setShowTotalBreakdown(true)}
          >
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-white text-gray-400 p-1.5 rounded-lg shadow-sm border border-gray-100"><BarChart size={16} /></div>
                </div>
                <div className="px-2">
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1 group-hover:text-gray-700 transition-colors">บ้านทั้งหมด (สถานะปัจจุบัน)</div>
                  <div className="text-xl font-black text-gray-800">{fmtM(metrics.totalVal)}</div>
                  <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                    <span>{metrics.sumTotalCnt} หลัง</span>
                    <span>เฉลี่ย {fmtM(average(metrics.totalVal, metrics.sumTotalCnt))}/หลัง</span>
                  </div>
                </div>

                <div className="px-2">
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดโอนสะสม</div>
                  <div className="text-xl font-black text-emerald-600">{fmtM(metrics.sumTransVal)}</div>
                  <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                    <span>{metrics.sumTransCnt} หลัง</span>
                    <span className="text-rose-500">ราคาประเมินทะเบียน {fmtM(metrics.sumTransAppraisal)}</span>
                  </div>
                </div>

                <div className="px-2">
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดรอโอน</div>
                  <div className="text-xl font-black text-blue-600">{fmtM(metrics.sumWaitVal)}</div>
                  <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                    <span>{metrics.sumWaitCnt} หลัง</span>
                    <span className="text-rose-500">ราคาประเมินทะเบียน {fmtM(metrics.sumWaitAppraisal)}</span>
                  </div>
                </div>

                <div className="px-2">
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดคงเหลือ (ว่าง)</div>
                  <div className="text-xl font-black text-gray-800">{fmtM(metrics.sumAvailVal)}</div>
                  <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                    <span>{metrics.sumAvailCnt} หลัง</span>
                    <span>เฉลี่ย {fmtM(average(metrics.sumAvailVal, metrics.sumAvailCnt))}/หลัง</span>
                  </div>
                </div>
              </div>
        </div>

        {/* ROW 2: CHARTS */}
        <div className="grid grid-cols-1 gap-6 mt-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-base font-bold text-gray-800 mb-6 flex items-center gap-2"><BarChart className="w-5 h-5 text-blue-600"/> ยอดจองและโอนประจำเดือน แต่ละโครงการ</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metrics.projChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="project" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                    <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                    <Legend iconType="circle" wrapperStyle={{fontSize: 12, paddingTop: '20px'}} />
                    <Bar dataKey="booking" name="ยอดจองประจำเดือน" fill="#93c5fd" radius={[4,4,0,0]} barSize={24} />
                    <Bar dataKey="transfer" name="ยอดโอนประจำเดือน" fill="#3b82f6" radius={[4,4,0,0]} barSize={24} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
        </div>

        {/* ROW 3: DETAILED TABLES */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mt-6">
          <div className="xl:col-span-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-full flex flex-col">
  <div className="flex-1 p-0 overflow-x-auto ">
                <table aria-label="สถานะแปลงแยกโครงการ" className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-3 text-left font-bold text-gray-700">โครงการ</th>
                      <th className="p-3 text-right font-bold text-emerald-600">โอน</th>
                      <th className="p-3 text-right font-bold text-blue-600">รอโอน</th>
                      <th className="p-3 text-right font-bold text-gray-500">ว่าง</th>
                      <th className="p-3 text-right font-bold text-gray-900 bg-gray-100">ทั้งหมด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.activeProjects.map(([proj, stats]) => {
                      const isExpanded = expandedProjects.has(proj);
                      return (
                        <React.Fragment key={proj}>
                          <tr 
                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <td className="p-3 font-semibold text-gray-800 flex items-center gap-2">
                              <button type="button" aria-expanded={isExpanded} onClick={() => toggleProjectExpand(proj)} className="flex items-center gap-2 text-left">
                              {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                              {proj}
                              </button>
                            </td>
                            <td className="p-3 text-right font-medium text-emerald-600">{stats.transferred}</td>
                            <td className="p-3 text-right font-medium text-blue-600">{stats.waiting}</td>
                            <td className="p-3 text-right text-gray-500">{stats.available}</td>
                            <td className="p-3 text-right font-bold bg-gray-50 text-gray-900">{stats.total}{stats.unknown > 0 && <div className="text-xs font-normal text-amber-700">ไม่ทราบ {stats.unknown}</div>}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/50 border-b border-gray-100">
                              <td className="p-3 text-xs font-bold text-gray-400 text-right align-top pt-4">รายชื่อแปลง:</td>
                              <td className="p-3 text-xs text-emerald-600 align-top text-right pt-4 space-y-1">
                                {[...stats.transferredPlots].sort((a, b) => (a.plot_name || '').localeCompare(b.plot_name || '', 'th', { numeric: true })).map((p) => (
                                  <div key={p.id}>{p.plot_name}</div>
                                ))}
                              </td>
                              <td className="p-3 text-xs text-blue-600 align-top text-right pt-4 space-y-1">
                                {[...stats.waitingPlots].sort((a, b) => (a.plot_name || '').localeCompare(b.plot_name || '', 'th', { numeric: true })).map((p) => (
                                  <div key={p.id}>{p.plot_name}</div>
                                ))}
                              </td>
                              <td className="p-3 text-xs text-gray-500 align-top text-right pt-4 space-y-1">
                                {[...stats.availablePlots].sort((a, b) => (a.plot_name || '').localeCompare(b.plot_name || '', 'th', { numeric: true })).map((p) => (
                                  <div key={p.id}>{p.plot_name}</div>
                                ))}
                              </td>
                              <td className="p-3 bg-gray-50/50 border-l border-white text-right text-xs text-amber-700">{stats.unknownPlots.map(p => <div key={p.id}>{p.plot_name} (ไม่ทราบ)</div>)}</td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td className="p-3 font-black text-blue-900">Grand Total</td>
                      <td className="p-3 text-right font-black text-emerald-700">{metrics.sumTransCnt}</td>
                      <td className="p-3 text-right font-black text-blue-700">{metrics.sumWaitCnt}</td>
                      <td className="p-3 text-right font-bold text-gray-700">{metrics.sumAvailCnt}</td>
                      <td className="p-3 text-right font-black text-blue-900">{metrics.sumTotalCnt}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="xl:col-span-4">
            {/* MONTHLY DETAILS CARD (3 COLUMNS) */}
            <div className="bg-white p-4 lg:p-5 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-3 gap-2">
                {/* Column 1: Booked */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-slate-700 mb-3 leading-tight text-center">
                    รายการที่<br/>จองในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-sky-700 space-y-1 text-left whitespace-nowrap">
                      {metrics.bookedMonth.length > 0 
                        ? [...metrics.bookedMonth].sort((a, b) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center">-</div>
                      }
                    </div>
                  </div>
                </div>

                {/* Column 2: Transferred */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-slate-700 mb-3 leading-tight text-center">
                    รายการโอน<br/>ภายในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-sky-700 space-y-1 text-left whitespace-nowrap">
                      {metrics.transferMonth.length > 0 
                        ? [...metrics.transferMonth].sort((a, b) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center">-</div>
                      }
                    </div>
                  </div>
                </div>

                {/* Column 3: Cancelled */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-red-600 mb-3 leading-tight text-center">
                    รายการยกเลิก<br/>ในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-red-600 space-y-1 text-left whitespace-nowrap">
                      {metrics.cancelMonth.length > 0 
                        ? [...metrics.cancelMonth].sort((a, b) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center">-</div>
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* LINE CHARTS */}
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-6">
            <TrendingUp className="text-blue-600 w-7 h-7 p-1.5 bg-blue-100 rounded-lg" />
            <h2 className="text-xl font-bold text-gray-800">สรุปยอดจองและยอดโอน บจก. สมสมัย</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดโอน ปี 2023 - 2026 (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.lineChartTransfers} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Line type="monotone" dataKey="y2023" name="ปี 2023" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2024" name="ปี 2024" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Area type="monotone" dataKey="y2025" name="ปี 2025 (ปีที่แล้ว)" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3, fill: '#cbd5e1', strokeWidth: 0}} activeDot={{r: 5, fill: '#94a3b8', strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2026" name="ปี 2026 (ปัจจุบัน)" stroke="#6366f1" strokeWidth={4} dot={{r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2}} activeDot={{r: 8, strokeWidth: 0}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดจอง ปี 2023 - 2026 (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.lineChartBookings} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Line type="monotone" dataKey="y2023" name="ปี 2023" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2024" name="ปี 2024" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Area type="monotone" dataKey="y2025" name="ปี 2025 (ปีที่แล้ว)" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3, fill: '#cbd5e1', strokeWidth: 0}} activeDot={{r: 5, fill: '#94a3b8', strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2026" name="ปี 2026 (ปัจจุบัน)" stroke="#6366f1" strokeWidth={4} dot={{r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2}} activeDot={{r: 8, strokeWidth: 0}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
            <h3 className="text-center font-bold text-gray-700 mb-4">ยอดเข้าชม ปี 2023 - 2026 (ครั้ง)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={metrics.lineChartViews} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                <RechartsTooltip 
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                  labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line type="monotone" dataKey="y2023" name="ปี 2023" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                <Line type="monotone" dataKey="y2024" name="ปี 2024" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                <Area type="monotone" dataKey="y2025" name="ปี 2025 (ปีที่แล้ว)" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3, fill: '#cbd5e1', strokeWidth: 0}} activeDot={{r: 5, fill: '#94a3b8', strokeWidth: 0}} />
                <Line type="monotone" dataKey="y2026" name="ปี 2026 (ปัจจุบัน)" stroke="#6366f1" strokeWidth={4} dot={{r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2}} activeDot={{r: 8, strokeWidth: 0}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CUMULATIVE CHARTS */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="text-emerald-600 w-7 h-7 p-1.5 bg-emerald-100 rounded-lg" />
              <h2 className="text-xl font-bold text-gray-800">สรุปยอดสะสม (Cumulative) ประจำปี</h2>
            </div>
            <div className="flex items-center gap-2 bg-white p-1.5 px-3 rounded-lg border border-gray-200 shadow-sm">
              <span className="text-sm font-bold text-gray-600">เลือกปี:</span>
              <select 
                aria-label="ปีกราฟสะสม"
                value={cumulativeYear}
                onChange={e => setCumulativeYear(e.target.value)}
                className="bg-transparent border-none text-sm font-bold text-emerald-700 focus:ring-0 cursor-pointer outline-none"
              >
                <option value="2023">2023</option>
                <option value="2024">2024</option>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Cumulative Transfers */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดโอนสะสม ปี {cumulativeYear} (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.cumulativeChartTransfers} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Area type="monotone" dataKey="cumulative" name="ยอดโอนสะสม" fill="#d1fae5" stroke="#10b981" strokeWidth={3} dot={{r: 4, fill: '#ffffff', stroke: '#10b981', strokeWidth: 2}} activeDot={{r: 7, strokeWidth: 0}}>
                    <LabelList dataKey="cumulative" position="top" offset={10} style={{ fill: '#059669', fontSize: 11, fontWeight: 'bold' }} />
                  </Area>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative Bookings */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดจองสะสม ปี {cumulativeYear} (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.cumulativeChartBookings} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Area type="monotone" dataKey="cumulative" name="ยอดจองสะสม" fill="#dbeafe" stroke="#3b82f6" strokeWidth={3} dot={{r: 4, fill: '#ffffff', stroke: '#3b82f6', strokeWidth: 2}} activeDot={{r: 7, strokeWidth: 0}}>
                    <LabelList dataKey="cumulative" position="top" offset={10} style={{ fill: '#2563eb', fontSize: 11, fontWeight: 'bold' }} />
                  </Area>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
            <h3 className="text-center font-bold text-gray-700 mb-4">ยอดเข้าชมสะสม ปี {cumulativeYear} (ครั้ง)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={metrics.cumulativeChartViews} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                <RechartsTooltip 
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                  labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                />
                <Area type="monotone" dataKey="cumulative" name="ยอดเข้าชมสะสม" fill="#f3e8ff" stroke="#a855f7" strokeWidth={3} dot={{r: 4, fill: '#ffffff', stroke: '#a855f7', strokeWidth: 2}} activeDot={{r: 7, strokeWidth: 0}}>
                  <LabelList dataKey="cumulative" position="top" offset={10} style={{ fill: '#9333ea', fontSize: 11, fontWeight: 'bold' }} />
                </Area>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <details className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <summary className="cursor-pointer font-semibold">ข้อมูลที่ใช้คำนวณและรายการรอตรวจ</summary>
          <div className="mt-3 space-y-1">
            <p>เหตุการณ์นับถึง {selectedDateStr} · บ้านและสถานะเป็นข้อมูลปัจจุบัน ไม่ใช่ภาพย้อนหลัง</p>
            <p>ข้อมูลเก่าใช้วันที่เข้าชม/บันทึก Lead จากคอลัมน์ A และวันที่คาดโอนจากคอลัมน์ Q; ไม่ใช้วันนำเข้าแทนวันที่จริง</p>
            <p>ยอดจองหักรายการยกเลิก · ข้อมูลเงินหรือวันที่ที่ไม่มีหลักฐานแสดงว่าไม่ทราบ</p>
            <p>ข้อมูลเดิม {report.legacyVisits} ครั้ง · Visit ใหม่ที่ส่ง Customer Voices แล้ว {report.completedVisits} ครั้ง · ไม่ใช้จำนวน Lead แทนยอดเข้าชม</p>
            <p>ประวัติเข้าชมไม่ระบุโครงการ {report.unassignedLegacyVisits} ครั้ง รวมเฉพาะยอดทุกโครงการ · ข้อมูลเดิมไม่ได้ยืนยันว่าแบบสอบถามใหม่เสร็จแล้ว</p>
            <p>ข้อมูลเดิมรอ Admin ตรวจ {report.pendingLegacyRows} รายการ ยังไม่รวมเป็นผลงานที่ยืนยันแล้ว · วันที่เข้าชมไม่ทราบ {report.unknownLegacyDates} รายการ</p>
            <p>ไม่ทราบวันจอง {report.unknownDates.booked} รายการ · วันยกเลิก {report.unknownDates.cancelled} · วันโอน {report.unknownDates.transferred} · วันคาดโอน {report.unknownForecast}</p>
            <p>สถานะแปลงไม่ทราบ {report.unknownStock} แปลง · รายชื่อลูกค้าด้านล่างแสดงหนึ่งแถวต่อประวัติการจอง รวมรายการยกเลิก</p>
          </div>
        </details>
        {/* WAITING FOR TRANSFER DETAILS */}
        <div className="mt-8 pt-6 border-t-2 border-gray-200">
          <CentralLegacyWaitingDetails report={report} />
        </div>

        {/* DETAILED TABLE LIST */}
        <div className="mt-8 pt-6 border-t-2 border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Users className="text-blue-600 w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">รายชื่อลูกค้า (Customer List)</h2>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table aria-label="ประวัติการจองลูกค้า" className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="p-3 font-bold text-gray-700">ลำดับ</th>
                    <th className="p-3 font-bold text-gray-700">วันที่</th>
                    <th className="p-3 font-bold text-gray-700">รายชื่อลูกค้า</th>
                    <th className="p-3 font-bold text-gray-700">เบอร์โทร</th>
                    <th className="p-3 font-bold text-gray-700">โครงการ/บ้านเลขที่</th>
                    <th className="p-3 font-bold text-gray-700">ราคาขาย</th>
                    <th className="p-3 font-bold text-gray-700">Sale</th>
                    <th className="p-3 font-bold text-gray-700">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {metrics.rawValidRecords.map((r, idx: number) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-600">{idx + 1}</td>
                      <td className="p-3 text-gray-600"><div>Lead: {r.createdDate || 'ไม่ทราบ'}</div><div>จอง: {r.bookDate || 'ไม่ทราบ'}</div></td>
                      <td className="p-3 font-medium text-gray-900">{r.customer_name}</td>
                      <td className="p-3 text-gray-600">{r.phone || 'ไม่ทราบ'}</td>
                      <td className="p-3 text-gray-600">{r.plot?.project_name || r.project_name || '-'} / {r.plot?.plot_name || r.plot_name || '-'}</td>
                      <td className="p-3 text-blue-600 font-medium">{fmtM(r.salePrice)}</td>
                      <td className="p-3 text-gray-600">{r.agent_name || '-'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          ['Transferred', 'Handover'].includes(r.status) ? 'bg-emerald-100 text-emerald-700' :
                          ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved'].includes(r.status) ? 'bg-blue-100 text-blue-700' :
                          r.status === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {r.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {metrics.rawValidRecords.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-gray-500">ไม่มีข้อมูลลูกค้าในปีและเดือนที่เลือก</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

      {showTotalBreakdown && (
        <div role="dialog" aria-modal="true" aria-label="รายละเอียดรวมบ้านทั้งหมด" className="fixed inset-0 z-[500] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-gray-800">รายละเอียดรวมบ้านทั้งหมด (สถานะปัจจุบัน)</h3>
                <p className="text-sm text-gray-500 font-medium">ยอดรวมรวมจากราคาขายตั้งต้นของทุกสถานะ</p>
              </div>
              <button type="button" aria-label="ปิดรายละเอียด" onClick={() => setShowTotalBreakdown(false)} className="w-10 h-10 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto dark-scrollbar flex-1 bg-white">
              {Object.keys(metrics.projectGroups).map(proj => {
                const group = metrics.projectGroups[proj];
                const allPlots = [
                  ...group.transferredPlots.map((p) => ({...p, __status: 'โอนแล้ว'})), 
                  ...group.waitingPlots.map((p) => ({...p, __status: 'รอโอน'})), 
                  ...group.availablePlots.map((p) => ({...p, __status: 'ว่าง'})),
                  ...group.unknownPlots.map(p => ({...p, __status: 'ไม่ทราบ'}))
                ];
                if (allPlots.length === 0) return null;
                return (
                  <div key={proj} className="mb-8 last:mb-0">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="bg-slate-800 text-white p-2 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>
                      </div>
                      <h4 className="text-lg font-bold text-gray-800">{proj}</h4>
                      <div className="ml-auto text-right">
                        <div className="text-lg font-black text-slate-800">{fmtM(group.totalVal)}</div>
                        <div className="text-xs text-slate-500 font-medium">{group.total} แปลง</div>
                      </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-gray-100 text-slate-500 text-xs uppercase">
                          <tr>
                            <th className="px-4 py-3 font-bold">แปลง</th>
                            <th className="px-4 py-3 font-bold">สถานะ</th>
                            <th className="px-4 py-3 font-bold text-right">ราคาตั้งต้น</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {allPlots.sort((a, b) => a.plot_name?.localeCompare(b.plot_name, 'th', { numeric: true })).map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 font-bold text-slate-700">{p.plot_name}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold ${p.__status === 'โอนแล้ว' ? 'bg-emerald-100 text-emerald-700' : p.__status === 'รอโอน' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{p.__status}</span>
                              </td>
                              <td className="px-4 py-3 font-bold text-right text-slate-700">{fmtM(p.selling_price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}


