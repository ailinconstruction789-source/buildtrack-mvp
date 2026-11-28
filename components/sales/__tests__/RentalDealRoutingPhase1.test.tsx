import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import LeadTrackerView from '../LeadTrackerView';
import SalesDealStatusModal from '../SalesDealStatusModal';
import RentalContractModal from '../RentalContractModal';

const mocks = vi.hoisted(() => ({
  fetchSalesWithoutLimit: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  contextRead: vi.fn(),
  rentalModalProps: [] as Record<string, any>[],
  rentalActionProps: [] as Record<string, any>[],
  dealStatusModalProps: [] as Record<string, any>[],
}));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({
  fetchSalesWithoutLimit: mocks.fetchSalesWithoutLimit,
}));

vi.mock('@/lib/sales/customerDealReadClient', () => ({
  customerDealReadApi: { read: mocks.contextRead },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => {
    const src = String(loader);
    if (src.includes('RentalContractModal')) {
      return function MockDynamicRentalContractModal(props: Record<string, any>) {
        mocks.rentalModalProps.push(props);
        return (
          <div data-testid="mock-rental-contract-modal">
            <span data-testid="rcm-customer">{props.lead?.customer_name}</span>
            <span data-testid="rcm-project">{props.projectName}</span>
            <span data-testid="rcm-plot">{props.plotId}</span>
            <span data-testid="rcm-mode">{props.defaultMode || ''}</span>
          </div>
        );
      };
    }
    if (src.includes('RentalActionModal')) {
      return function MockDynamicRentalActionModal(props: Record<string, any>) {
        mocks.rentalActionProps.push(props);
        return <div data-testid="mock-rental-action-modal">{props.lead?.customer_name}</div>;
      };
    }
    if (src.includes('SalesDealStatusModal')) {
      return function MockDynamicSalesDealStatusModal(props: Record<string, any>) {
        mocks.dealStatusModalProps.push(props);
        return <div data-testid="mock-sales-deal-status-modal">{props.lead?.customer_name}</div>;
      };
    }
    return () => null;
  },
}));

vi.mock('../RentalContractModal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../RentalContractModal')>();
  return {
    ...actual,
    default: (props: any) => {
      if (props.__useRealModal) {
        return <actual.default {...props} />;
      }
      mocks.rentalModalProps.push(props);
      return (
        <div data-testid="mock-rental-contract-modal">
          <span data-testid="rcm-customer">{props.lead?.customer_name}</span>
          <span data-testid="rcm-project">{props.projectName}</span>
          <span data-testid="rcm-plot">{props.plotId}</span>
          <span data-testid="rcm-mode">{props.defaultMode || ''}</span>
        </div>
      );
    },
  };
});

vi.mock('../RentalActionModal', () => ({
  default: (props: any) => {
    mocks.rentalActionProps.push(props);
    return <div data-testid="mock-rental-action-modal">{props.lead?.customer_name}</div>;
  },
}));

vi.mock('../RentalPaymentLedgerModal', () => ({ default: () => <div data-testid="mock-rental-ledger-modal" /> }));
vi.mock('../CustomerVoicesModal', () => ({ default: () => null }));
vi.mock('../HouseVisitChecklistModal', () => ({ default: () => null }));
vi.mock('../AdminDeleteCustomerModal', () => ({ default: () => null }));
vi.mock('../RentalAlertsWidget', () => ({ default: () => null }));
vi.mock('../RentalPortfolioAnalytics', () => ({ default: () => null }));
vi.mock('../AvailablePlotSelect', () => ({ default: () => null }));
vi.mock('../LeadPicker', () => ({ default: () => null }));

