// ==============================================================================
// Cascading Construction Planning KPI System (Foreman -> Site Engineer -> Project Planner)
//
// Rules (Agreed Blueprint):
// 1. Plot Score: Starts at 100 on Baseline lock. Non-exempt delay extensions deduct 25 pts ladder-style (100 -> 75 -> 50 -> 25 -> 0).
// 2. Foreman Score: Responsible for individual plots assigned. If a plot is delayed, foreman is penalized.
// 3. Site Engineer Score: Weighted average of all plots under this SE (sum of scores of plots / total plots).
// 4. Project Planner Score: 30% Baseline Setup Score (% of plots with baseline locked) + 70% Site Execution Score (SE average).
// 5. Foreman Handover: When a plot is reassigned, new foreman starts at 100 for that plot; only delays on/after assignment date deduct points.
// 6. Force Majeure: Approved external exemptions do NOT deduct points (score stays at current score, e.g. 75 remains 75).
// 7. Authority: SE, Planner, or Owner/Admin approves schedule extensions in the system.
// ==============================================================================

export interface PlotBaselineData {
  isLocked: boolean;
  start: string | null;
  end: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  revisions: number;
  score: number;
  foremanName?: string | null;
  foremanAssignedAt?: string | null;
  siteEngineer?: string | null;
  exemptionsCount?: number;
}

export interface ScoreBadgeStyle {
  score: number;
  bg: string;
  text: string;
  border: string;
  ring: string;
  dot: string;
  label: string;
  grade: string;
}

export interface ForemanScoreSummary {
  name: string;
  totalPlots: number;
  lockedPlots: number;
  avgScore: number;
  grade: string;
  badgeStyle: ScoreBadgeStyle;
  plots: any[];
  penalizedPlotsCount: number;
}

export interface SiteEngineerScoreSummary {
  name: string;
  totalPlots: number;
  lockedPlots: number;
  weightedAvgScore: number;
  grade: string;
  badgeStyle: ScoreBadgeStyle;
  foremen: string[];
  plots: any[];
}

export interface ProjectPlannerScoreSummary {
  overallScore: number;
  baselineSetupScore: number; // 30% weight
  siteExecutionScore: number; // 70% weight
  totalPlots: number;
  lockedPlots: number;
  lockPercentage: number;
  grade: string;
  badgeStyle: ScoreBadgeStyle;
}

/**
 * Calculates the planning score based on ladder step reduction formula:
 * 0 delays = 100
 * 1 delay  = 75
 * 2 delays = 50
 * 3 delays = 25
 * 4+ delays = 0
 */
export function calculatePlanningScore(delayRevisions: number): number {
  const safeCount = Math.max(0, Math.floor(delayRevisions || 0));
  return Math.max(0, 100 - safeCount * 25);
}

/**
 * Returns Tailwind classes and human-readable label for a given score.
 */
export function getScoreBadgeStyle(score: number): ScoreBadgeStyle {
  const safeScore = Math.max(0, Math.min(100, Math.round(score ?? 100)));

  if (safeScore >= 90) {
    return {
      score: safeScore,
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-300 dark:border-emerald-600',
      ring: 'ring-emerald-400/30',
      dot: 'bg-emerald-500',
      label: `${safeScore} คะแนน (ดีเยี่ยม)`,
      grade: 'ดีเยี่ยม'
    };
  }
  if (safeScore >= 75) {
    return {
      score: safeScore,
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-300 dark:border-blue-600',
      ring: 'ring-blue-400/30',
      dot: 'bg-blue-500',
      label: `${safeScore} คะแนน (ดี)`,
      grade: 'ดี'
    };
  }
  if (safeScore >= 50) {
    return {
      score: safeScore,
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-300 dark:border-amber-600',
      ring: 'ring-amber-400/30',
      dot: 'bg-amber-500',
      label: `${safeScore} คะแนน (พอใช้)`,
      grade: 'พอใช้'
    };
  }
  if (safeScore >= 25) {
    return {
      score: safeScore,
      bg: 'bg-orange-50 dark:bg-orange-950/40',
      text: 'text-orange-700 dark:text-orange-300',
      border: 'border-orange-300 dark:border-orange-600',
      ring: 'ring-orange-400/30',
      dot: 'bg-orange-500',
      label: `${safeScore} คะแนน (ต้องปรับปรุง)`,
      grade: 'ต้องปรับปรุง'
    };
  }
  return {
    score: safeScore,
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-300 dark:border-rose-600',
    ring: 'ring-rose-400/30',
    dot: 'bg-rose-500',
    label: `${safeScore} คะแนน (ล่าช้าวิกฤต)`,
    grade: 'ล่าช้าวิกฤต'
  };
}

