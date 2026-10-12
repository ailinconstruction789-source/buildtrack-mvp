import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DailyActivityHub from '../DailyActivityHub';

vi.mock('../MeterPhotoConfirmationModal', () => ({ default: () => null }));

const createdAt = '2026-10-01T10:00:00Z';
const otherCreatedAt = '2026-10-02T10:00:00Z';
const localDay = new Date(createdAt).toLocaleDateString('en-CA');
const props = {
  allUpdatesRecord: [{ id: 1, plot_id: 'A', task_template_id: 7, created_at: createdAt, role: 'Foreman', user_name: 'Worker A',
    progress: 50, action: 'First activity', image_url: 'https://example.test/image.jpg' },
    { id: 2, plot_id: 'A', task_template_id: '7', created_at: otherCreatedAt, role: 'Foreman', user_name: 'Worker A', progress: 70, action: 'String task activity' }],
  defects: [], defectUpdates: [], allUsers: [{ username: 'Worker A', role: 'Foreman' }],
  plots: [{ id: 'A', project_name: 'Project', progress: 50, foreman: 'Worker A' }],
  projects: [{ name: 'Project' }], selectedProject: { name: 'Project' },
  taskTemplates: [{ id: 7, task_name: 'First task' }, { id: 7, task_name: 'Duplicate task' }, { id: '7', task_name: 'String task' }],
};
beforeEach(() => { localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('daily construction activity hub (synthetic data)', () => {
  it('keeps first template lookup and strict IDs while changing dates and filters', () => {
    const { container } = render(<DailyActivityHub {...props} />);
    const dateInput = container.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: localDay } });
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.queryByText('Duplicate task')).not.toBeInTheDocument();
    const image = screen.getByAltText('รูปหน้างาน');
    expect(image).toHaveAttribute('loading', 'lazy'); expect(image).toHaveAttribute('decoding', 'async');
    fireEvent.change(dateInput, { target: { value: new Date(otherCreatedAt).toLocaleDateString('en-CA') } });
    expect(screen.getByText('String task')).toBeInTheDocument();
    const search = screen.getByPlaceholderText('ค้นหาชื่อ, แปลง, ชื่องาน...');
    fireEvent.change(search, { target: { value: '__not_found__' } });
    expect(screen.queryByText('String task')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('String task')).toBeInTheDocument();
  });
  it('indexes local dates once instead of scanning history on date/search changes or in the closed modal', () => {
    const original = Date.prototype.toLocaleDateString;
    let historyDatesParsed = 0;
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function(this: Date, ...args) {
      if (this.getTime() === new Date(createdAt).getTime() || this.getTime() === new Date(otherCreatedAt).getTime()) historyDatesParsed++;
      return original.apply(this, args);
    });
    const { container, rerender } = render(<DailyActivityHub {...props} />);
    expect(historyDatesParsed).toBe(2);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: localDay } });
    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อ, แปลง, ชื่องาน...'), { target: { value: 'First' } });
    rerender(<DailyActivityHub {...props} allUsers={[...props.allUsers]} />);
    expect(historyDatesParsed).toBe(2);
  });
  it('restores complete modal data on reopen while retaining its search filter', () => {
    const { container } = render(<DailyActivityHub {...props} />);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: localDay } });
    fireEvent.click(screen.getByText('ตารางประเมินผลงาน (แบบที่ 5)'));
    const search = screen.getByPlaceholderText('ค้นหาชื่อพนักงาน หรือ แปลง...');
    fireEvent.change(search, { target: { value: 'Worker' } });
    const modal = screen.getByText('ตารางประเมินการปฏิบัติงานรายบุคคล (Daily Accountability Table)').closest('.fixed')!;
    const close = Array.from(modal.querySelectorAll('button')).find(button => button.querySelector('.lucide-x'))!;
    fireEvent.click(close);
    expect(screen.queryByPlaceholderText('ค้นหาชื่อพนักงาน หรือ แปลง...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ตารางประเมินผลงาน (แบบที่ 5)'));
    expect(screen.getByPlaceholderText('ค้นหาชื่อพนักงาน หรือ แปลง...')).toHaveValue('Worker');
    const reopened = screen.getByText('ตารางประเมินการปฏิบัติงานรายบุคคล (Daily Accountability Table)').closest('.fixed')!;
    expect(reopened.textContent).toContain('Worker A');
  });
  it('releases the daily CSV Blob URL and removes the download anchor', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:daily-report'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container } = render(<DailyActivityHub {...props} />);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: localDay } });
    fireEvent.click(screen.getByText('ตารางประเมินผลงาน (แบบที่ 5)'));
    fireEvent.click(screen.getByText('Export CSV'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:daily-report');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.unstubAllGlobals();
  });
});
