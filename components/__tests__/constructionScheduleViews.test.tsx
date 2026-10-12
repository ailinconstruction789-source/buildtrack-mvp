import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MasterGanttChart from '../MasterGanttChart';
import ContractorScheduleView from '../ContractorScheduleView';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 8, 12));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const plots = [
  { id: 'P1', plot_name: 'Plot One', project_name: 'Project A', house_type_id: 1, foreman: 'Foreman A' },
  { id: 'P2', plot_name: 'Plot Two', project_name: 'Project B', house_type_id: 1, foreman: 'Foreman B' },
];
const taskTemplates = [
  { id: 'A', task_name: 'Roof work', house_type_id: 1 },
  { id: 'B', task_name: 'Wall work', house_type_id: 1 },
  { id: 'C', task_name: 'Paint work', house_type_id: 1 },
  { id: 'LAST', task_name: 'Last calendar day', house_type_id: 1 },
  { id: 'INVALID', task_name: 'Invalid schedule', house_type_id: 1 },
];

describe('construction schedule Gantt view', () => {
  const props = {
    view: 'master-gantt', plots, taskTemplates, contractors: [], assignments: [],
    projects: [{ name: 'Project A' }, { name: 'Project B' }],
    schedules: {
      'P1-A': { planned_start: '2026-10-08', planned_end: '2026-10-09' },
      'P1-B': { planned_start: '2026-10-09', planned_end: '2026-10-10' },
      'P1-C': { planned_start: '2026-10-10', planned_end: '2026-10-11' },
      'P2-LAST': { planned_start: '2026-12-29', planned_end: '2026-12-29' },
      'P2-INVALID': { planned_start: 'bad date', planned_end: '2026-10-08' },
    }, latestUpdatesMap: { 'P1-A': { progress: 100 } },
  };

  it('renders chained overlapping bars on distinct lanes while keeping text, progress and inclusive widths', () => {
    const { container } = render(<MasterGanttChart {...props} />);
    const roof = screen.getByTitle('Roof work (100%)');
    const wall = screen.getByTitle('Wall work (0%)');
    const paint = screen.getByTitle('Paint work (0%)');
    expect(roof).toHaveStyle({ top: '12px', left: '280px', width: '80px' });
    expect(wall).toHaveStyle({ top: '40px', left: '320px', width: '80px' });
    expect(paint).toHaveStyle({ top: '12px', left: '360px', width: '80px' });
    expect(roof.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByTitle('Last calendar day (0%)')).toHaveStyle({ left: '3560px', width: '40px' });
    expect(screen.queryByTitle('Invalid schedule (0%)')).not.toBeInTheDocument();
    expect(container.querySelector('[style*="NaN"]')).toBeNull();
  });

  it('preserves project filtering and month navigation without mutating schedules', () => {
    const original = JSON.stringify(props.schedules);
    const { container } = render(<MasterGanttChart {...props} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Project B' } });
    expect(screen.queryByTitle('Roof work (100%)')).not.toBeInTheDocument();
    expect(screen.getByTitle('Last calendar day (0%)')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Project A' } });
    expect(screen.getByTitle('Roof work (100%)')).toBeInTheDocument();
    const nextMonth = container.querySelector('.lucide-chevron-right')!.closest('button')!;
    fireEvent.click(nextMonth);
    expect(screen.queryByTitle('Roof work (100%)')).not.toBeInTheDocument();
    const previousMonth = container.querySelector('.lucide-chevron-left')!.closest('button')!;
    fireEvent.click(previousMonth);
    expect(screen.getByTitle('Roof work (100%)')).toBeInTheDocument();
    expect(JSON.stringify(props.schedules)).toBe(original);
  });
});

describe('construction contractor schedule view', () => {
  const props = {
    view: 'contractor-schedule', plots, taskTemplates, weatherInfo: null,
    contractors: [{ name: 'Team A', phone: '0000000001' }, { name: 'Team B', phone: '0000000002' }],
    assignments: [
      { plot_id: 'P1', task_template_id: 'A', contractor_name: 'Team A', current_progress: 80 },
      { plot_id: 'P1', task_template_id: 'B', contractor_name: 'Team A', current_progress: 0 },
      { plot_id: 'P2', task_template_id: 'C', contractor_name: 'Team B', current_progress: 0 },
    ],
    schedules: {
      'P1-A': { plot_id: 'P1', task_template_id: 'A', planned_start: '2026-10-08', planned_end: '2026-10-08' },
      'P1-B': { plot_id: 'P1', task_template_id: 'B', planned_start: '2026-10-09', planned_end: '2026-10-10' },
      'P2-C': { plot_id: 'P2', task_template_id: 'C', planned_start: '2026-10-08', planned_end: '2026-10-08' },
    }, latestUpdatesMap: { 'P1-A': { progress: 0 } }, loggedInUser: { username: 'Foreman A', role: 'Foreman' },
  };
  const todayCard = () => screen.getByRole('heading', { name: 'งานวันนี้ (Today)' }).parentElement!.parentElement!;

  it('includes work starting and ending today and treats the latest zero as authoritative', () => {
    render(<ContractorScheduleView {...props} />);
    expect(within(todayCard()).getByText('Roof work')).toBeInTheDocument();
    expect(within(todayCard()).getByText('0%')).toBeInTheDocument();
    expect(within(todayCard()).queryByText('80%')).not.toBeInTheDocument();
    expect(within(todayCard()).queryByText('ล่าช้า!')).not.toBeInTheDocument();
    expect(screen.queryByText('Paint work')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'tel:0000000001');
  });

  it('keeps Foreman restrictions and recalculates when the account changes', () => {
    const { rerender } = render(<ContractorScheduleView {...props} />);
    expect(screen.queryByText('Paint work')).not.toBeInTheDocument();
    rerender(<ContractorScheduleView {...props} loggedInUser={{ username: 'Foreman B', role: 'Foreman' }} />);
    expect(screen.queryByText('Roof work')).not.toBeInTheDocument();
    expect(within(todayCard()).getByText('Paint work')).toBeInTheDocument();
    rerender(<ContractorScheduleView {...props} loggedInUser={{ username: 'Engineer', role: 'Site Engineer' }} />);
    expect(within(todayCard()).getByText('Roof work')).toBeInTheDocument();
    expect(within(todayCard()).getByText('Paint work')).toBeInTheDocument();
  });

  it('keeps today operations independent from timeline week navigation', () => {
    const { container } = render(<ContractorScheduleView {...props} />);
    fireEvent.click(container.querySelector('.lucide-chevron-right')!.closest('button')!);
    expect(screen.getByText('สัปดาห์ที่ +1')).toBeInTheDocument();
    expect(within(todayCard()).getByText('Roof work')).toBeInTheDocument();
    expect(screen.getAllByText('ไม่มีงาน')).toHaveLength(7);
    fireEvent.click(container.querySelector('.lucide-chevron-left')!.closest('button')!);
    expect(screen.getByText('สัปดาห์ที่ 0')).toBeInTheDocument();
  });

  it.each(['null', '[]', '"not a dictionary"', '{"chk_Team A_โทรคอนเฟิร์มช่างแล้ว":"invalid"}'])('ignores malformed saved checklist %s', stored => {
    localStorage.setItem('buildtrack_call_checklists', stored);
    render(<ContractorScheduleView {...props} />);
    expect(screen.getByRole('checkbox', { name: 'โทรคอนเฟิร์มช่างแล้ว' })).not.toBeChecked();
  });

  it('restores valid checklist values and still allows toggling when local persistence fails', () => {
    localStorage.setItem('buildtrack_call_checklists', JSON.stringify({ 'chk_Team A_โทรคอนเฟิร์มช่างแล้ว': true }));
    render(<ContractorScheduleView {...props} />);
    const checkbox = screen.getByRole('checkbox', { name: 'โทรคอนเฟิร์มช่างแล้ว' });
    expect(checkbox).toBeChecked();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
});