/**
 * Parses baseline and assignment info from a Plot row.
 * Resilient to whether native columns are present or data is stored in handover_notes tag.
 */
export function parsePlotBaseline(plot: any): PlotBaselineData {
  if (!plot) {
    return {
      isLocked: false,
      start: null,
      end: null,
      lockedAt: null,
      lockedBy: null,
      revisions: 0,
      score: 100,
      foremanName: null,
      foremanAssignedAt: null,
      siteEngineer: null
    };
  }

  // Parse tag from handover_notes first if present
  let notesMeta: any = {};
  if (plot.handover_notes && typeof plot.handover_notes === 'string') {
    const match = plot.handover_notes.match(/\[planner_baseline:(\{.*?\})\]/);
    if (match && match[1]) {
      try {
        notesMeta = JSON.parse(match[1]);
      } catch (err) {
        // ignore parse error
      }
    }
  }

  const foremanName = plot.foreman_name || plot.foreman || notesMeta.foremanName || null;
  const foremanAssignedAt = plot.foreman_assigned_at || notesMeta.foremanAssignedAt || null;
  const siteEngineer = plot.site_engineer || notesMeta.siteEngineer || null;

  // 1. Check native columns first
  if (plot.baseline_locked_at || plot.baseline_planned_end) {
    const revisions = Number(plot.schedule_delay_revisions ?? notesMeta.revisions ?? 0);
    const score = Number(plot.schedule_planning_score ?? notesMeta.score ?? calculatePlanningScore(revisions));
    return {
      isLocked: true,
      start: plot.baseline_planned_start
        ? String(plot.baseline_planned_start).split('T')[0]
        : (notesMeta.start ? String(notesMeta.start).split('T')[0] : null),
      end: plot.baseline_planned_end
        ? String(plot.baseline_planned_end).split('T')[0]
        : (notesMeta.end ? String(notesMeta.end).split('T')[0] : null),
      lockedAt: plot.baseline_locked_at || notesMeta.lockedAt || null,
      lockedBy: plot.baseline_locked_by || notesMeta.lockedBy || 'Project Planner',
      revisions,
      score,
      foremanName,
      foremanAssignedAt,
      siteEngineer
    };
  }

  // 2. Fallback to handover_notes tag: [planner_baseline:{...}]
  if (notesMeta.lockedAt || notesMeta.end || notesMeta.isLocked) {
    const revisions = Number(notesMeta.revisions ?? 0);
    const score = Number(notesMeta.score ?? calculatePlanningScore(revisions));
    return {
      isLocked: true,
      start: notesMeta.start ? String(notesMeta.start).split('T')[0] : null,
      end: notesMeta.end ? String(notesMeta.end).split('T')[0] : null,
      lockedAt: notesMeta.lockedAt || null,
      lockedBy: notesMeta.lockedBy || 'Project Planner',
      revisions,
      score,
      foremanName,
      foremanAssignedAt,
      siteEngineer
    };
  }

  return {
    isLocked: false,
    start: null,
    end: null,
    lockedAt: null,
    lockedBy: null,
    revisions: 0,
    score: 100,
    foremanName,
    foremanAssignedAt,
    siteEngineer
  };
}

/**
 * Creates or updates the [planner_baseline:{...}] tag inside handover_notes string.
 * Merges with existing tag data so fields are not lost.
 */
