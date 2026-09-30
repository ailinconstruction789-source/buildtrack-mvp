import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { toDataURL } = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL } }));
import CustomerVoicesWorkspace from '../CustomerVoicesWorkspace';
import { CustomerVoicesApiError, type CustomerVoicesApi } from '@/lib/sales/customerVoicesClient';
import type { VoiceSnapshot, VoiceStaffResult } from '@/lib/sales/customerVoicesContracts';
import { voiceAnswers, voiceId, voiceResult, voiceScope, voiceSnapshot } from '@/lib/sales/__tests__/customerVoicesFixtures';
const now = new Date('2026-09-24T10:00:00Z').getTime();
const withToken = (id = voiceId(40), expiresAt = '2026-09-25T10:00:00Z') => ({ ...voiceSnapshot(), activeToken: { id, expiresAt } });
const completed = () => { const snapshot = voiceSnapshot(); snapshot.visit.status = 'completed'; snapshot.visit.completedAt = '2026-09-24T10:05:00Z'; snapshot.scope.canManage = false;
  snapshot.submission = { submittedAt: snapshot.visit.completedAt, answers: { ...voiceAnswers(), monthly_income: 'รายได้ส่วนบุคคลสังเคราะห์' } }; return snapshot; };
const apiFor = () => ({ read: vi.fn<CustomerVoicesApi['read']>().mockResolvedValue(voiceSnapshot()), save: vi.fn<CustomerVoicesApi['save']>().mockImplementation(async input => voiceResult(input)),
  watchIdentity: vi.fn<NonNullable<CustomerVoicesApi['watchIdentity']>>().mockReturnValue(vi.fn()) });
