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

  describe('Inspection Round Management for Foreman', () => {
    it('allows Foreman to see and click "เริ่มตรวจรอบที่ 1 >" when inspection round has not started (round 0)', async () => {
      const updateInspectionRoundMock = vi.fn().mockResolvedValue(true);
      const plotRoundZero = {
        ...mockPlot,
        inspection_round: 0
      };

      render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={plotRoundZero} 
          currentUserRole="Foreman" 
          updateInspectionRound={updateInspectionRoundMock}
        />
      );

      // Verify header indicates inspection round has not started
      expect(screen.getByText(/รอบการตรวจ: ยังไม่เริ่ม/i)).toBeInTheDocument();

      // Start round 1 button must be visible for Foreman
      const startRoundBtn = screen.getByRole('button', { name: /เริ่มตรวจรอบที่ 1 >/i });
      expect(startRoundBtn).toBeInTheDocument();
      expect(startRoundBtn).toBeEnabled();

      // Clicking start round opens confirmation modal
      fireEvent.click(startRoundBtn);

      expect(screen.getByText(/เริ่มการตรวจรอบใหม่/i)).toBeInTheDocument();

      // Confirm start round
      const confirmBtn = screen.getByRole('button', { name: 'เริ่มตรวจรอบที่ 1' });
      fireEvent.click(confirmBtn);

      expect(updateInspectionRoundMock).toHaveBeenCalledWith('A01', 1);
    });

    it('allows Foreman to start round 2 when current round is 1 and all defects are 100% completed', async () => {
      const updateInspectionRoundMock = vi.fn().mockResolvedValue(true);
      const completedDefect = {
        ...mockDefect,
        progress: 100,
        status: 'completed'
      };

      render(
        <HouseHandoverView 
          {...defaultProps} 
          defects={[completedDefect]}
          currentUserRole="Foreman" 
          updateInspectionRound={updateInspectionRoundMock}
        />
      );

      const nextRoundBtn = screen.getByRole('button', { name: /เริ่มตรวจรอบที่ 2 >/i });
      expect(nextRoundBtn).toBeInTheDocument();

      fireEvent.click(nextRoundBtn);
      expect(screen.getByText(/เริ่มการตรวจรอบใหม่/i)).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: 'เริ่มตรวจรอบที่ 2' });
      fireEvent.click(confirmBtn);

      expect(updateInspectionRoundMock).toHaveBeenCalledWith('A01', 2);
    });

    it('does not display start round button for Foreman when handover is already completed', () => {
      const completedPlot = {
        ...mockPlot,
        handover_status: 'completed'
      };

      render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={completedPlot} 
          currentUserRole="Foreman" 
        />
      );

      expect(screen.queryByRole('button', { name: /เริ่มตรวจรอบที่/i })).not.toBeInTheDocument();
    });
  });

  describe('Defect Deletion Permissions', () => {
    it('allows Foreman to see delete button when defect progress is 0%', () => {
      const zeroProgressDefect = {
        ...mockDefect,
        inspection_round: 1,
        progress: 0
      };

      render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={{ ...mockPlot, inspection_round: 1 }}
          defects={[zeroProgressDefect]}
          currentUserRole="Foreman" 
        />
      );

      const deleteButtons = screen.getAllByTitle(/ลบรายการที่เพิ่มผิด/i);
      expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it('does not allow Foreman to see delete button when defect progress is greater than 0%', () => {
      const inProgressDefect = {
        ...mockDefect,
        inspection_round: 1,
        progress: 50
      };

      render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={{ ...mockPlot, inspection_round: 1 }}
          defects={[inProgressDefect]}
          currentUserRole="Foreman" 
        />
      );

      expect(screen.queryByTitle(/ลบรายการที่เพิ่มผิด/i)).not.toBeInTheDocument();
      expect(screen.queryByTitle(/ลบรายการแจ้งซ่อม/i)).not.toBeInTheDocument();
    });

    it('allows Admin to see delete button even when defect has progress', () => {
      const inProgressDefect = {
        ...mockDefect,
        inspection_round: 1,
        progress: 50
      };

      render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={{ ...mockPlot, inspection_round: 1 }}
          defects={[inProgressDefect]}
          currentUserRole="Admin" 
        />
      );

      const deleteButtons = screen.getAllByTitle(/ลบรายการแจ้งซ่อม/i);
      expect(deleteButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Custom Handover Tasks & Furniture Support', () => {
    it('shows "+ เพิ่มงานเพิ่มเติม (Admin)" button only for Admin role', () => {
      const { rerender } = render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={{ ...mockPlot, inspection_round: 1 }}
          currentUserRole="Foreman" 
        />
      );
      expect(screen.queryByText(/\+ เพิ่มงานเพิ่มเติม \(Admin\)/i)).not.toBeInTheDocument();

      rerender(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={{ ...mockPlot, inspection_round: 1 }}
          currentUserRole="Admin" 
        />
      );
      expect(screen.getByText(/\+ เพิ่มงานเพิ่มเติม \(Admin\)/i)).toBeInTheDocument();
    });

    it('opens CustomHandoverTaskModal when Admin clicks "+ เพิ่มงานเพิ่มเติม (Admin)"', () => {
      render(
        <HouseHandoverView 
          {...defaultProps} 
          selectedPlot={{ ...mockPlot, inspection_round: 1 }}
          currentUserRole="Admin" 
        />
      );

      const addCustomBtn = screen.getByText(/\+ เพิ่มงานเพิ่มเติม \(Admin\)/i);
      fireEvent.click(addCustomBtn);

      expect(screen.getByText(/เพิ่มงานตรวจรับเพิ่มเติม \(เฉพาะ Admin\)/i)).toBeInTheDocument();
      expect(screen.getByText(/🛋️ งานเฟอร์นิเจอร์/i)).toBeInTheDocument();
      expect(screen.getByText(/🪟 งานผ้าม่าน\/มุ้งลวด/i)).toBeInTheDocument();
    });
  });
});