export function buildPlotBaselineNoteTag(
  oldNotes: string | null | undefined,
  data: {
    start?: string | null;
    end?: string | null;
    lockedAt?: string | null;
    lockedBy?: string | null;
    revisions?: number;
    score?: number;
    foremanName?: string | null;
    foremanAssignedAt?: string | null;
    siteEngineer?: string | null;
    isLocked?: boolean;
  }
): string {
  let existingData: any = {};
  if (oldNotes && typeof oldNotes === 'string') {
    const match = oldNotes.match(/\[planner_baseline:(\{.*?\})\]/);
    if (match && match[1]) {
      try {
        existingData = JSON.parse(match[1]);
      } catch (e) {
        // ignore parse error
      }
    }
  }

  const cleanNotes = (oldNotes || '').replace(/\[planner_baseline:\{.*?\}\]/g, '').trim();
  const merged: any = {
    ...existingData,
    ...data
  };

  Object.keys(merged).forEach((k) => {
    if (merged[k] === undefined) delete merged[k];
  });

  const tagJson = JSON.stringify(merged);
  const tag = `[planner_baseline:${tagJson}]`;
  return cleanNotes ? `${cleanNotes} ${tag}` : tag;
}

/**
 * Rule 5 (Agreed): Calculates a foreman's planning score for a specific plot.
 * If the plot was handed over (reassigned), only counts delay revisions that occurred
 * on or after foreman_assigned_at.
 */
export function calculateForemanPlotScore(plot: any, revisionsList?: any[]): number {
  const base = parsePlotBaseline(plot);
  if (!base.isLocked) return 100;

  // If no revision list provided, return current plot baseline score
  if (!revisionsList || !Array.isArray(revisionsList) || revisionsList.length === 0) {
    return base.score;
  }

  const assignedAtMs = base.foremanAssignedAt ? new Date(base.foremanAssignedAt).getTime() : 0;

  // Filter revisions that belong to current foreman's tenure and are NOT exempt
  const relevantRevisions = revisionsList.filter((rev: any) => {
    if (rev.plot_id && rev.plot_id !== plot.id) return false;
    if (rev.is_exempted) return false;

    // Check revision created date against assignment date if set
    if (assignedAtMs > 0 && rev.created_at) {
      const revTimeMs = new Date(rev.created_at).getTime();
      if (revTimeMs < assignedAtMs) return false;
    }

    return true;
  });

  return calculatePlanningScore(relevantRevisions.length);
}

/**
 * Aggregates planning scores grouped by Foreman.
 */
export function calculateForemanAggregates(
  plots: any[],
  foremenList?: any[]
): ForemanScoreSummary[] {
  const groups: Record<string, any[]> = {};

  (plots || []).forEach((p: any) => {
    const name = (p.foreman_name || p.foreman || 'ยังไม่ระบุโฟร์แมน').trim();
    if (!groups[name]) groups[name] = [];
    groups[name].push(p);
  });

  // Also include any foremen from foremenList who may not have plots assigned yet
  (foremenList || []).forEach((f: any) => {
    const name = (f.username || f.name || '').trim();
    if (name && !groups[name]) {
      groups[name] = [];
    }
  });

  return Object.keys(groups).map((name) => {
    const plotList = groups[name];
    let totalScore = 0;
    let lockedCount = 0;
    let penalizedCount = 0;

    plotList.forEach((p: any) => {
      const base = parsePlotBaseline(p);
      if (base.isLocked) {
        lockedCount++;
        totalScore += base.score;
        if (base.score < 100) penalizedCount++;
      }
    });

    const avgScore = lockedCount > 0 ? Math.round((totalScore / lockedCount) * 10) / 10 : 100;
    const badgeStyle = getScoreBadgeStyle(avgScore);

    return {
      name,
      totalPlots: plotList.length,
      lockedPlots: lockedCount,
      avgScore,
      grade: badgeStyle.grade,
      badgeStyle,
      plots: plotList,
      penalizedPlotsCount: penalizedCount
    };
  }).sort((a, b) => {
    // Sort descending by score, then by plot count
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    return b.totalPlots - a.totalPlots;
  });
}

export type SEForemanMap = Record<string, string[]>;

/**
 * Auto-detects SE -> Foremen mapping based on current plots data.
 */
