import { describe, it, expect } from 'vitest';
import { evaluatePlotCompletionAndSaleStatus } from '../plotStatusEvaluator';

describe('evaluatePlotCompletionAndSaleStatus with New Color Scheme', () => {
  const plotWithoutCustomer = { id: 'plot-1', house_type_id: 'ht-1', has_customer: false, is_completed: false, sale_status: 'active' };
  const plotWithCustomer = { id: 'plot-1', house_type_id: 'ht-1', has_customer: true, is_completed: false, sale_status: 'active' };
  const plotTransferred = { id: 'plot-1', house_type_id: 'ht-1', has_customer: true, is_completed: true, sale_status: 'transferred' };

  const taskTemplates = [
    { id: 't1', house_type_id: 'ht-1', task_name: 'โครงสร้าง', is_progress_counted: true },
    { id: 't2', house_type_id: 'ht-1', task_name: 'ก่อฉาบ', is_progress_counted: true },
    { id: 't3', house_type_id: 'ht-1', task_name: 'ปูหญ้า', is_progress_counted: false },
  ];

  it('marks transferred plot as GOLD (Amber theme) regardless of task calculation', () => {
    const status = evaluatePlotCompletionAndSaleStatus({
      plot: plotTransferred,
      taskTemplates,
      assignments: [],
      latestUpdatesMap: {},
    });

    expect(status.isTransferred).toBe(true);
    expect(status.badgeType).toBe('transferred');
    expect(status.colorTheme.colors).toContain('border-amber-500');
  });

  it('marks as CYAN (Ready for Sale) when counted tasks pass QC', () => {
    const assignments = [
      { plot_id: 'plot-1', task_template_id: 't1', current_progress: 100 },
      { plot_id: 'plot-1', task_template_id: 't2', current_progress: 100 },
      { plot_id: 'plot-1', task_template_id: 't3', current_progress: 0 },
    ];
    const latestUpdatesMap = {
      'plot-1-t1': { progress: 100, action: 'QC อนุมัติผ่าน', role: 'QC' },
      'plot-1-t2': { progress: 100, action: 'QC อนุมัติ', role: 'QC' },
    };

    const status = evaluatePlotCompletionAndSaleStatus({
      plot: plotWithoutCustomer,
      taskTemplates,
      assignments,
      latestUpdatesMap,
    });

    expect(status.isReadyForSale).toBe(true);
    expect(status.badgeType).toBe('ready_for_sale');
    expect(status.colorTheme.colors).toContain('border-cyan-500');
  });

  it('marks as EMERALD GREEN (Completed Stock) when all tasks pass QC without customer', () => {
    const assignments = [
      { plot_id: 'plot-1', task_template_id: 't1', current_progress: 100 },
      { plot_id: 'plot-1', task_template_id: 't2', current_progress: 100 },
      { plot_id: 'plot-1', task_template_id: 't3', current_progress: 100 },
    ];
    const latestUpdatesMap = {
      'plot-1-t1': { progress: 100, action: 'QC อนุมัติผ่าน', role: 'QC' },
      'plot-1-t2': { progress: 100, action: 'QC อนุมัติ', role: 'QC' },
      'plot-1-t3': { progress: 100, action: 'QC อนุมัติ', role: 'QC' },
    };

    const status = evaluatePlotCompletionAndSaleStatus({
      plot: plotWithoutCustomer,
      taskTemplates,
      assignments,
      latestUpdatesMap,
    });

    expect(status.isFullyCompletedStock).toBe(true);
    expect(status.badgeType).toBe('completed_stock');
    expect(status.colorTheme.colors).toContain('border-emerald-500');
  });

  it('marks as DEEP EMERALD (Ready for Customer) when all tasks pass QC WITH customer', () => {
    const assignments = [
      { plot_id: 'plot-1', task_template_id: 't1', current_progress: 100 },
      { plot_id: 'plot-1', task_template_id: 't2', current_progress: 100 },
      { plot_id: 'plot-1', task_template_id: 't3', current_progress: 100 },
    ];
    const latestUpdatesMap = {
      'plot-1-t1': { progress: 100, action: 'QC อนุมัติผ่าน', role: 'QC' },
      'plot-1-t2': { progress: 100, action: 'QC อนุมัติ', role: 'QC' },
      'plot-1-t3': { progress: 100, action: 'QC อนุมัติ', role: 'QC' },
    };

    const status = evaluatePlotCompletionAndSaleStatus({
      plot: plotWithCustomer,
      taskTemplates,
      assignments,
      latestUpdatesMap,
    });

    expect(status.isReadyForCustomerInspection).toBe(true);
    expect(status.badgeType).toBe('ready_for_customer');
    expect(status.colorTheme.colors).toContain('border-emerald-600');
  });
});
