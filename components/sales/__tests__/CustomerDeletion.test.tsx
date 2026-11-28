import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteCustomerWithCascade } from '@/lib/customerDeletionHelper';
import { supabase } from '@/lib/supabase';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: any[]) => mocks.from(...args),
    rpc: (...args: any[]) => mocks.rpc(...args),
  },
}));

describe('Phase 3 Hardened Admin Customer Deletion Helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-admin and read-only Owner callers immediately', async () => {
    const ownerRes = await deleteCustomerWithCascade('lead-1', 'plot-1', { actorRole: 'Owner' });
    expect(ownerRes.success).toBe(false);
    expect(ownerRes.errorCode).toBe('FORBIDDEN');
    expect(mocks.from).not.toHaveBeenCalled();

    const missingRoleRes = await deleteCustomerWithCascade('lead-1', 'plot-1');
    expect(missingRoleRes.success).toBe(false);
    expect(missingRoleRes.errorCode).toBe('FORBIDDEN');
  });

  it('blocks deletion when customer still has PendingContract or Active rental (never bypasses rental workflow)', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'lead-pending-1',
                  customer_name: 'ลูกค้าจองเช่า',
                  interested_plot_id: 'ไอลิน6-10',
                  project_name: 'ไอลิน6',
                  status: 'Reserved',
                  deal_type: 'rent',
                  rental_status: 'PendingContract',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'sales') {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      if (table === 'rental_contracts') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'rc-1', plot_id: 'ไอลิน6-10', status: 'PendingContract' }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table access: ${table}`);
    });

    const result = await deleteCustomerWithCascade('lead-pending-1', 'ไอลิน6-10', { actorRole: 'admin' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('ACTIVE_RENTAL_BLOCKED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('blocks deletion when customer still has an active non-cancelled purchase sale', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'lead-buy-1',
                  customer_name: 'ลูกค้าจองซื้อ',
                  interested_plot_id: 'ไอลิน6-11',
                  project_name: 'ไอลิน6',
                  status: 'Reserved',
                  deal_type: 'buy',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'sales') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'sale-1', plot_id: 'ไอลิน6-11', contract_status: 'Reserved', crm_stage: 'booked' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'rental_contracts') {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      throw new Error(`Unexpected table access: ${table}`);
    });

    const result = await deleteCustomerWithCascade('lead-buy-1', 'ไอลิน6-11', { actorRole: 'admin' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('ACTIVE_SALE_BLOCKED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('never touches a plot currently held by another buyer/tenant, and still deletes the ended lead cleanly', async () => {
    const plotUpdateSpy = vi.fn();

    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'id') {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'lead-old-1',
                      customer_name: 'ลูกค้าเดิมที่ยกเลิกแล้ว',
                      interested_plot_id: 'ไอลิน6-12',
                      project_name: 'ไอลิน6',
                      status: 'Cancelled',
                      deal_type: 'rent',
                      rental_status: 'Cancelled',
                    },
                    error: null,
                  }),
                };
              }
              return {
                neq: vi.fn().mockResolvedValue({ data: [], error: null }),
              };
            },
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'sales') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'lead_id') return Promise.resolve({ data: [], error: null });
              // Another buyer currently holds this plot!
              return Promise.resolve({
                data: [{ id: 'sale-other', lead_id: 'lead-other-buyer', contract_status: 'Reserved', crm_stage: 'booked' }],
                error: null,
              });
            },
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'rental_contracts') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'lead_id') {
                return Promise.resolve({
                  data: [{ id: 'rc-old', plot_id: 'ไอลิน6-12', status: 'Cancelled' }],
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'plots') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'ไอลิน6-12',
                    project_name: 'ไอลิน6',
                    plot_name: '12',
                    has_customer: true,
                    sale_status: 'Reserved',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: plotUpdateSpy,
        };
      }
      if (table === 'rental_payments') {
        return {
          delete: () => ({
            or: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            eq: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          }),
        };
      }
      return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    });

    const result = await deleteCustomerWithCascade('lead-old-1', 'ไอลิน6-12', { actorRole: 'admin' });

    expect(result.success).toBe(true);
    expect(result.releasedPlotIds).toEqual([]);
    expect(result.skippedPlotIds).toContain('ไอลิน6-12');
    expect(plotUpdateSpy).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('aborts deletion immediately if guard-approved legacy plot release fails (never continues deleting silently)', async () => {
    const deleteLeadSpy = vi.fn();

    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'id') {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'lead-ended-2',
                      customer_name: 'ลูกค้าย้ายออกแล้ว',
                      interested_plot_id: 'ไอลิน6-20',
                      project_name: 'ไอลิน6',
                      status: 'MovedOut',
                      deal_type: 'rent',
                      rental_status: 'MovedOut',
                    },
                    error: null,
                  }),
                };
              }
              return { neq: vi.fn().mockResolvedValue({ data: [], error: null }) };
            },
          }),
          delete: deleteLeadSpy,
        };
      }
      if (table === 'sales') {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      if (table === 'rental_contracts') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'rc-ended', plot_id: 'ไอลิน6-20', status: 'MovedOut' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'plots') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'ไอลิน6-20',
                    project_name: 'ไอลิน6',
                    plot_name: '20',
                    has_customer: true,
                    sale_status: 'Rented',
                    current_tenant_name: 'ลูกค้าย้ายออกแล้ว',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Should not delete table ${table} when legacy plot release fails`);
    });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SALES_TX_PLOT_HELD_BY_OTHER' },
    });

    const result = await deleteCustomerWithCascade('lead-ended-2', 'ไอลิน6-20', { actorRole: 'admin' });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SALES_TX_PLOT_HELD_BY_OTHER');
    expect(deleteLeadSpy).not.toHaveBeenCalled();
  });

  it('releases orphaned legacy plot via sales_tx_release_legacy_plot (zero direct plots.update) and deletes ended lead cleanly', async () => {
    const plotUpdateSpy = vi.fn();

    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'id') {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'lead-test-123',
                      customer_name: 'คุณทดสอบ ระบบ',
                      interested_plot_id: 'plot-32',
                      interested_plot_name: '32',
                      project_name: 'ไอลิน สันทราย 2',
                      status: 'MovedOut',
                      deal_type: 'rent',
                      rental_status: 'MovedOut',
                    },
                    error: null,
                  }),
                };
              }
              return { neq: vi.fn().mockResolvedValue({ data: [], error: null }) };
            },
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'sales') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'sale-1', plot_id: 'plot-32', contract_status: 'Cancelled', crm_stage: 'cancelled' }],
              error: null,
            }),
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'rental_contracts') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'contract-1', plot_id: 'plot-32', status: 'MovedOut' }],
              error: null,
            }),
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'plots') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'plot-32',
                    project_name: 'ไอลิน สันทราย 2',
                    plot_name: '32',
                    has_customer: true,
                    sale_status: 'Rented',
                    current_tenant_name: 'คุณทดสอบ ระบบ',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: plotUpdateSpy,
        };
      }
      if (table === 'rental_payments') {
        return {
          delete: () => ({
            or: () => ({ select: vi.fn().mockResolvedValue({ data: [{ id: 'p1' }, { id: 'p2' }], error: null }) }),
            eq: () => ({ select: vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null }) }),
          }),
        };
      }
      return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    });

    mocks.rpc.mockResolvedValueOnce({
      data: {
        command: 'legacy_plot_release',
        plotId: 'plot-32',
        projectName: 'ไอลิน สันทราย 2',
        previousHasCustomer: true,
        plotReleased: true,
        alreadyVacant: false,
      },
      error: null,
    });

    const result = await deleteCustomerWithCascade('lead-test-123', 'plot-32', { actorRole: 'admin' });

    expect(result.success).toBe(true);
    expect(result.releasedPlotIds).toEqual(['plot-32']);
    expect(result.deletedContractsCount).toBe(1);
    expect(result.deletedPaymentsCount).toBe(2);
    expect(plotUpdateSpy).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'sales_tx_release_legacy_plot',
      expect.objectContaining({
        p_payload: expect.objectContaining({
          projectName: 'ไอลิน สันทราย 2',
          plotId: 'plot-32',
          expectedHasCustomer: true,
          expectedSaleStatus: 'Rented',
        }),
      })
    );
  });

  it('blocks cascade deletion of a legacy purchase Reserved lead even when NO sales row exists', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'lead-legacy-buy-only',
                  customer_name: 'ผู้จองซื้อไม่มี sales row',
                  interested_plot_id: 'ไอลิน6-15',
                  project_name: 'ไอลิน6',
                  status: 'Reserved',
                  deal_type: 'buy',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'sales') {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      if (table === 'rental_contracts') {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      throw new Error(`Unexpected table access: ${table}`);
    });

    const result = await deleteCustomerWithCascade('lead-legacy-buy-only', 'ไอลิน6-15', { actorRole: 'admin' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('ACTIVE_SALE_BLOCKED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('never calls legacy plot release when another buyer holds a legacy purchase Reserved lead (without sales row) on the same plot', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === 'id') {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'lead-old-rent-ended',
                      customer_name: 'ผู้เช่าเก่า',
                      interested_plot_id: 'ไอลิน6-18',
                      project_name: 'ไอลิน6',
                      status: 'MovedOut',
                      deal_type: 'rent',
                      rental_status: 'MovedOut',
                    },
                    error: null,
                  }),
                };
              }
              if (col === 'interested_plot_id' && val === 'ไอลิน6-18') {
                return {
                  neq: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'lead-new-buyer-no-sale',
                        project_name: 'ไอลิน6',
                        interested_plot_id: 'ไอลิน6-18',
                        status: 'Reserved',
                        deal_type: 'buy',
                      },
                    ],
                    error: null,
                  }),
                };
              }
              return { neq: vi.fn().mockResolvedValue({ data: [], error: null }) };
            },
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'sales') {
        return {
          select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'rental_contracts') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'lead_id') {
                return Promise.resolve({
                  data: [{ id: 'rc-old-18', plot_id: 'ไอลิน6-18', status: 'MovedOut' }],
                  error: null,
                });
              }
              return Promise.resolve({
                data: [{ id: 'rc-old-18', lead_id: 'lead-old-rent-ended', plot_id: 'ไอลิน6-18', status: 'MovedOut' }],
                error: null,
              });
            },
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'plots') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'ไอลิน6-18',
                    project_name: 'ไอลิน6',
                    plot_name: '18',
                    has_customer: true,
                    sale_status: 'Rented',
                    current_tenant_name: 'ผู้เช่าเก่า',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'rental_payments') {
        return {
          delete: () => ({
            or: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            eq: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          }),
        };
      }
      return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    });

    const result = await deleteCustomerWithCascade('lead-old-rent-ended', 'ไอลิน6-18', { actorRole: 'admin' });
    expect(result.success).toBe(true);
    expect(result.releasedPlotIds).toEqual([]);
    expect(result.skippedPlotIds).toContain('ไอลิน6-18');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