export function autoDetectSEForemanMap(plots: any[]): SEForemanMap {
  const map: SEForemanMap = {};
  (plots || []).forEach((p: any) => {
    const se = (p.site_engineer || '').trim();
    const fm = (p.foreman_name || p.foreman || '').trim();
    if (se && fm && se !== 'วิศวกรส่วนกลาง' && se !== 'วิศวกรส่วนกลาง (Site Engineer)') {
      if (!map[se]) map[se] = [];
      if (!map[se].includes(fm)) map[se].push(fm);
    }
  });
  return map;
}

/**
 * Resolves the effective Site Engineer for a plot based on the SE -> Foremen team mapping.
 */
export function getEffectiveSEForPlot(plot: any, seForemanMap?: SEForemanMap): string | null {
  const fm = (plot.foreman_name || plot.foreman || '').trim();
  if (fm && seForemanMap) {
    for (const [seName, foremen] of Object.entries(seForemanMap)) {
      if (foremen && foremen.includes(fm)) {
        return seName;
      }
    }
  }
  return plot.site_engineer || null;
}

/**
 * Saves SE -> Foremen mapping to task_updates audit trail, localStorage,
 * and batch-updates plots.site_engineer in Supabase.
 */
export async function saveSEForemanMap(
  supabase: any,
  seForemanMap: SEForemanMap,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Cache to localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('buildtrack_se_foreman_map', JSON.stringify(seForemanMap));
      } catch (e) {
        // ignore storage error
      }
    }

    // 2. Audit log to task_updates
    try {
      await supabase.from('task_updates').insert([
        {
          plot_id: null,
          role: 'Site Engineer',
          action: 'ASSIGN_SE_FOREMEN',
          user_name: updatedBy,
          text_content: JSON.stringify(seForemanMap)
        }
      ]);
    } catch (auditErr) {
      console.warn('task_updates audit insert warning:', auditErr);
    }

    // 3. Batch update plots table in Supabase so plots reflect the assigned SE
    for (const [seName, foremen] of Object.entries(seForemanMap)) {
      if (foremen && foremen.length > 0) {
        try {
          await supabase
            .from('plots')
            .update({ site_engineer: seName })
            .in('foreman_name', foremen);
        } catch (e) {
          console.warn(`Failed to batch update plots for SE ${seName}:`, e);
        }
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('saveSEForemanMap error:', err);
    return { success: false, error: err?.message || 'Failed to save SE-foreman mapping' };
  }
}

/**
 * Loads SE -> Foremen mapping from task_updates, localStorage, or auto-detect from plots.
 */
export async function loadSEForemanMap(
  supabase: any,
  plots?: any[]
): Promise<SEForemanMap> {
  // 1. Try reading latest record from task_updates
  try {
    const { data, error } = await supabase
      .from('task_updates')
      .select('text_content')
      .eq('action', 'ASSIGN_SE_FOREMEN')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0 && data[0].text_content) {
      const parsed = JSON.parse(data[0].text_content);
      if (parsed && typeof parsed === 'object') {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('buildtrack_se_foreman_map', JSON.stringify(parsed));
          } catch {}
        }
        return parsed;
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. Fallback to localStorage
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('buildtrack_se_foreman_map');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
  }

  // 3. Fallback: Auto-detect from plots in memory
  return autoDetectSEForemanMap(plots || []);
}

/**
 * Rule 2 & 3 (Agreed): Aggregates planning scores grouped by Site Engineer.
 * Uses SE -> Foremen mapping (if provided) so plots roll up to their SE automatically.
 * Weighted average = Sum of scores of all plots under SE / Total locked plots under SE.
 */
