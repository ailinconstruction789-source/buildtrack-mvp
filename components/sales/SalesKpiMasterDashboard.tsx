'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Award, TrendingUp, Users, Target, CheckCircle2, AlertTriangle, AlertCircle, 
  Calendar, ShieldCheck, FileText, Sparkles, RefreshCw, Printer, ArrowLeft,
  ChevronDown, Star, Clock, Brain, UserCheck, Flame, Scale, Video, Check, Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchSalesWithoutLimit } from '@/lib/sales/fetchWithoutLimit';
import { normalizeSalesOwner } from '@/lib/salesNames';
import { getLeadStage } from '@/lib/sales/leadStage';

interface Props {
  currentUser?: {
    username?: string;
    displayName?: string;
    role?: string;
  } | null;
  projects?: any[];
  plots?: any[];
  onBack?: () => void;
}

// 👥 Sales Team Master Roster based on AILIN_Sales_JD_KPI_Master_v2.md
export const SALES_ROSTER = [
  {
    id: 'BELL',
    name: 'Bell',
    fullName: 'พนิดดา (เบล)',
    title: 'Head Sale',
    mission: 'ทำยอดขายส่วนตัว พร้อมบริหาร Pipeline และผลลัพธ์ของทีมขาย',
    salesTarget: 3,
    criticalRule: 'ต่ำกว่า 3 หลังติดต่อกัน 3 เดือน → Performance Review / Warning',
    weights: { sales: 30, leads: 10, team: 10, crm: 10, leadership: 10, mindset: 10, learning: 10, attendance: 10 },
    color: 'from-amber-500 to-orange-600',
    avatar: '👑'
  },
  {
    id: 'PIEW',
    name: 'Piwe',
    fullName: 'ปวีณา (เปิ้ล)',
    title: 'Sale',
    mission: 'เปลี่ยน Lead เป็นนัดชม จอง และยอดขาย ด้วย Follow-up และ Closing ที่เป็นระบบ',
    salesTarget: 3,
    criticalRule: 'ต่ำกว่า 3 หลังติดต่อกัน 3 เดือน → Performance Review / Warning',
    weights: { sales: 35, leads: 15, conversion: 10, crm: 10, mindset: 10, learning: 10, attendance: 10 },
    color: 'from-blue-500 to-indigo-600',
    avatar: '🎯'
  },
  {
    id: 'YING',
    name: 'Ying',
    fullName: 'จริยา (หญิง)',
    title: 'Content Creator + Sale',
    mission: 'สร้าง Demand จาก Content และเปลี่ยน Content / Lead เป็นยอดขาย',
    salesTarget: 1,
    criticalRule: 'เดือนใด Sales = 0 หลัง → Sales Performance Review ทันที',
    weights: { sales: 20, leads: 15, contentOutput: 15, contentToLead: 10, crm: 10, mindset: 10, learning: 10, attendance: 10 },
    color: 'from-rose-500 to-pink-600',
    avatar: '🎬'
  },
  {
    id: 'NOOK',
    name: 'Nook',
    fullName: 'สุมลยา (นุ๊ก)',
    title: 'นิติกร + Sale',
    mission: 'ทำให้กระบวนการจอง → เอกสาร → สินเชื่อ → โอน ถูกต้อง ตรงเวลา พร้อมสร้างยอดขาย',
    salesTarget: 1,
    criticalRule: 'เดือนใด Sales = 0 หลัง หรือเกิด Critical Legal Error → Review ทันที',
    weights: { sales: 15, leads: 10, legalAccuracy: 15, onTimeTransfer: 15, crm: 15, mindset: 10, learning: 10, attendance: 10 },
    color: 'from-purple-500 to-indigo-600',
    avatar: '⚖️'
  },
  {
    id: 'FIELD',
    name: 'Field',
    fullName: 'กรุณพล (ฟิลด์)',
    title: 'ผู้ช่วยนิติกร + Sale',
    mission: 'Support งานนิติกรรมให้รวดเร็ว ถูกต้อง ไม่มีงานตกหล่น พร้อมดูแล Lead และ Sales Pipeline ของตนเอง',
    salesTarget: 1,
    criticalRule: 'เดือนใด Sales = 0 หลัง → Sales Performance Review ทันที',
    weights: { sales: 15, leads: 10, taskOnTime: 15, docAccuracy: 15, crm: 15, mindset: 10, learning: 10, attendance: 10 },
    color: 'from-teal-500 to-emerald-600',
    avatar: '📂'
  }
];

