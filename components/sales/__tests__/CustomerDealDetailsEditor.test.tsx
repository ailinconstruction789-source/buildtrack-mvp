import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDealEditInput, CustomerDealEditSnapshot } from '@/lib/sales/customerDealEditContracts';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), pendingRead: vi.fn(), pendingWrite: vi.fn(), pendingClear: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/sales/customerDealEditClient', () => ({
  customerDealEditApi: { read: mocks.read, save: mocks.save },
  CustomerDealEditApiError: class extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); }
    get definitelyNotSaved() { return this.code === 'STALE_STATE' && this.status === 409; }
  },
}));
vi.mock('@/lib/sales/customerDealEditPending', () => ({ readCustomerDealEditPending: mocks.pendingRead,
  writeCustomerDealEditPending: mocks.pendingWrite, clearCustomerDealEditPending: mocks.pendingClear }));
import CustomerDealDetailsEditor from '../CustomerDealDetailsEditor';
import { CustomerDealEditApiError } from '@/lib/sales/customerDealEditClient';
import { SALES_BANK_NAMES } from '@/lib/sales/banks';

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const actor = id(1), other = id(2), saleId = id(3), customerId = id(4), projectName = 'โครงการทดสอบ';
function snapshot(): CustomerDealEditSnapshot {
  return { actor: { userId: actor, role: 'sales' }, customer: { id: customerId, ownerUserId: actor, revision: id(5), detailsRevision: null,
    name: 'ลูกค้าเดิม', phone: '0812345678', occupation: null, canEdit: true, sourceName: 'ชื่อต้นทาง', sourcePhone: null },
  deal: { id: saleId, customerId, interestId: id(6), ownerUserId: actor, projectName, plotId: 'A1', stage: 'booked',
    revision: id(7), interestRevision: id(8), detailsRevision: null, salePrice: 2300000.25, sourceSalePrice: 2400000,
    bankName: 'ธนาคารจากระบบเก่า', sourceBankName: null, paymentMethod: 'mortgage', canEdit: true } };
}
function input(): CustomerDealEditInput {
  return { requestId: id(9), command: 'update_details', customerId, saleId, projectName, expectedCustomerRevision: id(5),
    expectedInterestRevision: id(8), expectedSaleRevision: id(7), expectedCustomerDetailsRevision: null, expectedDealDetailsRevision: null,
    reason: 'ตรวจข้อมูลแล้ว', profile: { name: 'ชื่อใหม่', phone: '0812345678', occupation: null }, dealDetails: null };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const form = () => screen.getByRole('form', { name: 'แก้ข้อมูลลูกค้า ราคา และธนาคาร' });
const submit = () => fireEvent.submit(form());
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function show(value = snapshot(), props: Partial<React.ComponentProps<typeof CustomerDealDetailsEditor>> = {}) {
  mocks.read.mockResolvedValue(value);
  const onSaved = vi.fn(), onBusyChange = vi.fn();
  const rendered = render(<CustomerDealDetailsEditor saleId={saleId} projectName={projectName} currentUserId={actor} onSaved={onSaved} onBusyChange={onBusyChange} {...props} />);
  await screen.findByRole('form', { name: 'แก้ข้อมูลลูกค้า ราคา และธนาคาร' }); return { ...rendered, onSaved, onBusyChange };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.pendingRead.mockReturnValue(null); mocks.pendingWrite.mockImplementation((_actor, value) => value);
  mocks.pendingClear.mockImplementation(() => undefined); mocks.save.mockResolvedValue({});
});
afterEach(cleanup);