export function calculateSiteEngineerAggregates(
  plots: any[],
  siteEngineersList?: any[],
  seForemanMap?: SEForemanMap
): SiteEngineerScoreSummary[] {
  const groups: Record<string, any[]> = {};
  const seForemenListMap: Record<string, Set<string>> = {};

  (siteEngineersList || []).forEach((se: any) => {
    const name = (se.username || se.name || '').trim();
    if (name) {
      if (!groups[name]) groups[name] = [];
      if (!seForemenListMap[name]) seForemenListMap[name] = new Set<string>();
    }
  });

  if (seForemanMap) {
    Object.keys(seForemanMap).forEach((seName) => {
      const name = seName.trim();
      if (name) {
        if (!groups[name]) groups[name] = [];
        if (!seForemenListMap[name]) seForemenListMap[name] = new Set<string>();
        (seForemanMap[seName] || []).forEach((fm) => seForemenListMap[name].add(fm.trim()));
      }
    });
  }

  const resolveSE = (p: any): string => {
    const fm = (p.foreman_name || p.foreman || '').trim();
    if (fm && seForemanMap) {
      for (const [seName, foremen] of Object.entries(seForemanMap)) {
        if (foremen && foremen.includes(fm)) {
          return seName;
        }
      }
    }
    const native = (p.site_engineer || '').trim();
    if (native && native !== 'วิศวกรส่วนกลาง' && native !== 'วิศวกรส่วนกลาง (Site Engineer)') {
      return native;
    }
    return 'วิศวกรส่วนกลาง';
  };

  (plots || []).forEach((p: any) => {
    const seName = resolveSE(p);
    if (!groups[seName]) groups[seName] = [];
    groups[seName].push(p);

    const fm = (p.foreman_name || p.foreman || '').trim();
    if (fm) {
      if (!seForemenListMap[seName]) seForemenListMap[seName] = new Set<string>();
      seForemenListMap[seName].add(fm);
    }
  });

  return Object.keys(groups).map((name) => {
    const plotList = groups[name];
    let totalScore = 0;
    let lockedCount = 0;

    plotList.forEach((p: any) => {
      const base = parsePlotBaseline(p);
      if (base.isLocked) {
        lockedCount++;
        totalScore += base.score;
      }
    });

    const weightedAvg = lockedCount > 0 ? Math.round((totalScore / lockedCount) * 10) / 10 : 100;
    const badgeStyle = getScoreBadgeStyle(weightedAvg);

    return {
      name,
      totalPlots: plotList.length,
      lockedPlots: lockedCount,
      weightedAvgScore: weightedAvg,
      grade: badgeStyle.grade,
      badgeStyle,
      foremen: Array.from(seForemenListMap[name] || []),
      plots: plotList
    };
  }).sort((a, b) => b.weightedAvgScore - a.weightedAvgScore);
}

/**
 * Rule 7 (Agreed): Calculates Project Planner Score using Hybrid 30% / 70% model.
 * 30% = Baseline Setup Score (% of plots locked with baseline)
 * 70% = Site Execution Score (Weighted average of Site Engineers)
 */
export function calculateProjectPlannerScore(
  plots: any[],
  seAggregates?: SiteEngineerScoreSummary[]
): ProjectPlannerScoreSummary {
  const totalPlots = (plots || []).length;
  let lockedCount = 0;
  let totalPlotScore = 0;

  (plots || []).forEach((p: any) => {
    const base = parsePlotBaseline(p);
    if (base.isLocked) {
      lockedCount++;
      totalPlotScore += base.score;
    }
  });

  // 1. 30% Baseline Setup Score
  const lockPercentage = totalPlots > 0 ? Math.round((lockedCount / totalPlots) * 100) : 100;
  const baselineSetupScore = lockPercentage;

  // 2. 70% Site Execution Score
  let siteExecutionScore = 100;
  if (seAggregates && seAggregates.length > 0) {
    const totalSePlots = seAggregates.reduce((acc, se) => acc + se.lockedPlots, 0);
    if (totalSePlots > 0) {
      const sumWeighted = seAggregates.reduce((acc, se) => acc + se.weightedAvgScore * se.lockedPlots, 0);
      siteExecutionScore = Math.round((sumWeighted / totalSePlots) * 10) / 10;
    }
  } else if (lockedCount > 0) {
    siteExecutionScore = Math.round((totalPlotScore / lockedCount) * 10) / 10;
  }

  // 3. Combined Hybrid Score (30% + 70%)
  const overallScore = Math.round(baselineSetupScore * 0.3 + siteExecutionScore * 0.7);
  const badgeStyle = getScoreBadgeStyle(overallScore);

  return {
    overallScore,
    baselineSetupScore,
    siteExecutionScore,
    totalPlots,
    lockedPlots: lockedCount,
    lockPercentage,
    grade: badgeStyle.grade,
    badgeStyle
  };
}

