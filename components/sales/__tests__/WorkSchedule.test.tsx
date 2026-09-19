import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import WorkScheduleForm from '../WorkScheduleForm';
import WorkScheduleView from '../WorkScheduleView';
import { WorkScheduleApiError } from '@/lib/sales/workScheduleClient';
import type { WorkScheduleInput, WorkScheduleSnapshot } from '@/lib/sales/workScheduleContracts';
import { readWorkSchedulePending, writeWorkSchedulePending, workSchedulePendingKey } from '@/lib/sales/workSchedulePending';

const ADMIN = '00000000-0000-4000-8000-000000000001', SALES = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003', CALENDAR = '00000000-0000-4000-8000-000000000004';
const VERSION = '00000000-0000-4000-8000-000000000005', PERIOD = '00000000-0000-4000-8000-000000000006';
const REQUEST = '00000000-0000-4000-8000-000000000007', NEXT = '00000000-0000-4000-8000-000000000008';
const coverage = { startsAt: '2026-09-16T00:00:00+07:00', endsAt: '2026-09-17T00:00:00+07:00' };
const result = { calendarId: CALENDAR, version: NEXT, salesUserId: SALES, replayed: false };
function snapshot(target: string | null = SALES, hasCalendar = true): WorkScheduleSnapshot {
    return { actor: { userId: ADMIN, role: 'admin' }, asOf: '2026-09-16T08:00:00+07:00',
        sales: [{ userId: SALES, displayName: 'Sales A' }, { userId: OTHER, displayName: 'Sales B' }], salesHasMore: false,
        selectedSalesUserId: target, calendar: target && hasCalendar ? {
            raw: { id: CALENDAR, version: VERSION, ownerUserId: target, coverage: { ...coverage, complete: true },
                periods: [{ id: PERIOD, salesUserId: target, type: 'work', startsAt: '2026-09-16T09:00:00+07:00', endsAt: '2026-09-16T18:00:00+07:00' }] },
            publishedAt: '2026-09-15T08:00:00+07:00', publishedByUserId: ADMIN, changeReason: 'จัดเวรเดิม' } : null };
}
function input(): WorkScheduleInput { return { requestId: REQUEST, salesUserId: SALES, expectedVersion: VERSION,
    coverage, periods: [{ type: 'work', startsAt: '2026-09-16T09:00:00+07:00', endsAt: '2026-09-16T18:00:00+07:00' }], confirmedComplete: true, reason: 'จัดเวรเดือนนี้' }; }
function form(data = snapshot()) {
    const props = { snapshot: data, save: vi.fn().mockResolvedValue(result), onSaved: vi.fn().mockResolvedValue(undefined),
        onLockedChange: vi.fn(), onRefreshRequired: vi.fn().mockResolvedValue(undefined) };
    return { ...render(<WorkScheduleForm {...props} />), props };
}
function review() {
    fireEvent.change(screen.getByLabelText('เหตุผลการจัดหรือแก้ไขเวร *'), { target: { value: 'จัดเวรเดือนนี้' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('form', { name: 'จัดเวร Sales' }));
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'ยืนยันบันทึกตารางเวรรุ่นใหม่' }));
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(cleanup);

