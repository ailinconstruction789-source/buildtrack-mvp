import { describe, it, expect, vi } from 'vitest';
import {
  isHandoverDefectCompleted,
  isForemanRole,
  isUnassignedForemanName,
  canonicalizeForemanName,
  backfillUnassignedSnapshotsForPlot,
  resolvePlotFallbackForeman,
  resolveHandoverDefectForeman,
  getPlotActiveHandoverForemanInfo,
  evaluateHandoverAddAction,
  buildHandoverHandoffPlan,
} from '../handoverForeman';

describe('handoverForeman ownership & handoff helpers', () => {
  it('assigns incoming foreman immediately on first handover work even if plot construction foreman differs', () => {
    const plot = {
      id: 'plot-10',
      name: 'แปลง 10',
      foreman_name: 'LEAB',
      handover_cycle: 1,
    };

    const decision = evaluateHandoverAddAction({
      plot,
      defects: [],
      cycle: 1,
      actorRole: 'Foreman',
      actorName: 'VIEW',
    });

    expect(decision.needsPrompt).toBe(false);
    if (!decision.needsPrompt) {
      expect(decision.foremanForNewDefects).toBe('VIEW');
      expect(decision.shouldSetPlotHandoverForeman).toBe(true);
      expect(decision.plotHandoverForemanName).toBe('VIEW');
    }
  });

  it('does not prompt when the same handover foreman adds another item', () => {
    const plot = {
      id: 'plot-10',
      foreman_name: 'LEAB',
      handover_foreman_name: 'VIEW',
      handover_cycle: 1,
    };
    const existingDefect = {
      id: 'def-1',
      plot_id: 'plot-10',
      defect_stage: 'handover',
      handover_cycle: 1,
      progress: 40,
      status: 'in_progress',
      foreman_name: 'VIEW',
    };

    const decision = evaluateHandoverAddAction({
      plot,
      defects: [existingDefect],
      cycle: 1,
      actorRole: 'Foreman',
      actorName: 'view',
    });

    expect(decision.needsPrompt).toBe(false);
    if (!decision.needsPrompt) {
      expect(decision.foremanForNewDefects).toBe('VIEW');
    }
  });

  it('prompts when a different foreman adds handover work, even if existing handover items are 100% done (1.2)', () => {
    const plot = {
      id: 'plot-10',
      foreman_name: 'LEAB',
      handover_foreman_name: 'VIEW',
      handover_cycle: 1,
    };
    const completedLegacyDefect = {
      id: 'def-done-legacy',
      plot_id: 'plot-10',
      defect_stage: 'handover',
      handover_cycle: 1,
      progress: 100,
      status: 'resolved',
      foreman_name: null,
    };

    const decision = evaluateHandoverAddAction({
      plot,
      defects: [completedLegacyDefect],
      cycle: 1,
      actorRole: 'Foreman',
      actorName: 'SOMCHAI',
    });

    expect(decision.needsPrompt).toBe(true);
    if (decision.needsPrompt) {
      expect(decision.existingForeman).toBe('VIEW');
      expect(decision.incomingForeman).toBe('SOMCHAI');
      expect(decision.existingInfo.activeDefectsCount).toBe(0);
      expect(decision.existingInfo.completedDefectsCount).toBe(1);
      expect(decision.existingInfo.completedDefectIdsWithoutForeman).toEqual(['def-done-legacy']);
    }
  });

  it('builds correct help vs takeover handoff transition plans', () => {
    const plot = {
      id: 'plot-10',
      foreman_name: 'LEAB',
      handover_foreman_name: 'VIEW',
      handover_cycle: 1,
    };
    const defects = [
      {
        id: 'def-done-legacy',
        plot_id: 'plot-10',
        defect_stage: 'handover',
        handover_cycle: 1,
        progress: 100,
        status: 'resolved',
        foreman_name: null,
      },
      {
        id: 'def-done-explicit',
        plot_id: 'plot-10',
        defect_stage: 'handover',
        handover_cycle: 1,
        progress: 100,
        status: 'completed',
        foreman_name: 'VIEW',
      },
      {
        id: 'def-wip',
        plot_id: 'plot-10',
        defect_stage: 'handover',
        handover_cycle: 1,
        progress: 50,
        status: 'in_progress',
        foreman_name: 'VIEW',
      },
    ];

    const info = getPlotActiveHandoverForemanInfo({ plot, defects, cycle: 1 });

    // Mode 1: help -> keeps VIEW on everything including new items
    const helpPlan = buildHandoverHandoffPlan({
      mode: 'help',
      existingForeman: 'VIEW',
      incomingForeman: 'SOMCHAI',
      existingInfo: info,
    });
    expect(helpPlan.newDefectsForeman).toBe('VIEW');
    expect(helpPlan.freezeCompletedIds).toEqual([]);
    expect(helpPlan.transferIncompleteIds).toEqual([]);
    expect(helpPlan.nextPlotHandoverForeman).toBe('VIEW');

    // Mode 2: takeover -> freezes legacy completed to VIEW, moves active incomplete + new to SOMCHAI
    const takeoverPlan = buildHandoverHandoffPlan({
      mode: 'takeover',
      existingForeman: 'VIEW',
      incomingForeman: 'SOMCHAI',
      existingInfo: info,
    });
    expect(takeoverPlan.newDefectsForeman).toBe('SOMCHAI');
    expect(takeoverPlan.freezeCompletedForeman).toBe('VIEW');
    expect(takeoverPlan.freezeCompletedIds).toEqual(['def-done-legacy']);
    expect(takeoverPlan.transferIncompleteIds).toEqual(['def-wip']);
    expect(takeoverPlan.nextPlotHandoverForeman).toBe('SOMCHAI');
  });

  it('never assigns QC, Admin, Site Engineer, or Project Planner as foreman (Rule 1.1)', () => {
    const plotWithoutHandoverFm = {
      id: 'plot-20',
      foreman_name: 'LEAB',
      handover_cycle: 1,
    };

    for (const role of ['QC', 'Site Engineer', 'Admin', 'Project Planner']) {
      expect(isForemanRole(role)).toBe(false);
      const decision = evaluateHandoverAddAction({
        plot: plotWithoutHandoverFm,
        defects: [],
        cycle: 1,
        actorRole: role,
        actorName: `${role}-User`,
      });
      expect(decision.needsPrompt).toBe(false);
      if (!decision.needsPrompt) {
        expect(decision.foremanForNewDefects).toBe('LEAB');
        expect(decision.shouldSetPlotHandoverForeman).toBe(false);
      }
    }

    // If handover foreman already took over plot, QC/Admin inherits handover foreman instead of construction foreman
    const plotWithHandoverFm = {
      id: 'plot-20',
      foreman_name: 'LEAB',
      handover_foreman_name: 'VIEW',
      handover_cycle: 1,
    };
    const decisionQc = evaluateHandoverAddAction({
      plot: plotWithHandoverFm,
      defects: [],
      cycle: 1,
      actorRole: 'QC',
      actorName: 'QC-Som',
    });
    expect(decisionQc.needsPrompt).toBe(false);
    if (!decisionQc.needsPrompt) {
      expect(decisionQc.foremanForNewDefects).toBe('VIEW');
      expect(decisionQc.shouldSetPlotHandoverForeman).toBe(false);
    }
  });

  it('resolves defect foreman and completion flags accurately', () => {
    const plot = { id: 'p1', foreman_name: 'LEAB', handover_foreman_name: 'VIEW' };
    expect(resolvePlotFallbackForeman(plot)).toBe('VIEW');
    expect(resolveHandoverDefectForeman({ foreman_name: 'SOMCHAI' }, plot)).toBe('SOMCHAI');
    expect(resolveHandoverDefectForeman({ foreman_name: null }, plot)).toBe('VIEW');
    expect(resolveHandoverDefectForeman({}, { id: 'p2', foreman_name: 'LEAB' })).toBe('LEAB');

    expect(isHandoverDefectCompleted({ progress: 100, status: 'pending' })).toBe(true);
    expect(isHandoverDefectCompleted({ progress: 0, status: 'resolved' })).toBe(true);
    expect(isHandoverDefectCompleted({ progress: 95, status: 'in_progress' })).toBe(false);
  });

  it('detects unassigned foreman placeholders and ignores them in fallback resolution', () => {
    expect(isUnassignedForemanName('')).toBe(true);
    expect(isUnassignedForemanName(null)).toBe(true);
    expect(isUnassignedForemanName('ยังไม่ระบุโฟร์แมน')).toBe(true);
    expect(isUnassignedForemanName(' ยังไม่ระบุ ')).toBe(true);
    expect(isUnassignedForemanName('-')).toBe(true);
    expect(isUnassignedForemanName('Unassigned')).toBe(true);
    expect(isUnassignedForemanName('DEN')).toBe(false);
    expect(isUnassignedForemanName('Auen')).toBe(false);

    expect(
      resolvePlotFallbackForeman({
        id: 'p-placeholder',
        handover_foreman_name: 'ยังไม่ระบุโฟร์แมน',
        foreman_name: 'DEN',
      })
    ).toBe('DEN');
    expect(
      resolvePlotFallbackForeman({
        id: 'p-empty',
        handover_foreman_name: '',
        foreman_name: 'ยังไม่ระบุ',
      })
    ).toBe('');
    expect(
      resolveHandoverDefectForeman(
        { foreman_name: 'ยังไม่ระบุโฟร์แมน' },
        { id: 'p-fb', handover_foreman_name: 'DEN', foreman_name: 'Auen' }
      )
    ).toBe('DEN');
  });

  it('canonicalizes foreman case variants using foremenList and strips placeholders', () => {
    const foremenList = [
      { username: 'DEN', name: 'Den' },
      { username: 'VIEW', name: 'View' },
    ];
    expect(canonicalizeForemanName('Den', foremenList)).toBe('DEN');
    expect(canonicalizeForemanName('den', foremenList)).toBe('DEN');
    expect(canonicalizeForemanName('Auen', foremenList)).toBe('Auen');
    expect(canonicalizeForemanName('ยังไม่ระบุโฟร์แมน', foremenList)).toBe('');
  });

  it('backfills unassigned snapshot rows for a plot without touching concrete foreman rows', async () => {
    const inMock = vi.fn().mockResolvedValue({ error: null });
    const eqMock = vi.fn().mockReturnValue({ in: inMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    const supabaseMock = { from: fromMock };

    await backfillUnassignedSnapshotsForPlot(supabaseMock, 'plot-ailin3', 'DEN');

    expect(fromMock).toHaveBeenCalledWith('foreman_daily_duty_snapshots');
    expect(updateMock).toHaveBeenCalledWith({ foreman_name: 'DEN' });
    expect(eqMock).toHaveBeenCalledWith('plot_id', 'plot-ailin3');
    expect(inMock).toHaveBeenCalledWith('foreman_name', [
      '',
      'ยังไม่ระบุโฟร์แมน',
      'ยังไม่ระบุ',
      '-',
      'unassigned',
    ]);

    fromMock.mockClear();
    await backfillUnassignedSnapshotsForPlot(supabaseMock, 'plot-ailin3', 'ยังไม่ระบุโฟร์แมน');
    expect(fromMock).not.toHaveBeenCalled();
  });
});