/**
 * Locks the baseline schedule for a plot.
 */
export async function lockPlotBaseline(
  supabase: any,
  plot: any,
  start: string,
  end: string,
  lockedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const nowIso = new Date().toISOString();
    const foremanName = plot.foreman_name || plot.foreman || null;
    const siteEngineer = plot.site_engineer || null;

    const notesWithTag = buildPlotBaselineNoteTag(plot.handover_notes, {
      start,
      end,
      lockedAt: nowIso,
      lockedBy,
      revisions: 0,
      score: 100,
      foremanName,
      foremanAssignedAt: plot.foreman_assigned_at || nowIso,
      siteEngineer
    });

    let updatePayload: any = {
      baseline_planned_start: start,
      baseline_planned_end: end,
      baseline_locked_at: nowIso,
      baseline_locked_by: lockedBy,
      schedule_delay_revisions: 0,
      schedule_planning_score: 100,
      handover_notes: notesWithTag
    };

    let { error } = await supabase
      .from('plots')
      .update(updatePayload)
      .eq('id', plot.id);

    if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
      const fallbackResult = await supabase
        .from('plots')
        .update({ handover_notes: notesWithTag })
        .eq('id', plot.id);
      if (fallbackResult.error) throw fallbackResult.error;
    } else if (error) {
      throw error;
    }

    try {
      await supabase.from('task_updates').insert([
        {
          plot_id: plot.id,
          task_template_id: null,
          role: 'Project Planner',
          action: 'LOCK_BASELINE',
          user_name: lockedBy,
          text_content: JSON.stringify({
            message: 'ล็อกแผนงานหลัก (Baseline 100 คะแนน)',
            baseline_start: start,
            baseline_end: end,
            locked_at: nowIso,
            locked_by: lockedBy,
            foreman: foremanName,
            site_engineer: siteEngineer,
            score: 100
          })
        }
      ]);
    } catch (auditErr) {
      console.warn('Failed to insert task_updates audit log for LOCK_BASELINE:', auditErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error locking baseline:', err);
    return { success: false, error: err.message || 'เกิดข้อผิดพลาดในการล็อกแผนงาน' };
  }
}

/**
 * Assigns a Site Engineer to a plot.
 * Supports dual-write: updates native `site_engineer` column if present,
 * and updates `handover_notes` tag [planner_baseline:{...}] so it works
 * reliably even if the database migration hasn't been applied yet.
 */
export async function assignPlotSiteEngineer(
  supabase: any,
  plot: any,
  seName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!plot) return { success: false, error: 'Plot not found' };

    let nativeError: any = null;
    try {
      const res = await supabase
        .from('plots')
        .update({ site_engineer: seName })
        .eq('id', plot.id);
      nativeError = res.error;
    } catch (e: any) {
      nativeError = e;
    }

    // Always update handover_notes fallback so metadata is preserved
    const updatedNotes = buildPlotBaselineNoteTag(plot.handover_notes, {
      siteEngineer: seName
    });

    const { error: notesError } = await supabase
      .from('plots')
      .update({ handover_notes: updatedNotes })
      .eq('id', plot.id);

    if (notesError && nativeError) {
      console.warn('Fallback handover_notes update failed:', notesError.message);
      return { success: false, error: notesError.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('assignPlotSiteEngineer error:', err);
    return { success: false, error: err?.message || 'Failed to assign site engineer' };
  }
}

/**
 * Rule 6 (Agreed): Records a schedule delay revision.
 * If isExempt === true (Force Majeure / Procurement Exemption), the score does NOT decrease (retains current score).
 * If isExempt === false, ladder deduction applies (-25 pts).
 */