describe('Admin work schedule review and publish', () => {
    it('requires explicit confirmation after reviewing the complete replacement', () => {
        const { props } = form(); review();
        expect(screen.getByRole('region', { name: 'ตรวจทานตารางเวร' })).toHaveTextContent('ไม่ใช่เพิ่มเฉพาะบางวัน');
        expect(props.save).not.toHaveBeenCalled(); expect(readWorkSchedulePending(ADMIN)).toBeNull();
    });
    it('stores before POST, uses expected version, and clears only after confirmed success', async () => {
        const { props } = form(); props.save.mockImplementation(async payload => { expect(readWorkSchedulePending(ADMIN)).toEqual(payload); return result; });
        review(); confirm();
        await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(result));
        expect(props.save).toHaveBeenCalledWith(expect.objectContaining({ salesUserId: SALES, expectedVersion: VERSION, confirmedComplete: true }));
        expect(readWorkSchedulePending(ADMIN)).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('สำเร็จแล้ว');
    });
    it('does not publish without the completeness acknowledgement', () => {
        const { props } = form();
        fireEvent.change(screen.getByLabelText('เหตุผลการจัดหรือแก้ไขเวร *'), { target: { value: 'เหตุผล' } });
        fireEvent.submit(screen.getByRole('form'));
        expect(screen.getByRole('alert')).toBeInTheDocument(); expect(props.save).not.toHaveBeenCalled();
        expect(screen.queryByRole('region', { name: 'ตรวจทานตารางเวร' })).not.toBeInTheDocument();
    });
    it('invalidates review on field edit', () => {
        const { props } = form(); review();
        fireEvent.change(screen.getByLabelText('เหตุผลการจัดหรือแก้ไขเวร *'), { target: { value: 'เปลี่ยนเหตุผล' } });
        expect(screen.queryByRole('button', { name: 'ยืนยันบันทึกตารางเวรรุ่นใหม่' })).not.toBeInTheDocument();
        expect(props.save).not.toHaveBeenCalled();
    });
    it('invalidates review permanently when snapshot changes and then changes back', () => {
        const data = snapshot(); const { props, rerender } = form(data); review();
        rerender(<WorkScheduleForm {...props} snapshot={{ ...data, asOf: '2026-09-16T08:01:00+07:00' }} />);
        rerender(<WorkScheduleForm {...props} snapshot={data} />);
        expect(screen.queryByRole('button', { name: 'ยืนยันบันทึกตารางเวรรุ่นใหม่' })).not.toBeInTheDocument();
    });
    it('does not invent a shift for an unpublished calendar and requires dates', () => {
        form(snapshot(SALES, false));
        expect(screen.queryByLabelText('เริ่มช่วงที่ 1 *')).not.toBeInTheDocument();
        expect(screen.getByLabelText('ช่วงข้อมูลเริ่มต้น *')).toHaveValue(''); review();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    it('preserves microseconds from an existing version when reviewing without editing its time', async () => {
        const data = snapshot();
        const exact = { ...data, calendar: { ...data.calendar!, raw: { ...data.calendar!.raw,
            periods: [{ ...data.calendar!.raw.periods[0], startsAt: '2026-09-16T02:00:00.123456Z' }] } } };
        const { props } = form(exact);
        expect(screen.getByLabelText('เริ่มช่วงที่ 1 *')).toHaveValue('2026-09-16T09:00:00.123456');
        expect(screen.getByLabelText('เริ่มช่วงที่ 1 *')).toHaveAttribute('type', 'text');
        fireEvent.change(screen.getByLabelText('เหตุผลการจัดหรือแก้ไขเวร *'), { target: { value: 'รักษาเวลาเดิม' } });
        fireEvent.click(screen.getByRole('checkbox'));
        expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจทานตารางเวรก่อนบันทึก' })); confirm();
        await waitFor(() => expect(props.save).toHaveBeenCalled());
        expect(props.save.mock.calls[0][0].periods[0].startsAt).toBe('2026-09-16T09:00:00.123456+07:00');
    });
    it('shows a safe blocked state for a valid UTC boundary outside the Bangkok input year range', () => {
        const data = snapshot();
        const overflow = { ...data, calendar: { ...data.calendar!, raw: { ...data.calendar!.raw,
            coverage: { startsAt: '9999-12-30T00:00:00Z', endsAt: '9999-12-31T23:59:59Z', complete: true } } } };
        const { props } = form(overflow);
        expect(screen.getByRole('alert')).toHaveTextContent('ไม่มีการปัด');
        expect(props.save).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'ตรวจทานตารางเวรก่อนบันทึก' })).toBeDisabled();
    });
    it('supports an explicit complete known-no-work calendar with a warning', () => {
        form(snapshot(SALES, false));
        fireEvent.change(screen.getByLabelText('ช่วงข้อมูลเริ่มต้น *'), { target: { value: '2026-09-16T00:00' } });
        fireEvent.change(screen.getByLabelText('ช่วงข้อมูลสิ้นสุด (ไม่นับรวม) *'), { target: { value: '2026-09-17T00:00' } });
        review(); expect(screen.getByRole('region', { name: 'ตรวจทานตารางเวร' })).toHaveTextContent('ไม่มีเวลาทำงาน');
    });
    it('adds work/approved-leave/break intervals and removes only draft rows', () => {
        const { props } = form(); fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มช่วงเวลา' }));
        fireEvent.change(screen.getByLabelText('ประเภทช่วงที่ 2'), { target: { value: 'break' } });
        fireEvent.change(screen.getByLabelText('เริ่มช่วงที่ 2 *'), { target: { value: '2026-09-16T12:00' } });
        fireEvent.change(screen.getByLabelText('สิ้นสุดช่วงที่ 2 *'), { target: { value: '2026-09-16T13:00' } });
        review(); expect(screen.getByRole('region', { name: 'ตรวจทานตารางเวร' })).toHaveTextContent('เหลือ 2 ช่วงทำงาน');
        fireEvent.click(screen.getByRole('button', { name: 'นำช่วงที่ 2 ออกจากฉบับร่าง' }));
        expect(screen.queryByRole('region', { name: 'ตรวจทานตารางเวร' })).not.toBeInTheDocument(); expect(props.save).not.toHaveBeenCalled();
    });
    it('rejects overlapping work intervals', () => {
        form(); fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มช่วงเวลา' }));
        fireEvent.change(screen.getByLabelText('เริ่มช่วงที่ 2 *'), { target: { value: '2026-09-16T12:00' } });
        fireEvent.change(screen.getByLabelText('สิ้นสุดช่วงที่ 2 *'), { target: { value: '2026-09-16T13:00' } });
        review(); expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    it('blocks double confirmation synchronously', async () => {
        const { props } = form(); props.save.mockImplementation(() => new Promise(() => undefined)); review();
        const button = screen.getByRole('button', { name: 'ยืนยันบันทึกตารางเวรรุ่นใหม่' });
        act(() => { fireEvent.click(button); fireEvent.click(button); });
        await waitFor(() => expect(props.save).toHaveBeenCalledTimes(1)); expect(props.onLockedChange).toHaveBeenCalledWith(true);
    });
    it('recovers across Sales selection and replays exact original payload, not current revision', async () => {
        writeWorkSchedulePending(ADMIN, input()); const { props } = form(snapshot(OTHER));
        fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอตารางเวรเดิมซ้ำ' }));
        await waitFor(() => expect(props.save).toHaveBeenCalledWith(input()));
        expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
    it('keeps an unknown outcome sticky even after a later definite rejection', async () => {
        const { props } = form(); props.save.mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new WorkScheduleApiError('FORBIDDEN', 'สิทธิ์เปลี่ยน', 403));
        review(); confirm(); await screen.findByRole('button', { name: 'ส่งคำขอตารางเวรเดิมซ้ำ' });
        const saved = readWorkSchedulePending(ADMIN);
        fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอตารางเวรเดิมซ้ำ' }));
        await waitFor(() => expect(props.save).toHaveBeenCalledTimes(2));
        expect(readWorkSchedulePending(ADMIN)).toEqual(saved); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
    it('clears a first definite stale rejection but requires a fresh read before new review', async () => {
        const { props } = form(); props.save.mockRejectedValue(new WorkScheduleApiError('STALE_VERSION', 'เวรเปลี่ยนแล้ว', 409));
        review(); confirm(); await screen.findByRole('button', { name: 'โหลดเวรล่าสุดก่อนทำรายการใหม่' });
        expect(readWorkSchedulePending(ADMIN)).toBeNull();
        expect(screen.getByRole('button', { name: 'ตรวจทานตารางเวรก่อนบันทึก' })).toBeDisabled();
    });
    it('does not reinterpret failed refresh after confirmed save as another POST', async () => {
        const { props } = form(); props.onSaved.mockRejectedValue(new Error('GET failed')); review(); confirm();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('บันทึกสำเร็จแล้ว'));
        expect(props.save).toHaveBeenCalledTimes(1); expect(readWorkSchedulePending(ADMIN)).toBeNull();
    });
    it('does not POST if write-ahead storage fails', async () => {
        const { props } = form(); review(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); confirm();
        expect(props.save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('ยังไม่ส่ง');
    });
    it('preserves the request ID and does not refresh if confirmed save cannot clear storage', async () => {
        const { props } = form(); review(); vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage'); }); confirm();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('บันทึกสำเร็จแล้ว'));
        expect(props.onSaved).not.toHaveBeenCalled(); expect(screen.getByRole('region', { name: 'คำขอตารางเวรค้าง' })).toHaveTextContent(readWorkSchedulePending(ADMIN)!.requestId);
    });
    it('fails closed on a corrupt global queue', () => {
        sessionStorage.setItem(workSchedulePendingKey(ADMIN), '{broken'); const { props } = form();
        expect(screen.getByRole('alert')).toHaveTextContent('ห้ามล้าง'); expect(props.save).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'ตรวจทานตารางเวรก่อนบันทึก' })).toBeDisabled();
    });
});

