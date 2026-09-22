import { describe, it, expect } from 'vitest';

describe('Weekly Progress Report & Variance Calculation Logic', () => {
  // Logic mirror of plot progress metrics calculation
  function calculatePlotWeeklyMetrics({
    selectedProjectName,
    plots,
    houseTypes = [],
    allUpdatesRecord = [],
    assignments = [],
    taskTemplates = [],
    getPlotOverallStatus
  }: {
    selectedProjectName: string;
    plots: any[];
    houseTypes?: any[];
    allUpdatesRecord?: any[];
    assignments?: any[];
    taskTemplates?: any[];
    getPlotOverallStatus: (id: string) => any;
  }) {
    // Only plots for selected project
    const projectPlots = plots.filter((p: any) => p.project_name === selectedProjectName);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(23, 59, 59, 999);

    return projectPlots.map((plot: any) => {
      const plotName = plot.plot_name || plot.id;
      const houseTypeObj = houseTypes.find((h: any) => String(h.id) === String(plot.house_type_id));
      const houseTypeName = plot.house_types?.type_name || houseTypeObj?.type_name || plot.house_type || '-';
      const foremanName = plot.foreman || '-';

      const statusInfo = getPlotOverallStatus(plot.id);

      // Explicit completed check
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

      const plotUpdates = allUpdatesRecord.filter((u: any) => u.plot_id === plot.id);
      const updatesLast7Days = plotUpdates.filter((u: any) => new Date(u.created_at).getTime() > sevenDaysAgo.getTime());

      let lastWeekProgress = currentActual;

      if (isCompleted) {
        if (updatesLast7Days.length > 0) {
          // Recalculate if completed within the last 7 days
          const plotAssignments = assignments.filter((a: any) => a.plot_id === plot.id && !a.is_excluded);
          if (plotAssignments.length > 0) {
            let totalCost = 0;
            let totalWeightedProgress = 0;
            plotAssignments.forEach((assign: any) => {
              const template = taskTemplates.find((t: any) => t.id === assign.task_template_id);
              const cost = Number(template?.cost) || 1;
              totalCost += cost;

              const updatesBefore = plotUpdates
                .filter((u: any) => u.task_template_id === assign.task_template_id && new Date(u.created_at).getTime() <= sevenDaysAgo.getTime())
                .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

              const taskProgressAtCutoff = updatesBefore.length > 0 ? Number(updatesBefore[0].progress) || 0 : 0;
              totalWeightedProgress += taskProgressAtCutoff * cost;
            });
            lastWeekProgress = totalCost > 0 ? totalWeightedProgress / totalCost : currentActual;
          } else {
            lastWeekProgress = 100;
          }
        } else {
          lastWeekProgress = 100;
        }
      } else if (updatesLast7Days.length === 0) {
        lastWeekProgress = currentActual;
      } else {
        const plotAssignments = assignments.filter((a: any) => a.plot_id === plot.id && !a.is_excluded);
        if (plotAssignments.length > 0) {
          let totalCost = 0;
          let totalWeightedProgress = 0;
          plotAssignments.forEach((assign: any) => {
            const template = taskTemplates.find((t: any) => t.id === assign.task_template_id);
            const cost = Number(template?.cost) || 1;
            totalCost += cost;

            const updatesBefore = plotUpdates
              .filter((u: any) => u.task_template_id === assign.task_template_id && new Date(u.created_at).getTime() <= sevenDaysAgo.getTime())
              .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            const taskProgressAtCutoff = updatesBefore.length > 0 ? Number(updatesBefore[0].progress) || 0 : 0;
            totalWeightedProgress += taskProgressAtCutoff * cost;
          });
          lastWeekProgress = totalCost > 0 ? totalWeightedProgress / totalCost : currentActual;
        } else {
          lastWeekProgress = currentActual;
        }
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
        statusLabel
      };
    });
  }

  it('filters plots strictly by the selected project', () => {
    const plots = [
      { id: 'p1', plot_name: 'A-01', project_name: 'ไอลิน6' },
      { id: 'p2', plot_name: 'A-02', project_name: 'ไอลิน6' },
      { id: 'p3', plot_name: 'B-01', project_name: 'ไอลิน5' }
    ];

    const result = calculatePlotWeeklyMetrics({
      selectedProjectName: 'ไอลิน6',
      plots,
      getPlotOverallStatus: () => ({ actual: 50, planned: 50, status: 'on-track' })
    });

    expect(result).toHaveLength(2);
    expect(result.map(r => r.plotId)).toEqual(['p1', 'p2']);
  });

  it('marks completed plots explicitly as "เสร็จแล้ว" and paceStatus "completed"', () => {
    const plots = [
      { id: 'p1', plot_name: 'A-01', project_name: 'ไอลิน6', is_completed: true },
      { id: 'p2', plot_name: 'A-02', project_name: 'ไอลิน6', handover_status: 'completed' },
      { id: 'p3', plot_name: 'A-03', project_name: 'ไอลิน6', progress: 100 }
    ];

    const result = calculatePlotWeeklyMetrics({
      selectedProjectName: 'ไอลิน6',
      plots,
      getPlotOverallStatus: (id) => {
        if (id === 'p1') return { actual: 100, planned: 100, status: 'completed' };
        if (id === 'p2') return { actual: 100, planned: 100, status: 'ready_for_sale' };
        return { actual: 100, planned: 100, status: 'completed' };
      }
    });

    expect(result[0].statusLabel).toBe('เสร็จแล้ว');
    expect(result[0].paceStatus).toBe('completed');
    expect(result[0].isCompleted).toBe(true);
    expect(result[0].currentActual).toBe(100);

    expect(result[1].statusLabel).toBe('เสร็จแล้ว');
    expect(result[1].paceStatus).toBe('completed');

    expect(result[2].statusLabel).toBe('เสร็จแล้ว');
    expect(result[2].paceStatus).toBe('completed');
  });

  it('accurately identifies ahead, delayed, and on-track houses', () => {
    const plots = [
      { id: 'p1', plot_name: 'A-01', project_name: 'ไอลิน6' }, // Ahead
      { id: 'p2', plot_name: 'A-02', project_name: 'ไอลิน6' }, // Delayed
      { id: 'p3', plot_name: 'A-03', project_name: 'ไอลิน6' }  // On-track
    ];

    const result = calculatePlotWeeklyMetrics({
      selectedProjectName: 'ไอลิน6',
      plots,
      getPlotOverallStatus: (id) => {
        if (id === 'p1') return { actual: 60, planned: 50, status: 'ahead' };
        if (id === 'p2') return { actual: 30, planned: 40, status: 'delayed' };
        return { actual: 50, planned: 50, status: 'on-track' };
      }
    });

    expect(result[0].paceStatus).toBe('ahead');
    expect(result[0].statusLabel).toBe('เร็วกว่าแผน (+10%)');
    expect(result[0].variance).toBe(10);

    expect(result[1].paceStatus).toBe('delayed');
    expect(result[1].statusLabel).toBe('ช้ากว่าแผน (-10%)');
    expect(result[1].variance).toBe(-10);

    expect(result[2].paceStatus).toBe('on-track');
    expect(result[2].statusLabel).toBe('ตามแผน');
    expect(result[2].variance).toBe(0);
  });

  it('calculates weekly delta progress correctly when updates occurred', () => {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);

    const nineDaysAgo = new Date(today);
    nineDaysAgo.setDate(today.getDate() - 9);

    const plots = [{ id: 'p1', plot_name: 'A-01', project_name: 'ไอลิน6', house_type_id: 'ht1' }];
    const taskTemplates = [{ id: 't1', house_type_id: 'ht1', cost: 100 }];
    const assignments = [{ plot_id: 'p1', task_template_id: 't1', current_progress: 70 }];
    
    // Updates: 9 days ago was 50%, 3 days ago was 70%
    const allUpdatesRecord = [
      { plot_id: 'p1', task_template_id: 't1', progress: 50, created_at: nineDaysAgo.toISOString() },
      { plot_id: 'p1', task_template_id: 't1', progress: 70, created_at: threeDaysAgo.toISOString() }
    ];

    const result = calculatePlotWeeklyMetrics({
      selectedProjectName: 'ไอลิน6',
      plots,
      taskTemplates,
      assignments,
      allUpdatesRecord,
      getPlotOverallStatus: () => ({ actual: 70, planned: 65, status: 'ahead' })
    });

    expect(result[0].currentActual).toBe(70);
    expect(result[0].lastWeekProgress).toBe(50);
    expect(result[0].deltaProgress).toBe(20);
  });

  it('keeps last week progress equal to current when no updates occurred in past 7 days', () => {
    const today = new Date();
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(today.getDate() - 10);

    const plots = [{ id: 'p1', plot_name: 'A-01', project_name: 'ไอลิน6' }];
    const allUpdatesRecord = [
      { plot_id: 'p1', task_template_id: 't1', progress: 40, created_at: tenDaysAgo.toISOString() }
    ];

    const result = calculatePlotWeeklyMetrics({
      selectedProjectName: 'ไอลิน6',
      plots,
      allUpdatesRecord,
      getPlotOverallStatus: () => ({ actual: 40, planned: 40, status: 'on-track' })
    });

    expect(result[0].currentActual).toBe(40);
    expect(result[0].lastWeekProgress).toBe(40);
    expect(result[0].deltaProgress).toBe(0);
  });

  it('generates CSV with UTF-8 BOM and correct headers', () => {
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

    const row = [1, '"A-01"', '"Type A"', '"ช่างเอก"', '50%', '60%', '+10%', '55%', '"เร็วกว่าแผน (+5%)"'];
    const csvContent = BOM + [headers.join(','), row.join(',')].join('\r\n');

    expect(csvContent.startsWith('\uFEFF')).toBe(true);
    expect(csvContent).toContain('ลำดับ,แปลง (Plot),แบบบ้าน (House Type)');
    expect(csvContent).toContain('"A-01","Type A","ช่างเอก",50%,60%,+10%,55%,"เร็วกว่าแผน (+5%)"');
  });
});
