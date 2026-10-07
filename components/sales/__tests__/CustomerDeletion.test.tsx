import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteCustomerWithCascade } from '@/lib/customerDeletionHelper';
import { supabase } from '@/lib/supabase';

// Mock Supabase client
vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn()
    }
  };
});

describe('Admin Customer Deletion & Cascading Cleanup Helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs full cascading cleanup and releases linked plot', async () => {
    const mockLead = {
      id: 'lead-test-123',
      customer_name: 'คุณทดสอบ ระบบ',
      interested_plot_id: 'plot-32',
      interested_plot_name: '32',
      project_name: 'ไอลิน สันทราย 2'
    };

    const mockSales = [
      { id: 'sale-1', plot_id: 'plot-32' }
    ];

    const mockContracts = [
      { id: 'contract-1', plot_id: 'plot-32' }
    ];

    const fromMock = supabase.from as any;

    fromMock.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockLead, error: null })
            })
          }),
          delete: () => ({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'sales') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({ data: mockSales, error: null })
          }),
          delete: () => ({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'rental_contracts') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({ data: mockContracts, error: null })
          }),
          delete: () => ({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'rental_payments') {
        return {
          delete: () => ({
            or: () => ({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'p1' }, { id: 'p2' }], error: null })
            }),
            eq: () => ({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null })
            })
          })
        };
      }
      if (table === 'plots') {
        return {
          update: () => ({
            or: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      return {
        delete: () => ({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      };
    });

    const result = await deleteCustomerWithCascade('lead-test-123', 'plot-32');

    expect(result.success).toBe(true);
    expect(result.leadId).toBe('lead-test-123');
    expect(result.customerName).toBe('คุณทดสอบ ระบบ');
    expect(result.releasedPlotIds).toContain('plot-32');
    expect(result.deletedContractsCount).toBe(1);
    expect(result.deletedPaymentsCount).toBe(2);
  });

  it('handles error gracefully when lead deletion fails in database', async () => {
    const fromMock = supabase.from as any;

    fromMock.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'lead-fail', customer_name: 'Fail User' }, error: null })
            })
          }),
          delete: () => ({
            eq: vi.fn().mockResolvedValue({ error: new Error('Database foreign key violation') })
          })
        };
      }
      if (table === 'rental_payments') {
        return {
          delete: () => ({
            or: () => ({
              select: vi.fn().mockResolvedValue({ data: [], error: null })
            }),
            eq: () => ({
              select: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        }),
        delete: () => ({
          eq: vi.fn().mockResolvedValue({ error: null })
        }),
        update: () => ({
          or: vi.fn().mockResolvedValue({ error: null })
        })
      };
    });

    const result = await deleteCustomerWithCascade('lead-fail');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database foreign key violation');
  });
});
