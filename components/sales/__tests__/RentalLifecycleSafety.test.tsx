import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RentalActionModal from '../RentalActionModal';
import RentalContractModal from '../RentalContractModal';
import RentalPaymentLedgerModal from '../RentalPaymentLedgerModal';

type Query = { table: string; action: 'read' | 'insert' | 'update'; payload?: Record<string, unknown> | Record<string, unknown>[];
  filters: [string, unknown][]; columns?: string; single: boolean };
type Result = { data: unknown; error: { message: string } | null };
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../LeadPicker', () => ({ default: ({ onToggleCreateNew }: { onToggleCreateNew: (value: boolean) => void }) =>
  <button type="button" onClick={() => onToggleCreateNew(true)}>New walk-in</button> }));
vi.mock('../RentalReceiptModal', () => ({ default: () => null }));
vi.mock('../TenantPortalModal', () => ({ default: () => null }));
vi.mock('../RentalMaintenanceModal', () => ({ default: () => null }));

const contract = { id: 'contract-1', lead_id: 'lead-1', project_name: 'Project', plot_id: 'plot-1', plot_name: '1',
  tenant_name: 'Tenant One', agent_name: 'Sales A', program_type: 'program_b', status: 'Active', monthly_rent: 15000,
  savings_per_month: 5000, security_deposit: 30000, advance_rent: 15000, accumulated_savings: 0, base_price: 3000000,
  lease_duration_months: 1, lease_start_date: '2026-01-01', lease_end_date: '2026-02-01', created_at: '2026-01-01' };
