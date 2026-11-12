import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HouseHandoverView from '../HouseHandoverView';
import { supabase } from '@/lib/supabase';

const supabaseSpies = vi.hoisted(() => ({
  updateIn: vi.fn().mockResolvedValue({ error: null }),
  updateEq: vi.fn().mockResolvedValue({ error: null }),
  update: vi.fn(),
  insertSelect: vi.fn().mockResolvedValue({ data: [], error: null }),
  insert: vi.fn(),
  deleteEq: vi.fn().mockResolvedValue({ error: null }),
}));

// Mock Supabase
vi.mock('@/lib/supabase', () => {
  supabaseSpies.update.mockImplementation(() => ({
    eq: supabaseSpies.updateEq,
    in: supabaseSpies.updateIn,
  }));
  supabaseSpies.insert.mockImplementation((rows: any[]) => {
    supabaseSpies.insertSelect.mockResolvedValueOnce({
      data: (rows || []).map((r, i) => ({ id: `new-def-${i + 1}`, progress: 0, ...r })),
      error: null,
    });
    return { select: supabaseSpies.insertSelect };
  });
  return {
    supabase: {
      from: vi.fn(() => ({
        update: supabaseSpies.update,
        insert: supabaseSpies.insert,
        delete: vi.fn(() => ({
          eq: supabaseSpies.deleteEq,
        })),
      })),
    },
  };
});

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

  describe('Handover Foreman Assignment & Handoff Flow', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      supabaseSpies.updateEq.mockResolvedValue({ error: null });
      supabaseSpies.updateIn.mockResolvedValue({ error: null });
      supabaseSpies.update.mockImplementation(() => ({
        eq: supabaseSpies.updateEq,
        in: supabaseSpies.updateIn,
      }));
      supabaseSpies.insert.mockImplementation((rows: any[]) => {
        supabaseSpies.insertSelect.mockResolvedValueOnce({
          data: (rows || []).map((r, i) => ({ id: `new-def-${i + 1}`, progress: 0, ...r })),
          error: null,
        });
        return { select: supabaseSpies.insertSelect };
      });
    });

    it('immediately assigns incoming foreman when plot has no handover foreman yet', async () => {
      const plotWithConstructionFm = {
        ...mockPlot,
        foreman_name: 'LEAB',
      };

      render(
        <HouseHandoverView
          {...defaultProps}
          selectedPlot={plotWithConstructionFm}
          defects={[]}
          currentUserRole="Foreman"
          currentUserName="VIEW"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /เพิ่มรายการแจ้งซ่อม \(ลูกค้า\)/i }));
      fireEvent.click(screen.getByText('เก็บงานสีผนัง'));
      fireEvent.click(screen.getByRole('button', { name: /เพิ่มรายการเข้าสู่รอบตรวจ/i }));

      await vi.waitFor(() => {
        expect(supabaseSpies.insert).toHaveBeenCalledTimes(1);
      });
      const insertedRows = supabaseSpies.insert.mock.calls[0][0];
      expect(insertedRows[0].foreman_name).toBe('VIEW');
      expect(supabaseSpies.update).toHaveBeenCalledWith(
        expect.objectContaining({ handover_foreman_name: 'VIEW' })
      );
    });

    it('prompts when a second foreman adds work, and supports takeover preserving completed items to original foreman', async () => {
      const plotHandledByView = {
        ...mockPlot,
        foreman_name: 'LEAB',
        handover_foreman_name: 'VIEW',
      };
      const existingDefects = [
        {
          id: 'def-done-1',
          plot_id: 'A01',
          description: 'แก้: งานเก่าที่เสร็จแล้ว',
          defect_stage: 'handover',
          handover_cycle: 1,
          inspection_round: 1,
          status: 'resolved',
          progress: 100,
          foreman_name: null,
        },
        {
          id: 'def-wip-1',
          plot_id: 'A01',
          description: 'แก้: งานเก่าที่ยังค้าง',
          defect_stage: 'handover',
          handover_cycle: 1,
          inspection_round: 1,
          status: 'in_progress',
          progress: 40,
          foreman_name: 'VIEW',
        },
      ];

      render(
        <HouseHandoverView
          {...defaultProps}
          selectedPlot={plotHandledByView}
          defects={existingDefects}
          currentUserRole="Foreman"
          currentUserName="SOMCHAI"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /เพิ่มรายการแจ้งซ่อม \(ลูกค้า\)/i }));
      fireEvent.click(screen.getByText('เก็บงานสีผนัง'));
      fireEvent.click(screen.getByRole('button', { name: /เพิ่มรายการเข้าสู่รอบตรวจ/i }));

      // Handoff modal prompts clearly
      expect(await screen.findByText(/พบโฟร์แมนเดิมกำลังดูแลงานตรวจรับ/i)).toBeInTheDocument();
      expect(screen.getByText(/หลังนี้มีโฟร์แมน “VIEW” ทำงานอยู่นะ/i)).toBeInTheDocument();

      // Choose takeover
      fireEvent.click(screen.getByRole('button', { name: /🔄 มาต่องาน/i }));

      await vi.waitFor(() => {
        expect(supabaseSpies.insert).toHaveBeenCalledTimes(1);
      });

      // Completed legacy row frozen under VIEW, incomplete row moved to SOMCHAI, new row created under SOMCHAI
      expect(supabaseSpies.update).toHaveBeenCalledWith({ foreman_name: 'VIEW' });
      expect(supabaseSpies.updateIn).toHaveBeenCalledWith('id', ['def-done-1']);
      expect(supabaseSpies.update).toHaveBeenCalledWith({ foreman_name: 'SOMCHAI' });
      expect(supabaseSpies.updateIn).toHaveBeenCalledWith('id', ['def-wip-1']);
      expect(supabaseSpies.insert.mock.calls[0][0][0].foreman_name).toBe('SOMCHAI');
      expect(supabaseSpies.update).toHaveBeenCalledWith(
        expect.objectContaining({ handover_foreman_name: 'SOMCHAI' })
      );
    });

    it('keeps original foreman when QC or Admin adds handover defects (Rule 1.1)', async () => {
      const plotHandledByView = {
        ...mockPlot,
        foreman_name: 'LEAB',
        handover_foreman_name: 'VIEW',
      };

      render(
        <HouseHandoverView
          {...defaultProps}
          selectedPlot={plotHandledByView}
          defects={[]}
          currentUserRole="QC"
          currentUserName="QC-Som"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /เพิ่มรายการแจ้งซ่อม \(ลูกค้า\)/i }));
      fireEvent.click(screen.getByText('เก็บงานสีผนัง'));
      fireEvent.click(screen.getByRole('button', { name: /เพิ่มรายการเข้าสู่รอบตรวจ/i }));

      // No handoff prompt; defect attributed to current handover foreman VIEW
      expect(screen.queryByText(/พบโฟร์แมนเดิมกำลังดูแลงานตรวจรับ/i)).not.toBeInTheDocument();
      await vi.waitFor(() => {
        expect(supabaseSpies.insert).toHaveBeenCalledTimes(1);
      });
      expect(supabaseSpies.insert.mock.calls[0][0][0].foreman_name).toBe('VIEW');
    });
  });

  describe('Admin/Owner handover foreman reassignment modal (transfer vs fix_cycle)', () => {
    it('supports fix_cycle mode to reattribute all cycle handover defects and sync handover snapshots without modifying construction foreman', async () => {
      const setDefectsMock = vi.fn();
      const plotAilin4 = {
        id: 'plot-ailin4-1',
        name: 'แปลง 04',
        project_name: 'ไอลิน 4',
        foreman_name: 'Auen',
        handover_cycle: 1,
        inspection_round: 1,
        handover_status: 'pending',
      };
      const cycleDefects = [
        {
          id: 'def-active',
          plot_id: 'plot-ailin4-1',
          description: 'เก็บสีผนัง',
          defect_stage: 'handover',
          handover_cycle: 1,
          inspection_round: 1,
          status: 'pending',
          progress: 20,
          foreman_name: null,
        },
        {
          id: 'def-done',
          plot_id: 'plot-ailin4-1',
          description: 'ซ่อมฝ้า',
          defect_stage: 'handover',
          handover_cycle: 1,
          inspection_round: 1,
          status: 'resolved',
          progress: 100,
          foreman_name: null,
        },
      ];

      render(
        <HouseHandoverView
          {...defaultProps}
          selectedPlot={plotAilin4}
          defects={cycleDefects}
          setDefects={setDefectsMock}
          currentUserRole="Admin"
          currentUserName="AdminUser"
          foremenList={[
            { username: 'DEN', name: 'Den', role: 'Foreman' },
            { username: 'Auen', name: 'Auen', role: 'Foreman' },
          ]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /เปลี่ยน \/ ระบุโฟร์แมน/i }));
      fireEvent.change(screen.getByDisplayValue('Auen'), { target: { value: 'DEN' } });
      fireEvent.click(screen.getByText(/แก้ไขชื่อผู้รับผิดชอบที่ระบุผิด \(ทั้งรอบตรวจรับนี้\)/i));
      fireEvent.click(screen.getByRole('button', { name: /บันทึกผู้รับผิดชอบ/i }));

      await waitFor(() => {
        expect(supabaseSpies.updateIn).toHaveBeenCalledWith('id', ['def-active', 'def-done']);
      });

      const calledTables = (supabase.from as any).mock.calls.map((c: any[]) => c[0]);
      expect(calledTables).toContain('defects');
      expect(calledTables).toContain('plots');
      expect(calledTables).toContain('foreman_daily_duty_snapshots');

      const updatePayloads = supabaseSpies.update.mock.calls.map((c: any[]) => c[0]);
      expect(updatePayloads).toContainEqual({ foreman_name: 'DEN' });
      expect(updatePayloads).toContainEqual(
        expect.objectContaining({ handover_foreman_name: 'DEN' })
      );
      expect(supabaseSpies.updateEq).toHaveBeenCalledWith('id', 'plot-ailin4-1');
      expect(setDefectsMock).toHaveBeenCalledTimes(1);
    });

    it('supports transfer mode to freeze completed handover items on Auen and move incomplete items to DEN without rewriting snapshots', async () => {
      const plotAilin4 = {
        id: 'plot-ailin4-2',
        name: 'แปลง 05',
        project_name: 'ไอลิน 4',
        foreman_name: 'Auen',
        handover_foreman_name: 'Auen',
        handover_cycle: 1,
        inspection_round: 1,
        handover_status: 'pending',
      };
      const cycleDefects = [
        {
          id: 'def-incomplete',
          plot_id: 'plot-ailin4-2',
          description: 'ปรับระดับกระเบื้อง',
          defect_stage: 'handover',
          handover_cycle: 1,
          inspection_round: 1,
          status: 'in_progress',
          progress: 30,
          foreman_name: null,
        },
        {
          id: 'def-complete',
          plot_id: 'plot-ailin4-2',
          description: 'ติดบัวพื้น',
          defect_stage: 'handover',
          handover_cycle: 1,
          inspection_round: 1,
          status: 'resolved',
          progress: 100,
          foreman_name: null,
        },
      ];

      render(
        <HouseHandoverView
          {...defaultProps}
          selectedPlot={plotAilin4}
          defects={cycleDefects}
          currentUserRole="Owner"
          currentUserName="OwnerUser"
          foremenList={[
            { username: 'DEN', name: 'Den', role: 'Foreman' },
            { username: 'Auen', name: 'Auen', role: 'Foreman' },
          ]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /เปลี่ยน \/ ระบุโฟร์แมน/i }));
      fireEvent.change(screen.getByDisplayValue('Auen'), { target: { value: 'DEN' } });
      fireEvent.click(screen.getByRole('button', { name: /บันทึกผู้รับผิดชอบ/i }));

      await waitFor(() => {
        expect(supabaseSpies.updateIn).toHaveBeenCalledWith('id', ['def-complete']);
        expect(supabaseSpies.updateIn).toHaveBeenCalledWith('id', ['def-incomplete']);
      });

      const updatePayloads = supabaseSpies.update.mock.calls.map((c: any[]) => c[0]);
      expect(updatePayloads).toContainEqual({ foreman_name: 'Auen' });
      expect(updatePayloads).toContainEqual({ foreman_name: 'DEN' });
      expect(updatePayloads).toContainEqual(
        expect.objectContaining({ handover_foreman_name: 'DEN' })
      );

      const calledTables = (supabase.from as any).mock.calls.map((c: any[]) => c[0]);
      expect(calledTables).not.toContain('foreman_daily_duty_snapshots');
    });
  });
});
