import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDealStatusModal from '../SalesDealStatusModal';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import { customerHistoryTimeline } from '@/lib/sales/customerHistory';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), context: vi.fn() }));
vi.mock('@/lib/sales/customerDealReadClient', () => ({ customerDealReadApi: { read: mocks.context } }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let payload: unknown; const filters: Record<string, unknown> = {};
  const query = {
    select: () => query, insert: (value: unknown) => { payload = value; return query; }, update: (value: unknown) => { payload = value; return query; },
    eq: (key: string, value: unknown) => { filters[key] = value; return query; },
    is: (key: string, value: unknown) => { filters[key] = value; return query; },
    neq: (key: string, value: unknown) => { filters['neq:' + key] = value; return query; },
    limit: () => query,
    single: () => payload ? mocks.write(table, payload, filters) : mocks.read(table, filters),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(payload ? mocks.write(table, payload, filters) : mocks.read(table, filters)).then(resolve, reject),
  }; return query;
} } }));
const lead = { leadId: 'L1', saleId: 'S1', status: 'Booked', crmStage: 'booked', customer_name: 'Customer', notes: 'stale snapshot' };
const freshLead = { id: 'L1', customer_name: 'Fresh Customer', phone: '0812345678', occupation: 'Architect', status: 'Booked', notes: 'fresh notes from another activity', updated_at: 'version-1' };
const freshSale = { id: 'S1', lead_id: 'L1', crm_stage: 'booked', contract_status: 'Reserved', sale_price: 2793000, bank_name: 'ธนาคารเดิม', updated_at: 'sale-version-1' };
let saved = vi.fn<(notice: string) => void>();
beforeEach(() => {
  vi.clearAllMocks(); saved = vi.fn(); mocks.context.mockRejectedValue(new Error("fixture unavailable"));
  mocks.read.mockImplementation((table: string, filters: Record<string, unknown>) => Promise.resolve({ error: null, data: table === 'leads' ? { ...freshLead } : filters.lead_id ? [{ ...freshSale }] : { ...freshSale } }));
  mocks.write.mockImplementation((table: string) => Promise.resolve({ error: null, data: { id: table === 'leads' ? 'L1' : 'S1' } }));
});
afterEach(cleanup);
function open(value: Record<string, unknown> = lead, role = 'Sales') {
  return render(<SalesDealStatusModal lead={value} currentUser={{ id: 'U1', role, username: 'Sales One' }} onClose={vi.fn()} onSaved={saved} />);
}
async function ready() { await waitFor(() => expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).not.toBeDisabled()); }
async function submit() {
  await ready(); fireEvent.change(screen.getByRole('combobox', { name: 'สถานะหลังจอง' }), { target: { value: 'contracted' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูล' }));
}
function edit(name: string, value: string) { fireEvent.change(screen.getByRole(name === 'ธนาคาร' ? 'combobox' : 'textbox', { name }), { target: { value } }); }
function save() { fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูล' })); }

describe('shared Lead / Project Map customer editor safety', () => {
  it('uses exact IDs, fresh notes and conditional versions without creating a booking', async () => {
    open(); await submit(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', expect.objectContaining({ crm_stage: 'contracted', contract_status: 'Contracted' }), { id: 'S1', crm_stage: 'booked', contract_status: 'Reserved', updated_at: 'sale-version-1' });
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Contracted', notes: expect.stringContaining('fresh notes from another activity') }), { id: 'L1', updated_at: 'version-1' });
    expect(mocks.write.mock.calls[1][1].notes).not.toContain('stale snapshot');
  });
  it('stops on a resolved sales error without writing lead state or reporting success', async () => {
    mocks.write.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    open(); await submit(); expect(await screen.findByRole('alert')).toHaveTextContent('denied');
    expect(mocks.write).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
  });
  it('resumes only the missing lead step after an acknowledged sales write', async () => {
    mocks.write.mockResolvedValueOnce({ data: { id: 'S1' }, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'lead failed' } });
    open(); await submit(); expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกบางส่วนแล้ว');
    expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).toBeDisabled(); expect(saved).not.toHaveBeenCalled();
    save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls.filter(call => call[0] === 'sales')).toHaveLength(1);
    expect(mocks.write.mock.calls.filter(call => call[0] === 'leads')).toHaveLength(2);
  });
  it('does not report success when conditional update returns no row', async () => {
    mocks.write.mockResolvedValueOnce({ data: null, error: null }); open(); await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบรายการขาย'); expect(saved).not.toHaveBeenCalled();
  });
  it('rejects a lead that has transferred since opening the dialog', async () => {
    open(); await ready(); mocks.read.mockResolvedValue({ data: { ...freshLead, status: 'Transferred' }, error: null });
    await submit(); expect(await screen.findByRole('alert')).toHaveTextContent('สถานะลูกค้าเปลี่ยนแล้ว'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rejects a sale that has been cancelled since opening the dialog', async () => {
    open(); await ready(); mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, contract_status: 'Cancelled' } }));
    await submit(); expect(await screen.findByRole('alert')).toHaveTextContent('สถานะรายการขายเปลี่ยนแล้ว'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('keeps Owner read-only while allowing authorized detail reads', async () => { open(lead, 'Owner'); await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument()); expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument(); expect(mocks.write).not.toHaveBeenCalled(); });
  it('does not treat a registry customer ID as a public lead ID', () => {
    open({ ...lead, leadId: '', saleId: '', id: 'registry-customer' });
    expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('stops pending reads from changing the form or starting writes after unmount', async () => {
    let resolve!: (value: unknown) => void; mocks.read.mockReturnValue(new Promise(accept => { resolve = accept; }));
    const view = open(); await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce()); view.unmount();
    await act(async () => resolve({ data: freshLead, error: null })); expect(mocks.write).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it('loads canonical profile, price and bank instead of stale parent values', async () => {
    open(); await ready(); expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).toHaveValue('Fresh Customer');
    expect(screen.getByRole('textbox', { name: 'ราคาขายสุทธิ' })).toHaveValue('2793000'); expect(screen.getByRole('combobox', { name: 'ธนาคาร' })).toHaveValue('ธนาคารเดิม');
    expect(screen.getByRole('button', { name: 'บันทึกข้อมูล' })).toBeDisabled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('saves profile, price, bank and note without advancing the stage or changing plot prices', async () => {
    open(); await ready(); edit('ชื่อลูกค้า', 'Edited Customer'); edit('เบอร์โทรศัพท์', '0899999999'); edit('อาชีพ', 'Engineer'); edit('ราคาขายสุทธิ', '2,650,000'); edit('ธนาคาร', 'กสิกรไทย'); edit('หมายเหตุสถานะ', 'Customer-specific change'); save();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', { sale_price: 2650000, bank_name: 'กสิกรไทย' }, expect.objectContaining({ id: 'S1' }));
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ customer_name: 'Edited Customer', phone: '0899999999', occupation: 'Engineer', notes: expect.stringContaining('Customer-specific change') }), expect.objectContaining({ id: 'L1' }));
    const patch = mocks.write.mock.calls.find(call => call[0] === 'leads')![1]; expect(patch).not.toHaveProperty('status'); expect(patch).not.toHaveProperty('crm_status');
    expect(mocks.write.mock.calls.every(call => ['leads', 'sales'].includes(call[0]))).toBe(true);
  });
  it('stores a lead-only deal in readable history, without creating a sale or guessing a plot', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ data: table === 'leads' ? { ...freshLead, notes: '• ราคาขายสุทธิ: ฿2,793,000 บาท\n• ธนาคาร: เดิม' } : [], error: null }));
    open({ ...lead, saleId: null }); await ready(); edit('ราคาขายสุทธิ', '2600000'); edit('ธนาคาร', 'ไทยพาณิชย์'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ notes: expect.stringContaining('• ราคาขายสุทธิ: ฿2,600,000 บาท\n• ธนาคาร: ไทยพาณิชย์') }), expect.objectContaining({ id: 'L1' }));
  });
  it('resolves a missing sale ID only through its explicit lead relationship', async () => {
    open({ ...lead, saleId: null }); await ready(); edit('ธนาคาร', 'กรุงเทพ'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.read).toHaveBeenCalledWith('sales', { lead_id: 'L1', 'neq:contract_status': 'Cancelled' }); expect(mocks.write.mock.calls[0][2].id).toBe('S1');
  });
  it('blocks an ambiguous linked sale instead of choosing a customer with the same name', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ data: table === 'leads' ? freshLead : [freshSale, { ...freshSale, id: 'S2' }], error: null }));
    open({ ...lead, saleId: null }); expect(await screen.findByRole('alert')).toHaveTextContent('พบหลายรายการขาย'); expect(screen.getByRole('button', { name: 'บันทึกข้อมูล' })).toBeDisabled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rejects a supplied sale linked to a different lead', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ data: table === 'leads' ? freshLead : { ...freshSale, lead_id: 'L2' }, error: null }));
    open(); expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ตรงกับลูกค้า'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not overwrite a price changed by another editor after opening', async () => {
    open(); await ready(); edit('ราคาขายสุทธิ', '2600000');
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, sale_price: 2800000 } }));
    save(); expect(await screen.findByRole('alert')).toHaveTextContent(/ราคา\/ธนาคารเปลี่ยนแล้ว|ข้อมูลถูกแก้ไขจากผู้ใช้อื่น/); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not overwrite another editor changing the same profile field', async () => {
    open(); await ready(); edit('ชื่อลูกค้า', 'My name'); mocks.read.mockResolvedValue({ data: { ...freshLead, customer_name: 'Other name' }, error: null });
    save(); expect(await screen.findByRole('alert')).toHaveTextContent(/ข้อมูล(ลูกค้า|ถูกแก้ไข)/); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('validates negative prices before starting writes', async () => {
    open(); await ready(); edit('ราคาขายสุทธิ', '-1'); save(); expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ติดลบ'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('preserves zero price and permits clearing bank without falling back to plot price', async () => {
    open(); await ready(); edit('ราคาขายสุทธิ', '0'); edit('ธนาคาร', ''); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls[0][1]).toEqual({ sale_price: 0, bank_name: null });
  });
  it('keeps unlinked sale profile read-only and permits separate history notes without guessing a lead', async () => {
    open({ ...lead, leadId: null }); await ready(); expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).toBeDisabled(); expect(screen.getByRole('textbox', { name: 'หมายเหตุสถานะ' })).toBeEnabled();
    edit('ธนาคาร', 'กรุงเทพ'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(mocks.write.mock.calls.every(call => call[0] === 'sales')).toBe(true);
  });
  it('repairs booked progress using the explicitly linked sale while preserving lead history', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, crm_stage: 'contracted', contract_status: 'Contracted' } }));
    open(); await ready(); expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).toHaveValue('contracted'); edit('หมายเหตุสถานะ', 'Align progress'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Contracted', crm_status: 'Contracted — ทำสัญญาแล้ว' }), expect.objectContaining({ id: 'L1' }));
  });
  it('offers the same project-map bank choices plus cash while keeping the saved legacy value', async () => {
    open(); await ready();
    const bank = screen.getByRole('combobox', { name: 'ธนาคาร' });
    expect(bank).toHaveValue('ธนาคารเดิม');
    for (const name of ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'ออมสิน', 'ธอส.', 'กรุงศรี', '💵 ซื้อเงินสด', 'ธนาคารเดิม']) {
      expect(within(bank).getByRole('option', { name })).toBeInTheDocument();
    }
    edit('ธนาคาร', 'กสิกรไทย');
    expect(within(bank).getByRole('option', { name: 'ธนาคารเดิม' })).toBeInTheDocument();
    edit('ธนาคาร', 'ธนาคารเดิม'); expect(bank).toHaveValue('ธนาคารเดิม');
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('saves the cash selection through the existing shared persistence path', async () => {
    open(); await ready(); edit('ธนาคาร', 'ซื้อเงินสด'); save();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls[0][1]).toEqual({ bank_name: 'ซื้อเงินสด', payment_method: 'cash' });
  });

});