const lead = { id: 'lead-1', customer_name: 'Tenant One', status: 'Follow Up', project_name: 'Project', interested_plot_id: 'plot-1' };
const user = { id: 'user-1', username: 'Sales A', role: 'Sales' };
let queries: Query[];
let resolveQuery: (query: Query) => Result | Promise<Result>;
const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message = 'write denied'): Result => ({ data: null, error: { message } });
function defaultResult(q: Query): Result {
  if (q.action !== 'read') return ok({ id: q.table + '-saved' });
  if (q.table === 'plots') return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', has_customer: false }]);
  if (q.table === 'rental_payments') return ok(q.columns?.includes('savings_amount') ? [{ savings_amount: 5000 }] : []);
  if (q.table === 'rental_contracts') {
    if (q.filters.some(([key]) => key === 'lead_id')) return ok([]);
    return ok(q.single ? contract : [contract]);
  }
  return ok([]);
}
function builder(table: string) {
  const q: Query = { table, action: 'read', filters: [], single: false };
  const api = {
    select: (columns = '*') => { q.columns = columns; return api; },
    insert: (payload: Record<string, unknown>[]) => { q.action = 'insert'; q.payload = payload; return api; },
    update: (payload: Record<string, unknown>) => { q.action = 'update'; q.payload = payload; return api; },
    eq: (key: string, value: unknown) => { q.filters.push([key, value]); return api; },
    neq: (key: string, value: unknown) => { q.filters.push([`neq:${key}`, value]); return api; },
    in: (key: string, value: unknown) => { q.filters.push([key, value]); return api; },
    is: (key: string, value: unknown) => { q.filters.push([key, value]); return api; },
    or: (value: unknown) => { q.filters.push(['or', value]); return api; },
    order: () => api, limit: () => api,
    maybeSingle: () => { q.single = true; return api; }, single: () => { q.single = true; return api; },
    then: (done: (result: Result) => unknown, rejected?: (error: unknown) => unknown) => {
      queries.push(q);
      return Promise.resolve().then(() => resolveQuery(q)).then(done, rejected);
    }
  };
  return api;
}
const writes = (table?: string) => queries.filter(q => q.action !== 'read' && (!table || q.table === table));
const submit = (name: RegExp) => fireEvent.submit(screen.getByRole('button', { name }).closest('form')!);
beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  resolveQuery = defaultResult;
  mocks.from.mockReset().mockImplementation(builder);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('Rental action identity and error safety', () => {
  it('loads the exact clicked contract rather than another Active contract for its lead', async () => {
    resolveQuery = q => q.action === 'read' && q.table === 'rental_contracts' ? ok([{ ...contract, status: 'Renewed' }]) : defaultResult(q);
    render(<RentalActionModal isOpen contractId="contract-1" lead={lead as never} user={user} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
    expect(queries[0].filters).toContainEqual(['id', 'contract-1']);
    expect(queries[0].filters).not.toContainEqual(['lead_id', 'lead-1']);
  });
  it('uses a lead active contract ID when a caller does not provide the prop', async () => {
    render(<RentalActionModal isOpen lead={{ ...lead, active_rental_contract_id: 'contract-1' } as never} onClose={vi.fn()} />);
    await waitFor(() => expect(queries).toHaveLength(1));
    expect(queries[0].filters).toContainEqual(['id', 'contract-1']);
  });
  it('never performs an unscoped query', async () => {
    render(<RentalActionModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('กรุณาระบุสัญญา ลูกค้า หรือแปลง')).toBeInTheDocument();
    expect(queries).toHaveLength(0);
  });
  it.each(['MovedOut', 'Cancelled', 'ConvertedToBuy', 'missing'])('does not invent an actionable contract for %s', async status => {
    resolveQuery = () => ok(status === 'missing' ? [] : [{ ...contract, status }]);
    render(<RentalActionModal isOpen contractId="contract-1" onClose={vi.fn()} />);
    expect(await screen.findByText(/ไม่พบสัญญาเช่าที่ดำเนินการได้/)).toBeInTheDocument();
    submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
    expect(writes()).toHaveLength(0);
  });
  it('rejects an exact contract which belongs to a different lead', async () => {
    render(<RentalActionModal isOpen contractId="contract-1" lead={{ ...lead, id: 'different-lead' } as never} onClose={vi.fn()} />);
    expect(await screen.findByText('สัญญาไม่ตรงกับลูกค้าหรือแปลงที่เลือก')).toBeInTheDocument();
  });
  it('does not let an old contract request overwrite the newly selected contract', async () => {
    let release!: (result: Result) => void;
    resolveQuery = q => q.filters.some(([key, value]) => key === 'id' && value === 'old')
      ? new Promise<Result>(done => { release = done; }) : ok([{ ...contract, id: 'new', tenant_name: 'New Tenant' }]);
    const view = render(<RentalActionModal isOpen contractId="old" onClose={vi.fn()} />);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    view.rerender(<RentalActionModal isOpen contractId="new" onClose={vi.fn()} />);
    await screen.findByText('New Tenant');
    await act(async () => release(ok([{ ...contract, id: 'old', tenant_name: 'Old Tenant' }])));
    expect(screen.queryByText('Old Tenant')).not.toBeInTheDocument();
  });
  it.each(['error', 'zero rows'])('stops on a resolved contract update returning %s', async condition => {
    const onClose = vi.fn();
    resolveQuery = q => q.action === 'update' ? condition === 'error' ? fail() : ok(null) : defaultResult(q);
    render(<RentalActionModal isOpen contractId="contract-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
    submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
    await screen.findByText(condition === 'error' ? 'write denied' : /ไม่พบรายการที่แก้ไขได้/);
    expect(writes()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });
  it('resumes a partial renewal without extending the contract a second time', async () => {
    let failPlot = true;
    const onClose = vi.fn();
    resolveQuery = q => q.table === 'plots' && q.action === 'update' && failPlot ? fail('plot denied') : defaultResult(q);
    render(<RentalActionModal isOpen contractId="contract-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
    submit(/ยืนยันต่อสัญญาเช่า/);
    await screen.findByText(/บันทึกบางส่วนแล้ว.*plot denied/);
    expect(onClose).not.toHaveBeenCalled();
    failPlot = false;
    submit(/ยืนยันต่อสัญญาเช่า/);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writes('rental_contracts')).toHaveLength(1);
    expect(writes('rental_contracts')[0].payload).toMatchObject({ status: 'Renewed', lease_end_date: '2027-02-01' });
    expect(writes('leads')[0].payload).toMatchObject({ rental_status: 'Renewed' });
  });
  it('aligns ended lead state with the specific MovedOut contract status', async () => {
    const onClose = vi.fn();
    render(<RentalActionModal isOpen contractId="contract-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
    submit(/ยืนยันการย้ายออก/);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writes('leads')[0].payload).toMatchObject({ status: 'MovedOut', rental_status: 'MovedOut' });
    expect(writes('rental_contracts')[0].payload).toMatchObject({ status: 'MovedOut' });
  });
  it('does not continue plot and lead writes after an account switch during the primary save', async () => {
    let release!: (result: Result) => void;
    const onClose = vi.fn();
    resolveQuery = q => q.table === 'rental_contracts' && q.action === 'update'
      ? new Promise<Result>(done => { release = done; }) : defaultResult(q);
    const view = render(<RentalActionModal isOpen contractId="contract-1" user={user} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
    submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    view.rerender(<RentalActionModal isOpen contractId="contract-1" user={{ ...user, id: 'user-2' }} onClose={onClose} />);
    await act(async () => release(ok({ id: 'contract-1' })));
    expect(writes()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });
});

describe('Rental contract creation safety', () => {
  const renderContract = (extra: Record<string, unknown> = {}) => render(<RentalContractModal isOpen onClose={vi.fn()}
    lead={lead as never} user={user} salesOwners={[{ userId: 'user-1', displayName: 'Sales A' }]} {...extra} />);
  it('does not create another contract from a rental lead', async () => {
    renderContract({ lead: { ...lead, status: 'Rented' } });
    // Wait for the asynchronous plot load, rather than asserting a one-second machine budget.
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled(), { timeout: 10000 });
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await screen.findByText(/ลูกค้ารายนี้อยู่ในขั้นตอนจอง/);
    expect(writes()).toHaveLength(0);
  });
  it('rejects another existing Active or Renewed contract before inserting', async () => {
    resolveQuery = q => q.table === 'rental_contracts' ? ok([{ id: 'existing' }]) : defaultResult(q);
    renderContract();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await screen.findByText(/ลูกค้ามีสัญญาเช่าที่ใช้งานอยู่แล้ว/);
    expect(writes()).toHaveLength(0);
    expect(queries.find(q => q.table === 'rental_contracts')?.filters).toContainEqual(['status', ['Active', 'Renewed']]);
  });
  it('stops on a contract insert error instead of updating a plot or announcing success', async () => {
    const onClose = vi.fn();
    resolveQuery = q => q.table === 'rental_contracts' && q.action === 'insert' ? fail('contract denied') : defaultResult(q);
    renderContract({ onClose });
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await screen.findByText(/contract denied/);
    expect(writes()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });
  it('does not insert a second contract when retrying a failed lead update', async () => {
    let failLead = true;
    const onClose = vi.fn();
    resolveQuery = q => q.table === 'leads' && q.action === 'update' && failLead ? fail('lead denied') : defaultResult(q);
    renderContract({ onClose });
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await screen.findByText(/บันทึกบางส่วนแล้ว.*lead denied/);
    failLead = false;
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writes('rental_contracts')).toHaveLength(1);
    expect(writes('plots')).toHaveLength(1);
  });
  it('reuses an acknowledged walk-in lead when the contract insert needs retrying', async () => {
    let failContract = true;
    const onClose = vi.fn();
    resolveQuery = q => q.table === 'rental_contracts' && q.action === 'insert' && failContract ? fail('contract denied') : defaultResult(q);
    renderContract({ onClose });
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'New walk-in' }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมศรี มีสุข (ลูกค้า Walk-in)'), { target: { value: 'New Tenant' } });
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await screen.findByText(/บันทึกบางส่วนแล้ว.*contract denied/);
    failContract = false;
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writes('leads').filter(q => q.action === 'insert')).toHaveLength(1);
    expect((writes('rental_contracts')[1].payload as Record<string, unknown>[])[0].lead_id).toBe('leads-saved');
  });
  it('does not create a contract when the old account active-contract read finishes late', async () => {
    let release!: (result: Result) => void;
    resolveQuery = q => q.table === 'rental_contracts' && q.action === 'read'
      ? new Promise<Result>(done => { release = done; }) : defaultResult(q);
    const view = renderContract();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
    submit(/ยืนยันบันทึกสัญญาเช่า/);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    view.rerender(<RentalContractModal isOpen lead={lead as never} user={{ ...user, id: 'user-2' }} onClose={vi.fn()}
      salesOwners={[{ userId: 'user-1', displayName: 'Sales A' }]} />);
    await act(async () => release(ok([])));
    expect(writes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled();
  });
});

describe('Rental payment identity and retry safety', () => {
  const renderLedger = (extra: Record<string, unknown> = {}) => render(<RentalPaymentLedgerModal isOpen contractId="contract-1"
    onClose={vi.fn()} user={user} {...extra} />);
  const openPayment = async () => fireEvent.click(await screen.findByRole('button', { name: '+ บันทึกรับเงิน' }));
  it('loads payments strictly for the selected contract and never OR-merges the plot', async () => {
    renderLedger();
    await openPayment();
    expect(queries.find(q => q.table === 'rental_payments')?.filters).toEqual([['contract_id', 'contract-1']]);
  });
  it('shows missing contracts instead of a synthetic payment ledger', async () => {
    resolveQuery = () => ok(null);
    renderLedger();
    await screen.findByText(/ไม่พบสัญญาเช่า กรุณาตรวจสอบ/);
    expect(queries.map(q => q.table)).toEqual(['rental_contracts']);
    expect(screen.queryByRole('button', { name: '+ บันทึกรับเงิน' })).not.toBeInTheDocument();
  });
  it('does not expose payment actions for a closed contract', async () => {
    resolveQuery = q => q.table === 'rental_contracts' ? ok({ ...contract, status: 'MovedOut' }) : defaultResult(q);
    renderLedger();
    expect(await screen.findByRole('button', { name: '+ บันทึกรับเงิน' })).toBeDisabled();
  });
  it('does not close a payment form on resolved insert failure', async () => {
    const onSaved = vi.fn();
    resolveQuery = q => q.action === 'insert' ? fail('payment denied') : defaultResult(q);
    renderLedger({ onSaved });
    await openPayment();
    submit(/✓ บันทึกรับเงิน/);
    await screen.findByText('payment denied');
    expect(onSaved).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /✓ บันทึกรับเงิน/ })).toBeInTheDocument();
  });
  it('does not reinsert a payment after its savings update fails', async () => {
    let failSavings = true;
    const onSaved = vi.fn();
    resolveQuery = q => q.table === 'rental_contracts' && q.action === 'update' && failSavings ? fail('savings denied') : defaultResult(q);
    renderLedger({ onSaved });
    await openPayment();
    submit(/✓ บันทึกรับเงิน/);
    await screen.findByText(/บันทึกค่างวดแล้ว.*savings denied/);
    failSavings = false;
    submit(/✓ บันทึกรับเงิน/);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(writes('rental_payments')).toHaveLength(1);
    expect(queries.filter(q => q.table === 'rental_payments' && q.columns?.includes('savings_amount'))[0].filters)
      .toContainEqual(['contract_id', 'contract-1']);
  });
  it('keeps unlinked plot history accessible read-only without assigning it to this contract', async () => {
    resolveQuery = q => q.table === 'rental_payments' && q.filters.some(([key, value]) => key === 'contract_id' && value === null)
      ? ok([{ id: 'legacy', tenant_name: 'Legacy Tenant', period_month: 1, period_label: 'Legacy period', amount_paid: 7000, payment_status: 'Paid' }])
      : defaultResult(q);
    renderLedger();
    await screen.findByText('Legacy Tenant');
    expect(screen.getByText(/ประวัติเดิมที่ยังไม่ระบุสัญญา/)).toBeInTheDocument();
    const query = queries.find(q => q.filters.some(([key, value]) => key === 'contract_id' && value === null))!;
    expect(query.filters).toContainEqual(['project_name', 'Project']);
    expect(query.filters).toContainEqual(['plot_id', 'plot-1']);
    expect(screen.getByText('Legacy Tenant').closest('table')!.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByText('ยอดรับแล้ว: ฿0 บ.')).toBeInTheDocument();
  });
  it('keeps an acknowledged payment ID if history refresh fails, so reopening updates rather than inserts', async () => {
    let saved = false;
    let failRefresh = true;
    resolveQuery = q => {
      if (q.table === 'rental_payments' && q.action === 'insert') { saved = true; return ok({ id: 'saved-payment' }); }
      if (q.table === 'rental_contracts' && q.action === 'read' && saved && failRefresh) return fail('refresh denied');
      return defaultResult(q);
    };
    renderLedger();
    await openPayment();
    submit(/✓ บันทึกรับเงิน/);
    await screen.findByText(/บันทึกค่างวดสำเร็จแล้ว แต่โหลดประวัติล่าสุดไม่สำเร็จ/);
    failRefresh = false;
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข / สลิป' }));
    submit(/✓ บันทึกรับเงิน/);
    await waitFor(() => expect(writes('rental_payments')).toHaveLength(2));
    expect(writes('rental_payments').map(q => q.action)).toEqual(['insert', 'update']);
    expect(writes('rental_payments')[1].filters).toContainEqual(['id', 'saved-payment']);
  });
});
