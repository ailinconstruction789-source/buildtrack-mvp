import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import QCDailyInspectionPlanSlideOver from '../QCDailyInspectionPlanSlideOver';

describe('QCDailyInspectionPlanSlideOver Component', () => {
  const mockQueue = [
    {
      plot_id: 'plot-10',
      plot_name: 'แปลง 10',
      task_template_id: 'task-concrete',
      task_name: 'งานเทคอนกรีตเสา',
      project_name: 'ไอลิน 6',
      foreman: 'LEAB',
      statusFor: 'QC',
      created_at: '2026-11-21T03:00:00Z', // 10:00 BKK
    },
    {
      plot_id: 'plot-12',
      plot_name: 'แปลง 12',
      task_template_id: 'task-clean',
      task_name: 'งานทำความสะอาด',
      project_name: 'ไอลิน 6',
      foreman: 'VIEW',
      statusFor: 'QC',
      created_at: '2026-11-21T11:00:00Z', // 18:00 BKK (Late)
    },
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <QCDailyInspectionPlanSlideOver
        isOpen={false}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders scorecards, weighted points, and task cards when open', () => {
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
      />
    );

    // Header & Titles
    expect(screen.getByText(/แผนตรวจงานประจำวัน QC/i)).toBeInTheDocument();

    // Scorecards: 2 tasks total, 6 points total (5 + 1)
    expect(screen.getByText('2')).toBeInTheDocument(); // total tasks
    expect(screen.getByText('6')).toBeInTheDocument(); // total points
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2); // hold point + late handoff scorecards

    // Task items
    expect(screen.getByText(/งานเทคอนกรีตเสา/i)).toBeInTheDocument();
    expect(screen.getByText(/งานทำความสะอาด/i)).toBeInTheDocument();

    // Weight score badges
    expect(screen.getByText(/5 แต้ม \(Hold Point\)/i)).toBeInTheDocument();
    expect(screen.getByText(/1 แต้ม \(งานย่อย\)/i)).toBeInTheDocument();
  });

  it('filters by Hold Point tab when clicked', () => {
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
      />
    );

    const holdTabBtn = screen.getByRole('button', { name: /Hold Point \(1\)/i });
    fireEvent.click(holdTabBtn);

    // Only Hold point task should be visible
    expect(screen.getByText(/งานเทคอนกรีตเสา/i)).toBeInTheDocument();
    expect(screen.queryByText(/งานทำความสะอาด/i)).not.toBeInTheDocument();
  });

  it('filters tasks by search input', () => {
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
      />
    );

    const searchInput = screen.getByPlaceholderText(/ค้นหาชื่องาน/i);
    fireEvent.change(searchInput, { target: { value: 'แปลง 12' } });

    expect(screen.queryByText(/งานเทคอนกรีตเสา/i)).not.toBeInTheDocument();
    expect(screen.getByText(/งานทำความสะอาด/i)).toBeInTheDocument();
  });

  it('triggers onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={handleClose}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
      />
    );

    const closeBtn = screen.getByTitle('ปิดหน้าต่าง');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders "ตั้งค่าน้ำหนัก" button for Admin role and opens modal when clicked', () => {
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
        currentUserRole="Admin"
      />
    );

    const weightBtn = screen.getByTitle(/ตั้งค่าน้ำหนักแม่แบบงานตรวจ/i);
    expect(weightBtn).toBeInTheDocument();

    fireEvent.click(weightBtn);

    // Modal title should appear
    expect(screen.getByText(/กำหนดแต้มภาระงานตามขอบเขตจริง/i)).toBeInTheDocument();
  });

  it('triggers onSelectTask when task item is selected', () => {
    const handleSelect = vi.fn();
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
        onSelectTask={handleSelect}
      />
    );

    const taskCard = screen.getByText(/งานเทคอนกรีตเสา/i).closest('div');
    if (taskCard) {
      fireEvent.click(taskCard);
      expect(handleSelect).toHaveBeenCalledTimes(1);
      expect(handleSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          task_name: 'งานเทคอนกรีตเสา',
          plot_id: 'plot-10',
        })
      );
    }
  });

  it('renders "การลา" button and opens leave management modal when clicked', () => {
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
        currentUserRole="QC"
      />
    );

    const leaveBtn = screen.getByTitle(/จัดการคำขอลาและตรวจสอบวันลา/i);
    expect(leaveBtn).toBeInTheDocument();

    fireEvent.click(leaveBtn);

    // Leave Modal Title should appear
    expect(screen.getByText(/ระบบการลา QC \(Leave & Stand-in Management\)/i)).toBeInTheDocument();
  });

  it('renders "มอบหมายผู้ตรวจแทน" for Planner/Admin role and opens stand-in assignment modal', () => {
    render(
      <QCDailyInspectionPlanSlideOver
        isOpen={true}
        onClose={vi.fn()}
        inspectionQueue={mockQueue}
        todayDateStr="2026-11-21"
        currentUserRole="Admin"
      />
    );

    const assignBtns = screen.getAllByRole('button', { name: /มอบหมายผู้ตรวจแทน/i });
    expect(assignBtns.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(assignBtns[0]);

    // Stand-in Modal Title should appear
    expect(screen.getByText(/มอบหมายผู้ตรวจแทน \(Stand-in Assignment\)/i)).toBeInTheDocument();
  });
});
