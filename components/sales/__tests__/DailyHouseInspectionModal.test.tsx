import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import DailyHouseInspectionModal from '../DailyHouseInspectionModal';

// Mock Supabase
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockSelect = vi.fn().mockReturnValue({
  is: () => ({
    eq: () => ({
      order: () => ({
        limit: () => Promise.resolve({
          data: [
            {
              id: 'log-1',
              customer_name: 'ตรวจเช็คประจำวัน (รอบเช้า - เปิดบ้าน)',
              project_name: 'ไอลิน6',
              agent_name: 'Bell',
              stage: 'daily_routine_morning',
              lead_crm_status: 'Normal',
              created_at: new Date().toISOString()
            }
          ],
          error: null
        })
      })
    })
  })
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: mockInsert,
      select: mockSelect
    })
  }
}));

describe('DailyHouseInspectionModal', () => {
  it('renders morning checklist by default and allows checking items', () => {
    render(
      <DailyHouseInspectionModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="ไอลิน6"
        user={{ username: 'Bell' }}
      />
    );

    expect(screen.getByText(/SOP ตรวจบ้านประจำวัน/i)).toBeInTheDocument();
    expect(screen.getByText(/รอบเช้า \(เปิดบ้าน\)/i)).toBeInTheDocument();
    expect(screen.getByText(/ถวายน้ำพระ/i)).toBeInTheDocument();
  });

  it('allows switching to evening mode and selecting all items', () => {
    render(
      <DailyHouseInspectionModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="ไอลิน6"
        user={{ username: 'Bell' }}
      />
    );

    // Switch to evening
    const eveningBtn = screen.getByText(/รอบเย็น \(ปิดบ้าน\)/i);
    fireEvent.click(eveningBtn);

    expect(screen.getByText(/ปิดแอร์ทุกเครื่อง/i)).toBeInTheDocument();
    expect(screen.getByText(/ประตูดิจิทัล/i)).toBeInTheDocument();

    // Click "ติ๊กทั้งหมด"
    const selectAllBtn = screen.getByRole('button', { name: /ติ๊กทั้งหมด/i });
    fireEvent.click(selectAllBtn);

    expect(screen.getByText(/รายการตรวจสอบ \(7\/7\)/i)).toBeInTheDocument();
  });

  it('allows viewing inspection history logs', async () => {
    render(
      <DailyHouseInspectionModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="ไอลิน6"
        user={{ username: 'Bell' }}
      />
    );

    const historyBtn = screen.getByRole('button', { name: /ประวัติย้อนหลัง/i });
    fireEvent.click(historyBtn);

    await waitFor(() => {
      expect(screen.getByText(/ตรวจเช็คประจำวัน \(รอบเช้า - เปิดบ้าน\)/i)).toBeInTheDocument();
    });
  });
});