describe('Admin work schedule workspace', () => {
    function api() { return { read: vi.fn().mockImplementation(async (target: string | null) => snapshot(target)), save: vi.fn().mockResolvedValue(result) }; }
    it('starts unselected and fetches only the selected Sales without writing on open', async () => {
        const service = api(); render(<WorkScheduleView api={service} />);
        await screen.findByLabelText('Sales ที่ต้องการจัดเวร'); expect(service.read).toHaveBeenCalledWith(null);
        fireEvent.change(screen.getByLabelText('Sales ที่ต้องการจัดเวร'), { target: { value: SALES } });
        await screen.findByRole('form', { name: 'จัดเวร Sales' }); expect(service.read).toHaveBeenLastCalledWith(SALES); expect(service.save).not.toHaveBeenCalled();
    });
    it('searches only loaded Sales and shows no free-user-ID input', async () => {
        render(<WorkScheduleView api={api()} />); await screen.findByLabelText('Sales ที่ต้องการจัดเวร');
        fireEvent.change(screen.getByLabelText('ค้นหา Sales ในรายชื่อที่โหลด'), { target: { value: 'Sales B' } });
        expect(screen.queryByRole('option', { name: 'Sales A' })).not.toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Sales B' })).toBeInTheDocument();
    });
    it('recovers the global queue without issuing a second target read or allowing a target switch', async () => {
        writeWorkSchedulePending(ADMIN, input()); const service = api(); render(<WorkScheduleView api={service} />);
        await screen.findByRole('region', { name: 'คำขอตารางเวรค้าง' });
        expect(screen.getByLabelText('Sales ที่ต้องการจัดเวร')).toBeDisabled(); expect(service.read).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอตารางเวรเดิมซ้ำ' }));
        await waitFor(() => expect(service.save).toHaveBeenCalledWith(input(), ADMIN));
    });
    it('does not mount editor or expose candidates on failed authorization', async () => {
        const service = api(); service.read.mockRejectedValue(new WorkScheduleApiError('FORBIDDEN', 'เฉพาะ Admin', 403));
        render(<WorkScheduleView api={service} />); expect(await screen.findByRole('alert')).toHaveTextContent('เฉพาะ Admin');
        expect(screen.queryByLabelText('Sales ที่ต้องการจัดเวร')).not.toBeInTheDocument(); expect(service.save).not.toHaveBeenCalled();
    });
    it('rejects a changed actor during selection and never mounts a cross-account editor', async () => {
        const service = api(); service.read.mockResolvedValueOnce(snapshot(null)).mockResolvedValueOnce({ ...snapshot(), actor: { userId: OTHER, role: 'admin' } });
        render(<WorkScheduleView api={service} />); await screen.findByLabelText('Sales ที่ต้องการจัดเวร');
        fireEvent.change(screen.getByLabelText('Sales ที่ต้องการจัดเวร'), { target: { value: SALES } });
        await screen.findByRole('alert'); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(service.save).not.toHaveBeenCalled();
    });
    it('locks the selector in the same turn as submitting the confirmed command', async () => {
        const service = api(); service.save.mockImplementation(() => new Promise(() => undefined)); render(<WorkScheduleView api={service} />);
        await screen.findByLabelText('Sales ที่ต้องการจัดเวร'); fireEvent.change(screen.getByLabelText('Sales ที่ต้องการจัดเวร'), { target: { value: SALES } });
        await screen.findByRole('form'); review();
        act(() => { confirm(); fireEvent.change(screen.getByLabelText('Sales ที่ต้องการจัดเวร'), { target: { value: OTHER } }); });
        await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1)); expect(service.read).not.toHaveBeenCalledWith(OTHER);
    });
    it('detects a queue created after load before switching targets', async () => {
        const service = api(); render(<WorkScheduleView api={service} />); await screen.findByLabelText('Sales ที่ต้องการจัดเวร');
        writeWorkSchedulePending(ADMIN, input()); fireEvent.change(screen.getByLabelText('Sales ที่ต้องการจัดเวร'), { target: { value: OTHER } });
        expect(screen.getByRole('alert')).toHaveTextContent('คำขอเดิม'); expect(service.read).not.toHaveBeenCalledWith(OTHER);
    });
});