const pendingRentalFixture = {
  id: 'lead-rent-pending-1',
  customer_name: 'คุณสมชาย จองเช่า',
  phone: '0812345678',
  project_name: 'ไอลิน 6',
  interested_plot_id: 'ailin6-plot-10',
  interested_plot_name: '10',
  status: 'Reserved',
  deal_type: 'rent',
  rental_status: 'PendingContract',
  rental_program: 'program_a',
  crm_status: 'จองเช่า — รอทำสัญญา (แบบ A: เช่าปกติ)',
  sales_owner: 'PIEW',
  agent_name: 'PIEW',
  booking_date: '2026-11-20T05:00:00Z',
  created_at: '2026-11-20T05:00:00Z',
};

const purchaseBookedFixture = {
  id: 'lead-buy-1',
  customer_name: 'คุณวิชัย ซื้อบ้าน',
  phone: '0822222222',
  project_name: 'ไอลิน 6',
  interested_plot_id: 'ailin6-plot-11',
  interested_plot_name: '11',
  status: 'Booked',
  deal_type: 'buy',
  crm_status: 'Booked — จองแล้ว',
  sales_owner: 'PIEW',
  agent_name: 'PIEW',
  booking_date: '2026-11-20T05:00:00Z',
  created_at: '2026-11-20T05:00:00Z',
};

const convertedToBuyFixture = {
  id: 'lead-converted-1',
  customer_name: 'คุณนภา เปลี่ยนเป็นซื้อ',
  phone: '0833333333',
  project_name: 'ไอลิน 6',
  interested_plot_id: 'ailin6-plot-12',
  interested_plot_name: '12',
  status: 'Booked',
  deal_type: 'buy',
  rental_status: 'ConvertedToBuy',
  crm_status: 'ConvertedToBuy — เปลี่ยนจากเช่าเป็นซื้อ',
  sales_owner: 'PIEW',
  agent_name: 'PIEW',
  booking_date: '2026-11-21T05:00:00Z',
  created_at: '2026-11-21T05:00:00Z',
};

const activeRentalFixture = {
  id: 'lead-rent-active-1',
  customer_name: 'คุณอารี เช่าอยู่',
  phone: '0844444444',
  project_name: 'ไอลิน 6',
  interested_plot_id: 'ailin6-plot-13',
  interested_plot_name: '13',
  status: 'Rented',
  deal_type: 'rent',
  rental_status: 'Active',
  active_rental_contract_id: 'rc-active-1',
  crm_status: 'Rented / Active — ทำสัญญาเช่าแล้ว',
  sales_owner: 'PIEW',
  agent_name: 'PIEW',
  created_at: '2026-11-18T05:00:00Z',
};

const movedOutFixture = {
  id: 'lead-moved-out-1',
  customer_name: 'คุณเดิม ย้ายออกแล้ว',
  phone: '0855555555',
  project_name: 'ไอลิน 6',
  interested_plot_id: 'ailin6-plot-14',
  interested_plot_name: '14',
  status: 'MovedOut',
  deal_type: 'rent',
  rental_status: 'MovedOut',
  crm_status: 'Rented / Active — ทำสัญญาเช่าแล้ว',
  sales_owner: 'PIEW',
  agent_name: 'PIEW',
  created_at: '2026-11-15T05:00:00Z',
};

const plotsFixture = [
  { id: 'ailin6-plot-10', plot_name: '10', project_name: 'ไอลิน 6' },
  { id: 'ailin6-plot-11', plot_name: '11', project_name: 'ไอลิน 6' },
  { id: 'ailin6-plot-12', plot_name: '12', project_name: 'ไอลิน 6' },
  { id: 'ailin6-plot-13', plot_name: '13', project_name: 'ไอลิน 6' },
  { id: 'ailin6-plot-14', plot_name: '14', project_name: 'ไอลิน 6' },
];

const salesUser = { id: 'user-sales-1', username: 'PIEW', role: 'Sales' };
const readOnlyUser = { id: 'user-owner-1', username: 'OWNER', role: 'Owner' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rentalModalProps.length = 0;
  mocks.rentalActionProps.length = 0;
  mocks.dealStatusModalProps.length = 0;
  mocks.contextRead.mockRejectedValue(new Error('not used'));
  mocks.from.mockReturnValue({
    select: async () => ({
      data: [{ id: 'user-sales-1', username: 'PIEW', role: 'Sales' }],
      error: null,
    }),
  });
});

