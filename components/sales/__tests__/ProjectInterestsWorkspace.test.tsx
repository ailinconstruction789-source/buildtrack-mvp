import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const { loadAvailablePlots } = vi.hoisted(() => ({ loadAvailablePlots: vi.fn() }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots }));
import ProjectInterestsWorkspace from '../ProjectInterestsWorkspace';
import { ProjectInterestsApiError, type ProjectInterestsApi } from '@/lib/sales/projectInterestsClient';
import { projectInterestsPendingKey, readProjectInterestsPending, writeProjectInterestsPending } from '@/lib/sales/projectInterestsPending';
import { piId, piInput, piResult, piSnapshot } from '@/lib/sales/__tests__/projectInterestsFixtures';
import type { ProjectInterestResult, ProjectInterestsSnapshot } from '@/lib/sales/projectInterestsContracts';

const makeApi = () => ({ read: vi.fn<ProjectInterestsApi['read']>().mockResolvedValue(piSnapshot()),
  save: vi.fn<ProjectInterestsApi['save']>().mockImplementation(async input => piResult(input)),
  watchIdentity: vi.fn<NonNullable<ProjectInterestsApi['watchIdentity']>>().mockReturnValue(vi.fn()) });
const mount = (api: ProjectInterestsApi, visitsEnabled = false) => render(<ProjectInterestsWorkspace customerId={piId(1)} api={api} visitsEnabled={visitsEnabled} />);
async function fill() {
  const project = await screen.findByLabelText('โครงการที่สนใจ *');
  await act(async () => {
    fireEvent.change(project, { target: { value: 'โครงการสมมติ' } });
    fireEvent.change(screen.getByLabelText('เหตุผลที่เพิ่มโครงการ *'), { target: { value: 'ลูกค้าขอเข้าชมโครงการ' } });
  });
}
async function submit() { await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'เพิ่มโครงการที่สนใจ' })); }); }
const interest = (status = 'new') => ({ id: piId(20), projectName: 'โครงการเดิม', ownerUserId: piId(6), revision: piId(21), status, plotId: null });
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); loadAvailablePlots.mockImplementation(async (project: string) => [{ id: `${project}-A1`, plot_name: 'A1', project_name: project, has_customer: false, sale_status: 'available' }]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('existing Lead project interests workspace', () => {
  it('saves only a new project, preserving customer revision and using no arbitrary owner or customer creation', async () => {
    const api = makeApi(); mount(api); await fill(); await submit();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ customerId: piId(1), expectedCustomerRevision: piId(3), projectName: 'โครงการสมมติ', plotId: null, reason: 'ลูกค้าขอเข้าชมโครงการ' }), piId(6));
    expect(Object.keys(api.save.mock.calls[0][0]).sort()).toEqual(['customerId', 'expectedCustomerRevision', 'plotId', 'projectName', 'reason', 'requestId']);
    expect(screen.queryByLabelText(/Sales ผู้ดูแล/)).not.toBeInTheDocument();
    expect(screen.getByText(/เพิ่มโครงการที่สนใจแล้ว/)).toBeInTheDocument();
  });
  it('requires reason and keeps an optional searchable vacant plot bound to the selected project', async () => {
    const api = makeApi(); mount(api); fireEvent.change(await screen.findByLabelText('โครงการที่สนใจ *'), { target: { value: 'โครงการสมมติ' } });
    await submit(); expect(screen.getByRole('alert')).toHaveTextContent('ข้อความ'); expect(api.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('เหตุผลที่เพิ่มโครงการ *'), { target: { value: 'ลูกค้าสนใจแปลง A1' } });
    fireEvent.focus(screen.getByRole('combobox', { name: 'แปลงที่เล็งไว้ (ถ้ามี)' })); fireEvent.click(await screen.findByRole('option', { name: /A1/ }));
    await submit(); expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ plotId: 'โครงการสมมติ-A1' }), piId(6));
  });
  it('clears the old plot on project change and never silently books or locks stock', async () => {
    const api = makeApi(), snapshot = piSnapshot(); snapshot.projects.push({ name: 'อีกโครงการ' }); api.read.mockResolvedValue(snapshot); mount(api); await fill();
    fireEvent.focus(screen.getByRole('combobox', { name: 'แปลงที่เล็งไว้ (ถ้ามี)' })); fireEvent.click(await screen.findByRole('option', { name: /A1/ }));
    await act(async () => { fireEvent.change(screen.getByLabelText('โครงการที่สนใจ *'), { target: { value: 'อีกโครงการ' } }); }); await submit();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ projectName: 'อีกโครงการ', plotId: null }), piId(6));
    expect(screen.getByRole('region', { name: 'Lead ที่กำลังดู' })).toHaveTextContent('การเพิ่มโครงการไม่เปลี่ยนวันเริ่มเป็น Lead เจ้าของ Lead ส่วนกลาง หรืองาน SLA เดิม และยังไม่ใช่การจอง');
  });
  it('shows existing and lost interests as history, not add/reopen choices', async () => {
    const api = makeApi(), snapshot = piSnapshot(); snapshot.interests = [interest('lost')]; api.read.mockResolvedValue(snapshot); mount(api);
    expect(await screen.findByRole('article', { name: 'ความสนใจ โครงการเดิม' })).toHaveTextContent('Lost');
    expect(screen.queryByRole('option', { name: 'โครงการเดิม' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /เปิดใหม่/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'งานติดตาม / ประวัติ โครงการเดิม' })).toHaveAttribute('href', `/sales-crm/${piId(1)}?interestId=${piId(20)}`);
    expect(screen.queryByRole('link', { name: /นัดหมาย/ })).not.toBeInTheDocument();
  });
  it('offers Visit links only with the independent server flag', async () => {
    const api = makeApi(), snapshot = piSnapshot(); snapshot.interests = [interest()]; api.read.mockResolvedValue(snapshot); mount(api, true);
    expect(await screen.findByRole('link', { name: 'นัดหมาย / เข้าชม โครงการเดิม' })).toHaveAttribute('href', `/sales-crm/visits?customerId=${piId(1)}&interestId=${piId(20)}`);
  });
  it.each(['owner', 'other_sales', 'lost', 'canAdd_false'])('keeps %s read-only', async scenario => {
    const api = makeApi(), snapshot = piSnapshot();
    if (scenario === 'owner') snapshot.actor.role = 'owner'; else if (scenario === 'other_sales') snapshot.actor.userId = piId(99); else if (scenario === 'lost') snapshot.customer.intakeStatus = 'lost';
    snapshot.customer.canAdd = false; api.read.mockResolvedValue(snapshot); mount(api);
    await screen.findByRole('heading', { name: snapshot.customer.name }); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
  });
  it('lets Admin add without an owner selector; the existing central owner stays the default', async () => {
    const api = makeApi(), snapshot = piSnapshot(); snapshot.actor = { role: 'admin', userId: piId(99) }; api.read.mockResolvedValue(snapshot); mount(api);
    await fill(); await submit(); expect(api.save).toHaveBeenCalledWith(expect.not.objectContaining({ ownerUserId: expect.anything() }), piId(99));
    expect(screen.getByText(/เจ้าของ Lead ส่วนกลางคนเดิม/)).toBeInTheDocument();
  });
  it('discloses the 200-project cap and pages existing interests without showing stale editable data', async () => {
    const api = makeApi(), snapshot = piSnapshot(); snapshot.projects = Array.from({ length: 200 }, (_, index) => ({ name: `โครงการ ${index + 1}` })); snapshot.projectsHasMore = true;
    snapshot.interests = Array.from({ length: 50 }, (_, index) => ({ ...interest(), id: piId(100 + index), projectName: `เดิม ${index + 1}` })); snapshot.hasMore = true;
    let resolve!: (value: ProjectInterestsSnapshot) => void; api.read.mockResolvedValueOnce(snapshot).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mount(api); expect(await screen.findByText(/200 โครงการแรก/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'โครงการถัดไป' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(api.read).toHaveBeenLastCalledWith({ customerId: piId(1), page: 1 });
    await act(async () => resolve({ ...piSnapshot(), page: 1 })); expect(screen.getByText(/หน้า 2/)).toBeInTheDocument();
  });
  it('writes ahead before send and protects against click/submit reentrancy', async () => {
    const api = makeApi(); let resolve!: (value: ProjectInterestResult) => void;
    api.save.mockImplementation((input, actor) => { expect(readProjectInterestsPending(actor)).toEqual(input); return new Promise(done => { resolve = done; }); });
    mount(api); await fill(); await submit(); fireEvent.submit(screen.getByRole('form')); fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }));
    expect(api.save).toHaveBeenCalledOnce(); expect(api.read).toHaveBeenCalledOnce(); expect(screen.getByLabelText('เหตุผลที่เพิ่มโครงการ *')).toBeDisabled();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await act(async () => resolve(piResult(api.save.mock.calls[0][0]))); expect(readProjectInterestsPending(piId(6))).toBeNull();
  });
  it('recovers after refresh without auto-send, then preserves identical payload after an uncertain result followed by 403', async () => {
    const first = makeApi(); first.save.mockRejectedValue(new Error('network failed')); const view = mount(first); await fill(); await submit();
    const input = first.save.mock.calls[0][0]; view.unmount();
    const second = makeApi(); second.save.mockRejectedValue(new ProjectInterestsApiError('FORBIDDEN', 'สิทธิ์เปลี่ยนแล้ว', 403)); mount(second);
    const retry = await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }); expect(second.save).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(retry); }); expect(second.save).toHaveBeenCalledWith(input, piId(6));
    expect(screen.getByRole('alert')).toHaveTextContent('สิทธิ์เปลี่ยนแล้ว'); expect(readProjectInterestsPending(piId(6))).toEqual(input);
    expect(screen.getByLabelText('โครงการที่สนใจ *')).toBeDisabled();
  });
  it('clears only a definitive first rejection so the user can correct an unsaved form', async () => {
    const api = makeApi(); api.save.mockRejectedValue(new ProjectInterestsApiError('PROJECT_EXISTS', 'ใช้ความสนใจเดิม', 409)); mount(api); await fill(); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('ใช้ความสนใจเดิม'); expect(readProjectInterestsPending(piId(6))).toBeNull(); expect(screen.getByLabelText('เหตุผลที่เพิ่มโครงการ *')).not.toBeDisabled();
  });
  it('does not resend a successful save when refresh fails; success links use the pending customer, not the viewed one', async () => {
    const input = piInput({ customerId: piId(88) }); writeProjectInterestsPending(piId(6), input);
    const api = makeApi(); api.read.mockResolvedValueOnce(piSnapshot()).mockRejectedValue(new Error('โหลดล่าสุดไม่ได้')); mount(api, true);
    const retry = await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' });
    await act(async () => { fireEvent.click(retry); });
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดล่าสุดไม่ได้'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'เปิดงานติดตามของโครงการที่เพิ่ม' })).toHaveAttribute('href', `/sales-crm/${piId(88)}?interestId=${piId(4)}`);
    expect(screen.getByRole('link', { name: 'นัดหมาย / เช็คอินโครงการที่เพิ่ม' })).toHaveAttribute('href', `/sales-crm/visits?customerId=${piId(88)}&interestId=${piId(4)}`);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' })); }); expect(api.save).toHaveBeenCalledOnce();
  });
  it('blocks writes and navigation when the persisted command is corrupt', async () => {
    const key = projectInterestsPendingKey(piId(6)); sessionStorage.setItem(key, '{broken'); const api = makeApi(); mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ห้ามล้างข้อมูลแท็บ'); expect(screen.getByLabelText('โครงการที่สนใจ *')).toBeDisabled();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(sessionStorage.getItem(key)).toBe('{broken'); expect(api.save).not.toHaveBeenCalled();
  });
  it('does not send if session write-ahead storage fails', async () => {
    const api = makeApi(); mount(api); await fill(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Admin'); expect(api.save).not.toHaveBeenCalled();
  });
  it('does not resend a confirmed save if clearing the session receipt fails', async () => {
    const api = makeApi(); mount(api); await fill();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage blocked'); }); await submit();
    expect(screen.getByText('บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form')); expect(api.save).toHaveBeenCalledOnce();
    expect(readProjectInterestsPending(piId(6))).toEqual(api.save.mock.calls[0][0]);
  });
  it('hides old identity data immediately and discards a late old save result while retaining its session receipt on unknown result', async () => {
    const api = makeApi(); let changed!: () => void, reject!: (failure: Error) => void, nextRead!: (value: ProjectInterestsSnapshot) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); });
    api.save.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    api.read.mockResolvedValueOnce(piSnapshot()).mockImplementationOnce(() => new Promise(done => { nextRead = done; }));
    mount(api); await fill(); await submit(); const input = api.save.mock.calls[0][0];
    act(() => changed()); expect(screen.queryByRole('heading', { name: 'ลูกค้าสมมติ' })).not.toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'คำขอเพิ่มโครงการค้าง' })).not.toBeInTheDocument();
    const other = piSnapshot(); other.actor.userId = piId(99); other.customer.canAdd = false;
    await act(async () => { nextRead(other); reject(new Error('unknown after switch')); });
    expect(screen.queryByText('unknown after switch')).not.toBeInTheDocument(); expect(readProjectInterestsPending(piId(6))).toEqual(input); expect(api.save).toHaveBeenCalledOnce();
  });
  it('ignores late reads after customer scope changes', async () => {
    const api = makeApi(); let resolve!: (value: ProjectInterestsSnapshot) => void;
    api.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const next = piSnapshot(); next.customer = { ...next.customer, id: piId(88), name: 'ลูกค้าอีกคน' }; api.read.mockResolvedValueOnce(next);
    const view = mount(api); view.rerender(<ProjectInterestsWorkspace customerId={piId(88)} api={api} />);
    await screen.findByRole('heading', { name: 'ลูกค้าอีกคน' }); await act(async () => resolve(piSnapshot()));
    expect(screen.queryByRole('heading', { name: 'ลูกค้าสมมติ' })).not.toBeInTheDocument();
  });
  it('clears the old actor receipt on a late confirmed save without exposing its result to the new actor', async () => {
    const api = makeApi(); let changed!: () => void, resolve!: (result: ProjectInterestResult) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); });
    api.save.mockImplementation(() => new Promise(done => { resolve = done; }));
    const next = piSnapshot(); next.actor.userId = piId(99); next.customer.canAdd = false;
    api.read.mockResolvedValueOnce(piSnapshot()).mockResolvedValueOnce(next);
    mount(api); await fill(); await submit(); const input = api.save.mock.calls[0][0];
    await act(async () => { changed(); });
    await act(async () => resolve(piResult(input)));
    expect(readProjectInterestsPending(piId(6))).toBeNull();
    expect(screen.queryByRole('region', { name: 'โครงการที่เพิ่มสำเร็จ' })).not.toBeInTheDocument();
    expect(screen.queryByText(/เพิ่มโครงการที่สนใจแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('never auto-sends a recovered command even if the caller changes API instances', async () => {
    writeProjectInterestsPending(piId(6), piInput()); const first = makeApi(), second = makeApi(); const view = mount(first);
    await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }); view.rerender(<ProjectInterestsWorkspace customerId={piId(1)} api={second} />);
    await waitFor(() => expect(second.read).toHaveBeenCalledOnce()); expect(first.save).not.toHaveBeenCalled(); expect(second.save).not.toHaveBeenCalled();
  });
});
