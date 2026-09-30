import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerVoicePublic from '../CustomerVoicePublic';
import { CustomerVoicesApiError, type CustomerVoicePublicApi } from '@/lib/sales/customerVoicesClient';
import { VOICE_SCORES, type VoicePublicResult } from '@/lib/sales/customerVoicesContracts';
import { voiceToken } from '@/lib/sales/__tests__/customerVoicesFixtures';
const opened = { formVersion: 'customer_voices_v1', expiresAt: '2026-09-25T10:00:00Z' };
const apiFor = () => ({ request: vi.fn<CustomerVoicePublicApi['request']>().mockImplementation(async input => input.command === 'open' ? opened : { submitted: true, replayed: false }) });
const mount = (api: CustomerVoicePublicApi) => render(<CustomerVoicePublic api={api} />);
async function fill() {
  await screen.findByRole('form', { name: 'แบบประเมิน Customer Voices' });
  for (const [, label] of VOICE_SCORES) fireEvent.change(screen.getByLabelText(`${label} *`), { target: { value: '4' } });
}
async function submit() { await act(async () => { fireEvent.submit(screen.getByRole('form')); }); }
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', `/customer-voices#token=${voiceToken}`); vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-24T10:00:00Z').getTime()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });
describe('anonymous QR Customer Voices', () => {
  it('strips fragment before open, never stores token/answers and shows no Visit or customer identity', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'), log = vi.spyOn(console, 'error'), api = apiFor();
    api.request.mockImplementation(async input => { expect(window.location.hash).toBe(''); return input.command === 'open' ? opened : { submitted: true, replayed: false }; });
    mount(api); await fill(); expect(api.request).toHaveBeenCalledWith({ command: 'open', token: voiceToken });
    expect(document.body.innerHTML).not.toContain(voiceToken); expect(screen.queryByText(/ลูกค้าสังเคราะห์|โครงการทดสอบ/)).not.toBeInTheDocument(); expect(storage).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
  });
  it.each(['', '#token=bad', `#token=${voiceToken}&extra=1`, `#token=${voiceToken}&token=${voiceToken}`])('rejects missing/malformed fragment %s without fetching', async hash => {
    window.history.replaceState(null, '', `/customer-voices${hash}`); const api = apiFor(); mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ลิงก์แบบประเมินไม่ถูกต้อง'); expect(api.request).not.toHaveBeenCalled(); expect(window.location.hash).toBe('');
  });
  it('does not open when history stripping fails', async () => {
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { throw new Error('denied'); }); const api = apiFor(); mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ลิงก์แบบประเมินไม่ถูกต้อง'); expect(api.request).not.toHaveBeenCalled();
  });
  it('submits a new UUID and exactly eight scores, then clears the form and offers no answers readback', async () => {
    const api = apiFor(), storage = vi.spyOn(Storage.prototype, 'setItem'); mount(api); await fill(); fireEvent.change(screen.getByLabelText('ชื่อเล่น'), { target: { value: 'ความลับทดสอบ' } }); await submit();
    const input = api.request.mock.calls[1][0]; expect(input).toMatchObject({ command: 'submit', token: voiceToken, formVersion: 'customer_voices_v1' });
    expect(input).toHaveProperty('requestId', expect.stringMatching(/^[a-f0-9-]{36}$/)); expect(Object.keys(input)).toHaveLength(5);
    expect(await screen.findByText('ขอบคุณ ส่งแบบประเมินแล้ว')).toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(document.body.textContent).not.toContain('ความลับทดสอบ'); expect(storage).not.toHaveBeenCalled();
  });
  it('blocks double submits and beforeunload while a request is in flight', async () => {
    const api = apiFor(); let resolve!: (value: VoicePublicResult) => void;
    api.request.mockResolvedValueOnce(opened).mockImplementationOnce(() => new Promise(done => { resolve = done; })); mount(api); await fill(); await submit();
    fireEvent.submit(screen.getByRole('form')); expect(api.request).toHaveBeenCalledTimes(2); expect(screen.getByRole('button', { name: 'ส่งแบบประเมิน' })).toBeDisabled();
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await act(async () => resolve({ submitted: true, replayed: false }));
  });
  it('freezes one payload on uncertainty, never auto-sends, and retains it after a later 410', async () => {
    const api = apiFor(); api.request.mockResolvedValueOnce(opened).mockRejectedValueOnce(new Error(voiceToken)).mockRejectedValueOnce(new CustomerVoicesApiError('TOKEN_UNAVAILABLE', 410)).mockResolvedValueOnce({ submitted: true, replayed: true });
    mount(api); await fill(); await submit(); const original = api.request.mock.calls[1][0]; expect(Object.isFrozen(original)).toBe(true);
    expect(screen.getByRole('button', { name: 'ส่งแบบประเมิน' })).toBeDisabled(); expect(document.body.innerHTML).not.toContain(voiceToken); expect(api.request).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })); });
    expect(api.request.mock.calls[2][0]).toBe(original); expect(screen.getByRole('button', { name: 'ส่งแบบประเมิน' })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })); });
    expect(api.request.mock.calls[3][0]).toBe(original); expect(screen.getByText('ขอบคุณ ส่งแบบประเมินแล้ว')).toBeInTheDocument();
  });
  it('permits correcting a definitively rejected first submission only', async () => {
    const api = apiFor(); api.request.mockResolvedValueOnce(opened).mockRejectedValueOnce(new CustomerVoicesApiError('INVALID_INPUT', 400)); mount(api); await fill(); await submit();
    expect(screen.queryByRole('region', { name: 'ตรวจผลแบบประเมิน' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'ส่งแบบประเมิน' })).not.toBeDisabled();
  });
  it('terminal token rejection on first submit locks the form instead of creating another UUID', async () => {
    const api = apiFor(); api.request.mockResolvedValueOnce(opened).mockRejectedValueOnce(new CustomerVoicesApiError('TOKEN_UNAVAILABLE', 410)); mount(api); await fill(); await submit();
    expect(screen.queryByRole('region', { name: 'ตรวจผลแบบประเมิน' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'ส่งแบบประเมิน' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form')); expect(api.request).toHaveBeenCalledTimes(2);
  });
  it('does not restore capability or answers after refresh and does not auto-submit', async () => {
    const api = apiFor(); api.request.mockResolvedValueOnce(opened).mockRejectedValueOnce(new Error('unknown')); const view = mount(api); await fill(); await submit(); view.unmount();
    const next = apiFor(); mount(next); expect(await screen.findByRole('alert')).toHaveTextContent('ลิงก์แบบประเมินไม่ถูกต้อง'); expect(next.request).not.toHaveBeenCalled();
  });
  it('hides old answers on a same-page QR change and never submits them to the new token', async () => {
    const api = apiFor(); mount(api); await fill(); fireEvent.change(screen.getByLabelText('ชื่อเล่น'), { target: { value: 'เก่า' } });
    act(() => { window.history.replaceState(null, '', `/customer-voices#token=${'a'.repeat(64)}`); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('ลิงก์เปลี่ยนในหน้าเดิม'); expect(window.location.hash).toBe(''); expect(api.request).toHaveBeenCalledTimes(1);
  });
  it('keeps unknown original receipt after QR change, and only manually retries the OLD token/payload', async () => {
    const api = apiFor(); api.request.mockResolvedValueOnce(opened).mockRejectedValueOnce(new Error('unknown')).mockResolvedValueOnce({ submitted: true, replayed: true }); mount(api); await fill(); await submit(); const original = api.request.mock.calls[1][0];
    act(() => { window.history.replaceState(null, '', `/customer-voices#token=${'a'.repeat(64)}`); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(api.request).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })); }); expect(api.request.mock.calls[2][0]).toBe(original);
    expect(screen.getByText('ขอบคุณ ส่งแบบประเมินแล้ว')).toBeInTheDocument();
  });
  it('removes a previous thank-you after opening another QR in the same page', async () => {
    const api = apiFor(); mount(api); await fill(); await submit(); expect(screen.getByText('ขอบคุณ ส่งแบบประเมินแล้ว')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'th');
    act(() => { window.history.replaceState(null, '', `/customer-voices#token=${'a'.repeat(64)}`); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.queryByText('ขอบคุณ ส่งแบบประเมินแล้ว')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('ลิงก์เปลี่ยนในหน้าเดิม'); expect(api.request).toHaveBeenCalledTimes(2);
  });
  it('ignores a late initial open after another QR changed the page', async () => {
    const api = apiFor(); let resolve!: (value: VoicePublicResult) => void; api.request.mockImplementationOnce(() => new Promise(done => { resolve = done; })); mount(api);
    act(() => { window.history.replaceState(null, '', `/customer-voices#token=${'a'.repeat(64)}`); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await act(async () => resolve(opened)); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('sanitizes initial errors and ignores a late reply after unmount', async () => {
    const api = apiFor(); api.request.mockRejectedValueOnce(new Error(voiceToken)); const view = mount(api); expect(await screen.findByRole('alert')).not.toHaveTextContent(voiceToken); view.unmount();
    window.history.replaceState(null, '', `/customer-voices#token=${voiceToken}`); let resolve!: (value: VoicePublicResult) => void; const next = apiFor(); next.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const second = mount(next); second.unmount(); await act(async () => resolve(opened)); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
