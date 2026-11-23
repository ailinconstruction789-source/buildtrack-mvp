import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QCCapacityThresholdModal from '../QCCapacityThresholdModal';
import * as capacityService from '@/lib/qc/qcCapacitySettingService';

vi.mock('@/lib/qc/qcCapacitySettingService', async () => {
  const actual = await vi.importActual<typeof capacityService>('@/lib/qc/qcCapacitySettingService');
  return {
    ...actual,
    getQCCapacityThreshold: vi.fn().mockResolvedValue(12),
    saveQCCapacityThreshold: vi.fn().mockResolvedValue({ success: true, threshold: 14 }),
  };
});

describe('QCCapacityThresholdModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockUpdates = [
    {
      created_at: '2026-11-16T10:00:00Z', // Monday
      role: 'QC',
      action: 'QC อนุมัติผ่าน',
      user_name: 'qc_john',
      task_template_id: 't_1',
    },
    {
      created_at: '2026-11-16T14:00:00Z', // Monday
      role: 'QC',
      action: 'QC อนุมัติผ่าน',
      user_name: 'qc_john',
      task_template_id: 't_1',
    },
    {
      created_at: '2026-11-17T11:00:00Z', // Tuesday
      role: 'QC',
      action: 'QC อนุมัติผ่าน',
      user_name: 'qc_john',
      task_template_id: 't_2',
    },
  ];

  it('1. Does not render when isOpen is false', () => {
    const { container } = render(
      <QCCapacityThresholdModal
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('2. Renders title, 6 weekday cards (จันทร์–เสาร์), and analytics summary', async () => {
    render(
      <QCCapacityThresholdModal
        isOpen={true}
        onClose={vi.fn()}
        currentUserRole="Admin"
        currentUsername="admin_user"
        allUpdatesRecord={mockUpdates}
      />
    );

    expect(screen.getByText('ตั้งค่าภาระงานตรวจสูงสุดต่อวัน')).toBeDefined();
    expect(screen.getByText('Admin Only')).toBeDefined();

    // Check Weekday cards (Mon - Sat)
    expect(screen.getByText('จ.')).toBeDefined();
    expect(screen.getByText('อ.')).toBeDefined();
    expect(screen.getByText('พ.')).toBeDefined();
    expect(screen.getByText('พฤ.')).toBeDefined();
    expect(screen.getByText('ศ.')).toBeDefined();
    expect(screen.getByText('ส.')).toBeDefined();

    // System Recommendation banner
    expect(screen.getByText(/คำแนะนำระบบจากการวิเคราะห์สถิติ/)).toBeDefined();
  });

  it('3. Allows admin to choose preset threshold and save', async () => {
    const onThresholdUpdated = vi.fn();
    const onClose = vi.fn();

    render(
      <QCCapacityThresholdModal
        isOpen={true}
        onClose={onClose}
        currentUserRole="Admin"
        currentUsername="admin_user"
        allUpdatesRecord={mockUpdates}
        onThresholdUpdated={onThresholdUpdated}
      />
    );

    // Click 14 แต้ม preset
    const preset14Btn = screen.getByRole('button', { name: '14 แต้ม' });
    fireEvent.click(preset14Btn);

    // Save button should now be enabled for 14
    const saveBtn = screen.getByRole('button', { name: /บันทึกเกณฑ์ 14 แต้ม/ });
    expect(saveBtn).toBeDefined();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(capacityService.saveQCCapacityThreshold).toHaveBeenCalledWith(
        expect.objectContaining({
          threshold: 14,
          actorUsername: 'admin_user',
          actorRole: 'Admin',
        })
      );
      expect(onThresholdUpdated).toHaveBeenCalledWith(14);
    });
  });

  it('4. Displays view-only notice when user is not Admin', () => {
    render(
      <QCCapacityThresholdModal
        isOpen={true}
        onClose={vi.fn()}
        currentUserRole="QC"
        currentUsername="qc_inspector"
        allUpdatesRecord={mockUpdates}
      />
    );

    expect(screen.getByText(/โหมดแสดงผลอย่างเดียว/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /บันทึกเกณฑ์/ })).toBeNull();
  });
});