const mount = (api: CustomerVoicesApi) => render(<CustomerVoicesWorkspace scope={voiceScope()} api={api} />);
async function issue() {
  const reason = await screen.findByLabelText('เหตุผลในการออก / ยกเลิก QR *'); fireEvent.change(reason, { target: { value: 'ลูกค้าขอแบบประเมิน' } });
  await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'จัดการ QR Customer Voices' })); });
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now); toDataURL.mockResolvedValue('data:image/png;base64,c3ludGhldGlj'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Visit Customer Voices staff management', () => {
  it('shows actual Visit, central navigation and no automatic completion or issuance', async () => {
    const api = apiFor(); mount(api); await screen.findByText('ลูกค้าสังเคราะห์'); expect(screen.getByText(/Visit จะสำเร็จเมื่อลูกค้าส่ง/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'กลับนัดหมาย / เข้าชม' })).toHaveAttribute('href', `/sales-crm/visits?customerId=${voiceId(1)}&interestId=${voiceId(2)}`);
    expect(screen.getByLabelText('เหตุผลในการออก / ยกเลิก QR *')).toHaveValue(''); expect(api.save).not.toHaveBeenCalled(); expect(toDataURL).not.toHaveBeenCalled();
  });
  it('requires reason, creates a 256-bit capability and waits for matching fresh context before QR', async () => {
    const api = apiFor(); let resolve!: (snapshot: VoiceSnapshot) => void;
    api.read.mockResolvedValueOnce(voiceSnapshot()).mockImplementationOnce(() => new Promise(done => { resolve = done; })); mount(api);
    await screen.findByRole('form'); fireEvent.submit(screen.getByRole('form')); expect(api.save).not.toHaveBeenCalled(); await issue();
    const [input, actor] = api.save.mock.calls[0]; expect(actor).toBe(voiceId(5)); expect(input).toMatchObject({ ...voiceScope(), command: 'issue', expectedTokenId: null, expectedInterestRevision: voiceId(20), expectedVisitRevision: voiceId(30) });
    expect(input.token).toMatch(/^[a-f0-9]{64}$/); expect(Object.isFrozen(input)).toBe(true); expect(toDataURL).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await act(async () => resolve(withToken())); expect(await screen.findByRole('img', { name: 'QR แบบประเมิน Customer Voices' })).toHaveAttribute('src', 'data:image/png;base64,c3ludGhldGlj');
    expect(toDataURL).toHaveBeenCalledWith(`${window.location.origin}/customer-voices#token=${input.token}`, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
    expect(document.body.innerHTML).not.toContain(input.token!);
  });
  it('never exposes token on a mismatched fresh active ID', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(voiceSnapshot()).mockResolvedValueOnce(withToken(voiceId(99))); mount(api); await issue();
    expect(screen.queryByRole('region', { name: 'QR สำหรับลูกค้า' })).not.toBeInTheDocument(); expect(toDataURL).not.toHaveBeenCalled();
  });
  it('separates successful issuance from failed refresh; reload never resends', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(voiceSnapshot()).mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(withToken()); mount(api); await issue();
    expect(screen.getByText(/ออก QR สำเร็จแล้ว/)).toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' })); }); await screen.findByRole('img'); expect(api.save).toHaveBeenCalledOnce();
  });
  it('blocks double-clicks, navigation and unload while writing without storing token anywhere', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'), api = apiFor(); let resolve!: (result: VoiceStaffResult) => void;
    api.save.mockImplementation(() => new Promise(done => { resolve = done; })); const view = mount(api); await issue(); fireEvent.submit(screen.getByRole('form')); expect(api.save).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'ออก QR ให้ลูกค้า' })).toBeDisabled(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true); expect(storage).not.toHaveBeenCalled();
    view.unmount(); await act(async () => resolve(voiceResult(api.save.mock.calls[0][0])));
  });
  it('freezes uncertain command across later forbidden results and never auto-retries or reveals QR', async () => {
    const api = apiFor(); api.save.mockRejectedValueOnce(new Error('secret')).mockRejectedValueOnce(new CustomerVoicesApiError('FORBIDDEN', 403)); mount(api); await issue(); const original = api.save.mock.calls[0][0];
    expect(screen.getByLabelText('เหตุผลในการออก / ยกเลิก QR *')).toBeDisabled(); expect(api.save).toHaveBeenCalledOnce();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })); }); expect(api.save.mock.calls[1][0]).toBe(original);
    expect(screen.getByRole('region', { name: 'คำขอ QR ค้าง' })).toBeInTheDocument(); expect(toDataURL).not.toHaveBeenCalled(); expect(document.body.innerHTML).not.toContain(original.token!);
  });
  it('does not recover or auto-send memory-only receipt on remount; explicit rotation binds latest ID', async () => {
    const first = apiFor(); first.save.mockRejectedValueOnce(new Error('unknown')); const view = mount(first); await issue(); const original = first.save.mock.calls[0][0]; view.unmount();
    const next = apiFor(); next.read.mockResolvedValue(withToken()); mount(next); await screen.findByRole('button', { name: 'ออก QR ใหม่และยกเลิกอันเดิม' });
    expect(next.save).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.getByText(/ระบบไม่เก็บลิงก์ลับไว้/)).toBeInTheDocument();
    await issue(); expect(next.save.mock.calls[0][0]).toMatchObject({ expectedTokenId: voiceId(40) }); expect(next.save.mock.calls[0][0].token).not.toBe(original.token);
  });
  it('allows correcting only a definitive first rejection', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new CustomerVoicesApiError('INVALID_INPUT', 400)); mount(api); await issue();
    expect(screen.queryByRole('region', { name: 'คำขอ QR ค้าง' })).not.toBeInTheDocument(); expect(screen.getByLabelText('เหตุผลในการออก / ยกเลิก QR *')).not.toBeDisabled();
  });
  it('revokes the exact active token without transmitting its secret and removes the QR immediately', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(voiceSnapshot()).mockResolvedValueOnce(withToken()).mockResolvedValueOnce(voiceSnapshot()); mount(api); await issue(); await screen.findByRole('img');
    fireEvent.change(screen.getByLabelText('เหตุผลในการออก / ยกเลิก QR *'), { target: { value: 'ไม่ใช้แล้ว' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก QR ปัจจุบัน' })); });
    expect(api.save.mock.calls[1][0]).toMatchObject({ command: 'revoke', token: null, expectedTokenId: voiceId(40), reason: 'ไม่ใช้แล้ว' }); expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('ยกเลิก QR แล้ว ลิงก์เดิมใช้ไม่ได้')).toBeInTheDocument();
  });
  it('only current Sales and Admin manage QR; Owner and other Sales remain read-only', async () => {
    for (const role of ['owner', 'other_sales', 'admin'] as const) {
      const api = apiFor(), snapshot = voiceSnapshot(); snapshot.actor.role = role === 'other_sales' ? 'sales' : role;
      if (role === 'other_sales') snapshot.scope.ownerUserId = voiceId(99); snapshot.scope.canManage = role === 'admin'; api.read.mockResolvedValue(snapshot); mount(api); await screen.findByText('ลูกค้าสังเคราะห์');
      expect(!!screen.queryByRole('form')).toBe(role === 'admin'); cleanup();
    }
  });
  it('shows readonly privileged answers and computes mean from all eight; other Sales sees metadata only', async () => {
    const api = apiFor(); api.read.mockResolvedValue(completed()); mount(api); expect(await screen.findByText('คะแนนเฉลี่ย 4.00 / 5')).toBeInTheDocument();
    expect(screen.getByText('รายได้ส่วนบุคคลสังเคราะห์')).toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument(); cleanup();
    const restricted = completed(); restricted.actor.userId = voiceId(99); restricted.submission!.answers = null; api.read.mockResolvedValue(restricted); mount(api);
    expect(await screen.findByText('สิทธิ์นี้เห็นสถานะส่งแล้วเท่านั้น ไม่แสดงคำตอบหรือข้อมูลส่วนบุคคล')).toBeInTheDocument(); expect(screen.queryByText('รายได้ส่วนบุคคลสังเคราะห์')).not.toBeInTheDocument(); expect(screen.queryByText(/คะแนนเฉลี่ย/)).not.toBeInTheDocument();
  });
  it('hides all previous sensitive fields immediately on account change and discards late QR generation', async () => {
    const api = apiFor(); let changed!: () => void, qrResolve!: (image: string) => void, readResolve!: (snapshot: VoiceSnapshot) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); });
    api.read.mockResolvedValueOnce(voiceSnapshot()).mockResolvedValueOnce(withToken()).mockImplementationOnce(() => new Promise(done => { readResolve = done; }));
    toDataURL.mockImplementationOnce(() => new Promise(done => { qrResolve = done; })); mount(api); await issue();
    await screen.findByRole('region', { name: 'QR สำหรับลูกค้า' }); act(() => changed()); expect(screen.queryByText('ลูกค้าสังเคราะห์')).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'QR สำหรับลูกค้า' })).not.toBeInTheDocument();
    const other = completed(); other.actor.userId = voiceId(99); other.submission!.answers = null;
    await act(async () => { readResolve(other); qrResolve('data:image/png;base64,c3ludGhldGlj'); }); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('discards a late issuance receipt after identity changes, without leaking pending capability', async () => {
    const api = apiFor(); let changed!: () => void, resolve!: (result: VoiceStaffResult) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); }); api.save.mockImplementation(() => new Promise(done => { resolve = done; }));
    const other = voiceSnapshot(); other.actor = { userId: voiceId(99), role: 'owner' }; other.scope.canManage = false;
    api.read.mockResolvedValueOnce(voiceSnapshot()).mockResolvedValueOnce(other); mount(api); await issue(); const input = api.save.mock.calls[0][0];
    await act(async () => changed()); expect(screen.queryByRole('region', { name: 'คำขอ QR ค้าง' })).not.toBeInTheDocument(); await act(async () => resolve(voiceResult(input)));
    expect(toDataURL).not.toHaveBeenCalled(); expect(screen.queryByText(/ออก QR สำเร็จแล้ว/)).not.toBeInTheDocument();
  });
  it('hides an issued QR after external completion is freshly read', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(voiceSnapshot()).mockResolvedValueOnce(withToken()).mockResolvedValueOnce(completed()); mount(api); await issue(); await screen.findByRole('img');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ตรวจสถานะล่าสุด' })); }); expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.getByText('คะแนนเฉลี่ย 4.00 / 5')).toBeInTheDocument();
  });
  it('expires QR with time, reloads once, and does not loop if server still returns expired metadata', async () => {
    vi.restoreAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); const api = apiFor(); const expiring = withToken(voiceId(40), new Date(now + 1000).toISOString());
    api.read.mockResolvedValueOnce(voiceSnapshot()).mockResolvedValue(expiring); await act(async () => { mount(api); });
    fireEvent.change(screen.getByLabelText('เหตุผลในการออก / ยกเลิก QR *'), { target: { value: 'ออก QR' } }); await act(async () => { fireEvent.submit(screen.getByRole('form')); });
    expect(screen.getByRole('img')).toBeInTheDocument(); await act(async () => { vi.advanceTimersByTime(1001); });
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(api.read).toHaveBeenCalledTimes(3); await act(async () => { vi.advanceTimersByTime(60000); }); expect(api.read).toHaveBeenCalledTimes(3);
  });
  it('ignores old Visit reads after scope changes', async () => {
    const api = apiFor(); let resolve!: (snapshot: VoiceSnapshot) => void; api.read.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const view = mount(api);
    const next = voiceSnapshot(); next.scope.visitId = voiceId(99); next.scope.customerName = 'บริบทใหม่'; api.read.mockResolvedValueOnce(next);
    view.rerender(<CustomerVoicesWorkspace scope={{ ...voiceScope(), visitId: voiceId(99) }} api={api} />); await screen.findByText('บริบทใหม่');
    await act(async () => resolve(voiceSnapshot())); expect(screen.queryByText('ลูกค้าสังเคราะห์')).not.toBeInTheDocument();
  });
});
