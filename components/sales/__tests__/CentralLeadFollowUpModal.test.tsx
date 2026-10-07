import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CentralLeadFollowUpModal from '../CentralLeadFollowUpModal';

const mockInsert = vi.fn().mockResolvedValue({ data: {}, error: null });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: {}, error: null })
});
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'act-1',
            activity_type: 'call',
            result: 'contact_success',
            note: 'โทรคุยเรื่องสินเชื่อแล้ว ลูกค้าสนใจบ้านแปลง A01',
            occurred_at: '2026-10-01T10:00:00Z',
          }
        ],
        error: null
      })
    })
  })
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'lead_activities') {
        return {
          insert: mockInsert,
          select: mockSelect
        };
      }
      if (table === 'leads') {
        return {
          update: mockUpdate
        };
      }
      return {};
    })
  }
}));

describe('CentralLeadFollowUpModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCustomer = {
    id: 'cust-123',
    name: 'คุณสมศักดิ์ มั่งมี',
    phone: '081-234-5678',
    channel: 'Facebook',
    notes: 'เคยสนใจบ้านเดี่ยว',
    status: 'Follow Up',
    salesOwner: 'Sales Bell'
  };

  const mockOwners = [
    { userId: 'user-1', displayName: 'Sales Bell' },
    { userId: 'user-2', displayName: 'Sales Joy' }
  ];

  it('renders modal with customer information pre-filled', () => {
    render(
      <CentralLeadFollowUpModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง', 'โครงการ บางนา']}
        salesOwners={mockOwners}
      />
    );

    expect(screen.getByText('บันทึกการติดตามลูกค้า (Follow-up)')).toBeInTheDocument();
    expect(screen.getByText('คุณสมศักดิ์ มั่งมี')).toBeInTheDocument();
    expect(screen.getByText('081-234-5678')).toBeInTheDocument();
    expect(screen.getByText('โทรศัพท์')).toBeInTheDocument();
    expect(screen.getByText('LINE / แชท')).toBeInTheDocument();
  });

  it('validates required notes before submission', async () => {
    render(
      <CentralLeadFollowUpModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /บันทึกการติดตาม/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('กรุณาระบุรายละเอียดการติดตามหรือสิ่งที่ได้พูดคุยกับลูกค้า')).toBeInTheDocument();
    });
  });

  it('submits follow-up successfully and calls onSaved callback', async () => {
    const handleSaved = vi.fn();
    const handleClose = vi.fn();

    render(
      <CentralLeadFollowUpModal
        isOpen={true}
        onClose={handleClose}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
        onSaved={handleSaved}
      />
    );

    // Switch channel to LINE / แชท
    const chatBtn = screen.getByRole('button', { name: /LINE \/ แชท/i });
    fireEvent.click(chatBtn);

    // Fill notes
    const notesInput = screen.getByPlaceholderText(/พิมพ์ข้อความสรุปการสนทนา/i);
    fireEvent.change(notesInput, {
      target: { value: 'ลูกค้าสอบถามเรื่องโปรโมชั่นลด 1 แสนบาท' }
    });

    const submitBtn = screen.getByRole('button', { name: /บันทึกการติดตาม/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect(handleSaved).toHaveBeenCalledWith(
        expect.stringContaining('คุณสมศักดิ์ มั่งมี')
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('can switch to history tab and display past activities', async () => {
    render(
      <CentralLeadFollowUpModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
        projects={['โครงการ สวนหลวง']}
        salesOwners={mockOwners}
      />
    );

    const historyTab = screen.getByRole('button', { name: /ประวัติ/i });
    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(screen.getByText(/ประวัติการติดตามและการติดต่อที่ผ่านมา/i)).toBeInTheDocument();
      expect(screen.getByText(/โทรคุยเรื่องสินเชื่อแล้ว ลูกค้าสนใจบ้านแปลง A01/i)).toBeInTheDocument();
    });
  });
});
