import React, { useState, useMemo } from 'react';
import { 
  X, Download, Printer, Search, CheckCircle2, TrendingUp, 
  TrendingDown, Minus, Clock, FileSpreadsheet, Building2, User, 
  Filter, AlertTriangle, ArrowUpDown, ChevronDown
} from 'lucide-react';

interface WeeklyProgressReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProject: any;
  plots: any[];
  houseTypes?: any[];
  foremenList?: any[];
  assignments?: any[];
  taskTemplates?: any[];
  allUpdatesRecord?: any[];
  getPlotOverallStatus: (id: string) => any;
  onSelectPlot?: (plot: any) => void;
}

export interface PlotWeeklyMetric {
  plotId: string;
  plotName: string;
  houseTypeName: string;
  foremanName: string;
  currentActual: number;
  lastWeekProgress: number;
  deltaProgress: number;
  plannedProgress: number;
  variance: number;
  isCompleted: boolean;
  paceStatus: 'completed' | 'ahead' | 'on-track' | 'delayed';
  statusLabel: string;
  rawPlot: any;
}

/**
 * คำนวณความคืบหน้ารายแปลงย้อนหลัง ณ วันที่กำหนด
 */
function calculatePlotProgressAtDate(
  plot: any, 
  cutoffDate: Date, 
  plotUpdates: any[], 
  assignments: any[] = [], 
  taskTemplates: any[] = [],
  fallbackCurrent: number
): number {
  const plotAssignments = assignments.filter((a: any) => a.plot_id === plot.id && !a.is_excluded);
  if (plotAssignments.length === 0) {
    return fallbackCurrent;
  }

  let totalCost = 0;
  let totalWeightedProgress = 0;
  let hasValidData = false;

  plotAssignments.forEach((assign: any) => {
    const template = taskTemplates.find((t: any) => t.id === assign.task_template_id);
    if (template && template.is_progress_counted === false) {
      return;
    }
    const cost = Number(template?.cost) || 1;
    totalCost += cost;

    const taskUpdates = plotUpdates.filter((u: any) => 
      u.task_template_id === assign.task_template_id
    );

    const updatesBefore = taskUpdates
      .filter((u: any) => new Date(u.created_at).getTime() <= cutoffDate.getTime())
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    let taskProgressAtCutoff = 0;
    if (updatesBefore.length > 0) {
      taskProgressAtCutoff = Number(updatesBefore[0].progress) || 0;
      hasValidData = true;
    } else {
      const updatesAfter = taskUpdates.filter((u: any) => new Date(u.created_at).getTime() > cutoffDate.getTime());
      if (updatesAfter.length > 0) {
        taskProgressAtCutoff = 0;
        hasValidData = true;
      } else {
        taskProgressAtCutoff = Number(assign.current_progress) || 0;
      }
    }

    totalWeightedProgress += taskProgressAtCutoff * cost;
  });

  if (!hasValidData || totalCost === 0) {
    return fallbackCurrent;
  }

  return totalWeightedProgress / totalCost;
}

