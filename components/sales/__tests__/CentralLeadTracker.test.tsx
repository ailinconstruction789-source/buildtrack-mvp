import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CentralLeadTracker from '../CentralLeadTracker';

const USER = '00000000-0000-4000-8000-000000000001';

const mockCustomers = [
  {
    id: 'c-active-1',
    name: 'คุณสมชาย กำลังติดตาม',
    phone: '0811111111',
    channel: 'โทร',
    notes: 'สนใจบ้านเดี่ยว',
    ownerUserId: USER,
    leadCreatedAt: '2026-10-01T10:00:00Z',
    intakeStatus: 'new',
    interests: [{ id: 'int-1', projectName: 'โครงการ A', ownerUserId: USER, engagementStatus: 'new', plotId: 'A01' }]
  },
  {
    id: 'c-booked-2',
    name: 'คุณวิชัย จองแล้ว',
    phone: '0822222222',
    channel: 'Walk in',
    notes: '[01 ต.ค. 2026 🏷️ บันทึกการจอง โดย Sales A]\n• โครงการ: โครงการ A (แปลง A02)',
    ownerUserId: USER,
    leadCreatedAt: '2026-10-01T11:00:00Z',
    intakeStatus: 'booked',
    interests: [{ id: 'int-2', projectName: 'โครงการ A', ownerUserId: USER, engagementStatus: 'booked', plotId: 'A02' }]
  },
  {
    id: 'c-lost-3',
    name: 'คุณสมหญิง ไม่สนใจ',
    phone: '0833333333',
    channel: 'Facebook',
    notes: '• เหตุผล: 🏷️ งบประมาณไม่พอ',
    ownerUserId: USER,
    leadCreatedAt: '2026-10-01T12:00:00Z',
    intakeStatus: 'unqualified',
    interests: [{ id: 'int-3', projectName: 'โครงการ A', ownerUserId: USER, engagementStatus: 'lost', plotId: null }]
  }
];

const mockSnapshot: any = {
  actor: { userId: USER, role: 'sales' },
  projects: [{ name: 'โครงการ A' }],
  salesOwners: [{ userId: USER, displayName: 'Sales A' }],
  page: 0,
  hasMore: false,
  customers: mockCustomers,
  search: {
    contractVersion: 'central_search_v1',
    filters: { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false },
    projects: ['โครงการ A'],
    owners: [{ userId: USER, displayName: 'Sales A' }],
    channels: ['โทร', 'Walk in', 'Facebook'],
    hasMoreChannels: false
  }
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: {}, error: null })
      }),
      insert: vi.fn().mockResolvedValue({ data: {}, error: null })
    }))
  }
}));

describe('CentralLeadTracker Smart Views (Active / Booked / Lost / All)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Active leads by default and hides Booked and Lost leads from main view', () => {
    render(
      <CentralLeadTracker
        snapshot={mockSnapshot}
        filters={mockSnapshot.search.filters}
        onFilterChange={vi.fn()}
        onApply={vi.fn()}
        leadWorkEnabled={true}
        bookingEnabled={true}
        visitsEnabled={true}
      />
    );

    // Active lead should be shown
    expect(screen.getByText('คุณสมชาย กำลังติดตาม')).toBeInTheDocument();

    // Booked and Lost should NOT be in the table by default
    expect(screen.queryByText('คุณวิชัย จองแล้ว')).not.toBeInTheDocument();
    expect(screen.queryByText('คุณสมหญิง ไม่สนใจ')).not.toBeInTheDocument();

    // Stage pills count (only Active has count number, others have clean labels)
    expect(screen.getByText(/🟢 กำลังติดตาม \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/🏷️ จองแล้ว$/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่สนใจ \/ พักติดตาม$/)).toBeInTheDocument();
    expect(screen.getByText(/📁 ทั้งหมด$/)).toBeInTheDocument();
  });

  it('switches to Booked view and shows only booked customers', () => {
    render(
      <CentralLeadTracker
        snapshot={mockSnapshot}
        filters={mockSnapshot.search.filters}
        onFilterChange={vi.fn()}
        onApply={vi.fn()}
        leadWorkEnabled={true}
        bookingEnabled={true}
        visitsEnabled={true}
      />
    );

    // Click "🏷️ จองแล้ว"
    fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));

    expect(screen.getByText('คุณวิชัย จองแล้ว')).toBeInTheDocument();
    expect(screen.queryByText('คุณสมชาย กำลังติดตาม')).not.toBeInTheDocument();
    expect(screen.queryByText('คุณสมหญิง ไม่สนใจ')).not.toBeInTheDocument();
  });

  it('switches to Lost view and allows Re-activating customer back to Active', async () => {
    const onApplyMock = vi.fn();

    render(
      <CentralLeadTracker
        snapshot={mockSnapshot}
        filters={mockSnapshot.search.filters}
        onFilterChange={vi.fn()}
        onApply={onApplyMock}
        leadWorkEnabled={true}
        bookingEnabled={true}
        visitsEnabled={true}
      />
    );

    // Click "💤 ไม่สนใจ / พักติดตาม"
    fireEvent.click(screen.getByText(/ไม่สนใจ \/ พักติดตาม/));

    expect(screen.getByText('คุณสมหญิง ไม่สนใจ')).toBeInTheDocument();

    // Open detail drawer
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมหญิง ไม่สนใจ' }));

    // Re-activate button should be visible in drawer
    const reactivateBtn = screen.getByRole('button', { name: /ดึงกลับมาติดตามต่อ/ });
    expect(reactivateBtn).toBeInTheDocument();

    fireEvent.click(reactivateBtn);

    await waitFor(() => {
      expect(screen.getByText(/ดึง "คุณสมหญิง ไม่สนใจ" กลับมาอยู่ในรายการ 🟢 กำลังติดตาม/)).toBeInTheDocument();
      expect(onApplyMock).toHaveBeenCalled();
    });
  });
});