export async function recordScheduleDelayRevision(
  supabase: any,
  plot: any,
  currentBaseline: PlotBaselineData,
  newStart: string,
  newEnd: string,
  revisedBy: string,
  reason: string,
  options?: {
    isExempt?: boolean;
    revisionType?: string;
    foremanName?: string;
    siteEngineerName?: string;
  }
): Promise<{ success: boolean; newScore: number; newRevisions: number; error?: string }> {
  try {
    const prevEnd = currentBaseline.end || newEnd;
    const diffMs = new Date(newEnd).getTime() - new Date(prevEnd).getTime();
    const diffDays = Math.max(1, Math.ceil(diffMs / 86400000));
    const isExempt = Boolean(options?.isExempt);
    const revisionType = options?.revisionType || (isExempt ? 'force_majeure' : 'normal_delay');
    const foremanName = options?.foremanName || plot.foreman_name || plot.foreman || null;
    const siteEngineerName = options?.siteEngineerName || plot.site_engineer || null;

    // Rule 6: If exempt, score stays at current score (does not deduct 25 pts)
    const nextRevisions = isExempt
      ? (currentBaseline.revisions || 0)
      : (currentBaseline.revisions || 0) + 1;
    const nextScore = isExempt
      ? currentBaseline.score
      : calculatePlanningScore(nextRevisions);

    const nowIso = new Date().toISOString();

    const notesWithTag = buildPlotBaselineNoteTag(plot.handover_notes, {
      start: currentBaseline.start || newStart,
      end: newEnd,
      lockedAt: currentBaseline.lockedAt || nowIso,
      lockedBy: currentBaseline.lockedBy || revisedBy,
      revisions: nextRevisions,
      score: nextScore,
      foremanName,
      foremanAssignedAt: currentBaseline.foremanAssignedAt || null,
      siteEngineer: siteEngineerName
    });

    let updatePayload: any = {
      schedule_delay_revisions: nextRevisions,
      schedule_planning_score: nextScore,
      handover_notes: notesWithTag
    };

    let { error } = await supabase
      .from('plots')
      .update(updatePayload)
      .eq('id', plot.id);

    if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
      const fallbackResult = await supabase
        .from('plots')
        .update({ handover_notes: notesWithTag })
        .eq('id', plot.id);
      if (fallbackResult.error) throw fallbackResult.error;
    } else if (error) {
      throw error;
    }

    try {
      await supabase.from('plot_schedule_revisions').insert([
        {
          plot_id: plot.id,
          revised_by: revisedBy,
          previous_planned_end: prevEnd,
          new_planned_end: newEnd,
          diff_days: diffDays,
          previous_score: currentBaseline.score,
          new_score: nextScore,
          reason: reason || (isExempt ? 'ปรับขยายวันสิ้นสุด (เหตุสุดวิสัย - ยกเว้นการหักคะแนน)' : 'ปรับแผนงานก่อสร้างล่าช้า'),
          is_exempted: isExempt,
          revision_type: revisionType,
          foreman_name: foremanName,
          site_engineer_name: siteEngineerName,
          exempted_by: isExempt ? revisedBy : null,
          exempted_at: isExempt ? nowIso : null
        }
      ]);
    } catch (revErr) {
      console.warn('plot_schedule_revisions insert fallback:', revErr);
    }

    try {
      await supabase.from('task_updates').insert([
        {
          plot_id: plot.id,
          task_template_id: null,
          role: 'Site Engineer',
          action: 'REVISE_SCHEDULE',
          user_name: revisedBy,
          text_content: JSON.stringify({
            message: isExempt
              ? `ปรับขยายวันสิ้นสุด (+${diffDays} วัน) กรณีพิเศษ/เหตุสุดวิสัย (คงคะแนนเดิม ${nextScore})`
              : `ปรับขยายวันสิ้นสุด (+${diffDays} วัน) โฟร์แมน (${foremanName || '-'}) คะแนนปรับเป็น ${nextScore}`,
            previous_planned_end: prevEnd,
            new_planned_end: newEnd,
            diff_days: diffDays,
            previous_score: currentBaseline.score,
            new_score: nextScore,
            revision_count: nextRevisions,
            is_exempted: isExempt,
            revision_type: revisionType,
            foreman: foremanName,
            site_engineer: siteEngineerName,
            reason: reason || 'ปรับแผนงานก่อสร้างล่าช้า'
          })
        }
      ]);
    } catch (auditErr) {
      console.warn('task_updates audit insert fallback:', auditErr);
    }

    return {
      success: true,
      newScore: nextScore,
      newRevisions: nextRevisions
    };
  } catch (err: any) {
    console.error('Error recording schedule delay revision:', err);
    return {
      success: false,
      newScore: currentBaseline.score,
      newRevisions: currentBaseline.revisions,
      error: err.message || 'เกิดข้อผิดพลาดในการบันทึกการปรับแผน'
    };
  }
}

