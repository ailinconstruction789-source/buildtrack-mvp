import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProcurementDashboard from '../ProcurementDashboard';
import MaterialStoreDashboard from '../MaterialStoreDashboard';
import ReceiptUploadModal from '../ReceiptUploadModal';

const db = vi.hoisted(() => ({
  from: vi.fn(), update: vi.fn(), eq: vi.fn(), insertAssignment: vi.fn(), insertReceipt: vi.fn(),
  selectReceipt: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), publicUrl: vi.fn(),
  createUrl: vi.fn(), revokeUrl: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: db.from, storage: { from: db.storageFrom } } }));
const originalURL = URL;
const actor = { id: 1, authUserId: 'auth-a', username: 'Store A', role: 'Store' };
const nextActor = { id: 2, authUserId: 'auth-b', username: 'Store B', role: 'Store' };
const projects = [{ name: 'Project A' }, { name: 'Project B' }];
const plots = [
  { id: 'A', plot_name: 'A01', project_name: 'Project A', house_type_id: 'H1' },
  { id: 'B', plot_name: 'B01', project_name: 'Project B', house_type_id: 'H1' },
];
const taskTemplates = [
  { id: 'roof', house_type_id: 'H1', task_name: 'Roof' },
  { id: 'wall', house_type_id: 'H1', task_name: 'Wall' },
];
const procurementProps = { projects, plots, taskTemplates, assignments: [], contractors: [], fetchAllData: vi.fn(), loggedInUser: actor };
const request = { id: 'request-a', plot_id: 'A', task_template_id: 'roof', status: 'requested', requested_at: '2026-10-08T00:00:00Z' };
const storeProps = {
  view: 'material-store', materialRequests: [request], plots, taskTemplates, projects,
  loggedInUser: actor, setMaterialRequests: vi.fn(), materialReceipts: [], setMaterialReceipts: vi.fn(),
};
const receipt = { id: 'receipt-new', request_id: 'request-a', image_url: 'https://example.invalid/receipt.png' };
const uploadProps = {
  isOpen: true, onClose: vi.fn(), onSuccess: vi.fn(), plotId: 'A', taskId: 'roof', taskName: 'Roof',
  requestId: 'request-a', requestStatus: 'received', currentUserRole: 'Store', currentUserName: 'Store A',
  currentUserId: 1, currentAuthUserId: 'auth-a',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function chooseProcurement() {
  const [project, task] = screen.getAllByRole('combobox');
  fireEvent.change(project, { target: { value: 'Project A' } });
  fireEvent.change(task, { target: { value: 'Roof' } });
  return { project, task };
}
function draftName(value = 'Contractor draft') {
  fireEvent.change(screen.getByPlaceholderText('ระบุชื่อช่าง...'), { target: { value } });
}
function orderRequest() {
  fireEvent.click(screen.getByRole('button', { name: 'ทำ PR/สั่งของแล้ว' }));
  fireEvent.change(screen.getByPlaceholderText('เช่น PR-2023-001'), { target: { value: 'PR-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการสั่งซื้อ' }));
}
function chooseFile(container: HTMLElement, name = 'delivery.png') {
  const file = new File(['fixture image'], name, { type: 'image/png' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.from.mockImplementation(table => table === 'task_material_receipts'
    ? { insert: db.insertReceipt }
    : table === 'plot_task_assignments'
      ? { insert: db.insertAssignment, update: db.update }
      : { update: db.update });
  db.insertAssignment.mockResolvedValue({ error: null });
  db.insertReceipt.mockReturnValue({ select: db.selectReceipt });
  db.selectReceipt.mockResolvedValue({ data: [receipt], error: null });
  db.update.mockReturnValue({ eq: db.eq });
  db.eq.mockResolvedValue({ error: null });
  db.storageFrom.mockReturnValue({ upload: db.upload, getPublicUrl: db.publicUrl });
  db.upload.mockResolvedValue({ error: null });
  db.publicUrl.mockReturnValue({ data: { publicUrl: receipt.image_url } });
  db.createUrl.mockImplementation(() => `blob:receipt-${db.createUrl.mock.calls.length}`);
  vi.stubGlobal('URL', class extends originalURL {
    static createObjectURL = db.createUrl;
    static revokeObjectURL = db.revokeUrl;
  });
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('construction procurement UI', () => {
  it.each(['insert', 'update'])('does not report success when %s resolves with a Supabase error', async operation => {
    if (operation === 'insert') db.insertAssignment.mockResolvedValue({ error: { message: 'Denied' } });
    else db.eq.mockResolvedValue({ error: { message: 'Denied' } });
    const assignments = operation === 'update' ? [{ id: 99, plot_id: 'A', task_template_id: 'roof', contractor_name: '' }] : [];
    render(<ProcurementDashboard {...procurementProps} assignments={assignments} />);
    chooseProcurement();
    draftName();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูลช่าง' }));
    expect(await screen.findByText(/เกิดข้อผิดพลาดในการบันทึกข้อมูล: Denied/)).toBeInTheDocument();
    expect(screen.queryByText('บันทึกข้อมูลช่างเรียบร้อยแล้ว!')).not.toBeInTheDocument();
  });

  it('preserves row and global drafts across a same-selection data refresh', () => {
    const { rerender } = render(<ProcurementDashboard {...procurementProps} />);
    chooseProcurement();
    draftName();
    fireEvent.change(screen.getByPlaceholderText('ใส่ชื่อช่าง...'), { target: { value: 'Global draft' } });
    rerender(<ProcurementDashboard {...procurementProps} plots={plots.map(plot => ({ ...plot }))} taskTemplates={taskTemplates.map(task => ({ ...task }))} assignments={[]} />);
    expect(screen.getByDisplayValue('Contractor draft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Global draft')).toBeInTheDocument();
  });

  it.each(['task', 'project', 'account'])('resets drafts when the %s scope changes', scope => {
    const { rerender } = render(<ProcurementDashboard {...procurementProps} />);
    const selected = chooseProcurement();
    draftName();
    fireEvent.change(screen.getByPlaceholderText('ใส่ชื่อช่าง...'), { target: { value: 'Global draft' } });
    if (scope === 'account') rerender(<ProcurementDashboard {...procurementProps} loggedInUser={nextActor} />);
    else fireEvent.change(selected[scope as 'task' | 'project'], { target: { value: scope === 'task' ? 'Wall' : 'Project B' } });
    expect(screen.getByPlaceholderText('ระบุชื่อช่าง...')).toHaveValue('');
    expect(screen.getByPlaceholderText('ใส่ชื่อช่าง...')).toHaveValue('');
  });

  it('updates eligible plots when templates change while preserving the existing draft', () => {
    const extraPlot = { id: 'C', plot_name: 'A02', project_name: 'Project A', house_type_id: 'H2' };
    const allPlots = [...plots, extraPlot];
    const { rerender } = render(<ProcurementDashboard {...procurementProps} plots={allPlots} />);
    chooseProcurement();
    draftName();
    expect(screen.queryByText('A02')).not.toBeInTheDocument();
    rerender(<ProcurementDashboard {...procurementProps} plots={allPlots} taskTemplates={[...taskTemplates, { id: 'roof-2', task_name: 'Roof', house_type_id: 'H2' }]} />);
    expect(screen.getByText('A02')).toBeInTheDocument();
    const firstRow = screen.getAllByRole('row').find(row => within(row).queryByText('A01'))!;
    expect(within(firstRow).getByPlaceholderText('ระบุชื่อช่าง...')).toHaveValue('Contractor draft');
  });

  it('does not replace a newer selection with an earlier save completion', async () => {
    const pending = deferred<{ error: null }>();
    db.insertAssignment.mockReturnValue(pending.promise);
    const { rerender } = render(<ProcurementDashboard {...procurementProps} />);
    chooseProcurement();
    draftName('Old contractor');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกข้อมูลช่าง' }));
    rerender(<ProcurementDashboard {...procurementProps} loggedInUser={nextActor} />);
    draftName('New contractor');
    await act(async () => { pending.resolve({ error: null }); });
    expect(screen.getByDisplayValue('New contractor')).toBeInTheDocument();
    expect(screen.queryByText('บันทึกข้อมูลช่างเรียบร้อยแล้ว!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกข้อมูลช่าง' })).not.toBeDisabled();
  });
});

describe('construction material store UI', () => {
  it('ignores status completion from the previous actor even when both have the same role', async () => {
    const pending = deferred<{ error: null }>();
    db.eq.mockReturnValue(pending.promise);
    const { rerender } = render(<MaterialStoreDashboard {...storeProps} />);
    orderRequest();
    rerender(<MaterialStoreDashboard {...storeProps} loggedInUser={nextActor} />);
    expect(screen.getByRole('button', { name: 'ทำ PR/สั่งของแล้ว' })).not.toBeDisabled();
    await act(async () => { pending.resolve({ error: null }); });
    expect(storeProps.setMaterialRequests).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('does not update state or notify after the store unmounts', async () => {
    const pending = deferred<{ error: null }>();
    db.eq.mockReturnValue(pending.promise);
    const { unmount } = render(<MaterialStoreDashboard {...storeProps} />);
    orderRequest();
    unmount();
    await act(async () => { pending.resolve({ error: null }); });
    expect(storeProps.setMaterialRequests).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('reports a resolved status error without an optimistic success update', async () => {
    db.eq.mockResolvedValue({ error: { message: 'Status denied' } });
    render(<MaterialStoreDashboard {...storeProps} />);
    orderRequest();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('เกิดข้อผิดพลาด: Status denied'));
    expect(storeProps.setMaterialRequests).not.toHaveBeenCalled();
  });

  it('functionally merges receipts added during upload and deduplicates its returned row', async () => {
    render(<MaterialStoreDashboard {...storeProps} materialRequests={[{ ...request, status: 'ordered' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'รอรับ' }));
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปรับของ' }));
    chooseFile(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรูปรับของ' }));
    await waitFor(() => expect(storeProps.setMaterialReceipts).toHaveBeenCalledOnce());
    const merge = storeProps.setMaterialReceipts.mock.calls[0][0];
    expect(typeof merge).toBe('function');
    const realtime = { id: 'realtime', request_id: 'request-b' };
    const original = { id: 'original', request_id: 'request-a' };
    expect(merge([realtime, original, { ...receipt, notes: 'stale copy' }])).toEqual([receipt, realtime, original]);
  });
});

describe('construction receipt upload UI', () => {
  it('creates previews only for new files and revokes on replace, remove, close, and unmount', () => {
    const { container, rerender, unmount } = render(<ReceiptUploadModal {...uploadProps} />);
    const first = chooseFile(container);
    expect(db.createUrl).toHaveBeenCalledExactlyOnceWith(first);
    fireEvent.change(screen.getByPlaceholderText('ระบุจำนวน หรือหมายเหตุเพิ่มเติม...'), { target: { value: 'New note' } });
    rerender(<ReceiptUploadModal {...uploadProps} taskName="Roof updated label" />);
    expect(db.createUrl).toHaveBeenCalledOnce();
    chooseFile(container, 'second.png');
    expect(db.revokeUrl).toHaveBeenCalledWith('blob:receipt-1');
    fireEvent.click(container.querySelector('img')!.parentElement!.querySelector('button')!);
    expect(db.revokeUrl).toHaveBeenCalledWith('blob:receipt-2');
    chooseFile(container, 'third.png');
    rerender(<ReceiptUploadModal {...uploadProps} isOpen={false} />);
    expect(db.revokeUrl).toHaveBeenCalledWith('blob:receipt-3');
    rerender(<ReceiptUploadModal {...uploadProps} />);
    chooseFile(container, 'fourth.png');
    unmount();
    expect(db.createUrl).toHaveBeenCalledTimes(4);
    expect(db.revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:receipt-1', 'blob:receipt-2', 'blob:receipt-3', 'blob:receipt-4']);
  });

  it('does not notify or close a different receipt/account context when an old upload completes', async () => {
    const pending = deferred<{ error: null }>();
    db.upload.mockReturnValue(pending.promise);
    const { container, rerender } = render(<ReceiptUploadModal {...uploadProps} />);
    chooseFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรูปรับของ' }));
    rerender(<ReceiptUploadModal {...uploadProps} requestId="request-b" currentUserName="Store B" currentUserId={2} currentAuthUserId="auth-b" />);
    fireEvent.change(screen.getByPlaceholderText('ระบุจำนวน หรือหมายเหตุเพิ่มเติม...'), { target: { value: 'New context note' } });
    await act(async () => { pending.resolve({ error: null }); });
    expect(uploadProps.onSuccess).not.toHaveBeenCalled();
    expect(uploadProps.onClose).not.toHaveBeenCalled();
    expect(db.insertReceipt).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('New context note')).toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('does not invoke upload callbacks after unmount', async () => {
    const pending = deferred<{ error: null }>();
    db.upload.mockReturnValue(pending.promise);
    const { container, unmount } = render(<ReceiptUploadModal {...uploadProps} />);
    chooseFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรูปรับของ' }));
    unmount();
    await act(async () => { pending.resolve({ error: null }); });
    expect(uploadProps.onSuccess).not.toHaveBeenCalled();
    expect(uploadProps.onClose).not.toHaveBeenCalled();
    expect(db.insertReceipt).not.toHaveBeenCalled();
  });

  it('stops after upload when only the account IDs change on the same request and role', async () => {
    const pending = deferred<{ error: null }>();
    db.upload.mockReturnValue(pending.promise);
    const { container, rerender } = render(<ReceiptUploadModal {...uploadProps} />);
    chooseFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรูปรับของ' }));
    rerender(<ReceiptUploadModal {...uploadProps} currentUserId={2} currentAuthUserId="auth-b" />);
    await act(async () => { pending.resolve({ error: null }); });
    expect(db.insertReceipt).not.toHaveBeenCalled();
    expect(uploadProps.onSuccess).not.toHaveBeenCalled();
    expect(uploadProps.onClose).not.toHaveBeenCalled();
  });

  it('does not begin a request status write when the actor changes while receipt insertion is pending', async () => {
    const pending = deferred<{ data: typeof receipt[]; error: null }>();
    db.selectReceipt.mockReturnValue(pending.promise);
    const { container, rerender } = render(<ReceiptUploadModal {...uploadProps} requestStatus="ordered" />);
    chooseFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรูปรับของ' }));
    await waitFor(() => expect(db.insertReceipt).toHaveBeenCalledOnce());
    rerender(<ReceiptUploadModal {...uploadProps} requestStatus="ordered" currentUserId={2} currentAuthUserId="auth-b" />);
    await act(async () => { pending.resolve({ data: [receipt], error: null }); });
    expect(db.update).not.toHaveBeenCalled();
    expect(uploadProps.onSuccess).not.toHaveBeenCalled();
    expect(uploadProps.onClose).not.toHaveBeenCalled();
  });

  it.each(['upload', 'insert', 'status'])('does not report success when receipt %s fails', async stage => {
    if (stage === 'upload') db.upload.mockResolvedValue({ error: { message: 'Upload failed' } });
    if (stage === 'insert') db.selectReceipt.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });
    if (stage === 'status') db.eq.mockResolvedValue({ error: { message: 'Status failed' } });
    const { container } = render(<ReceiptUploadModal {...uploadProps} requestStatus="ordered" />);
    chooseFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรูปรับของ' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/^เกิดข้อผิดพลาดในการอัปโหลด:/)));
    expect(uploadProps.onSuccess).not.toHaveBeenCalled();
    expect(uploadProps.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'บันทึกรูปรับของ' })).not.toBeDisabled();
    if (stage === 'upload') expect(db.insertReceipt).not.toHaveBeenCalled();
  });
});