function arrangeStage(stage: string, status = 'Contracted', method = 'mortgage', bank: string | null = 'กสิกรไทย') {
  mocks.read.mockImplementation((table: string, filters: Record<string, unknown>) => Promise.resolve({ error: null,
    data: table === 'leads' ? { ...freshLead, status, crm_status: stage === 'transfer_pending' ? 'Transfer Pending — รอโอน' : stage === 'loan_submitted' ? 'Loan Pre-Approval' : stage === 'document_prep' ? 'Contracted — เตรียมเอกสาร' : stage === 'loan_rejected' ? 'Contracted — สินเชื่อไม่ผ่าน รอยื่นใหม่' : stage === 'handover' ? 'Handover — ส่งมอบบ้านแล้ว' : status } : filters.lead_id ? [] : { ...freshSale, crm_stage: stage, contract_status: status, payment_method: method, bank_name: bank } }));
}
function choose(stage: string) { fireEvent.change(screen.getByRole('combobox', { name: 'สถานะหลังจอง' }), { target: { value: stage } }); }
function confirmEvent(date = '2026-10-09') { fireEvent.change(screen.getByLabelText('วันที่ทำรายการ'), { target: { value: date } }); fireEvent.click(screen.getByRole('checkbox', { name: 'ยืนยันรายการ' })); }
describe('shared terminal workflow and audit checkpoints', () => {
  it('requires a bank before submission without any writes', async () => {
    arrangeStage('document_prep', 'Contracted', 'mortgage', null); open(); await ready(); choose('loan_submitted'); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('เลือกธนาคาร'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('allows cash to skip loans and persists its method with the next stage', async () => {
    arrangeStage('contracted'); open(); await ready(); edit('ธนาคาร', 'ซื้อเงินสด');
    expect(within(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).queryByRole('option', { name: /Pre-Approval/ })).not.toBeInTheDocument();
    choose('transfer_pending'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', expect.objectContaining({ crm_stage: 'transfer_pending', payment_method: 'cash', bank_name: 'ซื้อเงินสด' }), expect.anything());
  });
  it('requires explicit confirmation then records transfer dates and audit for both records', async () => {
    arrangeStage('transfer_pending'); open(); await ready(); choose('transferred'); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('ยืนยัน'); expect(mocks.write).not.toHaveBeenCalled();
    confirmEvent(); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', expect.objectContaining({ crm_stage: 'transferred', contract_status: 'Transferred', transferred_at: '2026-10-09T05:00:00.000Z' }), expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Transferred', transferred_date: '2026-10-09T05:00:00.000Z' }), expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('status_history', expect.objectContaining({ entity_type: 'lead', entity_id: 'L1', old_status: 'transfer_pending', new_status: 'transferred' }), {});
  });
  it('permits only handover after transfer and records its own date', async () => {
    arrangeStage('transferred', 'Transferred'); open({ ...lead, status: 'Transferred', crmStage: 'transferred' }); await ready();
    expect(within(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(['transferred', 'handover']);
    choose('handover'); confirmEvent(); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', expect.objectContaining({ crm_stage: 'handover', crm_handover_at: '2026-10-09T05:00:00.000Z', contract_status: 'Transferred' }), expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Handover' }), expect.anything());
  });
  it('makes an already handed-over canonical sale read-only despite stale parent props', async () => {
    arrangeStage('handover', 'Transferred'); open({ ...lead, status: 'Transferred', crmStage: 'transferred' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument());
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('requires cancellation reason and reconfirmation after changing it', async () => {
    open(); await ready(); choose('cancelled'); confirmEvent(); save(); expect(await screen.findByRole('alert')).toHaveTextContent('เหตุผล');
    edit('เหตุผล', 'Customer stopped buying'); expect(screen.getByRole('checkbox', { name: 'ยืนยันรายการ' })).not.toBeChecked();
    fireEvent.change(screen.getByRole('combobox', { name: 'ประเภทการยกเลิก' }), { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'ยืนยันรายการ' })); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', expect.objectContaining({ contract_status: 'Cancelled', crm_stage: 'cancelled', cancellation_category: 'other', cancellation_reason: 'Customer stopped buying', cancelled_at: '2026-10-09T05:00:00.000Z' }), expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Cancelled', lost_reason: 'Customer stopped buying' }), expect.anything());
  });
  it('blocks lead-only terminal changes before updating anything', async () => {
    arrangeStage('booked', 'Booked'); open({ ...lead, saleId: null }); await ready(); choose('cancelled'); edit('เหตุผล', 'Cancel request'); confirmEvent(); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('ยังไม่มีรายการขาย'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('keeps a rejected mortgage active and preserves the reason in history', async () => {
    arrangeStage('loan_submitted'); open(); await ready(); choose('loan_rejected'); edit('เหตุผล', 'Missing income proof'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', { crm_stage: 'loan_rejected', contract_status: 'Contracted' }, expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Contracted', notes: expect.stringContaining('Missing income proof') }), expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('status_history', expect.objectContaining({ old_status: 'loan_submitted', new_status: 'loan_rejected', changed_by: expect.stringContaining('Missing income proof') }), {});
  });
  it('returns rejection to document prep without cancelling or overwriting previous notes', async () => {
    arrangeStage('loan_rejected'); open(); await ready(); choose('document_prep'); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', { crm_stage: 'document_prep', contract_status: 'Contracted' }, expect.anything());
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ notes: expect.stringContaining('fresh notes from another activity') }), expect.anything());
  });
  it('retries failed audit only after both business writes have been acknowledged', async () => {
    let failures = 1; mocks.write.mockImplementation((table: string) => Promise.resolve(table === 'status_history' && failures-- > 0 ? { data: null, error: { message: 'audit denied' } } : { data: { id: table === 'leads' ? 'L1' : table === 'sales' ? 'S1' : 'H1' }, error: null }));
    arrangeStage('transfer_pending'); open(); await ready(); choose('transferred'); confirmEvent(); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกบางส่วนแล้ว'); expect(saved).not.toHaveBeenCalled(); save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls.map(c => c[0])).toEqual(['sales', 'leads', 'status_history', 'status_history']);
  });
  it.each(['project_interest_id', 'external_booking_id'])('does not attempt direct writes to a protected CRM sale: %s', key => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, [key]: 'CRM1' } }));
    open(); return screen.findByRole('region', { name: 'รายละเอียดรายการขาย CRM' }).then(details => { expect(details).toHaveTextContent('ป้องกันการเขียนโดยตรง'); expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument(); expect(mocks.write).not.toHaveBeenCalled(); });
  });
  it('blocks cash changes while still in a loan stage', async () => {
    arrangeStage('loan_submitted'); open(); await ready(); edit('ธนาคาร', 'ซื้อเงินสด'); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('สถานะสินเชื่อไม่ตรง'); expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe('protected CRM details and bounded server entry', () => {
  it.each(['contracted', 'transferred', 'cancelled'])('reads an old %s customer without creating a Lead or completing unknown steps', async stage => {
    mocks.read.mockResolvedValue({ error: null, data: { ...freshSale, lead_id: null, crm_stage: stage, project_interest_id: 'I1' } });
    mocks.context.mockResolvedValue({ actor: { userId: 'U1', role: 'sales' },
      customer: { id: 'C1', name: 'Historical Customer', phone: '0811111111' },
      deal: { id: 'S1', stage, salePrice: 0, bankName: 'Canonical Bank', paymentMethod: null },
      history: customerHistoryTimeline({}, undefined, { booked: '2024-03-01' }) });
    open({ ...lead, leadId: null, project_name: 'Project A', crmStage: stage });
    expect(await screen.findByText('Historical Customer')).toBeInTheDocument();
    expect(screen.getByText('Canonical Bank')).toBeInTheDocument(); expect(screen.getByText('01/03/2567')).toBeInTheDocument();
    expect(screen.getAllByText('ไม่มีบันทึกเดิม')).toHaveLength(6);
    expect(mocks.context).toHaveBeenCalledWith({ saleId: 'S1', projectName: 'Project A' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.read.mock.calls.map(call => call[0])).toEqual(['sales']);
    expect(mocks.write).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument();
  });
  it('does not borrow an unrelated Lead profile if canonical CRM reading fails', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, lead_id: 'other', project_interest_id: 'I1' } }));
    open(); expect(await screen.findByRole('alert')).toHaveTextContent('ยังโหลดไม่ได้');
    const details = screen.getByRole('region', { name: 'รายละเอียดรายการขาย CRM' });
    expect(details).not.toHaveTextContent('Fresh Customer'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('shows canonical price and bank without exposing an editable form or unavailable link', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, project_interest_id: 'I1', sale_price: 0, payment_method: 'cash' } }));
    open(); const details = await screen.findByRole('region', { name: 'รายละเอียดรายการขาย CRM' });
    expect(within(details).getByText('0 บาท')).toBeInTheDocument(); expect(within(details).getByText('ธนาคารเดิม')).toBeInTheDocument(); expect(within(details).getByText('เงินสด')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not turn missing payment evidence into an assumed mortgage', async () => {
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, external_booking_id: 'E1', payment_method: null } }));
    open(); expect(await screen.findByText('ยังไม่มีหลักฐานวิธีชำระเงิน')).toBeInTheDocument(); expect(screen.queryByText('กู้ธนาคาร')).not.toBeInTheDocument();
  });
  it('uses the verified sale ID for the server link only when the existing gate is enabled', async () => {
    const saleId = '21000000-0000-4000-8000-000000000001';
    mocks.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === 'leads' ? freshLead : { ...freshSale, id: saleId, project_interest_id: 'I1', payment_method: 'mortgage' } }));
    render(<SalesWorkspaceModeProvider postBookingEnabled><SalesDealStatusModal lead={{ ...lead, saleId }} currentUser={{ id: 'U1', role: 'Sales' }} onClose={vi.fn()} onSaved={saved} /></SalesWorkspaceModeProvider>);
    expect(await screen.findByRole('link', { name: 'เปิดประวัติและงานหลังจอง →' })).toHaveAttribute('href', '/sales-crm/post-booking?saleId=' + saleId);
    expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument(); expect(mocks.write).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it('discards a protected-sale read when the account changes', async () => {
    let resolve!: (value: unknown) => void;
    let saleReads = 0;
    mocks.read.mockImplementation((table: string) => table === 'leads' ? Promise.resolve({ data: freshLead, error: null }) : ++saleReads === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve({ data: null, error: { message: 'fixture new-account read denied' } }));
    const view = open(); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    view.rerender(<SalesDealStatusModal lead={lead} currentUser={{ id: 'U2', role: 'Owner' }} onClose={vi.fn()} onSaved={saved} />);
    await act(async () => resolve({ data: { ...freshSale, project_interest_id: 'I1' }, error: null }));
    expect(screen.queryByRole('region', { name: 'รายละเอียดรายการขาย CRM' })).not.toBeInTheDocument(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('resolves legacy unlinked sale via plot fallback and allows saving transferred stage', async () => {
    const legacySale = { id: 'legacy-S99', lead_id: null, plot_id: 'plot-21', booking_route: 'legacy_import', project_interest_id: 'pi-1', external_booking_id: 'eb-1', crm_stage: 'booked', contract_status: 'Reserved', sale_price: 2899000, bank_name: 'ธอส.', updated_at: 'legacy-1' };
    const leadWithPlot = { id: 'L99', customer_name: 'Legacy KFC', phone: '0812345678', occupation: 'ผจก KFC', status: 'Contracted', crm_status: 'Transfer Pending — รอโอน', notes: 'deal notes', interested_plot_id: 'plot-21', project_name: 'ไอลิน6', updated_at: 'lead-v1' };
    mocks.read.mockImplementation((table: string, filters: Record<string, unknown>) => {
      if (table === 'leads') return Promise.resolve({ error: null, data: { ...leadWithPlot } });
      if (table === 'sales') {
        if (filters.lead_id) return Promise.resolve({ error: null, data: [] });
        if (filters.plot_id === 'plot-21') return Promise.resolve({ error: null, data: [{ ...legacySale }] });
        if (filters.id === 'legacy-S99') return Promise.resolve({ error: null, data: { ...legacySale } });
      }
      return Promise.resolve({ error: null, data: null });
    });
    mocks.write.mockResolvedValue({ error: null, data: { id: 'saved' } });

    render(<SalesDealStatusModal lead={{ leadId: 'L99', plotId: 'plot-21', project_name: 'ไอลิน6', status: 'Contracted' }} currentUser={{ id: 'U1', role: 'Sales' }} onClose={vi.fn()} onSaved={saved} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).not.toBeDisabled());
    expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).toHaveValue('transfer_pending');
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะหลังจอง' }), { target: { value: 'transferred' } });
    const checkbox = screen.getByRole('checkbox', { name: 'ยืนยันรายการ' });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูล' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith('sales', expect.objectContaining({ crm_stage: 'transferred', contract_status: 'Transferred' }), expect.objectContaining({ id: 'legacy-S99' }));
    expect(mocks.write).toHaveBeenCalledWith('leads', expect.objectContaining({ status: 'Transferred' }), expect.objectContaining({ id: 'L99' }));
  });
});
