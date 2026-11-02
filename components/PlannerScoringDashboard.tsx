'use client';

import React, { useMemo, useState } from 'react';
import { Award, Lock, Search, History, CheckCircle2, ChevronRight, RefreshCw, AlertTriangle, ShieldCheck, Home, ArrowRight, Info, Filter } from 'lucide-react';
import { parsePlotBaseline, getScoreBadgeStyle } from '@/lib/plannerScoring';
import { isRelevantExecutiveProject } from '@/lib/constructionReportsIndex';
import ScheduleHistoryModal from './ScheduleHistoryModal';

interface PlannerScoringDashboardProps {
  projects: any[];
  plots: any[];
  isAdmin: boolean;
  isOwner: boolean;
  isProjectPlanner: boolean;
  currentUserName?: string;
  fetchAllData?: () => Promise<void>;
  onSelectPlot?: (plot: any) => void;
}

export default function PlannerScoringDashboard({
  projects,
  plots,
  isAdmin,
  isOwner,
  isProjectPlanner,
  currentUserName = 'Executive',
  fetchAllData,
  onSelectPlot
}: PlannerScoringDashboardProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [scoreFilterTab, setScoreFilterTab] = useState<'all' | 'locked' | 'unlocked' | '100' | '75' | '50' | '25' | '0'>('all');
  const [scoreSearchText, setScoreSearchText] = useState('');
  const [historyModalPlot, setHistoryModalPlot] = useState<any | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRules, setShowRules] = useState(false);

  // Filter projects to only active and relevant executive projects (excludes legacy projects)
  const activeProjectsList = useMemo(() => {
    return (projects || [])
      .filter((proj: any) => !proj.is_closed)
      .filter((proj: any) => isRelevantExecutiveProject(proj.name));
  }, [projects]);

  // Compute scoring data
  const scoringData = useMemo(() => {
    const relevantPlots = (plots || []).filter((p: any) => {
      if (!isRelevantExecutiveProject(p.project_name)) return false;
      if (selectedProjectId !== 'all' && p.project_name !== selectedProjectId) return false;
      return true;
    });

    let totalScore = 0;
    let lockedCount = 0;
    const distribution: Record<number, number> = { 100: 0, 75: 0, 50: 0, 25: 0, 0: 0 };
    const penalizedPlots: any[] = [];

    const allPlotItems = relevantPlots.map((p: any) => {
      const base = parsePlotBaseline(p);
      if (base.isLocked) {
        lockedCount++;
        totalScore += base.score;
        if (base.score >= 100) distribution[100]++;
        else if (base.score >= 75) distribution[75]++;
        else if (base.score >= 50) distribution[50]++;
        else if (base.score >= 25) distribution[25]++;
        else distribution[0]++;

        if (base.revisions > 0) {
          penalizedPlots.push({
            plot: p,
            score: base.score,
            revisions: base.revisions,
            start: base.start,
            end: base.end,
            penaltyScore: Math.max(0, 100 - base.score)
          });
        }
      }
      return {
        plot: p,
        baseline: base,
        score: base.score,
        isLocked: base.isLocked,
        revisions: base.revisions,
        start: base.start,
        end: base.end,
        lockedAt: base.lockedAt
      };
    }).sort((a: any, b: any) => {
      const nameA = String(a.plot.plot_name || a.plot.id);
      const nameB = String(b.plot.plot_name || b.plot.id);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const avgScore = lockedCount > 0 ? Math.round((totalScore / lockedCount) * 10) / 10 : 100;
    const unlockedCount = relevantPlots.length - lockedCount;
    const lockPercentage = relevantPlots.length > 0 ? Math.round((lockedCount / relevantPlots.length) * 100) : 0;

    return {
      totalPlots: relevantPlots.length,
      lockedCount,
      unlockedCount,
      lockPercentage,
      avgScore,
      distribution,
      penalizedPlots,
      allPlotItems
    };
  }, [plots, selectedProjectId]);

  // Filtered plot list based on active tab and search text
  const filteredPlots = useMemo(() => {
    return (scoringData.allPlotItems || []).filter((item: any) => {
      if (scoreFilterTab === 'locked' && !item.isLocked) return false;
      if (scoreFilterTab === 'unlocked' && item.isLocked) return false;
      if (scoreFilterTab === '100' && (!item.isLocked || item.score < 100)) return false;
      if (scoreFilterTab === '75' && (!item.isLocked || item.score !== 75)) return false;
      if (scoreFilterTab === '50' && (!item.isLocked || item.score !== 50)) return false;
      if (scoreFilterTab === '25' && (!item.isLocked || item.score !== 25)) return false;
      if (scoreFilterTab === '0' && (!item.isLocked || item.score !== 0)) return false;

      if (scoreSearchText.trim()) {
        const query = scoreSearchText.trim().toLowerCase();
        const plotName = String(item.plot.plot_name || item.plot.id || '').toLowerCase();
        const projName = String(item.plot.project_name || '').toLowerCase();
        const houseType = String(item.plot.house_type || '').toLowerCase();
        const foreman = String(item.plot.foreman || '').toLowerCase();
        if (!plotName.includes(query) && !projName.includes(query) && !houseType.includes(query) && !foreman.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [scoringData.allPlotItems, scoreFilterTab, scoreSearchText]);

  const handleRefresh = async () => {
    if (!fetchAllData || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchAllData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const avgBadge = getScoreBadgeStyle(scoringData.avgScore);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 md:p-8 rounded-3xl shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs font-black uppercase tracking-wider mb-3 border border-amber-500/30">
              <Award size={14} /> Planning & Schedule Quality
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              คะแนนแผนงานก่อสร้าง
            </h1>
            <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-2xl font-medium">
              ประเมินความแม่นยำของแผนงานก่อสร้างตามเกณฑ์คะแนนบันได (100 ➔ 75 ➔ 50 ➔ 25 ➔ 0 คะแนน) เมื่อมีการขยายเวลาส่งมอบบ้าน
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Project Selector Dropdown */}
            <div className="bg-white/10 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/15 flex items-center gap-2.5">
              <span className="text-xs font-bold text-slate-300 whitespace-nowrap">โครงการ:</span>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="bg-slate-800 text-white text-xs font-bold py-1.5 px-3 rounded-xl border border-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
              >
                <option value="all">ทุกโครงการ (ไอลิน 6 และโครงการใหม่)</option>
                {activeProjectsList.map((p: any) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            {fetchAllData && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-2xl border border-white/15 transition-all shadow-sm flex items-center justify-center cursor-pointer"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowRules(!showRules)}
              className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-2xl border border-amber-500/40 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Info size={15} />
              {showRules ? 'ซ่อนเกณฑ์คะแนน' : 'ดูเกณฑ์คะแนนบันได'}
            </button>
          </div>
        </div>
      </div>

      {/* Explanatory Rules Banner */}
      {showRules && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-5 text-amber-950 space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 font-black text-sm text-amber-900">
            <Award className="text-amber-600" size={18} />
            เกณฑ์คะแนนบันได 5 ขั้นสำหรับประเมิน Project Planner (Scoring Ladder)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
            <div className="p-3 bg-white rounded-xl border border-amber-200">
              <span className="font-black text-emerald-600 block text-sm">🌟 100 คะแนน</span>
              <span className="font-bold text-slate-700">ล็อก Baseline ครั้งแรก</span>
              <p className="text-[11px] text-slate-500 mt-0.5">ทำงานตรงตามแผนหลัก ไม่มีการขยายวันสิ้นสุดโครงการ</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-amber-200">
              <span className="font-black text-blue-600 block text-sm">⚠️ 75 คะแนน</span>
              <span className="font-bold text-slate-700">ขยายเวลาครั้งที่ 1</span>
              <p className="text-[11px] text-slate-500 mt-0.5">หัก 25 คะแนน เมื่อมีการเลื่อนวันสิ้นสุดออกไปครั้งแรก</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-amber-200">
              <span className="font-black text-amber-600 block text-sm">⚠️ 50 คะแนน</span>
              <span className="font-bold text-slate-700">ขยายเวลาครั้งที่ 2</span>
              <p className="text-[11px] text-slate-500 mt-0.5">หักเพิ่มอีก 25 คะแนน เมื่อเลื่อนวันสิ้นสุดครั้งที่สอง</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-amber-200">
              <span className="font-black text-orange-600 block text-sm">⚠️ 25 คะแนน</span>
              <span className="font-bold text-slate-700">ขยายเวลาครั้งที่ 3</span>
              <p className="text-[11px] text-slate-500 mt-0.5">หักเพิ่มอีก 25 คะแนน แผนงานล่าช้ากว่ากำหนดมาก</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-amber-200">
              <span className="font-black text-rose-600 block text-sm">🚨 0 คะแนน</span>
              <span className="font-bold text-slate-700">ขยายเวลา 4+ ครั้ง</span>
              <p className="text-[11px] text-slate-500 mt-0.5">ระดับวิกฤต มีการขยายเวลาส่งมอบตั้งแต่ 4 ครั้งขึ้นไป</p>
            </div>
          </div>
          <p className="text-[11px] text-amber-800 font-medium pt-1 border-t border-amber-200/60">
            🛡️ <strong>ข้อยกเว้นเหตุสุดวิสัย (Force Majeure):</strong> หากการขยายเวลาเกิดจากปัจจัยภายนอกที่ไม่สามารถควบคุมได้ เช่น ฝนตกหนัก พายุ อุทกภัย หรือเหตุฉุกเฉินระดับไซต์งาน Admin หรือ Owner สามารถกด <em>"ยกเว้นการหักคะแนน"</em> ในหน้าต่างประวัติแผนงานเพื่อคืนคะแนนให้เป็นธรรมได้
          </p>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* 1. คะแนนเฉลี่ย */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            คะแนนเฉลี่ยโครงการ
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{scoringData.avgScore}</span>
            <span className="text-xs font-bold text-slate-400">/ 100</span>
          </div>
          <div className="mt-2">
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-black border ${avgBadge.bg} ${avgBadge.text} ${avgBadge.border}`}>
              {avgBadge.grade}
            </span>
          </div>
        </div>

        {/* 2. สถานะการล็อก Baseline */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            ล็อก Baseline แล้ว
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-indigo-600">{scoringData.lockedCount}</span>
            <span className="text-xs font-bold text-slate-500">/ {scoringData.totalPlots} แปลง</span>
          </div>
          <div className="mt-2 text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${scoringData.lockPercentage}%` }}
              />
            </div>
            <span className="text-[11px] shrink-0">{scoringData.lockPercentage}%</span>
          </div>
        </div>

        {/* 3. แผนงานสมบูรณ์ (100 คะแนน) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            ตรงตามแผนหลัก (100 คะแนน)
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-600">{scoringData.distribution[100]}</span>
            <span className="text-xs font-bold text-slate-500">แปลง</span>
          </div>
          <p className="text-[11px] text-emerald-700 font-medium mt-2">
            ไม่มีการปรับขยายเวลาส่งมอบ
          </p>
        </div>

        {/* 4. แปลงที่มีการปรับขยายเวลา */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            ปรับขยายเวลา (ต้องติดตาม)
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-rose-600">{scoringData.penalizedPlots.length}</span>
            <span className="text-xs font-bold text-slate-500">แปลง</span>
          </div>
          <p className="text-[11px] text-rose-600 font-medium mt-2">
            คะแนนต่ำกว่า 100 เนื่องจากขยายเวลา
          </p>
        </div>
      </div>

      {/* Main Directory & Tabs Container */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
        <div>
          <h2 className="text-base font-black text-slate-800">
            จำแนกคะแนนและรายชื่อแปลงก่อสร้าง
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            คลิกที่ปุ่มตัวกรองเพื่อดูแปลงตามช่วงคะแนน หรือพิมพ์เลขแปลงในช่องค้นหา
          </p>
        </div>

        {/* Interactive Filter Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <button
            type="button"
            onClick={() => setScoreFilterTab('all')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-400'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === 'all' ? 'text-slate-300' : 'text-slate-400'}`}>ทั้งหมด</span>
            <span className="text-base font-black">{scoringData.totalPlots} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('locked')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === 'locked'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-300'
                : 'bg-indigo-50/70 text-indigo-900 border-indigo-200 hover:bg-indigo-100/70'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === 'locked' ? 'text-indigo-200' : 'text-indigo-600'}`}>ล็อกแล้ว</span>
            <span className="text-base font-black">{scoringData.lockedCount} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('unlocked')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === 'unlocked'
                ? 'bg-slate-600 text-white border-slate-600 shadow-md ring-2 ring-slate-300'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === 'unlocked' ? 'text-slate-300' : 'text-slate-500'}`}>รอตั้ง Baseline</span>
            <span className="text-base font-black">{scoringData.unlockedCount} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('100')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === '100'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300'
                : 'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100/70'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === '100' ? 'text-emerald-200' : 'text-emerald-600'}`}>100 (ตรงแผน)</span>
            <span className="text-base font-black">{scoringData.distribution[100]} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('75')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === '75'
                ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
                : 'bg-blue-50/70 text-blue-800 border-blue-200 hover:bg-blue-100/70'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === '75' ? 'text-blue-200' : 'text-blue-600'}`}>75 (ขยาย 1 ครั้ง)</span>
            <span className="text-base font-black">{scoringData.distribution[75]} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('50')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === '50'
                ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-300'
                : 'bg-amber-50/70 text-amber-800 border-amber-200 hover:bg-amber-100/70'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === '50' ? 'text-amber-200' : 'text-amber-600'}`}>50 (ขยาย 2 ครั้ง)</span>
            <span className="text-base font-black">{scoringData.distribution[50]} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('25')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === '25'
                ? 'bg-orange-600 text-white border-orange-600 shadow-md ring-2 ring-orange-300'
                : 'bg-orange-50/70 text-orange-800 border-orange-200 hover:bg-orange-100/70'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === '25' ? 'text-orange-200' : 'text-orange-600'}`}>25 (ขยาย 3 ครั้ง)</span>
            <span className="text-base font-black">{scoringData.distribution[25]} แปลง</span>
          </button>

          <button
            type="button"
            onClick={() => setScoreFilterTab('0')}
            className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
              scoreFilterTab === '0'
                ? 'bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-300'
                : 'bg-rose-50/70 text-rose-800 border-rose-200 hover:bg-rose-100/70'
            }`}
          >
            <span className={`text-[10px] font-bold block mb-0.5 ${scoreFilterTab === '0' ? 'text-rose-200' : 'text-rose-600'}`}>0 (วิกฤต 4+)</span>
            <span className="text-base font-black">{scoringData.distribution[0]} แปลง</span>
          </button>
        </div>

        {/* Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 pb-2 border-t border-slate-100">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={scoreSearchText}
              onChange={(e) => setScoreSearchText(e.target.value)}
              placeholder="ค้นหาเลขแปลง, แบบบ้าน หรือโฟร์แมน..."
              className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
            />
            {scoreSearchText && (
              <button
                type="button"
                onClick={() => setScoreSearchText('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-bold w-full sm:w-auto text-left sm:text-right">
            แสดง <span className="text-slate-900 font-black">{filteredPlots.length}</span> จากทั้งหมด <span className="text-slate-900 font-black">{scoringData.totalPlots}</span> แปลง
            {scoreFilterTab !== 'all' && (
              <button
                type="button"
                onClick={() => setScoreFilterTab('all')}
                className="ml-2 text-indigo-600 hover:underline text-xs font-bold"
              >
                (แสดงทั้งหมด)
              </button>
            )}
          </div>
        </div>

        {/* Plot Cards Grid */}
        {filteredPlots.length === 0 ? (
          <div className="py-12 text-center text-slate-400 font-bold text-sm bg-slate-50 rounded-2xl border border-slate-200">
            ไม่พบแปลงตามเงื่อนไขที่เลือก ({scoreFilterTab !== 'all' ? `ตัวกรอง: ${scoreFilterTab}` : ''} {scoreSearchText ? `คำค้นหา: "${scoreSearchText}"` : ''})
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPlots.map((item: any) => {
              const style = item.isLocked ? getScoreBadgeStyle(item.score) : null;
              return (
                <div
                  key={item.plot.id}
                  className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-amber-400 hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Plot Header */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-slate-900">
                            แปลง {item.plot.plot_name || item.plot.id}
                          </span>
                          <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                            {item.plot.project_name || 'ไอลิน 6'}
                          </span>
                        </div>
                        {item.plot.house_type && (
                          <span className="text-xs text-slate-500 font-medium block mt-0.5">
                            แบบบ้าน: {item.plot.house_type}
                          </span>
                        )}
                      </div>

                      {item.isLocked && style ? (
                        <div className="text-right shrink-0">
                          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black border ${style.bg} ${style.text} ${style.border}`}>
                            {item.score} คะแนน
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 block mt-0.5">
                            ({style.grade})
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                          ⏳ รอตั้ง Baseline
                        </span>
                      )}
                    </div>

                    {/* Baseline Details Box */}
                    <div className="text-xs bg-slate-50 p-3 rounded-xl mb-3 space-y-2">
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400 font-medium">แผนงานหลัก (Baseline):</span>
                        <span className="font-bold">
                          {item.isLocked ? (
                            <span className="text-emerald-700 flex items-center gap-1">
                              <Lock size={12} className="text-emerald-600" />
                              {item.start} ➔ {item.end}
                            </span>
                          ) : (
                            <span className="text-slate-400">ยังไม่ล็อก (เริ่มที่ 100 คะแนน)</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400 font-medium">สถานะการขยายเวลา:</span>
                        <span className="font-bold">
                          {item.revisions > 0 ? (
                            <span className="text-rose-600 font-black">
                              ขยายเวลา {item.revisions} ครั้ง (-{Math.max(0, 100 - item.score)} คะแนน)
                            </span>
                          ) : item.isLocked ? (
                            <span className="text-emerald-600 font-bold flex items-center gap-1">
                              <CheckCircle2 size={12} /> ตรงตามแผนหลัก
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200/60">
                        <span className="text-slate-400 font-medium">โฟร์แมนผู้รับผิดชอบ:</span>
                        <span className="font-bold text-slate-700">
                          {item.plot.foreman || '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-2">
                    {onSelectPlot ? (
                      <button
                        type="button"
                        onClick={() => onSelectPlot(item.plot)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                      >
                        <Home size={13} />
                        ไปยังหน้ารายละเอียดบ้าน
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">BuildTrack MVP</span>
                    )}

                    <button
                      type="button"
                      onClick={() => setHistoryModalPlot(item.plot)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer"
                    >
                      <History size={13} />
                      ดูประวัติแผนงาน
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Schedule History Modal */}
      {historyModalPlot && (
        <ScheduleHistoryModal
          isOpen={true}
          onClose={() => setHistoryModalPlot(null)}
          plot={historyModalPlot}
          isAdminOrOwner={isAdmin || isOwner}
          currentUserName={currentUserName}
          onRefresh={fetchAllData}
        />
      )}
    </div>
  );
}
