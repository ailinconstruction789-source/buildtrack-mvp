// ==============================================================================
// Project Planner Schedule Scoring System (Option 2 - Ladder Step Reduction)
//
// Rules:
// 1. Initial Schedule Setup: Planner inputs dates freely. On lock, baseline is locked (100 pts).
// 2. Internal Schedule Changes: If final completion date does NOT extend, no penalty (100 pts).
// 3. Shortened Schedule (Finishing earlier): No penalty (remains 100 pts).
// 4. Delay Extension (Extending final completion date past baseline):
//    - 1st extension: 75 pts (-25)
//    - 2nd extension: 50 pts (-25)
//    - 3rd extension: 25 pts (-25)
//    - 4th+ extension: 0 pts (min 0)
// 5. Force Majeure Exemption: Owner/Admin can approve an exemption, restoring points.
// ==============================================================================

export interface PlotBaselineData {
  isLocked: boolean;
  start: string | null;
  end: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  revisions: number;
  score: number;
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

/**
 * Calculates the planning score based on the ladder reduction formula:
 * 0 delay extensions = 100
 * 1 delay extension  = 75
 * 2 delay extensions = 50
 * 3 delay extensions = 25
 * 4+ delay extensions = 0
 */
export function calculatePlanningScore(delayRevisions: number): number {
  const safeCount = Math.max(0, Math.floor(delayRevisions || 0));
  return Math.max(0, 100 - safeCount * 25);
}

/**
 * Returns Tailwind classes and human-readable label for a given score.
 */
export function getScoreBadgeStyle(score: number): ScoreBadgeStyle {
  const safeScore = Math.max(0, Math.min(100, score ?? 100));

  if (safeScore >= 100) {
    return {
      score: 100,
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-300 dark:border-emerald-600',
      ring: 'ring-emerald-400/30',
      dot: 'bg-emerald-500',
      label: '100 คะแนน (ดีเยี่ยม)',
      grade: 'ดีเยี่ยม'
    };
  }
  if (safeScore >= 75) {
    return {
      score: 75,
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-300 dark:border-blue-600',
      ring: 'ring-blue-400/30',
      dot: 'bg-blue-500',
      label: '75 คะแนน (ดี)',
      grade: 'ดี'
    };
  }
  if (safeScore >= 50) {
    return {
      score: 50,
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-300 dark:border-amber-600',
      ring: 'ring-amber-400/30',
      dot: 'bg-amber-500',
      label: '50 คะแนน (พอใช้)',
      grade: 'พอใช้'
    };
  }
  if (safeScore >= 25) {
    return {
      score: 25,
      bg: 'bg-orange-50 dark:bg-orange-950/40',
      text: 'text-orange-700 dark:text-orange-300',
      border: 'border-orange-300 dark:border-orange-600',
      ring: 'ring-orange-400/30',
      dot: 'bg-orange-500',
      label: '25 คะแนน (ต้องปรับปรุง)',
      grade: 'ต้องปรับปรุง'
    };
  }
  return {
    score: 0,
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-300 dark:border-rose-600',
    ring: 'ring-rose-400/30',
    dot: 'bg-rose-500',
    label: '0 คะแนน (ล่าช้าวิกฤต)',
    grade: 'ล่าช้าวิกฤต'
  };
}

/**
 * Parses baseline info from a Plot row.
 * Resilient to whether native columns have been migrated or if data is stored in handover_notes tag.
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
      score: 100
    };
  }

  // 1. Check native columns first
  if (plot.baseline_locked_at || plot.baseline_planned_end) {
    const revisions = Number(plot.schedule_delay_revisions ?? 0);
    const score = Number(plot.schedule_planning_score ?? calculatePlanningScore(revisions));
    return {
      isLocked: true,
      start: plot.baseline_planned_start ? String(plot.baseline_planned_start).split('T')[0] : null,
      end: plot.baseline_planned_end ? String(plot.baseline_planned_end).split('T')[0] : null,
      lockedAt: plot.baseline_locked_at || null,
      lockedBy: plot.baseline_locked_by || 'Project Planner',
      revisions,
      score
    };
  }

  // 2. Fallback to handover_notes tag: [planner_baseline:{...}]
  if (plot.handover_notes && typeof plot.handover_notes === 'string') {
    const match = plot.handover_notes.match(/\[planner_baseline:(\{.*?\})\]/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        const revisions = Number(parsed.revisions ?? 0);
        const score = Number(parsed.score ?? calculatePlanningScore(revisions));
        return {
          isLocked: true,
          start: parsed.start ? String(parsed.start).split('T')[0] : null,
          end: parsed.end ? String(parsed.end).split('T')[0] : null,
          lockedAt: parsed.lockedAt || null,
          lockedBy: parsed.lockedBy || 'Project Planner',
          revisions,
          score
        };
      } catch (err) {
        console.warn('Failed to parse planner_baseline tag from handover_notes', err);
      }
    }
  }

  return {
    isLocked: false,
    start: null,
    end: null,
    lockedAt: null,
    lockedBy: null,
    revisions: 0,
    score: 100
  };
}

/**
 * Creates or updates the [planner_baseline:{...}] tag inside handover_notes string.
 */
export function buildPlotBaselineNoteTag(
  oldNotes: string | null | undefined,
  data: {
    start: string;
    end: string;
    lockedAt: string;
    lockedBy: string;
    revisions: number;
    score: number;
  }
): string {
  const cleanNotes = (oldNotes || '').replace(/\[planner_baseline:\{.*?\}\]/g, '').trim();
  const tagJson = JSON.stringify({
    start: data.start,
    end: data.end,
    lockedAt: data.lockedAt,
    lockedBy: data.lockedBy,
    revisions: data.revisions,
    score: data.score
  });
  const tag = `[planner_baseline:${tagJson}]`;
  return cleanNotes ? `${cleanNotes} ${tag}` : tag;
}

/**
 * Locks the baseline schedule for a plot.
 * Saves to Supabase plots table (both native columns and notes fallback) and logs to task_updates.
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
    const notesWithTag = buildPlotBaselineNoteTag(plot.handover_notes, {
      start,
      end,
      lockedAt: nowIso,
      lockedBy,
      revisions: 0,
      score: 100
    });

    // 1. Try updating with native columns + handover_notes
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

    // If native column does not exist yet in schema cache, fallback to handover_notes only
    if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
      console.warn('Native baseline columns not found, using handover_notes fallback:', error.message);
      const fallbackResult = await supabase
        .from('plots')
        .update({ handover_notes: notesWithTag })
        .eq('id', plot.id);
      if (fallbackResult.error) throw fallbackResult.error;
    } else if (error) {
      throw error;
    }

    // 2. Insert audit log into task_updates (always succeeds & provides immutable activity history)
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
 * Records a schedule delay revision, updates the plot score using the ladder steps,
 * saves to plot_schedule_revisions and task_updates.
 */
export async function recordScheduleDelayRevision(
  supabase: any,
  plot: any,
  currentBaseline: PlotBaselineData,
  newStart: string,
  newEnd: string,
  revisedBy: string,
  reason: string
): Promise<{ success: boolean; newScore: number; newRevisions: number; error?: string }> {
  try {
    const prevEnd = currentBaseline.end || newEnd;
    const diffMs = new Date(newEnd).getTime() - new Date(prevEnd).getTime();
    const diffDays = Math.max(1, Math.ceil(diffMs / 86400000));

    const nextRevisions = (currentBaseline.revisions || 0) + 1;
    const nextScore = calculatePlanningScore(nextRevisions);
    const nowIso = new Date().toISOString();

    const notesWithTag = buildPlotBaselineNoteTag(plot.handover_notes, {
      start: currentBaseline.start || newStart,
      end: newEnd, // Current active end
      lockedAt: currentBaseline.lockedAt || nowIso,
      lockedBy: currentBaseline.lockedBy || revisedBy,
      revisions: nextRevisions,
      score: nextScore
    });

    // 1. Update plots table
    let updatePayload: any = {
      schedule_delay_revisions: nextRevisions,
      schedule_planning_score: nextScore,
      handover_notes: notesWithTag
    };

    let { error } = await supabase
      .from('plots')
      .update(updatePayload)
      .eq('id', plot.id);

    // Fallback if column not migrated yet
    if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
      const fallbackResult = await supabase
        .from('plots')
        .update({ handover_notes: notesWithTag })
        .eq('id', plot.id);
      if (fallbackResult.error) throw fallbackResult.error;
    } else if (error) {
      throw error;
    }

    // 2. Try inserting into plot_schedule_revisions table
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
          reason: reason || 'ปรับแผนงานก่อสร้างล่าช้า',
          is_exempted: false
        }
      ]);
    } catch (revErr) {
      console.warn('plot_schedule_revisions insert fallback:', revErr);
    }

    // 3. Insert audit log into task_updates
    try {
      await supabase.from('task_updates').insert([
        {
          plot_id: plot.id,
          task_template_id: null,
          role: 'Project Planner',
          action: 'REVISE_SCHEDULE',
          user_name: revisedBy,
          text_content: JSON.stringify({
            message: `ปรับขยายวันสิ้นสุดโครงการ (+${diffDays} วัน) คะแนนลดเหลือ ${nextScore}`,
            previous_planned_end: prevEnd,
            new_planned_end: newEnd,
            diff_days: diffDays,
            previous_score: currentBaseline.score,
            new_score: nextScore,
            revision_count: nextRevisions,
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
 * Exempts a schedule delay penalty (Force Majeure / เหตุสุดวิสัย) by Owner/Admin.
 * Restores 25 points (reducing delay revision count by 1).
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
      score: nextScore
    });

    // 1. Update plot table
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

    // 2. If revisionId provided, update plot_schedule_revisions
    if (revisionId) {
      try {
        await supabase
          .from('plot_schedule_revisions')
          .update({
            is_exempted: true,
            exempted_by: exemptedBy,
            exempted_at: nowIso
          })
          .eq('id', revisionId);
      } catch (revErr) {
        console.warn('Failed to update plot_schedule_revisions exemption:', revErr);
      }
    }

    // 3. Log to task_updates
    try {
      await supabase.from('task_updates').insert([
        {
          plot_id: plot.id,
          task_template_id: null,
          role: 'Owner',
          action: 'EXEMPT_SCHEDULE_PENALTY',
          user_name: exemptedBy,
          text_content: JSON.stringify({
            message: `อนุมัติยกเว้นบทลงโทษแผนงาน (เหตุสุดวิสัย) โดย ${exemptedBy}: คะแนนปรับเป็น ${nextScore}`,
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
