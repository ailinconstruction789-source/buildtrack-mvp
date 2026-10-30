import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CentralLeadTracker from '../CentralLeadTracker';
import RentalActionModal from '../RentalActionModal';
import RentalContractModal from '../RentalContractModal';
import SalesDealStatusModal from '../SalesDealStatusModal';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/sales/leadActivity', () => ({
  readLeadActivitySnapshot: async (customer: unknown) => ({ lead: customer, historyExists: false }),
  writeLeadActivitySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../LeadPicker', () => ({
  default: () => <div data-testid="lead-picker-stub" />
}));

const CHAIN_METHODS = new Set(['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'or', 'not', 'ilike', 'order', 'limit', 'range']);
const proxyCache = new WeakMap<object, any>();

function ensureChainable(val: any): any {
  if (!val || (typeof val !== 'object' && typeof val !== 'function')) return val;
  if (proxyCache.has(val)) return proxyCache.get(val);

  if (typeof val.then === 'function' && (val instanceof Promise || !('select' in val || 'eq' in val || 'single' in val || 'maybeSingle' in val))) {
    for (const m of CHAIN_METHODS) {
      if (typeof val[m] !== 'function') val[m] = () => ensureChainable(val);
    }
    for (const m of ['single', 'maybeSingle'] as const) {
      if (typeof val[m] !== 'function') {
        val[m] = () => ensureChainable(val.then((r: any) => (r && Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r)));
      }
    }
    proxyCache.set(val, val);
    return val;
  }

  const proxy: any = new Proxy(val, {
    get(target, prop, receiver) {
      if (prop in target) {
        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig === 'function') {
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return orig.bind(target);
          return (...args: any[]) => ensureChainable(orig.apply(target, args));
        }
        return orig;
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        if (typeof target.maybeSingle === 'function') return (...args: any[]) => ensureChainable(target.maybeSingle(...args));
        if (typeof target.single === 'function') return (...args: any[]) => ensureChainable(target.single(...args));
        if (typeof target.then === 'function') {
          return () => ensureChainable(Promise.resolve(target).then((r: any) => (r && Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r)));
        }
        return async () => ({ data: null, error: null });
      }
      if (prop === 'then') {
        if (typeof target.maybeSingle === 'function') {
          return (res: any, rej: any) => Promise.resolve(target.maybeSingle()).then((r: any) => (r && r.data && !Array.isArray(r.data) ? { ...r, data: [r.data] } : r)).then(res, rej);
        }
        if (typeof target.single === 'function') {
          return (res: any, rej: any) => Promise.resolve(target.single()).then((r: any) => (r && r.data && !Array.isArray(r.data) ? { ...r, data: [r.data] } : r)).then(res, rej);
        }
        return (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej);
      }
      if (typeof prop === 'string' && CHAIN_METHODS.has(prop)) {
        return () => proxy;
      }
      return undefined;
    },
  });
  proxyCache.set(val, proxy);
  return proxy;
}

describe('Lead and Project Map Parity Bugs Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fromSpy = vi.spyOn(supabase, 'from');
    const rawMockImpl = (fromSpy as any).__rawMockImpl ??= fromSpy.mockImplementation.bind(fromSpy);
    fromSpy.mockImplementation = ((fn: (table: string) => any) =>
      rawMockImpl(((table: string) => ensureChainable(fn(table))) as any)) as any;
  });

  describe('Bug A & B: Rental Cancellation Safety in CentralLeadTracker', () => {
    const mockActor = { userId: 'sales-user-1', role: 'sales' };
    const mockCustomer = {
      id: 'lead-rent-1',
      leadId: 'lead-rent-1',
      name: 'คุณสมศักดิ์ จองเช่า',
      phone: '0812345678',
      status: 'Reserved',
      rental_status: 'PendingContract',
      deal_type: 'rent',
      projectName: 'โครงการ A',
      intakeStatus: 'booked',
      interests: [{ id: 'int-1', projectName: 'โครงการ A', plotId: 'Plot-01' }]
    };

    const mockSnapshot: any = {
      actor: mockActor,
      projects: [{ name: 'โครงการ A' }],
      salesOwners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
      page: 0,
      hasMore: false,
      customers: [mockCustomer],
      search: {
        contractVersion: 'central_search_v1',
        filters: { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false },
        projects: ['โครงการ A'],
        owners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
        channels: ['Walk in'],
        hasMoreChannels: false
      }
    };

    it('Bug A: stops and displays error when rental contract cancellation fails (does not declare success)', async () => {
      const onApplyMock = vi.fn();

      // Mock supabase to return error on rental_contracts update
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-rent-1',
                    customer_name: 'คุณสมศักดิ์ จองเช่า',
                    status: 'Reserved',
                    rental_status: 'PendingContract',
                    deal_type: 'rent',
                    interested_plot_id: 'p-1',
                    project_name: 'โครงการ A',
                    notes: 'จองเช่าเดิม'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        if (table === 'plots') {
          const plotQuery: any = {
            eq: () => plotQuery,
            then: (resolve: any) => resolve({
              data: [{
                id: 'p-1',
                project_name: 'โครงการ A',
                plot_name: 'Plot-01',
                sale_status: 'Reserved',
                has_customer: true,
                customer_name: 'คุณสมศักดิ์ จองเช่า',
                current_tenant_name: null
              }],
              error: null
            })
          };
          return {
            select: () => plotQuery
          } as any;
        }
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'rc-1', status: 'PendingContract', plot_id: 'p-1', project_name: 'โครงการ A', notes: '' }],
                  error: null
                })
              })
            }),
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: async () => ({ data: null, error: { message: 'RLS write denied on contracts' } })
              };
              return uChain;
            }
          } as any;
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        } as any;
      }) as any);

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={onApplyMock}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      // Switch to booked tab to see the customer
      fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));
      expect(screen.getByText('คุณสมศักดิ์ จองเช่า')).toBeInTheDocument();

      // Open drawer
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมศักดิ์ จองเช่า' }));

      // Cancel button should be present
      const cancelBtn = screen.getByRole('button', { name: /ยกเลิกการจองเช่า/ });
      expect(cancelBtn).toBeInTheDocument();
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.getByText(/ยกเลิกสัญญาเช่าไม่สำเร็จ: RLS write denied on contracts/)).toBeInTheDocument();
      });

      // Crucial: Must NOT call onApply or announce success
      expect(onApplyMock).not.toHaveBeenCalled();
      expect(screen.queryByText(/เรียบร้อยแล้ว/)).not.toBeInTheDocument();
    });

    it('Bug B: stops when target plot name has duplicates in project (collision check)', async () => {
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-rent-1',
                    customer_name: 'คุณสมศักดิ์ จองเช่า',
                    status: 'Reserved',
                    rental_status: 'PendingContract',
                    deal_type: 'rent',
                    interested_plot_name: 'DuplicatedPlot',
                    project_name: 'โครงการ A'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'rc-1', status: 'PendingContract', plot_name: 'DuplicatedPlot', project_name: 'โครงการ A' }],
                  error: null
                })
              })
            }),
            update: () => ({
              eq: () => ({
                eq: async () => ({ data: {}, error: null })
              })
            })
          } as any;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  // Return 2 plots with the same name!
                  data: [
                    { id: 'p1', plot_name: 'DuplicatedPlot', project_name: 'โครงการ A' },
                    { id: 'p2', plot_name: 'DuplicatedPlot', project_name: 'โครงการ A' }
                  ],
                  error: null
                })
              })
            })
          } as any;
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        } as any;
      }) as any);

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={vi.fn()}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมศักดิ์ จองเช่า' }));
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการจองเช่า/ }));

      await waitFor(() => {
        expect(screen.getByText(/พบแปลงชื่อ "DuplicatedPlot" ซ้ำกันในโครงการ/)).toBeInTheDocument();
      });
    });

    it('Bug B: guards against cancelling when lead has already become Active/Rented', async () => {
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-rent-1',
                    customer_name: 'คุณสมศักดิ์ จองเช่า',
                    status: 'Rented',
                    rental_status: 'Active',
                    deal_type: 'rent'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        return {} as any;
      }) as any);

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={vi.fn()}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมศักดิ์ จองเช่า' }));
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการจองเช่า/ }));

      await waitFor(() => {
        expect(screen.getByText(/สัญญานี้มีผลบังคับใช้ \(Active\) แล้ว/)).toBeInTheDocument();
      });
    });

    it('Bug A: guards against double clicking rental cancellation', async () => {
      let callCount = 0;
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  callCount++;
                  await new Promise(r => setTimeout(r, 60));
                  return {
                    data: {
                      id: 'lead-rent-1',
                      customer_name: 'คุณสมศักดิ์ จองเช่า',
                      status: 'Reserved',
                      rental_status: 'PendingContract',
                      deal_type: 'rent',
                      interested_plot_id: 'p-1',
                      project_name: 'โครงการ A'
                    },
                    error: null
                  };
                }
              })
            })
          } as any;
        }
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
          update: () => ({ eq: async () => ({ data: {}, error: null }) })
        } as any;
      }) as any);

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={vi.fn()}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมศักดิ์ จองเช่า' }));

      const cancelBtn = screen.getByRole('button', { name: /ยกเลิกการจองเช่า/ });
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(callCount).toBe(1);
      });
    });
  });

  describe('Bug C & G: Booking ownership and 0-row write safety in RentalContractModal', () => {
    it('Bug C: prevents lead with merely interested_plot_id from selecting a plot booked by another customer', async () => {
      const mockPlots = [
        { id: 'p2', plot_name: 'แปลง 2', sale_status: 'Booked', has_customer: true, customer_name: 'ลูกค้าท่านอื่น', price: 2800000, project_name: 'ไอลิน' },
        { id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 2500000, project_name: 'ไอลิน' }
      ];

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'plots') {
          return {
            select: () => ({
              eq: async () => ({ data: mockPlots, error: null })
            })
          } as any;
        }
        return {
          select: async () => ({ data: [], error: null })
        } as any;
      }) as any);

      // Lead is in Visit stage (NOT booked), but interested_plot_id is 'p2'
      const unbookedLead = {
        id: 'lead-visitor',
        customer_name: 'คุณผู้เยี่ยมชม',
        interested_plot_id: 'p2',
        status: 'Visit',
        deal_type: 'rent'
      };

      render(
        <RentalContractModal
          isOpen
          onClose={vi.fn()}
          lead={unbookedLead as any}
          user={{ displayName: 'Sales Person' }}
          salesOwners={[{ userId: 'u1', displayName: 'Sales Person' }]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/-- เลือกแปลงบ้าน/i)).toBeInTheDocument();
      });

      const options = screen.getAllByRole('option');
      const optP2 = options.find(o => o.getAttribute('value') === 'p2');

      // Crucial: Must be disabled because the customer did NOT hold booking for it!
      expect(optP2?.hasAttribute('disabled')).toBe(true);
      expect(optP2?.textContent).toContain('🟡 ติดจอง');
      expect(optP2?.textContent).not.toContain('แปลงของลูกค้ารายนี้');
    });

    it('Bug G: stops and throws error when plot update returns 0 rows', async () => {
      const mockPlots = [
        { id: 'p1', plot_name: 'แปลง 1', sale_status: 'Available', has_customer: false, price: 2500000, project_name: 'ไอลิน สันทราย 2' }
      ];

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: mockPlots[0], error: null }),
                then: (resolve: any) => resolve({ data: mockPlots, error: null })
              }),
              then: (resolve: any) => resolve({ data: mockPlots, error: null })
            }),
            update: () => ({
              eq: async () => ({
                data: null,
                count: 0, // 0 rows updated!
                error: null
              })
            })
          } as any;
        }
        if (table === 'rental_contracts') {
          const rcChain: any = {
            select: () => rcChain,
            eq: () => rcChain,
            in: () => rcChain,
            limit: async () => ({ data: [], error: null }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: 'rc-new' }, error: null })
              })
            })
          };
          return rcChain;
        }
        if (table === 'leads') {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: 'lead-1' }, error: null })
                })
              })
            })
          } as any;
        }
        if (table === 'status_history') {
          return {
            insert: async () => ({ data: {}, error: null })
          } as any;
        }
        const defaultChain: any = {
          select: () => defaultChain,
          update: () => defaultChain,
          eq: () => defaultChain,
          neq: () => defaultChain,
          single: async () => ({ data: {}, error: null }),
          then: (resolve: any) => resolve({ data: [], error: null })
        };
        return defaultChain as any;
      }) as any);

      const onClose = vi.fn();
      render(
        <RentalContractModal
          isOpen
          onClose={onClose}
          defaultMode="contract"
          plotId="p1"
          lead={{ id: 'lead-1', customer_name: 'คุณสมใจ', status: 'Visit', deal_type: 'rent', project_name: 'ไอลิน สันทราย 2', interested_plot_id: 'p1' } as any}
          user={{ id: 'u1', displayName: 'Sales Person' }}
          salesOwners={[{ userId: 'u1', displayName: 'Sales Person' }]}
        />
      );

      // Wait for plots to finish loading and submit button to be enabled
      await waitFor(() => {
        expect(screen.queryByText(/กำลังโหลดแปลง.../i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/i })).toBeEnabled();
      });

      const submitBtn = screen.getByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/i });
      fireEvent.click(submitBtn);

      // Should display error about 0 rows updated
      await waitFor(() => {
        expect(screen.getByText(/0 rows updated/i)).toBeInTheDocument();
      });

      // Must NOT close or announce success
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Bug D: Interrupted Terminal Resumption in RentalActionModal', () => {
    const user = { id: 'user-1', username: 'Sales A', role: 'Sales' };
    const lead = {
      id: 'lead-1',
      customer_name: 'Tenant One',
      status: 'Follow Up',
      rental_status: 'Active', // Interrupted: contract status is MovedOut, but lead status is still Active
      project_name: 'Project',
      interested_plot_id: 'plot-1'
    };

    it('allows resuming an interrupted MovedOut transition on move_out tab without stage error', async () => {
      const movedOutContract = {
        id: 'contract-moved-out',
        lead_id: 'lead-1',
        project_name: 'Project',
        plot_id: 'plot-1',
        plot_name: '1',
        tenant_name: 'Tenant One',
        status: 'MovedOut',
        security_deposit: 20000,
        monthly_rent: 10000
      };

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            neq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: async () => ({ data: [movedOutContract], error: null }),
            then: (resolve: any) => resolve({ data: [], error: null }),
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'contract-moved-out' }, error: null })
              };
              return uChain;
            }
          };
          return chain;
        }
        if (table === 'plots') {
          const pChain: any = {
            eq: () => pChain,
            maybeSingle: async () => ({
              data: {
                id: 'plot-1',
                plot_name: '1',
                project_name: 'Project',
                sale_status: 'Rented',
                has_customer: true,
                current_tenant_name: 'Tenant One'
              },
              error: null
            }),
            single: async () => ({
              data: { id: 'plot-1', plot_name: '1', project_name: 'Project' },
              error: null
            }),
            then: (resolve: any) => resolve({
              data: [{ id: 'plot-1', plot_name: '1', project_name: 'Project' }],
              error: null
            })
          };
          return {
            select: () => pChain,
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'plot-1' }, error: null }),
                then: (resolve: any) => resolve({ data: [{ id: 'plot-1' }], error: null })
              };
              return uChain;
            }
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'lead-1', notes: 'Initial note' }, error: null }),
                maybeSingle: async () => ({ data: { id: 'lead-1', notes: 'Initial note' }, error: null })
              })
            }),
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'lead-1' }, error: null })
              };
              return uChain;
            }
          } as any;
        }
        return {} as any;
      }) as any);

      const onClose = vi.fn();
      render(<RentalActionModal isOpen contractId="contract-moved-out" lead={lead as any} user={user} onClose={onClose} />);

      // Should automatically select move_out tab and allow clicking submit
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /ยืนยันการย้ายออก/ })).toBeEnabled();
      });

      // The renew tab button should be disabled for terminal contracts
      const renewTabBtn = screen.getByRole('button', { name: /2\. ต่อสัญญาเช่า/ });
      expect(renewTabBtn).toBeDisabled();

      // Submit move_out resumption via form submit
      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันการย้ายออก/ }).closest('form')!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('Bug F: SalesDealStatusModal validation and transition choices', () => {
    it('limits dropdown choices strictly to valid transitions from booked stage', async () => {
      // Mock sales and plot fetch
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'sales') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'sale-1',
                    lead_id: 'lead-1',
                    plot_id: 'plot-1',
                    contract_status: 'Reserved',
                    sale_price: 3000000,
                    booking_amount: 50000,
                    payment_method: 'mortgage'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'lead-1',
                    customer_name: 'คุณสมชาย',
                    status: 'Reserved',
                    notes: 'ธนาคาร: สินเชื่อ'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'plot-1', plot_name: 'A-10', project_name: 'Project A', sale_status: 'Reserved' },
                  error: null
                })
              })
            })
          } as any;
        }
        return {} as any;
      }) as any);

      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'คุณสมชาย', status: 'Reserved', plotId: 'plot-1' }}
          currentUser={{ id: 'user-1', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // Wait for modal to load editable controls
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).toBeInTheDocument();
      });

      const select = screen.getByRole('combobox', { name: 'สถานะหลังจอง' }) as HTMLSelectElement;
      const optionValues = Array.from(select.options).map(o => o.value);

      // From 'booked' with mortgage, allowable next stages are booked, contracted, cancelled
      expect(optionValues).toContain('booked');
      expect(optionValues).toContain('contracted');
      expect(optionValues).toContain('cancelled');

      // Handover and transferred must NOT be available directly from booked
      expect(optionValues).not.toContain('handover');
      expect(optionValues).not.toContain('transferred');
    });
  });

  describe('Finding A: Plot Ownership Security during Rental Cancellation', () => {
    const mockActor = { userId: 'sales-user-1', role: 'sales' };
    const mockCustomer = {
      id: 'lead-rent-a',
      leadId: 'lead-rent-a',
      name: 'คุณสมศักดิ์ จองเช่า',
      phone: '0812345678',
      status: 'Reserved',
      rental_status: 'PendingContract',
      deal_type: 'rent',
      projectName: 'โครงการ A',
      intakeStatus: 'booked',
      interests: [{ id: 'int-1', projectName: 'โครงการ A', plotId: 'Plot-Occupied' }]
    };

    const mockSnapshot: any = {
      actor: mockActor,
      projects: [{ name: 'โครงการ A' }],
      salesOwners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
      page: 0,
      hasMore: false,
      customers: [mockCustomer],
      search: {
        contractVersion: 'central_search_v1',
        filters: { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false },
        projects: ['โครงการ A'],
        owners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
        channels: ['Walk in'],
        hasMoreChannels: false
      }
    };

    it('refuses to cancel rental booking or release plot when plot is held by another tenant', async () => {
      const onApplyMock = vi.fn();
      let contractUpdateCalled = false;
      let plotUpdateCalled = false;

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-rent-a',
                    customer_name: 'คุณสมศักดิ์ จองเช่า',
                    status: 'Reserved',
                    rental_status: 'PendingContract',
                    deal_type: 'rent',
                    interested_plot_id: 'Plot-Occupied',
                    project_name: 'โครงการ A'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'rc-1', status: 'PendingContract', plot_id: 'Plot-Occupied', project_name: 'โครงการ A' }],
                  error: null
                })
              })
            }),
            update: () => {
              contractUpdateCalled = true;
              return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'rc-1' }], error: null }) }) }) };
            }
          } as any;
        }
        if (table === 'plots') {
          const plotQuery: any = {
            eq: () => plotQuery,
            then: (resolve: any) => resolve({
              data: [{
                id: 'Plot-Occupied',
                project_name: 'โครงการ A',
                plot_name: 'Plot-Occupied',
                sale_status: 'Rented',
                has_customer: true,
                customer_name: 'คุณผู้อื่น',
                current_tenant_name: 'คุณผู้อื่น'
              }],
              error: null
            })
          };
          return {
            select: () => plotQuery,
            update: () => {
              plotUpdateCalled = true;
              return { eq: () => ({ select: async () => ({ data: [], error: null }) }) };
            }
          } as any;
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        } as any;
      }) as any);

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={onApplyMock}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมศักดิ์ จองเช่า' }));
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการจองเช่า/ }));

      await waitFor(() => {
        expect(screen.getByText(/แปลงนี้มีผู้เช่าอื่น \(คุณผู้อื่น\) ถือสิทธิ์อยู่ ไม่สามารถคืนแปลงได้/)).toBeInTheDocument();
      });

      expect(contractUpdateCalled).toBe(false);
      expect(plotUpdateCalled).toBe(false);
      expect(onApplyMock).not.toHaveBeenCalled();
    });
  });

  describe('Finding B: Partial Failure Detection & Alerting in Rental Cancellation', () => {
    const mockActor = { userId: 'sales-user-1', role: 'sales' };
    const mockCustomer = {
      id: 'lead-partial',
      leadId: 'lead-partial',
      name: 'คุณสมศักดิ์ จองเช่า',
      phone: '0812345678',
      status: 'Reserved',
      rental_status: 'PendingContract',
      deal_type: 'rent',
      projectName: 'โครงการ A',
      intakeStatus: 'booked',
      interests: [{ id: 'int-1', projectName: 'โครงการ A', plotId: 'Plot-01' }]
    };

    const mockSnapshot: any = {
      actor: mockActor,
      projects: [{ name: 'โครงการ A' }],
      salesOwners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
      page: 0,
      hasMore: false,
      customers: [mockCustomer],
      search: {
        contractVersion: 'central_search_v1',
        filters: { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false },
        projects: ['โครงการ A'],
        owners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
        channels: ['Walk in'],
        hasMoreChannels: false
      }
    };

    it('alerts ⚠️ บันทึกบางส่วน when rental contracts cancelled but plot release fails', async () => {
      const onApplyMock = vi.fn();
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-partial',
                    customer_name: 'คุณสมศักดิ์ จองเช่า',
                    status: 'Reserved',
                    rental_status: 'PendingContract',
                    deal_type: 'rent',
                    interested_plot_id: 'Plot-01',
                    project_name: 'โครงการ A'
                  },
                  error: null
                })
              })
            })
          } as any;
        }
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'rc-1', status: 'PendingContract', plot_id: 'Plot-01', project_name: 'โครงการ A' }],
                  error: null
                })
              })
            }),
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: async () => ({ data: [{ id: 'rc-1' }], error: null })
              };
              return uChain;
            }
          } as any;
        }
        if (table === 'plots') {
          const plotQuery: any = {
            eq: () => plotQuery,
            then: (resolve: any) => resolve({
              data: [{
                id: 'Plot-01',
                project_name: 'โครงการ A',
                plot_name: 'Plot-01',
                sale_status: 'Reserved',
                has_customer: true,
                customer_name: 'คุณสมศักดิ์ จองเช่า',
                current_tenant_name: null
              }],
              error: null
            })
          };
          return {
            select: () => plotQuery,
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: async () => ({ data: null, error: { message: 'Plot update DB failure' } })
              };
              return uChain;
            }
          } as any;
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        } as any;
      }) as any);

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={onApplyMock}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      fireEvent.click(screen.getByText(/🏷️ จองแล้ว/));
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณสมศักดิ์ จองเช่า' }));
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการจองเช่า/ }));

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(/⚠️ บันทึกบางส่วน: สัญญาเช่ายกเลิกแล้ว แต่การคืนแปลงหรืออัปเดตสถานะลูกค้าไม่สมบูรณ์/);
      });

      expect(onApplyMock).not.toHaveBeenCalled();
    });
  });

  describe('Finding C: Interrupted Terminal State Recovery in Lead Tracker and Modal', () => {
    it('renders rental action button in CentralLeadTracker drawer for customer with MovedOut rental_status', async () => {
      const mockCustomer = {
        id: 'lead-movedout',
        leadId: 'lead-movedout',
        name: 'คุณวิชัย ย้ายออก',
        phone: '0899999999',
        status: 'Visit',
        rental_status: 'MovedOut',
        active_rental_contract_id: 'rc-interrupted-1',
        projectName: 'โครงการ A',
        intakeStatus: 'visit',
        interests: [{ id: 'int-1', projectName: 'โครงการ A', plotId: 'Plot-01' }]
      };
      const mockSnapshot: any = {
        actor: { userId: 'sales-1', role: 'sales' },
        projects: [{ name: 'โครงการ A' }],
        salesOwners: [{ userId: 'sales-1', displayName: 'Sales A' }],
        page: 0,
        hasMore: false,
        customers: [mockCustomer],
        search: {
          contractVersion: 'central_search_v1',
          filters: { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false },
          projects: ['โครงการ A'],
          owners: [{ userId: 'sales-1', displayName: 'Sales A' }],
          channels: ['Walk in'],
          hasMoreChannels: false
        }
      };

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={mockSnapshot.search.filters}
          onFilterChange={vi.fn()}
          onApply={vi.fn()}
          bookingEnabled={true}
          leadWorkEnabled={true}
        />
      );

      expect(screen.getByText('คุณวิชัย ย้ายออก')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ คุณวิชัย ย้ายออก' }));

      const manageBtn = screen.getByRole('button', { name: /จัดการสัญญาเช่าของ คุณวิชัย ย้ายออก/ });
      expect(manageBtn).toBeInTheDocument();
    });

    it('queries and recovers terminal contract in RentalActionModal when contractId is not provided', async () => {
      let queriedStatuses: string[] = [];
      const movedContract = {
        id: 'rc-terminal-recovered',
        lead_id: 'lead-recovery',
        plot_id: 'plot-1',
        plot_name: 'P-1',
        tenant_name: 'คุณสมศรี กู้คืน',
        status: 'MovedOut',
        security_deposit: 15000,
        monthly_rent: 8000
      };

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const chain: any = {
            select: () => chain,
            in: (_col: string, values: string[]) => {
              queriedStatuses = values;
              return chain;
            },
            eq: () => chain,
            order: () => chain,
            limit: async () => ({ data: [movedContract], error: null })
          };
          return chain;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'plot-1', plot_name: 'P-1', project_name: 'Project', sale_status: 'Available', has_customer: false, current_tenant_name: null },
                  error: null
                })
              })
            })
          } as any;
        }
        return {} as any;
      }) as any);

      render(
        <RentalActionModal
          isOpen
          onClose={vi.fn()}
          lead={{ id: 'lead-recovery', customer_name: 'คุณสมศรี กู้คืน', rental_status: 'Active' } as any}
          user={{ id: 'u1', username: 'Sales' }}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/ผู้เช่า:/)).toBeInTheDocument();
        expect(screen.getByText('คุณสมศรี กู้คืน')).toBeInTheDocument();
      });

      expect(queriedStatuses).toContain('MovedOut');
      expect(queriedStatuses).toContain('ConvertedToBuy');
    });
  });

  describe('Finding D: Guard against Overwriting Reallocated Plots on Move Out', () => {
    it('does not wipe plot when plot was reallocated to another tenant during move out replay', async () => {
      let plotUpdateCalled = false;
      const movedContract = {
        id: 'rc-replay-1',
        lead_id: 'lead-old-tenant',
        plot_id: 'plot-reallocated',
        plot_name: 'P-99',
        tenant_name: 'คุณลูกค้าเก่า',
        status: 'MovedOut',
        security_deposit: 20000,
        monthly_rent: 10000
      };

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: async () => ({ data: [movedContract], error: null })
          };
          return chain;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'plot-reallocated',
                    plot_name: 'P-99',
                    project_name: 'Project',
                    sale_status: 'Rented',
                    has_customer: true,
                    current_tenant_name: 'คุณผู้เช่าใหม่'
                  },
                  error: null
                })
              })
            }),
            update: () => {
              plotUpdateCalled = true;
              return { eq: () => ({ select: async () => ({ data: [], error: null }) }) };
            }
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'lead-old-tenant', notes: 'Initial note' }, error: null }),
                maybeSingle: async () => ({ data: { id: 'lead-old-tenant', notes: 'Initial note' }, error: null })
              })
            }),
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'lead-old-tenant' }, error: null })
              };
              return uChain;
            }
          } as any;
        }
        return {} as any;
      }) as any);

      const onClose = vi.fn();
      render(
        <RentalActionModal
          isOpen
          contractId="rc-replay-1"
          lead={{ id: 'lead-old-tenant', customer_name: 'คุณลูกค้าเก่า', rental_status: 'Active' } as any}
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={onClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /ยืนยันการย้ายออก/ })).toBeEnabled();
      });

      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันการย้ายออก/ }).closest('form')!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });

      expect(plotUpdateCalled).toBe(false);
    });
  });

  describe('Finding E: Convert to Buy Safe Preservation of Advanced Sale/Lead/Plot Stages', () => {
    it('does not overwrite sale price/date or downgrade plot/lead stage if deal already progressed', async () => {
      let capturedSalesUpdate: any = null;
      let capturedPlotUpdate: any = null;
      let capturedLeadUpdate: any = null;

      const activeContract = {
        id: 'rc-conv-1',
        lead_id: 'lead-adv-1',
        plot_id: 'plot-adv-1',
        plot_name: 'P-55',
        tenant_name: 'คุณประสิทธิ์ ซื้อบ้าน',
        status: 'Active',
        security_deposit: 30000,
        monthly_rent: 12000,
        program_type: 'program_a',
        lease_start_date: '2025-01-01',
        lease_end_date: '2026-01-01'
      };

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: async () => ({ data: [activeContract], error: null }),
            maybeSingle: async () => ({ data: activeContract, error: null }),
            update: () => {
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'rc-conv-1' }, error: null })
              };
              return uChain;
            }
          };
          return chain;
        }
        if (table === 'sales') {
          const sChain: any = {
            eq: () => sChain,
            neq: () => sChain,
            then: (resolve: any) => resolve({
              data: [{
                id: 'sale-adv-1',
                contract_status: 'Contracted',
                crm_stage: 'contracted',
                sale_price: 3800000,
                booked_at: '2025-02-15T10:00:00Z'
              }],
              error: null
            })
          };
          return {
            select: () => sChain,
            update: (payload: any) => {
              capturedSalesUpdate = payload;
              return { eq: async () => ({ data: {}, error: null }) };
            }
          } as any;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'plot-adv-1',
                    plot_name: 'P-55',
                    project_name: 'Project',
                    sale_status: 'Contracted',
                    has_customer: true,
                    current_tenant_name: 'คุณประสิทธิ์ ซื้อบ้าน'
                  },
                  error: null
                })
              })
            }),
            update: (payload: any) => {
              capturedPlotUpdate = payload;
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'plot-adv-1' }, error: null })
              };
              return uChain;
            }
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-adv-1',
                    status: 'Contracted',
                    customer_name: 'คุณประสิทธิ์ ซื้อบ้าน'
                  },
                  error: null
                })
              })
            }),
            update: (payload: any) => {
              capturedLeadUpdate = payload;
              const uChain: any = {
                eq: () => uChain,
                select: () => uChain,
                single: async () => ({ data: { id: 'lead-adv-1' }, error: null })
              };
              return uChain;
            }
          } as any;
        }
        return {} as any;
      }) as any);

      const onClose = vi.fn();
      render(
        <RentalActionModal
          isOpen
          contractId="rc-conv-1"
          lead={{ id: 'lead-adv-1', customer_name: 'คุณประสิทธิ์ ซื้อบ้าน', status: 'Contracted' } as any}
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={onClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /1\. เปลี่ยนเป็นซื้อ/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /1\. เปลี่ยนเป็นซื้อ/ }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ })).toBeInTheDocument();
      });

      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ }).closest('form')!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });

      expect(capturedSalesUpdate).toBeNull();

      expect(capturedPlotUpdate).toBeDefined();
      expect(capturedPlotUpdate.sale_status).toBeUndefined();
      expect(capturedPlotUpdate.current_tenant_name).toBeNull();

      expect(capturedLeadUpdate).toBeDefined();
      expect(capturedLeadUpdate.status).toBeUndefined();
      expect(capturedLeadUpdate.deal_type).toBe('buy');
      expect(capturedLeadUpdate.rental_status).toBe('ConvertedToBuy');
    });
  });

  describe('Comprehensive Parity Findings A - E Tests', () => {
    it('Finding A: checkLeadPlotOwnership prevents claiming a reserved plot via interested_plot_id when plot belongs to another customer or has no customer name', async () => {
      // Lead A has status Booked, and interested_plot_id = 'plot-b-1'
      // Plot plot-b-1 is marked sale_status = 'Reserved', customer_name is null, and lead_id is null
      const leadA = {
        id: 'lead-a-1',
        customer_name: 'คุณสมชาย ลูกค้าเอ',
        status: 'Booked',
        deal_type: 'buy',
        interested_plot_id: 'plot-b-1',
        project_name: 'โครงการ A'
      };

      const plotB = {
        id: 'plot-b-1',
        plot_name: 'B-01',
        project_name: 'โครงการ A',
        sale_status: 'Reserved',
        has_customer: true,
        customer_name: null,
        current_tenant_name: null,
        lead_id: null // No lead_id set!
      };

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'plots') {
          const plotChain: any = {
            order: () => Promise.resolve({ data: [plotB], error: null }),
            maybeSingle: async () => ({ data: plotB, error: null }),
            then: (resolve: any) => resolve({ data: [plotB], error: null })
          };
          return {
            select: () => ({
              eq: () => plotChain
            })
          } as any;
        }
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
                in: async () => ({ data: [], error: null })
              })
            })
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: leadA, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      }) as any);

      render(
        <RentalContractModal
          isOpen
          lead={leadA as any}
          projectName="โครงการ A"
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={vi.fn()}
        />
      );

      // In the plots dropdown, plotB must show as booked (ติดจอง) and be disabled!
      await waitFor(() => {
        const option = screen.getByRole('option', { name: /B-01/ });
        expect(option).toHaveTextContent(/ติดจอง/);
        expect(option).toBeDisabled();
      });
    });

    it('Finding A: handleConvertToBuy stops and does not overwrite plot when plot is held by another tenant', async () => {
      let plotUpdated = false;
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const rcData = {
            id: 'rc-a2-1',
            lead_id: 'lead-a2-1',
            plot_id: 'p-a2-1',
            tenant_name: 'คุณผู้เช่าเดิม',
            status: 'Active',
            program_type: 'program_a',
            project_name: 'Project A'
          };
          const rcChain: any = {
            eq: () => rcChain,
            order: () => rcChain,
            limit: () => Promise.resolve({ data: [rcData], error: null }),
            maybeSingle: async () => ({ data: rcData, error: null }),
            then: (resolve: any) => resolve({ data: [rcData], error: null })
          };
          return {
            select: () => rcChain
          } as any;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'p-a2-1',
                    sale_status: 'Rented',
                    has_customer: true,
                    current_tenant_name: 'คุณผู้อื่น ที่ไม่ใช่ผู้เช่าเดิม',
                    customer_name: null
                  },
                  error: null
                })
              })
            }),
            update: () => {
              plotUpdated = true;
              return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'p-a2-1' }, error: null }) }) }) };
            }
          } as any;
        }
        if (table === 'sales') {
          return { select: () => ({ eq: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }) }) } as any;
        }
        if (table === 'leads') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'lead-a2-1', customer_name: 'คุณผู้เช่าเดิม' }, error: null }) }) }) } as any;
        }
        return {} as any;
      }) as any);

      render(
        <RentalActionModal
          isOpen
          contractId="rc-a2-1"
          lead={{ id: 'lead-a2-1', customer_name: 'คุณผู้เช่าเดิม' } as any}
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={vi.fn()}
        />
      );

      await screen.findByRole('button', { name: /1. เปลี่ยนเป็นซื้อ/ });
      fireEvent.click(screen.getByRole('button', { name: /1. เปลี่ยนเป็นซื้อ/ }));
      await screen.findByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ });
      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/แปลงนี้มีผู้เช่าอื่นถือสิทธิ์อยู่|แปลงนี้ไม่ได้ถูกผูกสิทธิ์/)).toBeInTheDocument();
      });
      expect(plotUpdated).toBe(false);
    });

    it('Finding B: retry of handleConvertToBuy does not insert duplicate sales record', async () => {
      let salesInsertCount = 0;
      let simulateNetworkDropOnInsert = true;
      const createdSales: any[] = [];

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const rcData = { id: 'rc-b-1', lead_id: 'lead-b-1', plot_id: 'p-b-1', tenant_name: 'คุณสมชาย', status: 'Active', program_type: 'program_a' };
          const rcChain: any = {
            eq: () => rcChain,
            order: () => rcChain,
            limit: () => Promise.resolve({ data: [rcData], error: null }),
            maybeSingle: async () => ({ data: rcData, error: null }),
            then: (resolve: any) => resolve({ data: [rcData], error: null })
          };
          return {
            select: () => rcChain,
            update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'rc-b-1' }, error: null }) }) }) }) })
          } as any;
        }
        if (table === 'plots') {
          const plotUpdateChain: any = {
            eq: () => plotUpdateChain,
            select: () => ({ single: async () => ({ data: { id: 'p-b-1' }, error: null }) })
          };
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: { id: 'p-b-1', sale_status: 'Rented', current_tenant_name: 'คุณสมชาย', has_customer: true },
              error: null
            }) }) }),
            update: () => plotUpdateChain
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: { id: 'lead-b-1', status: 'Rented', customer_name: 'คุณสมชาย' },
              error: null
            }) }) }),
            update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'lead-b-1' }, error: null }) }) }) })
          } as any;
        }
        if (table === 'sales') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  neq: async () => ({ data: createdSales, error: null })
                })
              })
            }),
            insert: (rows: any[]) => {
              salesInsertCount++;
              const newSale = { id: `sale-${salesInsertCount}`, ...rows[0] };
              createdSales.push(newSale);
              if (simulateNetworkDropOnInsert) {
                simulateNetworkDropOnInsert = false;
                throw new Error('Network response lost after commit');
              }
              return { select: () => ({ single: async () => ({ data: newSale, error: null }) }) };
            },
            update: () => ({ eq: () => ({ error: null }) })
          } as any;
        }
        return {} as any;
      }) as any);

      render(
        <RentalActionModal
          isOpen
          contractId="rc-b-1"
          lead={{ id: 'lead-b-1', customer_name: 'คุณสมชาย' } as any}
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={vi.fn()}
        />
      );

      await screen.findByRole('button', { name: /1. เปลี่ยนเป็นซื้อ/ });
      fireEvent.click(screen.getByRole('button', { name: /1. เปลี่ยนเป็นซื้อ/ }));
      await screen.findByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ });

      // Attempt 1: Network drop on sales insert response
      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ }).closest('form')!);
      await screen.findByText(/Network response lost after commit/);

      // Attempt 2: User clicks retry
      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ }).closest('form')!);

      await waitFor(() => {
        expect(salesInsertCount).toBe(1); // Must NOT insert a second sale!
      });
    });

    it('Finding C: opens and allows recovery when contract, plot, and lead converted but sales record is missing', async () => {
      let salesInserted = false;
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          const rcData = {
            id: 'rc-c-1',
            lead_id: 'lead-c-1',
            plot_id: 'p-c-1',
            tenant_name: 'คุณวิชัย',
            status: 'ConvertedToBuy', // contract was already converted!
            program_type: 'program_a'
          };
          const rcChain: any = {
            eq: () => rcChain,
            order: () => rcChain,
            limit: () => Promise.resolve({ data: [rcData], error: null }),
            maybeSingle: async () => ({ data: rcData, error: null }),
            then: (resolve: any) => resolve({ data: [rcData], error: null })
          };
          return {
            select: () => rcChain,
            update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'rc-c-1' }, error: null }) }) }) })
          } as any;
        }
        if (table === 'plots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'p-c-1',
                    sale_status: 'Reserved', // plot was already converted!
                    current_tenant_name: null,
                    has_customer: true
                  },
                  error: null
                })
              })
            }),
            update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'p-c-1' }, error: null }) }) }) })
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-c-1',
                    rental_status: 'ConvertedToBuy', // lead was already converted!
                    status: 'Booked',
                    customer_name: 'คุณวิชัย'
                  },
                  error: null
                })
              })
            }),
            update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'lead-c-1' }, error: null }) }) }) })
          } as any;
        }
        if (table === 'sales') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  neq: async () => ({ data: [], error: null }) // NO sales record exists!
                })
              })
            }),
            insert: () => {
              salesInserted = true;
              return { select: () => ({ single: async () => ({ data: { id: 'sale-recovered' }, error: null }) }) };
            }
          } as any;
        }
        return {} as any;
      }) as any);

      render(
        <RentalActionModal
          isOpen
          contractId="rc-c-1"
          lead={{ id: 'lead-c-1', rental_status: 'ConvertedToBuy', customer_name: 'คุณวิชัย' } as any}
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={vi.fn()}
        />
      );

      // Must NOT show error "ไม่พบสัญญาเช่าที่ดำเนินการได้ สัญญาอาจสิ้นสุดแล้ว"
      expect(screen.queryByText(/ไม่พบสัญญาเช่าที่ดำเนินการได้/)).not.toBeInTheDocument();

      // Must allow submitting to complete the recovery
      const submitBtn = await screen.findByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ });
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(salesInserted).toBe(true);
      });
    });

    it('Finding D: rental cancellation aborts and does not overwrite lead or release plot if contract was concurrently signed to Active', async () => {
      let leadOverwritten = false;
      let plotReleased = false;

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'lead-race-1',
                    customer_name: 'คุณสมศักดิ์',
                    status: 'Reserved',
                    rental_status: 'PendingContract',
                    deal_type: 'rent',
                    interested_plot_id: 'p-race-1',
                    project_name: 'โครงการ A'
                  },
                  error: null
                })
              })
            }),
            update: () => {
              // Expected status guard: rental_status must be PendingContract or Booked
              return {
                eq: () => ({
                  in: () => ({
                    neq: () => ({
                      select: async () => {
                        // 0 rows returned because contract concurrently became Active
                        return { data: [], error: null };
                      }
                    })
                  }),
                  select: async () => {
                    leadOverwritten = true;
                    return { data: [{ id: 'lead-race-1' }], error: null };
                  }
                })
              };
            }
          } as any;
        }
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'rc-race-1', status: 'PendingContract', plot_id: 'p-race-1', project_name: 'โครงการ A' }],
                  error: null
                })
              })
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: async () => {
                    // Contract became Active concurrently! 0 rows returned
                    return { data: [], error: null };
                  }
                })
              })
            })
          } as any;
        }
        if (table === 'plots') {
          const plotQuery: any = {
            eq: () => plotQuery,
            then: (resolve: any) => resolve({
              data: [{ id: 'p-race-1', project_name: 'โครงการ A', sale_status: 'Reserved', has_customer: true, current_tenant_name: 'คุณสมศักดิ์' }],
              error: null
            })
          };
          return {
            select: () => plotQuery,
            update: () => {
              plotReleased = true;
              return { eq: () => ({ select: async () => ({ data: [{ id: 'p-race-1' }], error: null }) }) };
            }
          } as any;
        }
        return {} as any;
      }) as any);

      const mockSnapshot: any = {
        actor: { userId: 'sales-user-1', role: 'sales' },
        projects: [{ name: 'โครงการ A' }],
        salesOwners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
        page: 0,
        hasMore: false,
        customers: [{
          id: 'lead-race-1',
          name: 'คุณสมศักดิ์',
          status: 'Reserved',
          rental_status: 'PendingContract',
          deal_type: 'rent',
          projectName: 'โครงการ A',
          intakeStatus: 'booked',
          interests: [{ id: 'int-1', projectName: 'โครงการ A', plotId: 'p-race-1' }]
        }],
        search: {
          contractVersion: 'central_search_v1',
          filters: { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false },
          projects: ['โครงการ A'],
          owners: [{ userId: 'sales-user-1', displayName: 'Sales A' }],
          channels: ['Walk in'],
          hasMoreChannels: false
        }
      };

      const filterState = { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false };

      render(
        <CentralLeadTracker
          snapshot={mockSnapshot}
          filters={filterState}
          bookingEnabled={true}
          leadWorkEnabled={true}
          onFilterChange={vi.fn()}
          onApply={vi.fn()}
        />
      );

      // Switch to "จองแล้ว" tab where Reserved / PendingContract customers are listed
      fireEvent.click(screen.getByRole('button', { name: /🏷️ จองแล้ว/ }));
      fireEvent.click(screen.getByText('คุณสมศักดิ์'));
      const cancelBtn = await screen.findByRole('button', { name: /ยกเลิกการจองเช่า/ });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.getByText(/สถานะสัญญาเช่าถูกแก้ไขก่อนหน้า|ไม่สามารถยกเลิกได้/)).toBeInTheDocument();
      });

      expect(leadOverwritten).toBe(false);
      expect(plotReleased).toBe(false);
    });

    it('Finding E: unmounting RentalActionModal during preflight aborts and sends zero mutations', async () => {
      let updateExecuted = false;
      let insertExecuted = false;
      let resolvePreflightSales!: (val: any) => void;
      const pendingPreflightSales = new Promise(res => { resolvePreflightSales = res; });

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'rental_contracts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'rc-unmount-1', lead_id: 'l-u1', plot_id: 'p-u1', tenant_name: 'คุณเอก', status: 'Active', program_type: 'program_a' },
                  error: null
                })
              })
            }),
            update: () => {
              updateExecuted = true;
              return { eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'rc-unmount-1' }, error: null }) }) }) }) };
            }
          } as any;
        }
        if (table === 'sales') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  neq: () => pendingPreflightSales
                })
              })
            }),
            insert: () => {
              insertExecuted = true;
              return { select: () => ({ single: async () => ({ data: { id: 'sale-1' }, error: null }) }) };
            }
          } as any;
        }
        if (table === 'leads') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'l-u1', customer_name: 'คุณเอก' }, error: null }) }) }),
            update: () => { updateExecuted = true; return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'l-u1' }, error: null }) }) }) }; }
          } as any;
        }
        if (table === 'plots') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p-u1', sale_status: 'Rented', current_tenant_name: 'คุณเอก' }, error: null }) }) }),
            update: () => { updateExecuted = true; return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'p-u1' }, error: null }) }) }) }; }
          } as any;
        }
        return {} as any;
      }) as any);

      const { unmount } = render(
        <RentalActionModal
          isOpen
          contractId="rc-unmount-1"
          lead={{ id: 'l-u1', customer_name: 'คุณเอก' } as any}
          user={{ id: 'u1', username: 'Sales', role: 'Sales' }}
          onClose={vi.fn()}
        />
      );

      await screen.findByRole('button', { name: /1. เปลี่ยนเป็นซื้อ/ });
      fireEvent.click(screen.getByRole('button', { name: /1. เปลี่ยนเป็นซื้อ/ }));
      await screen.findByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ });

      // Click submit -> enters handleConvertToBuy and awaits pendingPreflightSales
      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อ/ }).closest('form')!);

      // Parent unmounts the modal while preflight is awaiting!
      unmount();

      // Now resolve preflight
      resolvePreflightSales({ data: [], error: null });

      // Wait a tick for any microtasks to resolve
      await new Promise(r => setTimeout(r, 50));

      // MUST NOT execute any updates or inserts!
      expect(updateExecuted).toBe(false);
      expect(insertExecuted).toBe(false);
    });
  });
});
