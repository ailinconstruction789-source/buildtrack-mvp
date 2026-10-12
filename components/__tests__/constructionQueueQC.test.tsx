import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QCPerformanceDashboard from '../QCPerformanceDashboard';

vi.mock('recharts', () => ({
  XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null,
  ResponsiveContainer: () => null, PieChart: () => null, Pie: () => null, Cell: () => null,
  LineChart: () => null, Line: () => null, BarChart: () => null, Bar: () => null, Legend: () => null,
}));
const submit = { id: 'submit', plot_id: 'A', task_template_id: 'T', created_at: '2026-10-08T09:00:00Z', progress: 100, action: 'ส่งงาน 100%' };
const approval = { ...submit, id: 'review', created_at: '2026-10-08T09:05:00Z', action: 'QC อนุมัติผ่าน' };
const props = {
  plots: [{ id: 'A', plot_name: 'A01', project_name: 'Project' }],
  taskTemplates: [{ id: 'T', task_name: 'Roof', cost: 1000 }], defects: [], assignments: [],
  isAdmin: true, isOwner: false, inspectionQueue: [], allUpdatesRecord: [submit, approval],
};
afterEach(() => vi.useRealTimers());

describe('construction QC report', () => {
  it('detects a five-minute approval even when lazy history arrives oldest first', () => {
    const { rerender } = render(<QCPerformanceDashboard {...props} />);
    expect(screen.getByText('5 นาที')).toBeInTheDocument();
    rerender(<QCPerformanceDashboard {...props} allUpdatesRecord={[approval, submit]} />);
    expect(screen.getByText('5 นาที')).toBeInTheDocument();
  });

  it('uses the current local day for date inputs around local midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 0, 30));
    const { container } = render(<QCPerformanceDashboard {...props} />);
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="date"]')) {
      expect(input.value).toBe('2026-10-09');
    }
  });

  it('clamps suspect pagination when refreshed history removes a page', () => {
    const rows = Array.from({ length: 11 }, (_, i) => [
      { ...submit, id: `s${i}`, task_template_id: `T${i}` },
      { ...approval, id: `q${i}`, task_template_id: `T${i}` },
    ]).flat();
    const { rerender } = render(<QCPerformanceDashboard {...props} allUpdatesRecord={rows} />);
    fireEvent.click(screen.getByRole('button', { name: 'หน้าถัดไป' }));
    expect(screen.getAllByText('5 นาที')).toHaveLength(1);
    rerender(<QCPerformanceDashboard {...props} allUpdatesRecord={rows.slice(0, 4)} />);
    expect(screen.getAllByText('5 นาที')).toHaveLength(2);
  });
});