describe('canonical customer and deal details editor', () => {
  it('loads exact sale/project with an abort signal and preserves source and unknown bank', async () => {
    await show();
    expect(mocks.read).toHaveBeenCalledWith({ saleId, projectName }, { signal: expect.any(AbortSignal) });
    expect(screen.getByLabelText('ธนาคาร')).toHaveValue('ธนาคารจากระบบเก่า');
    expect(screen.getByText(/ราคาจากต้นทาง: 2,400,000.00 บาท/)).toHaveTextContent('ราคาปัจจุบัน: 2,300,000.25 บาท');
    for (const bank of SALES_BANK_NAMES) expect(screen.getByRole('option', { name: bank })).toBeInTheDocument();
    expect(screen.getByText(/ใช้ร่วมกันทุกโครงการ/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('submits changed profile and integer satang with exact revisions and no workflow fields', async () => {
    const { onSaved } = await show();
    change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('อาชีพ', 'พนักงาน'); change('ราคาสุทธิปัจจุบัน (บาท)', '2500000.01');
    change('ธนาคาร', SALES_BANK_NAMES[0]); change('เหตุผลที่แก้ไข *', 'ตรวจเอกสารแล้ว'); submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const command = mocks.save.mock.calls[0][0];
    expect(command).toEqual({ ...input(), requestId: expect.any(String), reason: 'ตรวจเอกสารแล้ว',
      profile: { name: 'ชื่อใหม่', phone: '0812345678', occupation: 'พนักงาน' }, dealDetails: { salePriceSatang: 250000001, bankName: SALES_BANK_NAMES[0] } });
    expect(command).not.toHaveProperty('stage'); expect(command).not.toHaveProperty('paymentMethod'); expect(command).not.toHaveProperty('occurredAt');
    expect(mocks.pendingWrite).toHaveBeenCalledWith(actor, command); expect(mocks.pendingClear).toHaveBeenCalledWith(actor, command);
  });
  it('sends a profile-only change without writing unchanged price or bank', async () => {
    await show(); change('เบอร์โทร', ''); change('เหตุผลที่แก้ไข *', 'เบอร์เก่ายังไม่ยืนยัน'); submit();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ profile: { name: 'ลูกค้าเดิม', phone: null, occupation: null }, dealDetails: null });
  });
  it('blank price and bank explicitly mean unknown without changing payment method', async () => {
    await show(); change('ราคาสุทธิปัจจุบัน (บาท)', ''); change('ธนาคาร', ''); change('เหตุผลที่แก้ไข *', 'ข้อมูลยังไม่ยืนยัน'); submit();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ profile: null, dealDetails: { salePriceSatang: null, bankName: null } });
  });
  it.each(['1e6', '10.005', '-1', '01', '0'])('never sends invalid money %s', async value => {
    await show(); change('ราคาสุทธิปัจจุบัน (บาท)', value); change('เหตุผลที่แก้ไข *', 'ตรวจราคา'); submit();
    expect(mocks.save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('requires an actual change and a reason before storing a command', async () => {
    await show(); change('เหตุผลที่แก้ไข *', 'ตรวจราคา'); submit(); expect(screen.getByRole('alert')).toHaveTextContent('ยังไม่มีข้อมูลที่เปลี่ยนแปลง');
    change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', ''); submit();
    expect(mocks.pendingWrite).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('enforces profile and deal permissions independently even on synthetic submit', async () => {
    const value = snapshot(); value.customer.canEdit = false;
    await show(value); change('ชื่อลูกค้า *', 'ห้ามแก้'); change('ธนาคาร', SALES_BANK_NAMES[1]); change('เหตุผลที่แก้ไข *', 'เปลี่ยนธนาคาร'); submit();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(screen.getByLabelText('ชื่อลูกค้า *')).toBeDisabled(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ profile: null });
  });
  it('lets a permitted profile edit on a transferred deal keep price and bank unchanged', async () => {
    const value = snapshot(); value.deal.stage = 'transferred'; value.deal.canEdit = true;
    await show(value); change('ราคาสุทธิปัจจุบัน (บาท)', '2000000'); change('ชื่อลูกค้า *', 'ชื่อยืนยันแล้ว'); change('เหตุผลที่แก้ไข *', 'แก้ชื่อ'); submit();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(screen.getByLabelText('ราคาสุทธิปัจจุบัน (บาท)')).toBeDisabled(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ dealDetails: null });
  });
  it.each(['owner', 'other-sales', 'no-permission'])('blocks all writes for %s', async restriction => {
    const value = snapshot();
    if (restriction === 'owner') value.actor.role = 'owner';
    if (restriction === 'other-sales') { value.customer.ownerUserId = other; value.deal.ownerUserId = other; }
    if (restriction === 'no-permission') { value.customer.canEdit = false; value.deal.canEdit = false; }
    await show(value); change('ชื่อลูกค้า *', 'ห้ามแก้'); change('เหตุผลที่แก้ไข *', 'ไม่อนุญาต'); submit();
    expect(mocks.save).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า ราคา และธนาคาร' })).toBeDisabled();
  });
  it('shows unavailable without a direct write fallback and lets read-only reload retry', async () => {
    mocks.read.mockRejectedValueOnce(new CustomerDealEditApiError('FEATURE_DISABLED', 'ยังไม่เปิดใช้งาน', 503)).mockResolvedValue(snapshot());
    render(<CustomerDealDetailsEditor saleId={saleId} projectName={projectName} onSaved={vi.fn()} />);
    await screen.findByText('ยังไม่เปิดใช้งาน'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' })); await screen.findByRole('form'); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['sale', 'project', 'actor'])('hides a mismatched %s snapshot', async kind => {
    const value = snapshot(); if (kind === 'sale') value.deal.id = id(30); if (kind === 'project') value.deal.projectName = 'โครงการอื่น'; if (kind === 'actor') value.actor.userId = other;
    mocks.read.mockResolvedValue(value); render(<CustomerDealDetailsEditor saleId={saleId} projectName={projectName} currentUserId={actor} onSaved={vi.fn()} />);
    await screen.findByText(/บัญชีหรือรายการเปลี่ยนระหว่างโหลด/); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(mocks.pendingRead).not.toHaveBeenCalled();
  });
  it('makes a double submit one immutable command and blocks close/navigation while unresolved', async () => {
    const write = deferred<unknown>(); mocks.save.mockReturnValue(write.promise);
    const { onBusyChange } = await show(); change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit(); submit();
    expect(mocks.save).toHaveBeenCalledTimes(1); expect(onBusyChange).toHaveBeenLastCalledWith(true);
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await act(async () => write.resolve({}));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });
  it('keeps an uncertain command immutable and retries the same ID and payload', async () => {
    mocks.save.mockRejectedValueOnce(new Error('ยังยืนยันผลไม่ได้')).mockResolvedValue({});
    const { onSaved } = await show(); change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit();
    await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }); expect(mocks.pendingClear).not.toHaveBeenCalled();
    const original = mocks.save.mock.calls[0][0]; change('ชื่อลูกค้า *', 'ชื่อหลังส่ง');
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1)); expect(mocks.save.mock.calls[1]).toEqual([original, actor]);
  });
  it('does not clear a recovered uncertain request after a definitive retry failure', async () => {
    mocks.pendingRead.mockReturnValue(input()); mocks.save.mockRejectedValue(new CustomerDealEditApiError('STALE_STATE', 'ข้อมูลเปลี่ยน', 409));
    await show(); fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })); await screen.findByText('ข้อมูลเปลี่ยน');
    expect(mocks.pendingClear).not.toHaveBeenCalled(); expect(screen.getByLabelText('ชื่อลูกค้า *')).toBeDisabled();
  });
  it('clears only a fresh command proved not saved and allows correction', async () => {
    mocks.save.mockRejectedValue(new CustomerDealEditApiError('STALE_STATE', 'ข้อมูลเปลี่ยน', 409));
    await show(); change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit(); await screen.findByText('ข้อมูลเปลี่ยน');
    expect(mocks.pendingClear).toHaveBeenCalledTimes(1); expect(screen.queryByLabelText('คำขอแก้ข้อมูลค้าง')).not.toBeInTheDocument();
  });
  it('recovers the same actor command for another sale without rewriting its target', async () => {
    const original = { ...input(), saleId: id(33), projectName: 'โครงการเดิม' }; mocks.pendingRead.mockReturnValue(original);
    await show(); expect(screen.getByText(/คำขอนี้เป็นของรายการอื่น/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(original, actor));
  });
  it('does not send when the write-ahead receipt cannot be stored', async () => {
    mocks.pendingWrite.mockImplementation(() => { throw new Error('เก็บคำขอไม่ได้'); });
    const { onBusyChange } = await show(); change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit(); await screen.findByText('เก็บคำขอไม่ได้');
    expect(mocks.save).not.toHaveBeenCalled(); expect(onBusyChange).toHaveBeenLastCalledWith(true);
  });
  it('never retries after a successful write whose pending cleanup failed', async () => {
    mocks.pendingClear.mockImplementation(() => { throw new Error('ล้างคำขอไม่ได้'); });
    const { onSaved } = await show(); change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit();
    await screen.findByText(/บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ/); expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })); expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it('does not turn a parent refresh failure into an uncertain write', async () => {
    await show(snapshot(), { onSaved: () => { throw new Error('refresh failed'); } });
    change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit(); await screen.findByText(/กรุณาเปิดรายการใหม่เพื่ออ่านข้อมูลล่าสุด/);
    expect(mocks.pendingClear).toHaveBeenCalledTimes(1); expect(screen.queryByLabelText('คำขอแก้ข้อมูลค้าง')).not.toBeInTheDocument();
  });
  it('aborts an old read and suppresses its data when the account changes', async () => {
    const old = deferred<CustomerDealEditSnapshot>(); mocks.read.mockReturnValueOnce(old.promise).mockResolvedValue({ ...snapshot(), actor: { userId: other, role: 'owner' } });
    const props = { saleId, projectName, onSaved: vi.fn() }; const view = render(<CustomerDealDetailsEditor {...props} currentUserId={actor} />);
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<CustomerDealDetailsEditor {...props} currentUserId={other} />); await screen.findByRole('form');
    await act(async () => old.resolve({ ...snapshot(), customer: { ...snapshot().customer, name: 'ข้อมูลบัญชีเก่า' } }));
    expect(signal.aborted).toBe(true); expect(screen.getByLabelText('ชื่อลูกค้า *')).not.toHaveValue('ข้อมูลบัญชีเก่า');
  });
  it('suppresses callbacks after unmount while still clearing a proved successful receipt', async () => {
    const write = deferred<unknown>(); mocks.save.mockReturnValue(write.promise);
    const { onSaved, unmount } = await show(); change('ชื่อลูกค้า *', 'ชื่อใหม่'); change('เหตุผลที่แก้ไข *', 'ตรวจชื่อ'); submit(); unmount();
    await act(async () => write.resolve({})); expect(onSaved).not.toHaveBeenCalled(); expect(mocks.pendingClear).toHaveBeenCalledTimes(1);
  });
});