export default function SalesKpiMasterDashboard({
  currentUser,
  onBack
}: Props) {
  // 🗓️ Period selection
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1); // 1-12
  const [activeTab, setActiveTab] = useState<string>('overview'); // 'overview' | 'BELL' | 'PIEW' | 'YING' | 'NOOK' | 'FIELD'

  // 📦 Data state
  const [leads, setLeads] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // 📝 Manual Assessment State (Stored per month-year-person)
  const storageKey = `ailin_kpi_eval_${selectedYear}_${selectedMonth}`;
  const [evaluations, setEvaluations] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Load evaluations from localStorage & Supabase
  useEffect(() => {
    let isMounted = true;

    // 1. Instant load from local storage backup
    let localData: Record<string, any> = {};
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        localData = JSON.parse(saved);
        setEvaluations(localData);
      } else {
        setEvaluations({});
      }
    } catch {
      setEvaluations({});
    }

    // 2. Fetch latest shared evaluations from Supabase table
    const loadFromSupabase = async () => {
      try {
        const { data, error } = await supabase
          .from('sales_kpi_evaluations')
          .select('*')
          .eq('year', selectedYear)
          .eq('month', selectedMonth);

        if (!isMounted) return;

        if (!error && data && data.length > 0) {
          const merged: Record<string, any> = { ...localData };
          data.forEach((row: any) => {
            if (row.agent_id) {
              merged[row.agent_id] = {
                ...(row.evaluations_data || {}),
                executiveFeedback: row.executive_feedback || row.evaluations_data?.executiveFeedback || ''
              };
            }
          });
          setEvaluations(merged);
          try {
            localStorage.setItem(storageKey, JSON.stringify(merged));
          } catch {}
        }
      } catch (err) {
        console.warn('Could not load evaluations from Supabase (using local backup):', err);
      }
    };

    loadFromSupabase();

    return () => {
      isMounted = false;
    };
  }, [selectedYear, selectedMonth, storageKey]);

  // Fetch real-time sales & leads
  const fetchData = useCallback(async (fresh = false) => {
    if (fresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [leadsData, salesData] = await Promise.all([
        fetchSalesWithoutLimit('leads', { orderBy: 'created_at', ascending: false }),
        fetchSalesWithoutLimit('sales', { orderBy: 'created_at', ascending: false })
      ]);
      setLeads(leadsData || []);
      setSales(salesData || []);
    } catch (err) {
      console.error('Error fetching KPI data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 📊 Calculate KPI metrics for a staff member in the selected month & year
  const getAgentMetrics = useCallback((agentId: string) => {
    const isMatchingAgent = (name?: string) => {
      if (!name) return false;
      const normalized = normalizeSalesOwner(name);
      return normalized.toUpperCase() === agentId.toUpperCase();
    };

    // Filter leads created or updated in this month & year
    const agentLeads = leads.filter(l => {
      const owner = l.sales_owner || l.agent_name || l.created_by_agent;
      if (!isMatchingAgent(owner)) return false;

      const dateStr = l.created_at || l.lead_date;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth;
    });

    // Qualified Leads: has phone, valid project, not lost immediately
    const qualifiedLeads = agentLeads.filter(l => {
      const stage = getLeadStage(l);
      return stage !== 'lost' && l.project_name && (l.phone || l.customer_name);
    });

    // Sales Count (Booked or Transferred in selected month/year)
    // 1. From sales table
    const matchingSales = sales.filter(s => {
      if (!isMatchingAgent(s.agent_name || s.owner_name)) return false;
      const dateStr = s.booked_at || s.transferred_date || s.created_at;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth;
    });

    // 2. From leads with booked/transferred status in this month/year (de-duplicate by lead/customer)
    const bookedLeads = leads.filter(l => {
      const owner = l.sales_owner || l.agent_name || l.created_by_agent;
      if (!isMatchingAgent(owner)) return false;
      const stage = getLeadStage(l);
      if (stage !== 'booked' && stage !== 'transferred') return false;
      const dateStr = l.booking_date || l.transferred_date || l.updated_at;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth;
    });

    // Unique sales count
    const uniqueSaleIds = new Set<string>();
    matchingSales.forEach(s => uniqueSaleIds.add(String(s.id || s.saleId)));
    bookedLeads.forEach(l => {
      if (l.saleId) uniqueSaleIds.add(String(l.saleId));
      else uniqueSaleIds.add(`lead-${l.id}`);
    });
    const actualSales = Math.max(matchingSales.length, uniqueSaleIds.size, bookedLeads.length);

    // Follow-up discipline score
    const activeLeads = leads.filter(l => {
      const owner = l.sales_owner || l.agent_name || l.created_by_agent;
      if (!isMatchingAgent(owner)) return false;
      const stage = getLeadStage(l);
      return ['active', 'appointment', 'loan'].includes(stage);
    });

    const leadsWithNextFollowUp = activeLeads.filter(l => Boolean(l.appointment_date || l.next_follow_up || l.next_action));
    const followUpDisciplinePercent = activeLeads.length > 0
      ? Math.round((leadsWithNextFollowUp.length / activeLeads.length) * 100)
      : 100;

    return {
      agentLeadsCount: agentLeads.length,
      qualifiedLeadsCount: qualifiedLeads.length,
      actualSales,
      activeLeadsCount: activeLeads.length,
      followUpDisciplinePercent
    };
  }, [leads, sales, selectedYear, selectedMonth]);

  // Total Team Sales Count
  const totalTeamSales = useMemo(() => {
    return SALES_ROSTER.reduce((sum, member) => {
      return sum + getAgentMetrics(member.id).actualSales;
    }, 0);
  }, [getAgentMetrics]);

  // Update evaluation for specific agent
  const updateAgentEval = (agentId: string, field: string, value: any) => {
    const current = evaluations[agentId] || {};
    const updated = {
      ...evaluations,
      [agentId]: {
        ...current,
        [field]: value
      }
    };
    setEvaluations(updated);
  };

  // Calculate overall score for a staff member (0 - 100%)
  const calculateFinalScore = useCallback((member: typeof SALES_ROSTER[0]) => {
    const metrics = getAgentMetrics(member.id);
    const agentEval = evaluations[member.id] || {};

    // 1. Sales Score (Max weight: member.weights.sales)
    const salesAchievementRate = Math.min(metrics.actualSales / member.salesTarget, 1.25); // cap at 125%
    const salesScore = Math.round(salesAchievementRate * member.weights.sales);

    // 2. Qualified Lead Score (Max: member.weights.leads)
    const leadTarget = 10; // Baseline standard
    const leadAchievementRate = Math.min(metrics.qualifiedLeadsCount / leadTarget, 1.2);
    const leadScore = Math.round(leadAchievementRate * member.weights.leads);

    // 3. CRM Discipline Score (Max: member.weights.crm)
    const crmScore = Math.round((metrics.followUpDisciplinePercent / 100) * member.weights.crm);

    // 4. Role-specific core items
    let roleCoreScore = 0;
    if (member.id === 'BELL') {
      const teamAchieve = Math.min(totalTeamSales / 9, 1.2);
      const teamScore = Math.round(teamAchieve * 10);
      const leadershipScore = (agentEval.leadershipRating ?? 4) * 2; // max 10
      roleCoreScore = teamScore + leadershipScore;
    } else if (member.id === 'PIEW') {
      const conversionScore = (agentEval.conversionRating ?? 4) * 2; // max 10
      roleCoreScore = conversionScore;
    } else if (member.id === 'YING') {
      const contentOutput = Math.min((agentEval.contentCount ?? 15) / 15, 1) * 15;
      const contentToLead = (agentEval.contentLeadQuality ?? 4) * 2; // max 10
      roleCoreScore = Math.round(contentOutput + contentToLead);
    } else if (member.id === 'NOOK') {
      const legalAccuracy = (agentEval.legalAccuracy ?? 4.5) * 3; // max 15
      const onTimeTransfer = (agentEval.onTimeTransfer ?? 4.5) * 3; // max 15
      roleCoreScore = Math.round(legalAccuracy + onTimeTransfer);
    } else if (member.id === 'FIELD') {
      const taskOnTime = (agentEval.taskOnTime ?? 4.5) * 3; // max 15
      const docAccuracy = (agentEval.docAccuracy ?? 4.5) * 3; // max 15
      roleCoreScore = Math.round(taskOnTime + docAccuracy);
    }

    // 5. Mindset & Organization (Max: 10%)
    const mindsetScores = agentEval.mindset || { ownership: 4, accountability: 4, proactive: 4, teamwork: 4, orgFirst: 4 };
    const avgMindset = (
      (mindsetScores.ownership || 4) +
      (mindsetScores.accountability || 4) +
      (mindsetScores.proactive || 4) +
      (mindsetScores.teamwork || 4) +
      (mindsetScores.orgFirst || 4)
    ) / 5;
    const mindsetScore = Math.round((avgMindset / 5) * 10);

    // 6. Learning & Development (Max: 10%)
    const learningPoints = (agentEval.learningItems || [true, true, true, false, false]).filter(Boolean).length * 20;
    const learningScore = Math.round((learningPoints / 100) * 10);

    // 7. Attendance (Max: 10%)
    const lateMinutes = agentEval.lateMinutes ?? 0;
    let attendanceScore = 10;
    if (lateMinutes > 100) attendanceScore = 5;
    else if (lateMinutes > 80) attendanceScore = 6;
    else if (lateMinutes > 60) attendanceScore = 7;
    else if (lateMinutes > 40) attendanceScore = 8;
    else if (lateMinutes > 20) attendanceScore = 9;

    if (agentEval.sickLeavePenalty) {
      attendanceScore = Math.max(0, attendanceScore - 5);
    }

    const total = salesScore + leadScore + crmScore + roleCoreScore + mindsetScore + learningScore + attendanceScore;
    return Math.min(100, Math.max(0, total));
  }, [evaluations, getAgentMetrics, totalTeamSales]);

  // Save evaluations to Supabase & localStorage
  const handleSaveEvaluations = async () => {
    setIsSaving(true);
    try {
      // 1. Instant save to local storage
      localStorage.setItem(storageKey, JSON.stringify(evaluations));

      // 2. Prepare database payload for each staff member
      const records = SALES_ROSTER.map(member => {
        const agentEval = evaluations[member.id] || {};
        const metrics = getAgentMetrics(member.id);
        const score = calculateFinalScore(member);
        return {
          year: selectedYear,
          month: selectedMonth,
          agent_id: member.id,
          reviewer_username: currentUser?.username || 'TEAW',
          evaluations_data: agentEval,
          final_score: score,
          actual_sales: metrics.actualSales,
          qualified_leads: metrics.qualifiedLeadsCount,
          executive_feedback: agentEval.executiveFeedback || '',
          updated_at: new Date().toISOString()
        };
      });

      // 3. Upsert into Supabase sales_kpi_evaluations
      const { error } = await supabase
        .from('sales_kpi_evaluations')
        .upsert(records, { onConflict: 'year,month,agent_id' });

      if (error) {
        console.warn('Supabase KPI save notice:', error);
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
          setSaveNotice('บันทึกผลการประเมินเรียบร้อยแล้ว (จัดเก็บในเครื่อง - ยังไม่ได้รัน SQL ใน Supabase)');
        } else {
          setSaveNotice(`บันทึกผลการประเมินเรียบร้อยแล้ว (คลาวด์: ${error.message || 'บันทึกไม่สำเร็จ'})`);
        }
      } else {
        setSaveNotice('บันทึกผลการประเมินเรียบร้อยแล้ว (บันทึกลง Supabase และเครื่องนี้)');
      }
    } catch (err) {
      console.error('Error saving evaluations:', err);
      setSaveNotice('บันทึกผลการประเมินเรียบร้อยแล้ว');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveNotice(null), 4000);
    }
  };

  const getScoreGrade = (score: number) => {
    if (score >= 90) return { label: '🌟 ดีเยี่ยม (Excellence)', color: 'text-emerald-700 bg-emerald-50 border-emerald-300' };
    if (score >= 80) return { label: '🟢 ผ่านเกณฑ์ตามมาตรฐาน (Good)', color: 'text-blue-700 bg-blue-50 border-blue-300' };
    if (score >= 70) return { label: '🟡 เฝ้าระวัง / ต้องพัฒนา', color: 'text-amber-700 bg-amber-50 border-amber-300' };
    return { label: '🔴 ต่ำกว่าเกณฑ์วิกฤต (Critical)', color: 'text-rose-700 bg-rose-50 border-rose-300' };
  };

  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const currentMember = SALES_ROSTER.find(m => m.id === activeTab);

  return (
    <div className="w-full min-h-screen bg-slate-50 flex flex-col space-y-6 pb-20">
      
      {/* 🌟 1. Executive Top Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white border-b border-amber-500/30 shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            {onBack && (
              <button 
                onClick={onBack}
                type="button"
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                title="กลับหน้าหลัก"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20 shrink-0">
              <Award size={26} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                  แดชบอร์ด KPI ฝ่ายขาย (Sales KPI Master)
                </h1>
                <span className="px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1">
                  <Sparkles size={11} /> Executive Only
                </span>
              </div>
              <p className="text-xs text-amber-200/80 font-medium mt-0.5 flex items-center gap-1.5">
                <span>👤 ผู้ประเมิน: <strong>{currentUser?.displayName || currentUser?.username || 'TEAW'}</strong></span>
                <span>•</span>
                <span>มาตรฐาน Master Spec: AILIN Sales JD & KPI v2</span>
              </p>
            </div>
          </div>

          {/* Month / Year Filters & Actions */}
          <div className="flex items-center gap-2.5 flex-wrap">
            
            {/* Year Selector */}
            <div className="relative">
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="appearance-none bg-slate-800/90 border border-slate-700 text-white rounded-xl px-3.5 py-2 pr-8 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none cursor-pointer"
              >
                <option value={2026}>ปี 2026</option>
                <option value={2025}>ปี 2025</option>
                <option value={2024}>ปี 2024</option>
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

            {/* Month Selector */}
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(Number(e.target.value))}
                className="appearance-none bg-slate-800/90 border border-slate-700 text-white rounded-xl px-3.5 py-2 pr-8 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none cursor-pointer"
              >
                {monthNames.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>เดือน {name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer shadow-xs disabled:opacity-50"
              title="รีเฟรชข้อมูลล่าสุด"
            >
              <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-amber-400' : ''} />
            </button>

            {/* Print / Report */}
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-amber-500/20"
              title="พิมพ์รายงานสรุปผล"
            >
              <Printer size={15} /> พิมพ์รายงาน (A4)
            </button>

            {/* Save All Evaluations to Supabase */}
            <button
              type="button"
              onClick={handleSaveEvaluations}
              disabled={isSaving}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-600/20 disabled:opacity-60"
              title="บันทึกผลการประเมินทีมขายลง Supabase"
            >
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกการประเมิน'}</span>
            </button>

          </div>

        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6 w-full">

        {/* 🔔 Save Notice Banner */}
        {saveNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl flex items-center gap-2 text-xs font-bold shadow-xs animate-in fade-in duration-200">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{saveNotice}</span>
          </div>
        )}

        {/* 🎛️ Navigation Pills (Overview + 5 Staff Members) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Users size={16} /> ภาพรวมทีมขายทั้งหมด (Overview)
          </button>

          {SALES_ROSTER.map(member => {
            const isSelected = activeTab === member.id;
            const metrics = getAgentMetrics(member.id);
            const isAlert = member.salesTarget === 1 ? metrics.actualSales === 0 : metrics.actualSales < member.salesTarget;

            return (
              <button
                key={member.id}
                type="button"
                onClick={() => setActiveTab(member.id)}
                className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-2 whitespace-nowrap ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{member.avatar}</span>
                <span>{member.name} ({member.title})</span>
                {isAlert && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
              </button>
            );
          })}
        </div>

        {/* =========================================================
            VIEW 1: TEAM OVERVIEW
        ========================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            {/* Team Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Card 1: ยอดขายรวมทั้งทีม */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-500">🏆 ยอดขายรวมทั้งทีม</span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-black text-slate-900">{totalTeamSales}</span>
                      <span className="text-xs font-bold text-slate-400">/ เป้า 9 หลัง</span>
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                    <Target size={24} />
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
                  <div 
                    className={`h-2 rounded-full transition-all duration-500 ${totalTeamSales >= 9 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, Math.round((totalTeamSales / 9) * 100))}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-slate-500 mt-1 block">
                  ความสำเร็จ {Math.round((totalTeamSales / 9) * 100)}% {totalTeamSales >= 9 ? '🎉 ทะลุเป้าหมาย' : 'กำลังดำเนินการ'}
                </span>
              </div>

              {/* Card 2: จำนวน Qualified Lead รวม */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-500">👥 Qualified Leads รวม</span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-black text-blue-600">
                        {SALES_ROSTER.reduce((sum, m) => sum + getAgentMetrics(m.id).qualifiedLeadsCount, 0)}
                      </span>
                      <span className="text-xs font-bold text-slate-400">ราย (ในเดือนนี้)</span>
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <Flame size={24} />
                  </div>
                </div>
                <span className="text-[11px] font-bold text-slate-400 mt-3 block">
                  Lead คุณภาพที่ผ่านการระบุแปลง/งบประมาณ
                </span>
              </div>

              {/* Card 3: วินัยการติดตาม CRM รวม */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-500">📋 วินัยการติดตาม CRM</span>
                    <div className="flex items-baseline gap-2 mt-1">
                      {(() => {
                        const sum = SALES_ROSTER.reduce((acc, m) => acc + getAgentMetrics(m.id).followUpDisciplinePercent, 0);
                        const avg = Math.round(sum / SALES_ROSTER.length);
                        return (
                          <>
                            <span className={`text-3xl font-black ${avg >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>{avg}%</span>
                            <span className="text-xs font-bold text-slate-400">/ เกณฑ์ ≥95%</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                    <Clock size={24} />
                  </div>
                </div>
                <span className="text-[11px] font-bold text-slate-400 mt-3 block">
                  สัดส่วน Lead ที่มีนัดหมาย & Next Follow-up
                </span>
              </div>

              {/* Card 4: สถานะ Critical Alert */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-500">🚨 สถานะแจ้งเตือนวิกฤต</span>
                    <div className="flex items-baseline gap-2 mt-1">
                      {(() => {
                        const alertCount = SALES_ROSTER.filter(m => {
                          const met = getAgentMetrics(m.id);
                          return m.salesTarget === 1 ? met.actualSales === 0 : met.actualSales < m.salesTarget;
                        }).length;
                        return (
                          <>
                            <span className={`text-3xl font-black ${alertCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {alertCount}
                            </span>
                            <span className="text-xs font-bold text-slate-400">ท่านที่ต้องเฝ้าระวัง</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                    <AlertTriangle size={24} />
                  </div>
                </div>
                <span className="text-[11px] font-bold text-slate-400 mt-3 block">
                  วัดตามเกณฑ์ Critical Sales KPI v2
                </span>
              </div>

            </div>

            {/* Individual Cards Grid */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <UserCheck size={18} className="text-amber-600" /> ตารางเปรียบเทียบผลงานและคะแนน KPI รายบุคคล ({monthNames[selectedMonth - 1]} {selectedYear})
                </h3>
                <span className="text-xs text-slate-500 font-bold">คลิกที่การ์ดเพื่อเปิดดูการประเมินเจาะลึก</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {SALES_ROSTER.map(member => {
                  const metrics = getAgentMetrics(member.id);
                  const score = calculateFinalScore(member);
                  const grade = getScoreGrade(score);
                  const isCritical = member.salesTarget === 1 ? metrics.actualSales === 0 : metrics.actualSales < member.salesTarget;

                  return (
                    <div 
                      key={member.id}
                      onClick={() => setActiveTab(member.id)}
                      className="p-5 rounded-2xl border border-slate-200/90 bg-slate-50/50 hover:bg-white hover:border-amber-400 hover:shadow-md transition-all cursor-pointer space-y-4 relative group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-center text-2xl">
                            {member.avatar}
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-slate-900 group-hover:text-amber-700 transition-colors">
                              {member.name} ({member.fullName})
                            </h4>
                            <span className="text-[11px] font-bold text-slate-500">{member.title}</span>
                          </div>
                        </div>

                        {/* Final Score Pill */}
                        <div className="text-right">
                          <span className="text-xl font-black text-slate-900">{score}%</span>
                          <span className="text-[10px] block font-bold text-slate-400">คะแนนประเมิน</span>
                        </div>
                      </div>

                      {/* Performance Bar */}
                      <div className="grid grid-cols-3 gap-2 p-2.5 bg-white rounded-xl border border-slate-100 text-center">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold block">ยอดขายจริง</span>
                          <span className={`text-sm font-black ${metrics.actualSales >= member.salesTarget ? 'text-emerald-600' : 'text-slate-800'}`}>
                            {metrics.actualSales} / {member.salesTarget}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold block">Qualified</span>
                          <span className="text-sm font-black text-blue-600">{metrics.qualifiedLeadsCount}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold block">CRM วินัย</span>
                          <span className={`text-sm font-black ${metrics.followUpDisciplinePercent >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {metrics.followUpDisciplinePercent}%
                          </span>
                        </div>
                      </div>

                      {/* Grade Badge */}
                      <div className="flex items-center justify-between pt-1">
                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${grade.color}`}>
                          {grade.label}
                        </span>
                        {isCritical && (
                          <span className="text-[10px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <AlertCircle size={11} /> เฝ้าระวัง
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

          </div>
        )}

        {/* =========================================================
            VIEW 2: INDIVIDUAL STAFF SCORECARD
        ========================================================= */}
        {activeTab !== 'overview' && currentMember && (() => {
          const metrics = getAgentMetrics(currentMember.id);
          const agentEval = evaluations[currentMember.id] || {};
          const score = calculateFinalScore(currentMember);
          const grade = getScoreGrade(score);
          const isCritical = currentMember.salesTarget === 1 ? metrics.actualSales === 0 : metrics.actualSales < currentMember.salesTarget;

          return (
            <div className="space-y-6">

              {/* Profile Card & Big Score */}
              <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
                
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white flex items-center justify-center text-3xl shadow-md shadow-orange-500/20 shrink-0">
                    {currentMember.avatar}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-black text-slate-900">{currentMember.name} — {currentMember.fullName}</h2>
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-black text-xs">
                        {currentMember.title}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
                      <strong>Mission:</strong> {currentMember.mission}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs font-black px-2.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md">
                        🎯 เป้าหมายยอดขาย: ≥ {currentMember.salesTarget} หลัง/เดือน
                      </span>
                      {isCritical && (
                        <span className="text-xs font-black px-2.5 py-0.5 bg-rose-50 text-rose-800 border border-rose-200 rounded-md flex items-center gap-1">
                          <AlertTriangle size={13} /> {currentMember.criticalRule}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Big Score Gauge */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-4 shrink-0 justify-between md:justify-start">
                  <div>
                    <span className="text-xs font-black text-slate-500 block">คะแนนประเมินรวม</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-4xl font-black text-slate-900">{score}</span>
                      <span className="text-xs font-bold text-slate-400">/ 100</span>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border mt-1 inline-block ${grade.color}`}>
                      {grade.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveEvaluations}
                    disabled={isSaving}
                    className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกการประเมิน'}</span>
                  </button>
                </div>

              </div>

              {/* 4 Assessment Categories */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* 📋 Section 1: Result & Core Job ตามตำแหน่ง (70%) */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Target size={16} className="text-amber-600" /> หมวด 1: Result + Core Job ตามตำแหน่ง (70%)
                    </h3>
                    <span className="text-[11px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                      น้ำหนัก 70%
                    </span>
                  </div>

                  <div className="space-y-3.5">

                    {/* Indicator 1: Sales Result */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">1. ยอดขายจริงเทียบเป้า (Sales Target ≥ {currentMember.salesTarget} หลัง)</span>
                        <span className="text-xs font-black text-slate-900">น้ำหนัก {currentMember.weights.sales}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">ผลงานจริงในระบบ:</span>
                        <span className={`font-black ${metrics.actualSales >= currentMember.salesTarget ? 'text-emerald-600 font-bold' : 'text-rose-600'}`}>
                          {metrics.actualSales} หลัง ({Math.round((metrics.actualSales / currentMember.salesTarget) * 100)}%)
                        </span>
                      </div>
                    </div>

                    {/* Indicator 2: Qualified Leads */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">2. Qualified Lead คุณภาพ (ระบุแปลง/งบประมาณ/Next Action)</span>
                        <span className="text-xs font-black text-slate-900">น้ำหนัก {currentMember.weights.leads}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">ได้จริงในเดือนนี้:</span>
                        <span className="font-black text-blue-600">{metrics.qualifiedLeadsCount} ราย</span>
                      </div>
                    </div>

                    {/* Indicator 3: CRM Follow-up Discipline */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">3. วินัยการติดตามลูกค้า & CRM (มาตรฐาน ≥95%)</span>
                        <span className="text-xs font-black text-slate-900">น้ำหนัก {currentMember.weights.crm}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">มีนัดหมาย/Next Follow-up Date ครบ:</span>
                        <span className={`font-black ${metrics.followUpDisciplinePercent >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {metrics.followUpDisciplinePercent}% (Active Lead: {metrics.activeLeadsCount} ราย)
                        </span>
                      </div>
                    </div>

                    {/* Role-Specific Core Job Items */}
                    {currentMember.id === 'BELL' && (
                      <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200/80 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-amber-950">4. ยอดขายทีมรวม (Team Sales Target ≥ 9 หลัง) (10%)</span>
                          <span className="text-xs font-black text-amber-900">{totalTeamSales} / 9 หลัง</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-amber-200/60">
                          <span className="font-bold text-amber-900">5. ภาวะผู้นำ / Coaching / Forecast แม่นยำ (10%):</span>
                          <select 
                            value={agentEval.leadershipRating ?? 4}
                            onChange={e => updateAgentEval(currentMember.id, 'leadershipRating', Number(e.target.value))}
                            className="bg-white border border-amber-300 rounded-lg px-2 py-1 text-xs font-bold"
                          >
                            <option value={5}>5 - ยอดเยี่ยม (10%)</option>
                            <option value={4}>4 - ดีมาก (8%)</option>
                            <option value={3}>3 - ตามเกณฑ์ (6%)</option>
                            <option value={2}>2 - ต้องพัฒนา (4%)</option>
                            <option value={1}>1 - วิกฤต (2%)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {currentMember.id === 'PIEW' && (
                      <div className="p-3.5 rounded-2xl bg-blue-50/60 border border-blue-200/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-blue-950">4. Conversion นัดชม / พาชม (Walk-in Closing) (10%)</span>
                          <select 
                            value={agentEval.conversionRating ?? 4}
                            onChange={e => updateAgentEval(currentMember.id, 'conversionRating', Number(e.target.value))}
                            className="bg-white border border-blue-300 rounded-lg px-2 py-1 text-xs font-bold"
                          >
                            <option value={5}>5 - Conversion ยอดเยี่ยม (10%)</option>
                            <option value={4}>4 - ปิดการขายนัดชมได้ดี (8%)</option>
                            <option value={3}>3 - ตามเกณฑ์มาตรฐาน (6%)</option>
                            <option value={2}>2 - ต้องเพิ่มการปิด (4%)</option>
                            <option value={1}>1 - หลุดเป้า (2%)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {currentMember.id === 'YING' && (
                      <div className="p-3.5 rounded-2xl bg-pink-50/60 border border-pink-200/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-pink-950">4. ผลิต Content Output ตามแผน (15%):</span>
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              value={agentEval.contentCount ?? 15}
                              onChange={e => updateAgentEval(currentMember.id, 'contentCount', Number(e.target.value))}
                              className="w-16 bg-white border border-pink-300 rounded-lg px-2 py-1 text-xs font-bold text-center"
                            />
                            <span className="text-pink-900 font-bold">/ เป้า 15 ชิ้น</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {currentMember.id === 'NOOK' && (
                      <div className="p-3.5 rounded-2xl bg-purple-50/60 border border-purple-200/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-purple-950">4. ความถูกต้องเอกสารสัญญา & โอนตรงเวลา (30%):</span>
                          <select 
                            value={agentEval.legalAccuracy ?? 4.5}
                            onChange={e => updateAgentEval(currentMember.id, 'legalAccuracy', Number(e.target.value))}
                            className="bg-white border border-purple-300 rounded-lg px-2 py-1 text-xs font-bold"
                          >
                            <option value={5}>5 - เอกสารสมบูรณ์ 100% ตรงเวลา</option>
                            <option value={4.5}>4.5 - เรียบร้อยดีมาก ไม่มี Error</option>
                            <option value={4}>4 - ผ่านเกณฑ์มาตรฐาน</option>
                            <option value={2}>2 - มีจุดผิดพลาดต้องแก้ไข</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {currentMember.id === 'FIELD' && (
                      <div className="p-3.5 rounded-2xl bg-teal-50/60 border border-teal-200/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-teal-950">4. จัดการเอกสารตรงเวลา & Support นิติกรรม (30%):</span>
                          <select 
                            value={agentEval.taskOnTime ?? 4.5}
                            onChange={e => updateAgentEval(currentMember.id, 'taskOnTime', Number(e.target.value))}
                            className="bg-white border border-teal-300 rounded-lg px-2 py-1 text-xs font-bold"
                          >
                            <option value={5}>5 - ทำงานเสร็จก่อนกำหนด เอกสารถูกต้อง</option>
                            <option value={4.5}>4.5 - ตรงเวลา ไม่มีงานค้าง</option>
                            <option value={4}>4 - ปานกลางตามมาตรฐาน</option>
                            <option value={2}>2 - มีงานล่าช้ากว่ากำหนด</option>
                          </select>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* 🧠 Section 2: Mindset & Organization (10%) */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Brain size={16} className="text-indigo-600" /> หมวด 2: Mindset & Organization (10%)
                    </h3>
                    <span className="text-[11px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                      คะแนนรูบริก (1-5)
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {[
                      { key: 'ownership', label: '1. Ownership (ความเป็นเจ้าของงาน)', desc: 'ใส่ใจในความสำเร็จ ไม่ปัดความรับผิดชอบ' },
                      { key: 'accountability', label: '2. Accountability (รับผิดชอบต่อผลลัพธ์)', desc: 'รักษาสัญญา ทำตามคำมั่น' },
                      { key: 'proactive', label: '3. Proactive (คิดและทำเชิงรุก)', desc: 'ไม่รอให้สั่ง มองเห็นปัญหาก่อนเกิด' },
                      { key: 'teamwork', label: '4. Teamwork (การทำงานร่วมกับทีม)', desc: 'ช่วยสนับสนุนเพื่อนร่วมทีม สื่อสารสร้างสรรค์' },
                      { key: 'orgFirst', label: '5. Organization First (มองประโยชน์องค์กร)', desc: 'ทัศนคติเชิงบวก พัฒนาองค์กรร่วมกัน' },
                    ].map(item => {
                      const mindsetScores = agentEval.mindset || { ownership: 4, accountability: 4, proactive: 4, teamwork: 4, orgFirst: 4 };
                      const currentVal = mindsetScores[item.key] ?? 4;

                      return (
                        <div key={item.key} className="p-2.5 rounded-xl bg-slate-50 flex items-center justify-between gap-3 text-xs">
                          <div>
                            <span className="font-bold text-slate-800 block">{item.label}</span>
                            <span className="text-[10px] text-slate-400">{item.desc}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {[1, 2, 3, 4, 5].map(star => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => {
                                  const nextMindset = { ...mindsetScores, [item.key]: star };
                                  updateAgentEval(currentMember.id, 'mindset', nextMindset);
                                }}
                                className={`w-6 h-6 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                  currentVal >= star
                                    ? 'bg-amber-400 text-slate-900 shadow-2xs'
                                    : 'bg-slate-200 text-slate-400 hover:bg-slate-300'
                                }`}
                              >
                                {star}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 💡 Section 3: Learning & Org Development (10%) */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Sparkles size={16} className="text-blue-600" /> หมวด 3: Learning & AI Development (10%)
                    </h3>
                    <span className="text-[11px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                      ข้อละ 20 คะแนนดิบ
                    </span>
                  </div>

                  <p className="text-xs text-slate-500">
                    วัดจากการนำ AI, เทคโนโลยี, และความรู้ใหม่มาประยุกต์ใช้เพื่อเพิ่มประสิทธิภาพการขายจริง
                  </p>

                  <div className="space-y-2">
                    {[
                      '1. เข้ารับการอบรม / เรียนรู้สิ่งใหม่สม่ำเสมอ (20 คะแนน)',
                      '2. นำความรู้ที่ได้มาปรับปรุงและพัฒนางานจริง (20 คะแนน)',
                      '3. ใช้งาน AI และเทคโนโลยีเพิ่ม Speed & Quality (20 คะแนน)',
                      '4. แบ่งปันความรู้ / Case Sharing ให้เพื่อนในทีม (20 คะแนน)',
                      '5. เสนอแนะโครงการหรือไอเดียเพื่อพัฒนาองค์กร (20 คะแนน)',
                    ].map((label, idx) => {
                      const items = agentEval.learningItems || [true, true, true, false, false];
                      const checked = Boolean(items[idx]);

                      return (
                        <label 
                          key={idx}
                          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-blue-50/40 transition-colors cursor-pointer text-xs font-bold text-slate-700"
                        >
                          <input 
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              const nextItems = [...items];
                              nextItems[idx] = e.target.checked;
                              updateAgentEval(currentMember.id, 'learningItems', nextItems);
                            }}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* ⏱️ Section 4: Attendance & วินัยการเข้างาน (10%) */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Clock size={16} className="text-teal-600" /> หมวด 4: วินัยการเข้างาน (Attendance 10%)
                    </h3>
                    <span className="text-[11px] font-black text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md">
                      รอบสะสม 6 เดือน
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        เวลามาสายสะสมในรอบ 6 เดือน (นาที):
                      </label>
                      <input 
                        type="number"
                        value={agentEval.lateMinutes ?? 0}
                        onChange={e => updateAgentEval(currentMember.id, 'lateMinutes', Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-teal-500"
                        placeholder="0"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">
                        (เกณฑ์: ≤20 นาที = ได้ 10%, 21-40 นาที = 9%, 41-60 นาที = 8%, &gt;100 นาที = 5%)
                      </span>
                    </div>

                    <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 cursor-pointer text-xs font-bold text-slate-700">
                      <input 
                        type="checkbox"
                        checked={Boolean(agentEval.sickLeavePenalty)}
                        onChange={e => updateAgentEval(currentMember.id, 'sickLeavePenalty', e.target.checked)}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                      />
                      <div>
                        <span>ลาป่วยเกิน 7 วันในรอบครึ่งปี</span>
                        <span className="text-[10px] text-rose-600 block">(หัก -10 คะแนนดิบ ตามระเบียบบริษัท)</span>
                      </div>
                    </label>

                    {/* Executive Reviewer Feedback Notes */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        บันทึกข้อเสนอแนะจากผู้บริหาร (Feedback & Action Plan):
                      </label>
                      <textarea
                        rows={2}
                        value={agentEval.executiveFeedback || ''}
                        onChange={e => updateAgentEval(currentMember.id, 'executiveFeedback', e.target.value)}
                        placeholder="เช่น จุดแข็งที่ทำได้ดีมาก, สิ่งที่ต้องโฟกัสเพิ่มเติมเพื่อปิดการขาย..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                </div>

              </div>

            </div>
          );
        })()}

      </div>

    </div>
  );
}