export default function WeeklyProgressReportModal({
  isOpen,
  onClose,
  selectedProject,
  plots,
  houseTypes = [],
  foremenList = [],
  assignments = [],
  taskTemplates = [],
  allUpdatesRecord = [],
  getPlotOverallStatus,
  onSelectPlot
}: WeeklyProgressReportModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'delayed' | 'on-track' | 'ahead'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'progress' | 'delta' | 'variance'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // คำนวณข้อมูลรายแปลงเฉพาะโครงการที่เลือก
  const plotMetrics = useMemo(() => {
    if (!selectedProject?.name || !plots || plots.length === 0) return [];

    // ดึงเฉพาะแปลงในโครงการปัจจุบัน
    const currentProjectPlots = plots.filter((p: any) => p.project_name === selectedProject.name);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(23, 59, 59, 999);

    const metrics: PlotWeeklyMetric[] = currentProjectPlots.map((plot: any) => {
      const plotName = plot.plot_name || plot.id;
      const houseTypeObj = houseTypes.find((h: any) => String(h.id) === String(plot.house_type_id));
      const houseTypeName = plot.house_types?.type_name || houseTypeObj?.type_name || houseTypeObj?.name || plot.house_type || '-';
      const foremanName = plot.foreman || '-';

      const statusInfo = getPlotOverallStatus(plot.id);

      // เงื่อนไขเสร็จสมบูรณ์
      const isCompleted = 
        Boolean(plot.is_completed) ||
        plot.handover_status === 'completed' ||
        statusInfo?.status === 'completed' ||
        statusInfo?.status === 'ready_for_sale' ||
        (Number(statusInfo?.actual) >= 100);

      const currentActual = isCompleted 
        ? 100 
        : Math.max(0, Math.min(100, Math.round(Number(statusInfo?.actual ?? plot.progress ?? 0))));

      const plannedProgress = isCompleted 
        ? 100 
        : Math.max(0, Math.min(100, Math.round(Number(statusInfo?.planned ?? 0))));

      // ข้อมูลการอัปเดตย้อนหลัง 7 วัน
      const plotUpdates = (allUpdatesRecord || []).filter((u: any) => u.plot_id === plot.id);
      const updatesLast7Days = plotUpdates.filter((u: any) => new Date(u.created_at).getTime() > sevenDaysAgo.getTime());

      let lastWeekProgress = currentActual;

      if (isCompleted) {
        if (updatesLast7Days.length > 0) {
          lastWeekProgress = calculatePlotProgressAtDate(plot, sevenDaysAgo, plotUpdates, assignments, taskTemplates, currentActual);
        } else {
          lastWeekProgress = 100;
        }
      } else if (updatesLast7Days.length === 0) {
        lastWeekProgress = currentActual;
      } else {
        lastWeekProgress = calculatePlotProgressAtDate(plot, sevenDaysAgo, plotUpdates, assignments, taskTemplates, currentActual);
      }

      lastWeekProgress = Math.max(0, Math.min(currentActual, Math.round(lastWeekProgress)));
      const deltaProgress = Math.max(0, currentActual - lastWeekProgress);

      const variance = isCompleted ? 0 : (currentActual - plannedProgress);

      let paceStatus: 'completed' | 'ahead' | 'on-track' | 'delayed' = 'on-track';
      let statusLabel = 'ตามแผน';

      if (isCompleted) {
        paceStatus = 'completed';
        statusLabel = 'เสร็จแล้ว';
      } else if (variance > 0) {
        paceStatus = 'ahead';
        statusLabel = `เร็วกว่าแผน (+${variance}%)`;
      } else if (variance < 0) {
        paceStatus = 'delayed';
        statusLabel = `ช้ากว่าแผน (${variance}%)`;
      } else {
        paceStatus = 'on-track';
        statusLabel = 'ตามแผน';
      }

      return {
        plotId: plot.id,
        plotName,
        houseTypeName,
        foremanName,
        currentActual,
        lastWeekProgress,
        deltaProgress,
        plannedProgress,
        variance,
        isCompleted,
        paceStatus,
        statusLabel,
        rawPlot: plot
      };
    });

    return metrics;
  }, [selectedProject?.name, plots, houseTypes, allUpdatesRecord, assignments, taskTemplates, getPlotOverallStatus]);

  // สรุปตัวเลขภาพรวม (Summary KPI)
  const summary = useMemo(() => {
    const total = plotMetrics.length;
    if (total === 0) {
      return { total: 0, completed: 0, ahead: 0, onTrack: 0, delayed: 0, avgProgress: 0, avgDelta: 0 };
    }
    const completed = plotMetrics.filter(p => p.isCompleted).length;
    const ahead = plotMetrics.filter(p => !p.isCompleted && p.paceStatus === 'ahead').length;
    const onTrack = plotMetrics.filter(p => !p.isCompleted && p.paceStatus === 'on-track').length;
    const delayed = plotMetrics.filter(p => !p.isCompleted && p.paceStatus === 'delayed').length;

    const sumActual = plotMetrics.reduce((acc, p) => acc + p.currentActual, 0);
    const sumDelta = plotMetrics.reduce((acc, p) => acc + p.deltaProgress, 0);

    return {
      total,
      completed,
      ahead,
      onTrack,
      delayed,
      avgProgress: Math.round(sumActual / total),
      avgDelta: Math.round((sumDelta / total) * 10) / 10
    };
  }, [plotMetrics]);

  // กรองและเรียงลำดับ
  const filteredAndSortedPlots = useMemo(() => {
    let result = [...plotMetrics];

    // ค้นหา
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(p => 
        p.plotName.toLowerCase().includes(q) ||
        p.houseTypeName.toLowerCase().includes(q) ||
        p.foremanName.toLowerCase().includes(q)
      );
    }

    // กรองสถานะ
    if (statusFilter !== 'all') {
      result = result.filter(p => p.paceStatus === statusFilter);
    }

    // เรียงลำดับ
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.plotName.localeCompare(b.plotName, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'progress') {
        cmp = a.currentActual - b.currentActual;
      } else if (sortBy === 'delta') {
        cmp = a.deltaProgress - b.deltaProgress;
      } else if (sortBy === 'variance') {
        cmp = a.variance - b.variance;
      }
      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [plotMetrics, searchTerm, statusFilter, sortBy, sortAsc]);

  // สลับการเรียง
  const handleSort = (field: 'name' | 'progress' | 'delta' | 'variance') => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(field === 'name');
    }
  };

  // ส่งออกเป็น Excel / CSV พร้อม UTF-8 BOM
  const handleExportCSV = () => {
    const BOM = '\uFEFF';
    const headers = [
      'ลำดับ',
      'แปลง (Plot)',
      'แบบบ้าน (House Type)',
      'โฟร์แมน (Foreman)',
      'สัปดาห์ก่อน (%)',
      'สัปดาห์นี้ (%)',
      'เพิ่มขึ้นรอบสัปดาห์ (+%)',
      'แผนงาน (%)',
      'สถานะ / ความคืบหน้าเทียบแผน'
    ];

    const rows = filteredAndSortedPlots.map((p, idx) => [
      idx + 1,
      `"${p.plotName}"`,
      `"${p.houseTypeName}"`,
      `"${p.foremanName}"`,
      `${p.lastWeekProgress}%`,
      `${p.currentActual}%`,
      p.deltaProgress > 0 ? `+${p.deltaProgress}%` : '0%',
      `${p.plannedProgress}%`,
      `"${p.statusLabel}"`
    ]);

    const csvContent = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `สรุปความคืบหน้ารายสัปดาห์_${selectedProject?.name || 'โครงการ'}_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // พิมพ์หน้ารายงาน
  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-hidden animate-in fade-in duration-200 print:bg-white print:p-0 print:static">
      <div className="bg-white w-full max-w-6xl max-h-[92vh] rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col border border-slate-200 overflow-hidden print:border-none print:shadow-none print:max-h-none print:w-full print:rounded-none">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-6 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 print:bg-none print:text-black print:p-0 print:mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl print:hidden">
                <FileSpreadsheet size={20} />
              </span>
              <h2 className="text-lg sm:text-2xl font-bold tracking-tight">
                รายงานสรุปความคืบหน้ารายสัปดาห์ (Weekly Progress)
              </h2>
            </div>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 flex items-center gap-2">
              <span>โครงการ: <strong className="text-emerald-400 font-bold">{selectedProject?.name || '-'}</strong></span>
              <span>•</span>
              <span>ข้อมูล ณ วันที่: {new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end print:hidden">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md hover:shadow-lg transition-all"
              title="ส่งออกไฟล์ Excel / CSV"
            >
              <Download size={15} />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs sm:text-sm font-bold transition-all"
              title="พิมพ์รายงานหรือบันทึกเป็น PDF"
            >
              <Printer size={15} />
              <span className="hidden sm:inline">พิมพ์ / PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
              title="ปิดหน้าต่าง"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 p-3 sm:p-5 bg-slate-50 border-b border-slate-200 shrink-0 print:grid-cols-5 print:p-2 print:bg-slate-100">
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">แปลงทั้งหมด</span>
            <span className="text-xl sm:text-2xl font-black text-slate-800">{summary.total} <span className="text-xs font-normal text-slate-500">แปลง</span></span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-2xs">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">🟢 สร้างเสร็จแล้ว</span>
            <span className="text-xl sm:text-2xl font-black text-emerald-700">{summary.completed} <span className="text-xs font-normal text-emerald-600">แปลง</span></span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-rose-200 bg-rose-50/40 shadow-2xs">
            <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">🔴 ช้ากว่าแผน</span>
            <span className="text-xl sm:text-2xl font-black text-rose-700">{summary.delayed} <span className="text-xs font-normal text-rose-600">แปลง</span></span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-blue-200 bg-blue-50/40 shadow-2xs">
            <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider block">🔵 กำลังก่อสร้าง (ปกติ)</span>
            <span className="text-xl sm:text-2xl font-black text-blue-700">{summary.ahead + summary.onTrack} <span className="text-xs font-normal text-blue-600">แปลง</span></span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 shadow-2xs col-span-2 sm:col-span-1">
            <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">⚡ ขยับรอบ 7 วัน</span>
            <span className="text-xl sm:text-2xl font-black text-indigo-700">+{summary.avgDelta}% <span className="text-xs font-normal text-indigo-600">เฉลี่ย</span></span>
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div className="p-3 sm:p-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0 print:hidden">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาชื่อแปลง, แบบบ้าน หรือโฟร์แมน..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-2xs"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1 mr-1">
              <Filter size={13} /> สถานะ:
            </span>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'all' ? 'bg-slate-800 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              ทั้งหมด ({summary.total})
            </button>
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'completed' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
            >
              เสร็จแล้ว ({summary.completed})
            </button>
            <button
              onClick={() => setStatusFilter('delayed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'delayed' ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
            >
              ช้ากว่าแผน ({summary.delayed})
            </button>
            <button
              onClick={() => setStatusFilter('on-track')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'on-track' ? 'bg-blue-600 text-white shadow-xs' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
            >
              ตามแผน ({summary.onTrack})
            </button>
            <button
              onClick={() => setStatusFilter('ahead')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'ahead' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
            >
              เร็วกว่าแผน ({summary.ahead})
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto custom-scrollbar p-0">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-10 shadow-2xs border-b border-slate-200">
              <tr>
                <th className="py-3 px-3 sm:px-4 text-center w-12 text-slate-500">#</th>
                <th 
                  className="py-3 px-3 sm:px-4 cursor-pointer hover:text-indigo-600 transition-colors select-none"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>แปลง</span>
                    <ArrowUpDown size={13} className={sortBy === 'name' ? 'text-indigo-600' : 'text-slate-400'} />
                  </div>
                </th>
                <th className="py-3 px-3 sm:px-4">แบบบ้าน</th>
                <th className="py-3 px-3 sm:px-4">โฟร์แมน</th>
                <th className="py-3 px-3 sm:px-4 text-center">สัปดาห์ก่อน</th>
                <th 
                  className="py-3 px-3 sm:px-4 text-center cursor-pointer hover:text-indigo-600 transition-colors select-none"
                  onClick={() => handleSort('progress')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>สัปดาห์นี้</span>
                    <ArrowUpDown size={13} className={sortBy === 'progress' ? 'text-indigo-600' : 'text-slate-400'} />
                  </div>
                </th>
                <th 
                  className="py-3 px-3 sm:px-4 text-center cursor-pointer hover:text-indigo-600 transition-colors select-none"
                  onClick={() => handleSort('delta')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>เพิ่มขึ้นรอบสัปดาห์</span>
                    <ArrowUpDown size={13} className={sortBy === 'delta' ? 'text-indigo-600' : 'text-slate-400'} />
                  </div>
                </th>
                <th className="py-3 px-3 sm:px-4 text-center">แผนงาน</th>
                <th 
                  className="py-3 px-3 sm:px-4 text-center cursor-pointer hover:text-indigo-600 transition-colors select-none"
                  onClick={() => handleSort('variance')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>สถานะ / เทียบแผน</span>
                    <ArrowUpDown size={13} className={sortBy === 'variance' ? 'text-indigo-600' : 'text-slate-400'} />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSortedPlots.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-bold">
                    ไม่พบข้อมูลแปลงที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                filteredAndSortedPlots.map((plot, index) => (
                  <tr 
                    key={plot.plotId} 
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    onClick={() => onSelectPlot && onSelectPlot(plot.rawPlot)}
                  >
                    <td className="py-3 px-3 sm:px-4 text-center text-slate-400 font-medium">
                      {index + 1}
                    </td>
                    <td className="py-3 px-3 sm:px-4 font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {plot.plotName}
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-slate-600 font-medium">
                      {plot.houseTypeName}
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-slate-600">
                      {plot.foremanName !== '-' ? (
                        <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                          <User size={13} className="text-slate-400" />
                          {plot.foremanName}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-center font-semibold text-slate-600">
                      {plot.lastWeekProgress}%
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-center">
                      <div className="inline-flex flex-col items-center gap-1 min-w-[70px]">
                        <span className="font-bold text-slate-900">{plot.currentActual}%</span>
                        <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${plot.isCompleted ? 'bg-emerald-500' : plot.paceStatus === 'delayed' ? 'bg-rose-500' : 'bg-blue-500'}`}
                            style={{ width: `${plot.currentActual}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-center">
                      {plot.deltaProgress > 0 ? (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <TrendingUp size={13} />
                          +{plot.deltaProgress}%
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-center font-semibold text-slate-600">
                      {plot.plannedProgress}%
                    </td>
                    <td className="py-3 px-3 sm:px-4 text-center">
                      {plot.isCompleted ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                          <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                          <span>เสร็จแล้ว</span>
                        </span>
                      ) : plot.paceStatus === 'ahead' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-2xs">
                          <TrendingUp size={13} className="text-indigo-600 shrink-0" />
                          <span>เร็วกว่าแผน (+{plot.variance}%)</span>
                        </span>
                      ) : plot.paceStatus === 'on-track' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200 shadow-2xs">
                          <Minus size={13} className="text-blue-500 shrink-0" />
                          <span>ตามแผน</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200 shadow-2xs">
                          <TrendingDown size={13} className="text-rose-600 shrink-0" />
                          <span>ช้ากว่าแผน ({plot.variance}%)</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0 print:hidden">
          <span className="text-xs text-slate-500 font-medium">
            แสดง {filteredAndSortedPlots.length} จากทั้งหมด {summary.total} แปลง • สามารถคลิกที่แถวเพื่อเปิดดูรายละเอียดแปลงได้
          </span>
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-all"
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>

      {/* Print Specific CSS */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          table {
            border: 1px solid #cbd5e1 !important;
          }
          th, td {
            border: 1px solid #e2e8f0 !important;
            padding: 6px 8px !important;
          }
        }
      `}</style>
    </div>
  );
}
