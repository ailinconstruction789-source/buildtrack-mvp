import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ConstructionForemanHandoffModal from '../ConstructionForemanHandoffModal';

// Mock Supabase
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null })
});
const mockInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'plot_task_assignments') return { upsert: mockUpsert };
      if (table === 'plots') return { update: mockUpdate };
      if (table === 'plot_foreman_handovers') return { insert: mockInsert };
      return {};
    }),
  },
}));

describe('ConstructionForemanHandoffModal UI Component', () => {
  const plot = {
    id: 'plot-101',
    plot_name: 'แปลง A-01',
    project_name: 'โครงการไอลิน 6',
  };

  const foremanInfo = {
    plotId: 'plot-101',
    currentForeman: 'LEAB',
    previousForeman: 'SOMCHAI',
    handoffAt: '2026-11-10T08:00:00Z',
    handoffReason: 'เกลี่ยงานเฟสแรก',
    completedTasks: [
      { taskId: 't1', taskName: 'ตอกเสาเข็ม', taskOrder: 1, currentProgress: 100, isCompleted: true, qcStatus: 'passed' as const, assignedForeman: 'LEAB' },
      { taskId: 't2', taskName: 'เทฐานราก', taskOrder: 2, currentProgress: 100, isCompleted: true, qcStatus: 'passed' as const, assignedForeman: 'LEAB' },
    ],
    pendingTasks: [
      { taskId: 't3', taskName: 'ก่ออิฐชั้น 1', taskOrder: 3, currentProgress: 50, isCompleted: false, qcStatus: 'none' as const, assignedForeman: 'LEAB' },
      { taskId: 't4', taskName: 'มุงหลังคา', taskOrder: 4, currentProgress: 0, isCompleted: false, qcStatus: 'none' as const, assignedForeman: null },
    ],
    completedCount: 2,
    pendingCount: 2,
  };

  const foremenList = [
    { username: 'LEAB', role: 'Foreman' },
    { username: 'DEN', role: 'Foreman' },
    { username: 'VIEW', role: 'Foreman' },
  ];

  it('renders current foreman, previous foreman, and task count breakdowns', () => {
    render(
      <ConstructionForemanHandoffModal
        isOpen={true}
        onClose={vi.fn()}
        plot={plot}
        foremanInfo={foremanInfo}
        foremenList={foremenList}
        currentUserName="AdminUser"
        onSuccess={vi.fn()}
      />
    );

    // Displays current & previous foreman
    expect(screen.getByText('LEAB')).toBeInTheDocument();
    expect(screen.getByText(/รับช่วงจาก:/)).toBeInTheDocument();
    expect(screen.getByText('SOMCHAI')).toBeInTheDocument();

    // Displays counts
    expect(screen.getByText('2 งาน', { selector: '.bg-emerald-600' })).toBeInTheDocument();
    expect(screen.getByText('2 งาน', { selector: '.bg-amber-500' })).toBeInTheDocument();
  });

  it('filters out current foreman from available new foreman choices', () => {
    render(
      <ConstructionForemanHandoffModal
        isOpen={true}
        onClose={vi.fn()}
        plot={plot}
        foremanInfo={foremanInfo}
        foremenList={foremenList}
        currentUserName="AdminUser"
        onSuccess={vi.fn()}
      />
    );

    const select = screen.getByLabelText(/โฟร์แมนคนใหม่/);
    const options = Array.from(select.querySelectorAll('option')).map(o => o.value);

    expect(options).toContain('DEN');
    expect(options).toContain('VIEW');
    expect(options).not.toContain('LEAB');
  });

  it('submits handoff when a new foreman is selected', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <ConstructionForemanHandoffModal
        isOpen={true}
        onClose={onClose}
        plot={plot}
        foremanInfo={foremanInfo}
        foremenList={foremenList}
        currentUserName="AdminUser"
        onSuccess={onSuccess}
      />
    );

    const select = screen.getByLabelText(/โฟร์แมนคนใหม่/);
    fireEvent.change(select, { target: { value: 'DEN' } });

    const submitBtn = screen.getByRole('button', { name: /ยืนยันการเปลี่ยนโฟร์แมน/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('DEN', 'LEAB');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
