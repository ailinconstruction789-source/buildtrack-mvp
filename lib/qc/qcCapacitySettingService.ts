// ==============================================================================
// 📋 BUILDTRACK: QC CAPACITY THRESHOLD & HISTORICAL WORKLOAD ANALYTICS SERVICE
// lib/qc/qcCapacitySettingService.ts
// ==============================================================================

import { supabase } from '@/lib/supabase';
import { canManageQCWeights, type QCTaskWeight } from './qcInspectionPlanService';

export interface WeekdayWorkloadStat {
  dayIndex: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  dayName: string; // 'จันทร์', 'อังคาร', ...
  dayAbbr: string; // 'จ.', 'อ.', ...
  totalInspections: number;
  totalPoints: number;
  activeDaysCount: number;
  averagePointsPerDay: number;
  maxPointsSingleDay: number;
}

export interface QCHistoricalCapacityAnalysis {
  analyzedDaysCount: number;
  totalQCInspections: number;
  totalQCPoints: number;
  weekdayStats: WeekdayWorkloadStat[];
  overallAveragePointsPerDay: number;
  overallMaxSingleDayPoints: number;
  peakWeekday: string;
  recommendedThreshold: number;
  recommendationReason: string;
}

const WEEKDAY_NAMES_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const WEEKDAY_ABBRS_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const STORAGE_KEY = 'buildtrack_qc_capacity_threshold';
const DEFAULT_THRESHOLD = 12;

let memoryCapacityThreshold: number = DEFAULT_THRESHOLD;

/**
 * 1. Read Current Capacity Overload Threshold
 * Order of resolution: Database (qc_system_settings) -> LocalStorage -> Memory Cache -> Default (12)
 */
export async function getQCCapacityThreshold(client: any = supabase): Promise<number> {
  // Check LocalStorage first if client-side
  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const num = parseInt(cached, 10);
      if (!isNaN(num) && num >= 6 && num <= 30) {
        memoryCapacityThreshold = num;
      }
    }
  }

  try {
    const { data, error } = await client
      .from('qc_system_settings')
      .select('setting_value')
      .eq('setting_key', 'daily_overload_threshold')
      .maybeSingle();

    if (!error && data && data.setting_value) {
      const val = typeof data.setting_value === 'number' 
        ? data.setting_value 
        : parseInt(String(data.setting_value), 10);

      if (!isNaN(val) && val >= 6 && val <= 30) {
        memoryCapacityThreshold = val;
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, String(val));
        }
        return val;
      }
    }
  } catch {
    // Fallback gracefully
  }

  return memoryCapacityThreshold;
}

/**
 * 2. Save Admin Capacity Overload Threshold
 */
export async function saveQCCapacityThreshold(
  params: {
    threshold: number;
    actorUsername: string;
    actorRole: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; threshold?: number }> {
  const { threshold, actorUsername, actorRole } = params;

  if (!canManageQCWeights(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์กำหนดเกณฑ์ภาระงาน (เฉพาะ Admin หรือ Project Planner)' };
  }

  if (threshold < 6 || threshold > 30 || !Number.isInteger(threshold)) {
    return { success: false, error: 'เกณฑ์ภาระงานต้องเป็นจำนวนเต็มระหว่าง 6 ถึง 30 แต้มต่อวัน' };
  }

  memoryCapacityThreshold = threshold;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, String(threshold));
    window.dispatchEvent(new CustomEvent('qc-capacity-threshold-changed', { detail: { threshold } }));
  }

  try {
    const now = new Date().toISOString();
    await client
      .from('qc_system_settings')
      .upsert([
        {
          setting_key: 'daily_overload_threshold',
          setting_value: threshold,
          description: 'เกณฑ์แต้มภาระงานสูงสุดต่อวันก่อนแจ้งเตือน Overload',
          updated_by: actorUsername,
          updated_at: now,
        },
      ], { onConflict: 'setting_key' });
  } catch {
    // Memory/storage fallback is preserved
  }

  return { success: true, threshold };
}

/**
 * 3. Analyze Historical Inspection Workload (Mon - Sat Breakdown & AI/Statistical Recommendation)
 */
