import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
  loadAvailablePlots: vi.fn()
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from
  }
}));

vi.mock('@/lib/sales/plotAvailabilityClient', () => ({
  loadAvailablePlots: mocks.loadAvailablePlots
}));

import CentralVisitAppointmentModal from '../CentralVisitAppointmentModal';

describe('CentralVisitAppointmentModal', () => {
  const customer = {
    id: 'customer-001',
    leadId: 'customer-001',
    name: 'คุณสมชาย ทดสอบ',
    phone: '0812345678',
    channel: 'Facebook',
    ownerUserId: 'user-001'
  };

  const projects = ['โครงการ พฤกษา', 'โครงการ โยวัว', 'โครงการ โบตั๋น'];
  const salesOwners = [
    { userId: 'user-001', displayName: 'Sales BELL' },
    { userId: 'user-002', displayName: 'Sales PIEW' }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAvailablePlots.mockResolvedValue([
      { id: 'plot-1', plot_name: 'A-01', project_name: 'โครงการ พฤกษา', has_customer: false, sale_status: 'available' },
      { id: 'plot-2', plot_name: 'A-02', project_name: 'โครงการ พฤกษา', has_customer: false, sale_status: 'available' }
    ]);
    mocks.update.mockResolvedValue({ data: { id: customer.id }, error: null });
    mocks.from.mockImplementation((table: string) => {
      const query = { select: () => query, eq: () => query, is: () => query,
        update: (payload: unknown) => { mocks.update(payload); return { eq: () => query, is: () => query, select: () => ({ single: () => mocks.update() }) }; },
        single: async () => ({ data: { ...customer, status: 'Follow Up' }, error: null }),
        limit: async () => ({ data: [], error: null }),
        insert: mocks.insert,
      };
      return query;
    });
  });

  it('renders modal with customer information pre-filled', async () => {
    render(
      <CentralVisitAppointmentModal
        isOpen={true}
        onClose={vi.fn()}
        customer={customer}
        projects={projects}
        salesOwners={salesOwners}
      />
    );

    expect(screen.getByText('คุณสมชาย ทดสอบ')).toBeInTheDocument();
    expect(screen.getByText('0812345678')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกนัดหมายเข้าชม' })).toBeInTheDocument();
  });

  it('loads and displays available plots when project is selected', async () => {
    render(
      <CentralVisitAppointmentModal
        isOpen={true}
        onClose={vi.fn()}
        customer={customer}
        initialInterest={{ projectName: 'โครงการ พฤกษา', plotId: 'plot-1', ownerUserId: 'user-001' }}
        projects={projects}
        salesOwners={salesOwners}
      />
    );

    await waitFor(() => expect(mocks.loadAvailablePlots).toHaveBeenCalledWith('โครงการ พฤกษา'));
    await screen.findByText('A-01 (แปลงว่าง)');
  });

  it('submits appointment to supabase leads table and triggers onSaved callback', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <CentralVisitAppointmentModal
        isOpen={true}
        onClose={onClose}
        customer={customer}
        initialInterest={{ projectName: 'โครงการ โยวัว', plotId: null, ownerUserId: 'user-001' }}
        projects={projects}
        salesOwners={salesOwners}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัดหมายเข้าชม' }));

    await waitFor(() => {
      expect(mocks.from).toHaveBeenCalledWith('leads');
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'Visit',
        auto_status: 'นัดชมโครงการ'
      }));
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('บันทึกนัดหมายเข้าชมโครงการ โครงการ โยวัว'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('defaults the sales caretaker to the logged-in user when provided', async () => {
    const loggedInUser = {
      id: 'current-uid',
      username: 'TEAW',
      displayName: 'TEAW Executive',
      role: 'executive_sales'
    };

    render(
      <CentralVisitAppointmentModal
        isOpen={true}
        onClose={vi.fn()}
        customer={customer}
        projects={projects}
        salesOwners={salesOwners}
        currentUser={loggedInUser}
      />
    );

    const select = screen.getByLabelText('Sales ผู้ดูแลพาชม') as HTMLSelectElement;
    expect(select.value).toBe('TEAW Executive');
  });
});