/**
 * Retroactively exempts a schedule delay penalty by Owner/Admin, restoring 25 points.
 */
export async function exemptSchedulePenalty(
  supabase: any,
  plot: any,
  currentBaseline: PlotBaselineData,
  revisionId: string | null,
  exemptedBy: string,
  reason?: string
): Promise<{ success: boolean; newScore: number; newRevisions: number; error?: string }> {
  try {
    const nextRevisions = Math.max(0, (currentBaseline.revisions || 0) - 1);
    const nextScore = calculatePlanningScore(nextRevisions);
    const nowIso = new Date().toISOString();

    const notesWithTag = buildPlotBaselineNoteTag(plot.handover_notes, {
      start: currentBaseline.start || '',
      end: currentBaseline.end || '',
      lockedAt: currentBaseline.lockedAt || nowIso,
      lockedBy: currentBaseline.lockedBy || 'Project Planner',
      revisions: nextRevisions,
      score: nextScore,
      foremanName: currentBaseline.foremanName,
      foremanAssignedAt: currentBaseline.foremanAssignedAt,
      siteEngineer: currentBaseline.siteEngineer
    });

    let updatePayload: any = {
      schedule_delay_revisions: nextRevisions,
      schedule_planning_score: nextScore,
      handover_notes: notesWithTag
    };

    let { error } = await supabase
      .from('plots')
      .update(updatePayload)
      .eq('id', plot.id);

    if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
      const fallbackResult = await supabase
        .from('plots')
        .update({ handover_notes: notesWithTag })
        .eq('id', plot.id);
      if (fallbackResult.error) throw fallbackResult.error;
    } else if (error) {
      throw error;
    }

    if (revisionId) {
      try {
        await supabase
          .from('plot_schedule_revisions')
          .update({
            is_exempted: true,
            exempted_by: exemptedBy,
            exempted_at: nowIso,
            exemption_reason: reason || 'อนุมัติยกเว้นบทลงโทษ (เหตุสุดวิสัย / จัดซื้อ / ปัจจัยภายนอก)'
          })
          .eq('id', revisionId);
      } catch (revErr) {
        console.warn('Failed to update plot_schedule_revisions exemption:', revErr);
      }
    }

    try {
      await supabase.from('task_updates').insert([
        {
          plot_id: plot.id,
          task_template_id: null,
          role: 'Owner',
          action: 'EXEMPT_SCHEDULE_PENALTY',
          user_name: exemptedBy,
          text_content: JSON.stringify({
            message: `อนุมัติยกเว้นบทลงโทษแผนงาน (${reason || 'เหตุสุดวิสัย'}) โดย ${exemptedBy}: คืนคะแนนเป็น ${nextScore}`,
            exempted_by: exemptedBy,
            exempted_at: nowIso,
            reason: reason || 'เหตุสุดวิสัย / ปัจจัยภายนอก',
            previous_score: currentBaseline.score,
            new_score: nextScore,
            new_revisions: nextRevisions
          })
        }
      ]);
    } catch (auditErr) {
      console.warn('task_updates audit insert fallback for EXEMPT_SCHEDULE_PENALTY:', auditErr);
    }

    return {
      success: true,
      newScore: nextScore,
      newRevisions: nextRevisions
    };
  } catch (err: any) {
    console.error('Error exempting schedule penalty:', err);
    return {
      success: false,
      newScore: currentBaseline.score,
      newRevisions: currentBaseline.revisions,
      error: err.message || 'เกิดข้อผิดพลาดในการยกเว้นบทลงโทษ'
    };
  }
}
