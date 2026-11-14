import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDemoProjects from '@/components/admin/AdminDemoProjects';
import { createDemoLayout, type DemoProject } from '@/lib/demoProjects';

const calls = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/demoProjects', async original => ({
  ...await original<typeof import('@/lib/demoProjects')>(),
  listDemoProjects: calls.list, createDemoProject: calls.create, saveDemoProject: calls.save,
}));
const project = (): DemoProject => ({ id: 'd0000000-0000-4000-8000-000000000001', name: 'Demo ถนน A',
  created_by: 'a0000000-0000-4000-8000-000000000001', created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z',
  revision: 1, layout_data: createDemoLayout() });
beforeEach(() => { vi.clearAllMocks(); calls.list.mockResolvedValue([project()]); calls.create.mockResolvedValue(project()); });
afterEach(cleanup);

describe('Admin Demo projects', () => {
  it('does not read data or offer creation to non-admins', () => {
    render(<AdminDemoProjects isAdmin={false} onBack={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('เฉพาะ Admin');
    expect(calls.list).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'สร้าง Demo พร้อมผังตัวอย่าง' })).not.toBeInTheDocument();
  });

  it('keeps creation disabled until trusted access and loading succeed', async () => {
    calls.list.mockRejectedValue(new Error('ยังยืนยันสิทธิ์ของบัญชีไม่ได้'));
    render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'สร้าง Demo พร้อมผังตัวอย่าง' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('ยังยืนยันสิทธิ์');
    expect(screen.getByRole('button', { name: 'สร้าง Demo พร้อมผังตัวอย่าง' })).toBeDisabled();
  });

  it('discards a pending list when admin access is removed', async () => {
    let resolve!: (rows: DemoProject[]) => void;
    calls.list.mockReturnValue(new Promise<DemoProject[]>(done => { resolve = done; }));
    const view = render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    view.rerender(<AdminDemoProjects isAdmin={false} onBack={vi.fn()} />);
    await act(async () => resolve([project()]));
    expect(screen.queryByText('Demo ถนน A')).not.toBeInTheDocument();
  });

  it('creates a sandbox and opens its example map', async () => {
    render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    await screen.findByRole('button', { name: /Demo ถนน A/ });
    fireEvent.change(screen.getByLabelText('สร้างโครงการทดลอง'), { target: { value: 'Demo ถนน A' } });
    fireEvent.click(screen.getByRole('button', { name: 'สร้าง Demo พร้อมผังตัวอย่าง' }));
    expect(await screen.findByRole('group', { name: 'ผัง Demo แบบตาราง' })).toBeInTheDocument();
    expect(calls.create).toHaveBeenCalledWith('Demo ถนน A', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(screen.getByText('บันทึกผัง Demo')).toBeDisabled();
  });

  it('retains the create UUID after an uncertain result so retry cannot duplicate it', async () => {
    calls.create.mockRejectedValueOnce(new Error('เครือข่ายขัดข้อง')).mockResolvedValueOnce(project());
    render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    await screen.findByRole('button', { name: /Demo ถนน A/ });
    fireEvent.click(screen.getByRole('button', { name: 'สร้าง Demo พร้อมผังตัวอย่าง' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'สร้าง Demo พร้อมผังตัวอย่าง' }));
    await screen.findByRole('group', { name: 'ผัง Demo แบบตาราง' });
    expect(calls.create.mock.calls[0][1]).toBe(calls.create.mock.calls[1][1]);
  });

  it('edits one layer without removing overlapping utilities and saves by revision', async () => {
    calls.save.mockImplementation(async (row, layout) => ({ ...row, layout_data: layout, revision: 2 }));
    render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Demo ถนน A/ }));
    // This coordinate contains both road and drainage in the seed.
    fireEvent.click(screen.getByText('ลบเฉพาะชั้นที่เลือก'));
    fireEvent.click(screen.getByLabelText('ช่อง 3, 8'));
    fireEvent.click(screen.getByText('บันทึกผัง Demo'));
    await screen.findByText('บันทึกผัง Demo แล้ว');
    const [previous, layout] = calls.save.mock.calls[0];
    expect(previous.revision).toBe(1);
    expect(layout.cells.some((cell: { x: number; y: number; kind: string }) => cell.x === 2 && cell.y === 7 && cell.kind === 'road')).toBe(false);
    expect(layout.cells.some((cell: { x: number; y: number; kind: string }) => cell.x === 2 && cell.y === 7 && cell.kind === 'drainage')).toBe(true);
    expect(screen.getByText('บันทึกผัง Demo')).toBeDisabled();
  });

  it('preserves unsaved edits after a save conflict and can reload latest server revision', async () => {
    calls.save.mockRejectedValueOnce(new Error('โครงการ Demo ถูกแก้ไขแล้วหรือสิทธิ์เปลี่ยน กรุณาโหลดใหม่ก่อนบันทึก'));
    render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Demo ถนน A/ }));
    fireEvent.click(screen.getByLabelText('ช่อง 1, 1'));
    fireEvent.click(screen.getByText('บันทึกผัง Demo'));
    await screen.findByRole('alert');
    expect(screen.getByText('บันทึกผัง Demo')).toBeEnabled();
    expect(screen.getByText(/มีการแก้ไขที่ยังไม่บันทึก/)).toBeInTheDocument();
    await waitFor(() => expect(calls.save).toHaveBeenCalledTimes(1));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    calls.list.mockResolvedValueOnce([{ ...project(), revision: 2 }]);
    fireEvent.click(screen.getByText('โหลดข้อมูลล่าสุด'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/มีการแก้ไขที่ยังไม่บันทึก/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('โหลดข้อมูลล่าสุด'));
    await screen.findByText('โหลดข้อมูลโครงการ Demo ล่าสุดแล้ว');
    expect(screen.getByText(/ฉบับบันทึก 2/)).toBeInTheDocument();
    expect(screen.queryByText(/มีการแก้ไขที่ยังไม่บันทึก/)).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('clears loaded demo data immediately if session changes or admin access is revoked during save', async () => {
    calls.save.mockRejectedValueOnce(new Error('บัญชีผู้ใช้เปลี่ยนระหว่างดำเนินการ กรุณาเปิดโครงการ Demo ใหม่'));
    render(<AdminDemoProjects isAdmin onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Demo ถนน A/ }));
    fireEvent.click(screen.getByLabelText('ช่อง 1, 1'));
    fireEvent.click(screen.getByText('บันทึกผัง Demo'));
    expect(await screen.findByRole('alert')).toHaveTextContent('บัญชีผู้ใช้เปลี่ยน');
    expect(screen.queryByRole('group', { name: 'ผัง Demo แบบตาราง' })).not.toBeInTheDocument();
    expect(screen.queryByText('Demo ถนน A')).not.toBeInTheDocument();
  });

  it('warns before leaving or switching projects when draft has unsaved changes', async () => {
    const onBack = vi.fn();
    render(<AdminDemoProjects isAdmin onBack={onBack} />);
    fireEvent.click(await screen.findByRole('button', { name: /Demo ถนน A/ }));
    fireEvent.click(screen.getByLabelText('ช่อง 1, 1'));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByText('กลับหน้าโครงการ'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('กลับหน้าโครงการ'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});
