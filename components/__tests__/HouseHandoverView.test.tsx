import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HouseHandoverView from '../HouseHandoverView';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null })
      })),
      insert: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      })),
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null })
      }))
    }))
  }
}));

describe('HouseHandoverView - Mobile Schedule Editing', () => {
  const mockPlot = {
    id: 'A01',
    handover_cycle: 1,
    inspection_round: 1,
    handover_status: 'pending'
  };

  const mockDefect = {
    id: 'def-1',
    plot_id: 'A01',
    description: 'เก็บสีผนังห้องนอนใหญ่',
    defect_stage: 'handover',
    handover_cycle: 1,
    inspection_round: 1,
    status: 'pending',
    progress: 0,
    planned_start: '2026-09-20T00:00:00Z',
    planned_end: '2026-09-22T00:00:00Z'
  };

  const mockTaskTemplates = [
    { id: 't1', task_name: 'เก็บงานสีผนัง' }
  ];

  const defaultProps = {
    selectedPlot: mockPlot,
    defects: [mockDefect],
    setDefects: vi.fn(),
    currentUserRole: 'Foreman',
    resetHandoverCycle: vi.fn(),
    updateInspectionRound: vi.fn(),
    fetchAllData: vi.fn(),
    taskTemplates: mockTaskTemplates,
    contractors: [],
    assignments: [],
    schedules: [],
    isMobileLayout: true,
    setView: vi.fn(),
    setSelectedDefect: vi.fn(),
    setDefectReturnView: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders editable date and duration inputs on mobile for Foreman', () => {
    render(<HouseHandoverView {...defaultProps} isMobileLayout={true} currentUserRole="Foreman" />);

    expect(screen.getByText(/แผนงานซ่อม/i)).toBeInTheDocument();
    expect(screen.getByText('วันเริ่ม')).toBeInTheDocument();
    expect(screen.getByText('ระยะเวลา')).toBeInTheDocument();
    expect(screen.getByText('วันเสร็จสิ้น')).toBeInTheDocument();

    const dateInputs = screen.getAllByDisplayValue(/2026-09-2/);
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('allows Foreman to change duration and auto-updates end date on mobile', () => {
    render(<HouseHandoverView {...defaultProps} isMobileLayout={true} currentUserRole="Foreman" />);

    const durationInput = screen.getByPlaceholderText('วัน');
    fireEvent.change(durationInput, { target: { value: '5' } });

    expect(screen.getByDisplayValue('2026-09-24')).toBeInTheDocument();
    expect(screen.getByText(/บันทึกแผนซ่อมรายการนี้/i)).toBeInTheDocument();
    expect(screen.getByText(/บันทึกแผนซ่อม \(1 รายการ\)/i)).toBeInTheDocument();
  });

  it('renders read-only schedule when handover is completed or user lacks permission', () => {
    render(
      <HouseHandoverView 
        {...defaultProps} 
        isMobileLayout={true} 
        currentUserRole="Worker"
      />
    );

    expect(screen.queryByPlaceholderText('วัน')).not.toBeInTheDocument();
    expect(screen.getByText('แผนงาน')).toBeInTheDocument();
  });

  it('allows Procurement to edit only start date and save without specifying end date', () => {
    const defectWithoutDates = {
      ...mockDefect,
      planned_start: null,
      planned_end: null
    };

    render(
      <HouseHandoverView 
        {...defaultProps} 
        defects={[defectWithoutDates]}
        isMobileLayout={true} 
        currentUserRole="Procurement" 
      />
    );

    // Should indicate Procurement role
    expect(screen.getAllByText(/ผู้จัดจ้าง/i).length).toBeGreaterThan(0);
    // Duration input should not be an active number input for Procurement
    expect(screen.queryByPlaceholderText('วัน')).not.toBeInTheDocument();
    expect(screen.getByText('รอโฟร์แมน')).toBeInTheDocument();

    // Start date input is available
    const allInputs = document.querySelectorAll('input[type="date"]');
    expect(allInputs.length).toBe(1); // Only start date is an editable date input for Procurement

    // Change start date
    fireEvent.change(allInputs[0], { target: { value: '2026-09-25' } });

    // In-card save button and floating save bar should appear with Procurement wording
    expect(screen.getByText(/บันทึกวันเริ่มงานรายการนี้/i)).toBeInTheDocument();
    expect(screen.getByText(/💾 บันทึกวันเริ่มงาน \(1 รายการ\)/i)).toBeInTheDocument();

    // Trigger save
    fireEvent.click(screen.getByText(/บันทึกวันเริ่มงานรายการนี้/i));
  });
});
