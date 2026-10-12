import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExecutiveAnalytics from '../ExecutiveAnalytics';

const chart = vi.hoisted(() => ({ data: [] as any[] }));
vi.mock('recharts', () => {
  const Empty = () => null;
  return { ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    LineChart: ({ data }: { data: any[] }) => { chart.data = data; return null; },
    Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty };
});

describe('executive schedule scope (synthetic data)', () => {
  it('includes hyphenated plot schedule rows and retains project selection and planned cost', () => {
    render(<ExecutiveAnalytics loading={false} projects={[{ name: 'A' }, { name: 'B' }]}
      plots={[{ id: 'A-1', project_name: 'A', progress: 50, house_type_id: 1 }, { id: 'B-1', project_name: 'B', progress: 20, house_type_id: 1 }]}
      taskTemplates={[{ id: 'task-uuid', house_type_id: 1, cost: 100 }]}
      schedules={{ 'A-1-task-uuid': { plot_id: 'A-1', task_template_id: 'task-uuid', planned_start: '2026-10-01', planned_end: '2026-10-08' },
        'B-1-task-uuid': { plot_id: 'B-1', task_template_id: 'task-uuid', planned_start: '2026-10-01', planned_end: '2026-10-08' } }}
      latestUpdatesMap={{}} foremenList={[]} allUpdatesRecord={[]} />);
    expect(chart.data.at(-1).PV).toBe(200);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A' } });
    expect(chart.data.at(-1).PV).toBe(100);
    expect(screen.getByRole('combobox')).toHaveValue('A');
  });
});
