'use client';

import React, { useMemo, useState } from 'react';
import { 
  Award, Lock, Search, History, CheckCircle2, ChevronRight, RefreshCw, 
  AlertTriangle, ShieldCheck, Home, ArrowRight, Info, Filter, User, 
  HardHat, Users, CheckCircle, BarChart3, Layers, CalendarClock
} from 'lucide-react';
import { 
  parsePlotBaseline, 
  getScoreBadgeStyle, 
  calculateForemanAggregates,
  calculateSiteEngineerAggregates,
  calculateProjectPlannerScore,
  assignPlotSiteEngineer,
  ForemanScoreSummary,
  SiteEngineerScoreSummary,
  ProjectPlannerScoreSummary
} from '@/lib/plannerScoring';
import { isRelevantExecutiveProject } from '@/lib/constructionReportsIndex';
import { supabase } from '@/lib/supabase';
import ScheduleHistoryModal from './ScheduleHistoryModal';

interface PlannerScoringDashboardProps {
  projects: any[];
  plots: any[];
  allUsers?: any[];
  foremenList?: any[];
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
  allUsers = [],
  foremenList = [],
  isAdmin,
  isOwner,
  isProjectPlanner,
  currentUserName = 'Executive',
  fetchAllData,
  onSelectPlot
}: PlannerScoringDashboardProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [activeRoleView, setActiveRoleView] = useState<'foreman' | 'site_engineer' | 'planner'>('foreman');
  const [scoreFilterTab, setScoreFilterTab] = useState<'all' | 'locked' | 'unlocked' | '100' | '75' | '50' | '25' | '0'>('all');
  const [scoreSearchText, setScoreSearchText] = useState('');
  const [historyModalPlot, setHistoryModalPlot] = useState<any | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [selectedForemanFilter, setSelectedForemanFilter] = useState<string | null>(null);
  const [selectedSeFilter, setSelectedSeFilter] = useState<string | null>(null);
  const [updatingPlotSeId, setUpdatingPlotSeId] = useState<string | null>(null);

  // Extract lists of Site Engineers and Foremen from allUsers (deduplicated by name)
  const siteEngineersList = useMemo(() => {
    const list = (allUsers || []).filter((u: any) => (u.role || '').toLowerCase() === 'site engineer');
    const seen = new Set<string>();
    return list.filter((u: any) => {
      const name = u.username || u.name;
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [allUsers]);

  const effectiveForemenList = useMemo(() => {
    const list = (foremenList && foremenList.length > 0)
      ? foremenList
      : (allUsers || []).filter((u: any) => (u.role || '').toLowerCase() === 'foreman');
    const seen = new Set<string>();
    return list.filter((u: any) => {
      const name = u.username || u.name;
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [allUsers, foremenList]);

  // Filter projects to only active and relevant executive projects (deduplicated by name)
  const activeProjectsList = useMemo(() => {
    const list = (projects || [])
      .filter((proj: any) => !proj.is_closed)
      .filter((proj: any) => isRelevantExecutiveProject(proj.name));
    const seen = new Set<string>();
    return list.filter((p: any) => {
      if (!p.name || seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });
  }, [projects]);

  // Filtered relevant plots for scoring
  const relevantPlots = useMemo(() => {
    return (plots || []).filter((p: any) => {
      if (!isRelevantExecutiveProject(p.project_name)) return false;
      if (selectedProjectId !== 'all' && p.project_name !== selectedProjectId) return false;
      return true;
    });
  }, [plots, selectedProjectId]);

  // 1. Calculate Foreman Aggregates
  const foremanSummaries: ForemanScoreSummary[] = useMemo(() => {
    return calculateForemanAggregates(relevantPlots, effectiveForemenList);
  }, [relevantPlots, effectiveForemenList]);

  // 2. Calculate Site Engineer Aggregates (Weighted Average - Rule 2)
  const siteEngineerSummaries: SiteEngineerScoreSummary[] = useMemo(() => {
    return calculateSiteEngineerAggregates(relevantPlots, siteEngineersList);
  }, [relevantPlots, siteEngineersList]);

  // 3. Calculate Project Planner Hybrid Score (30% Baseline Setup + 70% Site Execution - Rule 7)
  const plannerSummary: ProjectPlannerScoreSummary = useMemo(() => {
    return calculateProjectPlannerScore(relevantPlots, siteEngineerSummaries);
  }, [relevantPlots, siteEngineerSummaries]);

  // All plot items sorted naturally
  const allPlotItems = useMemo(() => {
    return relevantPlots.map((p: any) => {
      const base = parsePlotBaseline(p);
      return {
        plot: p,
        baseline: base,
        score: base.score,
        isLocked: base.isLocked,
        revisions: base.revisions,
        start: base.start,
        end: base.end,
        lockedAt: base.lockedAt,
        foremanName: p.foreman_name || p.foreman || 'ยังไม่ระบุ',
        siteEngineer: p.site_engineer || 'วิศวกรส่วนกลาง'
      };
    }).sort((a: any, b: any) => {
      const nameA = String(a.plot.plot_name || a.plot.id);
      const nameB = String(b.plot.plot_name || b.plot.id);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [relevantPlots]);

  // Breakdown distribution of scores
  const scoreDistribution = useMemo(() => {
    const dist: Record<number, number> = { 100: 0, 75: 0, 50: 0, 25: 0, 0: 0 };
    allPlotItems.forEach((item: any) => {
      if (item.isLocked) {
        if (item.score >= 100) dist[100]++;
        else if (item.score >= 75) dist[75]++;
        else if (item.score >= 50) dist[50]++;
        else if (item.score >= 25) dist[25]++;
        else dist[0]++;
      }
    });
    return dist;
  }, [allPlotItems]);

  // Filtered plot list based on active tab, search text, and role filter
  const filteredPlots = useMemo(() => {
    return allPlotItems.filter((item: any) => {
      // 1. Role Filter (Foreman or SE click filter)
      if (selectedForemanFilter && item.foremanName !== selectedForemanFilter) return false;
      if (selectedSeFilter && item.siteEngineer !== selectedSeFilter) return false;

      // 2. Score Filter Tab
      if (scoreFilterTab === 'locked' && !item.isLocked) return false;
      if (scoreFilterTab === 'unlocked' && item.isLocked) return false;
      if (scoreFilterTab === '100' && (!item.isLocked || item.score < 100)) return false;
      if (scoreFilterTab === '75' && (!item.isLocked || item.score !== 75)) return false;
      if (scoreFilterTab === '50' && (!item.isLocked || item.score !== 50)) return false;
      if (scoreFilterTab === '25' && (!item.isLocked || item.score !== 25)) return false;
      if (scoreFilterTab === '0' && (!item.isLocked || item.score !== 0)) return false;

      // 3. Search query filter
      if (scoreSearchText.trim()) {
        const query = scoreSearchText.trim().toLowerCase();
        const plotName = String(item.plot.plot_name || item.plot.id || '').toLowerCase();
        const projName = String(item.plot.project_name || '').toLowerCase();
        const houseType = String(item.plot.house_type || '').toLowerCase();
        const fm = String(item.foremanName).toLowerCase();
        const se = String(item.siteEngineer).toLowerCase();
        if (!plotName.includes(query) && !projName.includes(query) && !houseType.includes(query) && !fm.includes(query) && !se.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [allPlotItems, scoreFilterTab, scoreSearchText, selectedForemanFilter, selectedSeFilter]);

  const handleRefresh = async () => {
    if (!fetchAllData || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchAllData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAssignSiteEngineer = async (plot: any, seName: string) => {
    if (!plot) return;
    setUpdatingPlotSeId(plot.id);
    try {
      // Optimistic in-memory update for instant feedback
      plot.site_engineer = seName;
      const res = await assignPlotSiteEngineer(supabase, plot, seName);
      if (!res.success) {
        console.warn('Assign site engineer warning:', res.error);
      }
      if (fetchAllData) {
        try {
          await fetchAllData();
        } catch (fetchErr: any) {
          console.warn('Background refresh after assigning SE:', fetchErr?.message || fetchErr);
        }
      }
    } catch (err: any) {
      console.error('Failed to assign site engineer:', err?.message || err);
    } finally {
      setUpdatingPlotSeId(null);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 md:p-8 rounded-3xl shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs font-black uppercase tracking-wider mb-3 border border-amber-500/30">
              <Award size={14} /> Cascading Planning KPI
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              คะแนนแผนงานก่อสร้าง
            </h1>
            <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-2xl font-medium">
              ระบบประเมินความแม่นยำของแผนงานก่อสร้างแบบลูกโซ่ 3 ระดับ: <strong>Foreman (แปลง)</strong> ➔ <strong>Site Engineer (ทีม)</strong> ➔ <strong>Project Planner (ภาพรวม)</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Project Selector Dropdown */}
            <div className="bg-white/10 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/15 flex items-center gap-2.5">
              <span className="text-xs font-bold text-slate-300 whitespace-nowrap">โครงการ:</span>
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setSelectedForemanFilter(null);
                  setSelectedSeFilter(null);
                }}
                className="bg-slate-800 text-white text-xs font-bold py-1.5 px-3 rounded-xl border border-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
              >
                <option value="all">ทุกโครงการ (ไอลิน 6 และโครงการใหม่)</option>
                {activeProjectsList.map((p: any, idx: number) => (
                  <option key={p.name || p.id || `proj-${idx}`} value={p.name}>{p.name}</option>
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
              {showRules ? 'ซ่อนเกณฑ์ข้อตกลง' : 'ดูกฎข้อตกลง KPI'}
            </button>
          </div>
        </div>
      </div>

      {/* Explanatory Rules Banner (Rule 1-7 Blueprint) */}
      {showRules && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-5 text-amber-950 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 font-black text-sm text-amber-900">
            <Award className="text-amber-600" size={18} />
            ข้อตกลงและหลักเกณฑ์การประเมินคะแนนแผนงานก่อสร้าง (Agreed Blueprint)
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 bg-white rounded-xl border border-amber-200 space-y-1">
              <span className="font-black text-amber-900 block text-xs flex items-center gap-1.5">
                <HardHat size={14} className="text-amber-600" /> 1. โฟร์แมน (Foreman)
              </span>
              <p className="text-slate-600 font-medium">
                • เริ่มต้น 100 คะแนนเมื่อล็อก Baseline<br/>
                • ขยายวันสิ้นสุดหักครั้งละ 25 คะแนน (100 ➔ 75 ➔ 50 ➔ 25 ➔ 0)<br/>
                • <strong>การเปลี่ยนตัว:</strong> โฟร์แมนคนใหม่เริ่มนับ 100 เต็ม ไม่รับกรรมจากความล่าช้าในอดีต (นับเฉพาะขยายเวลาที่เกิดหลังวันรับมอบหมาย)
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-xl border border-amber-200 space-y-1">
              <span className="font-black text-blue-900 block text-xs flex items-center gap-1.5">
                <User size={14} className="text-blue-600" /> 2. วิศวกร (Site Engineer)
              </span>
              <p className="text-slate-600 font-medium">
                • <strong>สูตรถ่วงน้ำหนัก (Plot-Weighted):</strong> ผลรวมคะแนนทุกแปลงในมือ ÷ จำนวนแปลงทั้งหมดที่ดูแล<br/>
                • โฟร์แมนที่คุมแปลงน้อยจะไม่ดึงคะแนนของทีมฮวบ<br/>
                • SE เป็นผู้ตรวจสอบและกดอนุมัติการขยายแผนในระบบ
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-xl border border-amber-200 space-y-1">
              <span className="font-black text-indigo-900 block text-xs flex items-center gap-1.5">
                <BarChart3 size={14} className="text-indigo-600" /> 3. ผู้วางแผน (Project Planner)
              </span>
              <p className="text-slate-600 font-medium">
                • <strong>ระบบผสม Hybrid (30% + 70%):</strong><br/>
                - 30% จากความครบถ้วนในการล็อก Baseline ทันกำหนด<br/>
                - 70% จากผลงานหน้างานจริง (ค่าเฉลี่ยของ SE ทุกคนรวมกัน)
              </p>
            </div>
          </div>

          <div className="p-3 bg-white/80 rounded-xl border border-amber-200 text-xs space-y-1">
            <span className="font-bold text-amber-900 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-600" /> กฎเหตุสุดวิสัย / ปัจจัยภายนอก (Force Majeure & Procurement)
            </span>
            <p className="text-slate-600 font-medium">
              หากงานล่าช้าเพราะสภาพอากาศ, ฝนตกหนัก, หรือจัดซื้อ/หาช่างไม่ทัน และได้รับอนุมัติยกเว้น <strong>คะแนนจะคงที่เท่าเดิม ไม่หักเพิ่ม</strong> (เช่น เดิมหลุดแผนเหลือ 75 คะแนน เมื่อขอขยายเพราะเหตุสุดวิสัย คะแนนจะคงที่ 75 คะแนนเท่าเดิม ไม่ลดลงไป 50)
            </p>
          </div>
        </div>
      )}

      {/* Main Role Selector Tabs (3 Levels) */}
      <div className="flex border-b border-slate-200 gap-2 sm:gap-4 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => {
            setActiveRoleView('foreman');
            setSelectedForemanFilter(null);
            setSelectedSeFilter(null);
          }}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-xs sm:text-sm transition-all cursor-pointer whitespace-nowrap ${
            activeRoleView === 'foreman'
              ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <HardHat size={16} />
          คะแนนรายโฟร์แมน (Foreman Leaderboard)
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeRoleView === 'foreman' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {foremanSummaries.length} คน
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveRoleView('site_engineer');
            setSelectedForemanFilter(null);
            setSelectedSeFilter(null);
          }}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-xs sm:text-sm transition-all cursor-pointer whitespace-nowrap ${
            activeRoleView === 'site_engineer'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <User size={16} />
          คะแนน Site Engineer (SE Leaderboard)
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeRoleView === 'site_engineer' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {siteEngineerSummaries.length} ท่าน
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveRoleView('planner');
            setSelectedForemanFilter(null);
            setSelectedSeFilter(null);
          }}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-xs sm:text-sm transition-all cursor-pointer whitespace-nowrap ${
            activeRoleView === 'planner'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <BarChart3 size={16} />
          คะแนน Project Planner & ภาพรวมแปลง
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeRoleView === 'planner' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {plannerSummary.overallScore} คะแนน
          </span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: FOREMAN LEADERBOARD                                               */}
      {/* ========================================================================= */}
      {activeRoleView === 'foreman' && (
        <div className="space-y-6">
          {/* Header Description */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div>
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <HardHat className="text-amber-500" size={18} />
                ผลการประเมินคะแนนรายโฟร์แมน (Foreman Planning Performance)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ประเมินจากความแม่นยำของแผนงานในแปลงที่ตนรับผิดชอบ (หัก 25 คะแนนต่อการขยายเวลาที่ไม่ได้รับการยกเว้น)
              </p>
            </div>
            {selectedForemanFilter && (
              <button
                type="button"
                onClick={() => setSelectedForemanFilter(null)}
                className="text-xs font-bold text-amber-600 hover:underline cursor-pointer"
              >
                ✕ แสดงโฟร์แมนทุกคน
              </button>
            )}
          </div>

          {/* Foreman Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {foremanSummaries.map((fm) => {
              const isSelected = selectedForemanFilter === fm.name;
              return (
                <div
                  key={fm.name}
                  onClick={() => setSelectedForemanFilter(isSelected ? null : fm.name)}
                  className={`p-5 rounded-3xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-amber-50/50 border-amber-400 ring-2 ring-amber-400/30 shadow-md'
                      : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-sm'
                  }`}
                >
                  <div>
                    {/* Top Row: Name and Score */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 font-black text-sm flex items-center justify-center shrink-0 border border-amber-200">
                          {fm.name.substring(0, 2)}
                        </div>
                        <div>
                          <h3 className="font-black text-base text-slate-900 leading-tight">
                            {fm.name}
                          </h3>
                          <span className="text-[11px] font-bold text-slate-400 block mt-0.5">
                            โฟร์แมนผู้รับผิดชอบ
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black border ${fm.badgeStyle.bg} ${fm.badgeStyle.text} ${fm.badgeStyle.border}`}>
                          {fm.avgScore} คะแนน
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 block mt-0.5">
                          ({fm.grade})
                        </span>
                      </div>
                    </div>

                    {/* Stats pills */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-2xl text-center mb-3 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">แปลงในมือ</span>
                        <span className="font-black text-slate-800 text-sm">{fm.totalPlots}</span>
                      </div>
                      <div className="border-x border-slate-200">
                        <span className="text-[10px] font-bold text-slate-400 block">ล็อก Baseline</span>
                        <span className="font-black text-indigo-600 text-sm">{fm.lockedPlots}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">แปลงที่ขยาย</span>
                        <span className={`font-black text-sm ${fm.penalizedPlotsCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {fm.penalizedPlotsCount}
                        </span>
                      </div>
                    </div>

                    {/* Plots list preview */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-500 block">
                        แปลงที่รับผิดชอบ ({fm.plots.length} แปลง):
                      </span>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                        {fm.plots.map((p: any) => {
                          const base = parsePlotBaseline(p);
                          const pStyle = getScoreBadgeStyle(base.score);
                          return (
                            <span
                              key={p.id}
                              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                                base.isLocked ? `${pStyle.bg} ${pStyle.border} ${pStyle.text}` : 'bg-slate-100 text-slate-500 border-slate-200'
                              }`}
                            >
                              แปลง {p.plot_name || p.id}
                              {base.isLocked && <span className="text-[9px] opacity-80">({base.score}p)</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 mt-4 flex items-center justify-between text-xs">
                    <span className="text-[11px] font-bold text-amber-600">
                      {isSelected ? '✓ กำลังกรองแปลงด้านล่าง' : 'คลิกเพื่อกรองเฉพาะแปลงนี้'}
                    </span>
                    <ChevronRight size={14} className="text-slate-400" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: SITE ENGINEER LEADERBOARD                                         */}
      {/* ========================================================================= */}
      {activeRoleView === 'site_engineer' && (
        <div className="space-y-6">
          {/* Header Description */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div>
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <User className="text-blue-600" size={18} />
                ผลการประเมินคะแนน Site Engineer (SE Planning Performance)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                คำนวณตาม <strong>สูตรถ่วงน้ำหนัก (Plot-Weighted Average)</strong> จากคะแนนของทุกแปลงที่อยู่ในความดูแลของวิศวกร
              </p>
            </div>
            {selectedSeFilter && (
              <button
                type="button"
                onClick={() => setSelectedSeFilter(null)}
                className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
              >
                ✕ แสดงวิศวกรทุกคน
              </button>
            )}
          </div>

          {/* Site Engineer Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {siteEngineerSummaries.map((se) => {
              const isSelected = selectedSeFilter === se.name;
              return (
                <div
                  key={se.name}
                  onClick={() => setSelectedSeFilter(isSelected ? null : se.name)}
                  className={`p-5 rounded-3xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-400/30 shadow-md'
                      : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
                  }`}
                >
                  <div>
                    {/* Top Row: Name and Weighted Score */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-800 font-black text-sm flex items-center justify-center shrink-0 border border-blue-200">
                          SE
                        </div>
                        <div>
                          <h3 className="font-black text-base text-slate-900 leading-tight">
                            {se.name}
                          </h3>
                          <span className="text-[11px] font-bold text-slate-400 block mt-0.5">
                            วิศวกรโครงการ (Site Engineer)
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black border ${se.badgeStyle.bg} ${se.badgeStyle.text} ${se.badgeStyle.border}`}>
                          {se.weightedAvgScore} คะแนน
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 block mt-0.5">
                          ({se.grade})
                        </span>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-2xl text-center mb-3 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block">แปลงทั้งหมดในสายงาน</span>
                        <span className="font-black text-slate-800 text-sm">{se.totalPlots} แปลง</span>
                      </div>
                      <div className="border-l border-slate-200">
                        <span className="text-[10px] font-bold text-slate-400 block">ล็อก Baseline แล้ว</span>
                        <span className="font-black text-indigo-600 text-sm">{se.lockedPlots} แปลง</span>
                      </div>
                    </div>

                    {/* Foremen supervised */}
                    <div className="space-y-1.5 mb-2">
                      <span className="text-[11px] font-bold text-slate-500 block">
                        โฟร์แมนในสายงาน ({se.foremen.length} คน):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {se.foremen.length > 0 ? (
                          se.foremen.map((fm, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200">
                              <HardHat size={11} className="text-amber-500" />
                              {fm}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400 italic">ยังไม่มีการผูกโฟร์แมน</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 mt-4 flex items-center justify-between text-xs">
                    <span className="text-[11px] font-bold text-blue-600">
                      {isSelected ? '✓ กำลังกรองแปลงด้านล่าง' : 'คลิกเพื่อกรองเฉพาะแปลงในสายงาน'}
                    </span>
                    <ChevronRight size={14} className="text-slate-400" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: PROJECT PLANNER HYBRID DASHBOARD                                  */}
      {/* ========================================================================= */}
      {activeRoleView === 'planner' && (
        <div className="space-y-6">
          {/* Planner Hybrid KPI Card */}
          <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 text-white p-6 md:p-8 rounded-3xl shadow-lg border border-indigo-800/60 relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-indigo-800/60">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-indigo-300 block mb-1">
                    คะแนนประเมิน Project Planner (Hybrid Score 30% + 70%)
                  </span>
                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl md:text-5xl font-black text-white">
                      {plannerSummary.overallScore}
                    </span>
                    <span className="text-base font-bold text-indigo-300">/ 100 คะแนน</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-black border ${plannerSummary.badgeStyle.bg} ${plannerSummary.badgeStyle.text} ${plannerSummary.badgeStyle.border}`}>
                      เกรด {plannerSummary.grade}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* 30% Baseline Setup Component */}
                  <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/15">
                    <span className="text-[11px] font-bold text-indigo-200 block mb-0.5">
                      1. ความเร็วการตั้ง Baseline (30%)
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-amber-300">{plannerSummary.baselineSetupScore}</span>
                      <span className="text-xs text-indigo-200 font-bold">/ 100</span>
                    </div>
                    <span className="text-[10px] text-indigo-200 block mt-1">
                      ล็อกแล้ว {plannerSummary.lockedPlots} / {plannerSummary.totalPlots} แปลง ({plannerSummary.lockPercentage}%)
                    </span>
                  </div>

                  {/* 70% Site Execution Component */}
                  <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/15">
                    <span className="text-[11px] font-bold text-indigo-200 block mb-0.5">
                      2. ความแม่นยำหน้างานจริง (70%)
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-emerald-300">{plannerSummary.siteExecutionScore}</span>
                      <span className="text-xs text-indigo-200 font-bold">/ 100</span>
                    </div>
                    <span className="text-[10px] text-indigo-200 block mt-1">
                      ค่าเฉลี่ยถ่วงน้ำหนักจาก Site Engineer ทุกคน
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-indigo-200 gap-2">
                <span>สูตรคำนวณ: (คะแนนตั้ง Baseline × 30%) + (คะแนนเฉลี่ยหน้างาน Site Engineer × 70%)</span>
                <span className="text-amber-300 font-bold">โครงการ: {selectedProjectId === 'all' ? 'ทุกโครงการที่เปิดขาย' : selectedProjectId}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PLOT SCORES DIRECTORY TABLE (SHARED ACROSS ALL VIEWS)                     */}
      {/* ========================================================================= */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
              <Layers className="text-indigo-600" size={18} />
              สารบบแปลงบ้านและประวัติคะแนนแผนงาน
              {selectedForemanFilter && (
                <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                  โฟร์แมน: {selectedForemanFilter}
                </span>
              )}
              {selectedSeFilter && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold">
                  SE: {selectedSeFilter}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              แสดงสถานะแผนงานหลัก (Baseline), โฟร์แมน, วิศวกร (SE), และประวัติการขอขยายเวลา
            </p>
          </div>

          {(selectedForemanFilter || selectedSeFilter) && (
            <button
              type="button"
              onClick={() => {
                setSelectedForemanFilter(null);
                setSelectedSeFilter(null);
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 px-3 py-1.5 rounded-xl cursor-pointer"
            >
              ล้างตัวกรองสายงาน
            </button>
          )}
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
            <span className="text-base font-black">{allPlotItems.length} แปลง</span>
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
            <span className="text-base font-black">{plannerSummary.lockedPlots} แปลง</span>
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
            <span className="text-base font-black">{allPlotItems.length - plannerSummary.lockedPlots} แปลง</span>
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
            <span className="text-base font-black">{scoreDistribution[100]} แปลง</span>
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
            <span className="text-base font-black">{scoreDistribution[75]} แปลง</span>
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
            <span className="text-base font-black">{scoreDistribution[50]} แปลง</span>
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
            <span className="text-base font-black">{scoreDistribution[25]} แปลง</span>
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
            <span className="text-base font-black">{scoreDistribution[0]} แปลง</span>
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
              placeholder="ค้นหาเลขแปลง, โฟร์แมน, SE หรือแบบบ้าน..."
              className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
            />
            {scoreSearchText && (
              <button
                type="button"
                onClick={() => setScoreSearchText('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-bold w-full sm:w-auto text-left sm:text-right">
            แสดง <span className="text-slate-900 font-black">{filteredPlots.length}</span> จากทั้งหมด <span className="text-slate-900 font-black">{allPlotItems.length}</span> แปลง
            {(scoreFilterTab !== 'all' || selectedForemanFilter || selectedSeFilter) && (
              <button
                type="button"
                onClick={() => {
                  setScoreFilterTab('all');
                  setSelectedForemanFilter(null);
                  setSelectedSeFilter(null);
                }}
                className="ml-2 text-indigo-600 hover:underline text-xs font-bold cursor-pointer"
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
                  className="p-4 rounded-3xl border border-slate-200 bg-white hover:border-amber-400 hover:shadow-md transition-all flex flex-col justify-between"
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

                    {/* Personnel box: Foreman & Site Engineer */}
                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-2xl border border-slate-200 text-slate-600 mb-2.5">
                      <div className="truncate">
                        <span className="text-[10px] text-slate-400 font-bold block">โฟร์แมน</span>
                        <span className="font-black text-slate-800 flex items-center gap-1 truncate mt-0.5">
                          <HardHat size={12} className="text-amber-500 shrink-0" />
                          {item.foremanName}
                        </span>
                      </div>

                      <div className="truncate border-l border-slate-200 pl-2">
                        <span className="text-[10px] text-slate-400 font-bold block">Site Engineer</span>
                        {isAdmin || isOwner || isProjectPlanner ? (
                          <select
                            value={item.siteEngineer || 'วิศวกรส่วนกลาง'}
                            onChange={(e) => handleAssignSiteEngineer(item.plot, e.target.value)}
                            disabled={updatingPlotSeId === item.plot.id}
                            className="text-[11px] font-bold bg-white border border-slate-300 rounded-md px-1.5 py-0.5 text-slate-800 mt-0.5 w-full outline-none focus:border-blue-500 cursor-pointer"
                          >
                            <option value="วิศวกรส่วนกลาง">วิศวกรส่วนกลาง</option>
                            {siteEngineersList.map((se: any, i: number) => {
                              const seName = se.username || se.name;
                              return (
                                <option key={se.id || seName || `se-${i}`} value={seName}>
                                  {seName}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <span className="font-black text-slate-800 flex items-center gap-1 truncate mt-0.5">
                            <User size={12} className="text-blue-500 shrink-0" />
                            {item.siteEngineer}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Baseline Details Box */}
                    <div className="text-xs bg-slate-50 p-3 rounded-2xl mb-3 space-y-2">
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
