import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SalesKanban from '../SalesKanban';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          order: () => Promise.resolve({ data: [], error: null })
        }),
        in: () => Promise.resolve({ data: [], error: null }),
        then: (resolve: any) => {
          if (table === 'plots') {
            return resolve({
              data: [
                { id: 'p1', project_name: 'ไอลิน6', has_customer: false, sale_status: 'ready_for_sale' },
                { id: 'p2', project_name: 'ไอลิน6', has_customer: true, sale_status: 'sold' },
                { id: 'p3', project_name: 'ไอลิน 4', has_customer: false, sale_status: 'available' },
                { id: 'p4', project_name: 'ไอลิน 2', has_customer: true, sale_status: 'transferred' },
              ],
              error: null
            });
          }
          if (table === 'sales') {
            return resolve({
              data: [
                { plot_id: 'p2', contract_status: 'Reserved' },
                { plot_id: 'p4', contract_status: 'Transferred' },
              ],
              error: null
            });
          }
          return resolve({ data: [], error: null });
        }
      })
    }),
    rpc: () => Promise.resolve({ data: { rows: [] }, error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } })
    }
  }
}));

describe('SalesKanban Project Filtering', () => {
  const sampleProjects = [
    { name: 'ไอลิน6', description: 'โครงการ 6', is_closed: false },
    { name: 'ไอลิน 4', description: 'โครงการ 4', is_closed: false },
    { name: 'ไอลิน 2', description: 'โครงการ 2 (ขายหมดแล้ว)', is_closed: true },
    { name: 'ลูกค้าทั่วไป', description: 'ไม่ใช่โครงการ', is_closed: true }
  ];

  it('filters out projects without vacant plots and non-project entries by default', async () => {
    render(<SalesKanban projects={sampleProjects} />);

    // Initially loads availability
    await waitFor(() => {
      expect(screen.getByText('ไอลิน6')).toBeInTheDocument();
      expect(screen.getByText('ไอลิน 4')).toBeInTheDocument();
    });

    // "ลูกค้าทั่วไป" should NEVER be displayed as a project card
    expect(screen.queryByText('ลูกค้าทั่วไป')).not.toBeInTheDocument();

    // "ไอลิน 2" has 0 vacant plots and is closed, so it should NOT be in the available view
    expect(screen.queryByText('โครงการ 2 (ขายหมดแล้ว)')).not.toBeInTheDocument();

    // Badges should show vacant plot count
    expect(screen.getAllByText('ว่าง 1 หลัง').length).toBe(2);
  });

  it('allows switching to view all projects including closed ones via toggle button', async () => {
    render(<SalesKanban projects={sampleProjects} />);

    await waitFor(() => {
      expect(screen.getByText('ไอลิน6')).toBeInTheDocument();
    });

    // Click "ทั้งหมด"
    const allButton = screen.getByRole('button', { name: /ทั้งหมด/i });
    fireEvent.click(allButton);

    // Now "ไอลิน 2" is visible
    expect(screen.getByText('โครงการ 2 (ขายหมดแล้ว)')).toBeInTheDocument();
    // "ลูกค้าทั่วไป" is still filtered out
    expect(screen.queryByText('ลูกค้าทั่วไป')).not.toBeInTheDocument();
  });
});
