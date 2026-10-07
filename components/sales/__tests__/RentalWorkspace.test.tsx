import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RentalManagementWorkspace from '../RentalManagementWorkspace';

const mockContracts = [
  {
    id: 'contract-1',
    lead_id: 'lead-1',
    project_name: 'ไอลิน สันทราย 2',
    plot_id: 'plot-1',
    plot_name: 'A01',
    tenant_name: 'สมชาย ใจดี',
    tenant_phone: '0812345678',
    agent_name: 'แพรวา',
    program_type: 'program_b',
    monthly_rent: 18000,
    security_deposit: 36000,
    advance_rent: 18000,
    savings_per_month: 5000,
    accumulated_savings: 15000,
    base_price: 2990000,
    lease_duration_months: 12,
    lease_start_date: '2026-01-01',
    lease_end_date: '2026-12-31',
    status: 'Active',
    created_at: '2026-01-01T00:00:00Z'
  },
  {
    id: 'contract-2',
    lead_id: 'lead-2',
    project_name: 'ไอลิน สันทราย 2',
    plot_id: 'plot-2',
    plot_name: 'B02',
    tenant_name: 'วิภาดา รักษ์ดี',
    tenant_phone: '0898765432',
    agent_name: 'กอล์ฟ',
    program_type: 'program_a',
    monthly_rent: 12000,
    security_deposit: 24000,
    advance_rent: 12000,
    savings_per_month: 0,
    accumulated_savings: 0,
    lease_duration_months: 12,
    lease_start_date: '2026-02-01',
    lease_end_date: '2026-10-15',
    status: 'Active',
    created_at: '2026-02-01T00:00:00Z'
  }
];

// Mock Supabase
vi.mock('@/lib/supabase', () => {
  const createQueryBuilder = (resultData: any) => {
    const builder: any = {
      data: resultData,
      error: null,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: resultData, error: null })
    };
    return builder;
  };

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'rental_contracts') {
          return createQueryBuilder(mockContracts);
        }
        if (table === 'rental_payments') {
          return createQueryBuilder([
            {
              id: 'pay-1',
              contract_id: 'contract-1',
              plot_id: 'plot-1',
              amount_due: 18000,
              payment_status: 'Overdue',
              due_date: '2026-03-01'
            }
          ]);
        }
        return createQueryBuilder([]);
      })
    }
  };
});

describe('RentalManagementWorkspace Component', () => {
  const mockProjects = [{ id: 'p1', name: 'ไอลิน สันทราย 2' }];
  const mockUser = { username: 'admin', role: 'admin' };

  it('renders workspace title, KPI ribbon, and loaded contracts', async () => {
    render(
      <RentalManagementWorkspace
        projects={mockProjects}
        user={mockUser}
        selectedProjectName="all"
      />
    );

    expect(screen.getByText(/Ailin Rental Management/i)).toBeDefined();
    expect(screen.getByText(/ระบบงานเช่า & ผ่อนตรง/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/สมชาย ใจดี/i)).toBeDefined();
      expect(screen.getByText(/วิภาดา รักษ์ดี/i)).toBeDefined();
      expect(screen.getByText(/แปลง A01/i)).toBeDefined();
    });
  });

  it('allows filtering by search text', async () => {
    render(
      <RentalManagementWorkspace
        projects={mockProjects}
        user={mockUser}
        selectedProjectName="all"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/สมชาย ใจดี/i)).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText(/ค้นหาชื่อผู้เช่า/i);
    fireEvent.change(searchInput, { target: { value: 'วิภาดา' } });

    expect(screen.getByText(/วิภาดา รักษ์ดี/i)).toBeDefined();
    expect(screen.queryByText(/สมชาย ใจดี/i)).toBeNull();
  });

  it('switches between Table view and Grid view seamlessly', async () => {
    render(
      <RentalManagementWorkspace
        projects={mockProjects}
        user={mockUser}
        selectedProjectName="all"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/สมชาย ใจดี/i)).toBeDefined();
    });

    const gridBtn = screen.getByTitle(/การ์ด \(Grid View\)/i);
    fireEvent.click(gridBtn);

    expect(screen.getAllByText(/ค่าเช่ารายเดือน/i).length).toBeGreaterThan(0);
  });
});