export function analyzeQCHistoricalWorkload(params: {
  allUpdatesRecord?: any[];
  weightsMap?: Map<string, QCTaskWeight>;
  lookbackDays?: number;
}): QCHistoricalCapacityAnalysis {
  const {
    allUpdatesRecord = [],
    weightsMap = new Map(),
    lookbackDays = 60,
  } = params;

  const now = new Date();
  const cutoffTime = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  // Filter updates for QC actions within lookback window
  const validQCUpdates = allUpdatesRecord.filter(upd => {
    if (!upd || !upd.created_at) return false;
    const t = new Date(upd.created_at).getTime();
    if (isNaN(t) || t < cutoffTime) return false;

    const action = String(upd.action || '');
    const role = String(upd.role || '');
    const isQC = role === 'QC' || action.includes('QC') || action.includes('ตรวจ');
    return isQC;
  });

  // Map to daily totals per inspector per day
  // Key: "YYYY-MM-DD_inspector"
  interface DailyInspectorAccumulator {
    dateStr: string;
    dayOfWeek: number;
    inspector: string;
    points: number;
    tasksCount: number;
  }

  const dailyInspectorMap = new Map<string, DailyInspectorAccumulator>();

  validQCUpdates.forEach(upd => {
    const d = new Date(upd.created_at);
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const inspector = String(upd.user_name || 'QC').toLowerCase();
    const key = `${dateStr}_${inspector}`;

    // Get weight
    const tmplId = String(upd.task_template_id || '');
    const w = weightsMap.get(tmplId);
    const pts = w ? w.weight_score : 2; // default 2 points if unconfigured

    const existing = dailyInspectorMap.get(key);
    if (existing) {
      existing.points += pts;
      existing.tasksCount += 1;
    } else {
      dailyInspectorMap.set(key, {
        dateStr,
        dayOfWeek,
        inspector,
        points: pts,
        tasksCount: 1,
      });
    }
  });

  // Group by day of week (1 to 6 = Mon to Sat, and 0 = Sun)
  const weekdayTotals: Record<number, {
    totalPoints: number;
    totalTasks: number;
    dailyPointsList: number[];
    uniqueDates: Set<string>;
  }> = {};

  for (let i = 0; i <= 6; i++) {
    weekdayTotals[i] = {
      totalPoints: 0,
      totalTasks: 0,
      dailyPointsList: [],
      uniqueDates: new Set<string>(),
    };
  }

  let totalQCInspections = 0;
  let totalQCPoints = 0;
  let overallMaxSingleDayPoints = 0;

  dailyInspectorMap.forEach(record => {
    const dow = record.dayOfWeek;
    weekdayTotals[dow].totalPoints += record.points;
    weekdayTotals[dow].totalTasks += record.tasksCount;
    weekdayTotals[dow].dailyPointsList.push(record.points);
    weekdayTotals[dow].uniqueDates.add(record.dateStr);

    totalQCInspections += record.tasksCount;
    totalQCPoints += record.points;
    if (record.points > overallMaxSingleDayPoints) {
      overallMaxSingleDayPoints = record.points;
    }
  });

  // Build weekday stats (Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6)
  const weekdayStats: WeekdayWorkloadStat[] = [];
  let peakDayIndex = 1;
  let peakAverage = 0;

  // We order from Monday (1) to Saturday (6)
  const displayDays = [1, 2, 3, 4, 5, 6];

  displayDays.forEach(dow => {
    const data = weekdayTotals[dow];
    const activeDays = data.uniqueDates.size;
    const avgPts = activeDays > 0 ? Math.round((data.totalPoints / activeDays) * 10) / 10 : 0;
    const maxPts = data.dailyPointsList.length > 0 ? Math.max(...data.dailyPointsList) : 0;

    if (avgPts > peakAverage) {
      peakAverage = avgPts;
      peakDayIndex = dow;
    }

    weekdayStats.push({
      dayIndex: dow,
      dayName: WEEKDAY_NAMES_TH[dow],
      dayAbbr: WEEKDAY_ABBRS_TH[dow],
      totalInspections: data.totalTasks,
      totalPoints: data.totalPoints,
      activeDaysCount: activeDays,
      averagePointsPerDay: avgPts,
      maxPointsSingleDay: maxPts,
    });
  });

  const totalActiveDays = new Set(Array.from(dailyInspectorMap.values()).map(r => r.dateStr)).size;
  const overallAveragePointsPerDay = totalActiveDays > 0 
    ? Math.round((totalQCPoints / totalActiveDays) * 10) / 10 
    : 0;

  // Statistical Recommendation calculation
  let recommendedThreshold = DEFAULT_THRESHOLD;
  let recommendationReason = '';

  if (overallAveragePointsPerDay > 0) {
    // Recommend average * 1.25 (allowing 25% flexibility on peak days), bounded between 8 and 18
    const rawRec = Math.round(overallAveragePointsPerDay * 1.25);
    recommendedThreshold = Math.max(8, Math.min(18, rawRec));
    recommendationReason = `อิงจากสถิติย้อนหลัง ${lookbackDays} วัน มีแต้มตรวจเฉลี่ย ${overallAveragePointsPerDay} แต้ม/วัน โดยวัน${WEEKDAY_NAMES_TH[peakDayIndex]}เป็นวันโหลดสูงสุด (${peakAverage} แต้ม) แนะนำตั้งเกณฑ์ที่ ${recommendedThreshold} แต้ม เพื่อรองรับงานเร่งด่วนโดยไม่กระทบคุณภาพงาน`;
  } else {
    recommendedThreshold = DEFAULT_THRESHOLD;
    recommendationReason = `ยังไม่มีประวัติการบันทึกแต้มตรวจในอดีต แนะนำใช้เกณฑ์มาตรฐานที่ ${DEFAULT_THRESHOLD} แต้ม/วัน (เทียบเท่างานโครงสร้าง 3-4 งาน หรืองานทั่วไป 5-6 งาน)`;
  }

  return {
    analyzedDaysCount: lookbackDays,
    totalQCInspections,
    totalQCPoints,
    weekdayStats,
    overallAveragePointsPerDay,
    overallMaxSingleDayPoints,
    peakWeekday: WEEKDAY_NAMES_TH[peakDayIndex],
    recommendedThreshold,
    recommendationReason,
  };
}

/**
 * Reset memory state for test isolation
 */
export function resetQCCapacityMemory(): void {
  memoryCapacityThreshold = DEFAULT_THRESHOLD;
}