afterEach(() => {
  cleanup();
});

describe('Phase 1 Regression: Unified Rental Booking Status & Modal Routing', () => {
  it('My Lead List View routes PendingContract rental fixture to RentalContractModal (defaultMode=contract) with matching customer & canonical plot, NOT SalesDealStatusModal', async () => {
    mocks.fetchSalesWithoutLimit.mockImplementation(async (table: string) => {
      if (table === 'leads') return [pendingRentalFixture];
      if (table === 'plots') return plotsFixture;
      return [];
    });

    render(
      <MySalesWorkspace
        currentUser={salesUser}
        projects={[{ name: 'ไอลิน 6' }]}
        plots={plotsFixture}
      />
    );

    expect(await screen.findByText('คุณสมชาย จองเช่า')).toBeInTheDocument();
    expect(screen.getByText('จองเช่า — รอทำสัญญา')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'อัปเดตสถานะ' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ทำสัญญาเช่าจริง/ }));

    expect(screen.getByTestId('mock-rental-contract-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-sales-deal-status-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('rcm-customer')).toHaveTextContent('คุณสมชาย จองเช่า');
    expect(screen.getByTestId('rcm-project')).toHaveTextContent('ไอลิน 6');
    expect(screen.getByTestId('rcm-plot')).toHaveTextContent('ailin6-plot-10');
    expect(screen.getByTestId('rcm-mode')).toHaveTextContent('contract');
  });

  it('My Lead Kanban View routes PendingContract rental fixture to RentalContractModal (defaultMode=contract), NOT SalesDealStatusModal', async () => {
    mocks.fetchSalesWithoutLimit.mockImplementation(async (table: string) => {
      if (table === 'leads') return [pendingRentalFixture];
      if (table === 'plots') return plotsFixture;
      return [];
    });

    render(
      <MySalesWorkspace
        currentUser={salesUser}
        projects={[{ name: 'ไอลิน 6' }]}
        plots={plotsFixture}
      />
    );

    expect(await screen.findByText('คุณสมชาย จองเช่า')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Kanban/i }));

    expect(screen.getByText('จองเช่า — รอทำสัญญา')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'อัปเดตสถานะ' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ทำสัญญาเช่าจริง/ }));

    expect(screen.getByTestId('mock-rental-contract-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-sales-deal-status-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('rcm-customer')).toHaveTextContent('คุณสมชาย จองเช่า');
    expect(screen.getByTestId('rcm-plot')).toHaveTextContent('ailin6-plot-10');
    expect(screen.getByTestId('rcm-mode')).toHaveTextContent('contract');
  });

  it('My Lead preserves purchase flow for normal booked purchase and ConvertedToBuy leads', async () => {
    mocks.fetchSalesWithoutLimit.mockImplementation(async (table: string) => {
      if (table === 'leads') return [purchaseBookedFixture, convertedToBuyFixture];
      if (table === 'plots') return plotsFixture;
      return [];
    });

    render(
      <MySalesWorkspace
        currentUser={salesUser}
        projects={[{ name: 'ไอลิน 6' }]}
        plots={plotsFixture}
      />
    );

    expect(await screen.findByText('คุณวิชัย ซื้อบ้าน')).toBeInTheDocument();
    expect(screen.getByText('คุณนภา เปลี่ยนเป็นซื้อ')).toBeInTheDocument();

    const updateButtons = screen.getAllByRole('button', { name: 'อัปเดตสถานะ' });
    expect(updateButtons).toHaveLength(2);

    fireEvent.click(updateButtons[0]);
    expect(screen.getByTestId('mock-sales-deal-status-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-rental-contract-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-rental-action-modal')).not.toBeInTheDocument();
  });

  it('LeadTrackerView does NOT open RentalActionModal for PendingContract fixture and opens RentalContractModal with defaultMode=contract and canonical plotId', () => {
    render(
      <LeadTrackerView
        leads={[
          pendingRentalFixture as any,
          activeRentalFixture as any,
          movedOutFixture as any,
          convertedToBuyFixture as any,
        ]}
        plots={plotsFixture}
        projects={[{ name: 'ไอลิน 6' }]}
        selectedProjectName="ไอลิน 6"
        user={salesUser}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('คุณสมชาย จองเช่า')).toBeInTheDocument();
    expect(screen.getByText('จองเช่า — รอทำสัญญา')).toBeInTheDocument();

    // Only the Active rental row should have "สัญญา" (RentalActionModal) button — NOT PendingContract, MovedOut, or ConvertedToBuy
    const leaseManageButtons = screen.getAllByRole('button', { name: /สัญญา$/ });
    expect(leaseManageButtons).toHaveLength(1);

    // Click "ทำสัญญาเช่าจริง" on the PendingContract fixture row
    fireEvent.click(screen.getByRole('button', { name: /ทำสัญญาเช่าจริง/ }));

    expect(screen.getByTestId('mock-rental-contract-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-rental-action-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('rcm-customer')).toHaveTextContent('คุณสมชาย จองเช่า');
    expect(screen.getByTestId('rcm-project')).toHaveTextContent('ไอลิน 6');
    expect(screen.getByTestId('rcm-plot')).toHaveTextContent('ailin6-plot-10');
    expect(screen.getByTestId('rcm-mode')).toHaveTextContent('contract');
  });

  it('SalesDealStatusModal blocks direct PendingContract rental fixture without purchase form or ensure_lead_sale_record', () => {
    render(
      <SalesDealStatusModal
        lead={{ ...pendingRentalFixture, leadId: pendingRentalFixture.id }}
        currentUser={salesUser}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/จองเช่ารอทำสัญญา/);
    expect(screen.queryByRole('combobox', { name: 'ธนาคาร' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'ราคา ทด.13 (ประเมินที่ดิน)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('SalesDealStatusModal guards stale open dialog when lead changes to rental before save and NEVER calls ensure_lead_sale_record', async () => {
    let leadReadCount = 0;
    const writes: string[] = [];

    mocks.from.mockImplementation((table: string) => {
      let payload: unknown;
      const query: any = {
        select: () => query,
        insert: (val: unknown) => { payload = val; return query; },
        update: (val: unknown) => { payload = val; return query; },
        eq: () => query,
        neq: () => query,
        is: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (payload) {
            writes.push(table);
            return { data: { id: 'written' }, error: null };
          }
          if (table === 'leads') {
            leadReadCount++;
            if (leadReadCount === 1) {
              // Initial load: looks like normal purchase booking without saleId
              return {
                data: {
                  id: 'lead-stale-1',
                  customer_name: 'คุณเปลี่ยนเป็นเช่า',
                  phone: '0899999999',
                  status: 'Booked',
                  deal_type: 'buy',
                  rental_status: null,
                  crm_status: 'Booked — จองแล้ว',
                  project_name: 'ไอลิน 6',
                  interested_plot_id: 'ailin6-plot-10',
                  interested_plot_name: '10',
                  notes: '',
                  updated_at: 'v1',
                },
                error: null,
              };
            }
            // Before save: changed in DB to rental PendingContract!
            return {
              data: {
                id: 'lead-stale-1',
                customer_name: 'คุณเปลี่ยนเป็นเช่า',
                phone: '0899999999',
                status: 'Reserved',
                deal_type: 'rent',
                rental_status: 'PendingContract',
                crm_status: 'จองเช่า — รอทำสัญญา (แบบ A)',
                project_name: 'ไอลิน 6',
                interested_plot_id: 'ailin6-plot-10',
                interested_plot_name: '10',
                notes: '',
                updated_at: 'v2',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(
            payload
              ? (writes.push(table), { data: { id: 'written' }, error: null })
              : { data: [], error: null }
          ).then(resolve),
      };
      return query;
    });

    const onSaved = vi.fn();
    render(
      <SalesDealStatusModal
        lead={{
          id: 'lead-stale-1',
          leadId: 'lead-stale-1',
          saleId: null,
          customer_name: 'คุณเปลี่ยนเป็นเช่า',
          status: 'Booked',
          deal_type: 'buy',
          crm_status: 'Booked — จองแล้ว',
          project_name: 'ไอลิน 6',
          interested_plot_id: 'ailin6-plot-10',
          interested_plot_name: '10',
        }}
        currentUser={salesUser}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const stageSelect = await screen.findByRole('combobox', { name: 'สถานะหลังจอง' });
    await waitFor(() => expect(stageSelect).not.toBeDisabled());

    fireEvent.change(stageSelect, { target: { value: 'contracted' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูล' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/จองเช่ารอทำสัญญา/);
    expect(mocks.rpc).not.toHaveBeenCalledWith('ensure_lead_sale_record', expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('prevents read-only roles from executing rental contract or cancellation mutations across My Lead, LeadTrackerView, and RentalContractModal', async () => {
    mocks.fetchSalesWithoutLimit.mockImplementation(async (table: string) => {
      if (table === 'leads') return [pendingRentalFixture, purchaseBookedFixture, activeRentalFixture];
      if (table === 'plots') return plotsFixture;
      return [];
    });

    const { unmount } = render(
      <MySalesWorkspace
        currentUser={readOnlyUser}
        projects={[{ name: 'ไอลิน 6' }]}
        plots={plotsFixture}
      />
    );

    // Switch to all leads so read-only Owner can view rows
    fireEvent.click(await screen.findByRole('button', { name: /ลูกค้าทั้งหมดในทีม/i }));
    expect(await screen.findByText('คุณสมชาย จองเช่า')).toBeInTheDocument();

    // No write action buttons for rental pending or active
    expect(screen.queryByRole('button', { name: /ทำสัญญาเช่าจริง/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ยกเลิกจองเช่า/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จัดการสัญญาเช่า/ })).not.toBeInTheDocument();
    // Existing read-only view button on purchase booking is preserved
    expect(screen.getByRole('button', { name: 'ดูสถานะ' })).toBeInTheDocument();
    unmount();

    // LeadTrackerView read-only
    const lt = render(
      <LeadTrackerView
        leads={[pendingRentalFixture as any, activeRentalFixture as any]}
        plots={plotsFixture}
        projects={[{ name: 'ไอลิน 6' }]}
        selectedProjectName="ไอลิน 6"
        user={readOnlyUser}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /ทำสัญญาเช่าจริง/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ยกเลิกจองเช่า/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /สัญญา$/ })).not.toBeInTheDocument();
    lt.unmount();

    // Real RentalContractModal blocks submit for read-only role
    const writes: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        insert: () => { writes.push(table); return q; },
        update: () => { writes.push(table); return q; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: plotsFixture, error: null }).then(resolve),
      };
      return q;
    });

    render(
      <RentalContractModal
        {...({ __useRealModal: true } as any)}
        isOpen={true}
        onClose={vi.fn()}
        lead={pendingRentalFixture as any}
        plotId="ailin6-plot-10"
        projectName="ไอลิน 6"
        defaultMode="contract"
        user={readOnlyUser}
        salesOwners={[{ userId: 'user-sales-1', displayName: 'PIEW' }]}
      />
    );

    const submitBtn = await screen.findByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/ });
    expect(submitBtn).toBeDisabled();
    fireEvent.submit(submitBtn.closest('form')!);
    expect(await screen.findByText(/สิทธิ์ดูข้อมูลอย่างเดียว/)).toBeInTheDocument();
    expect(writes).toHaveLength(0);
  });
});
