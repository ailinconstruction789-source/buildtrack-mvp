import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const mock = vi.hoisted(() => ({ legacy: vi.fn(), central: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => mock.legacy }));
vi.mock('../ProjectSalesWorkspace', () => ({ default: mock.central }));
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import SalesWorkspaceEntry from '../SalesWorkspaceEntry';
import SalesPage from '@/app/sales/page';
mock.legacy.mockImplementation(() => <p>legacy workspace</p>);
mock.central.mockImplementation(() => <p>central project reader</p>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('project workspace replacement boundary', () => {
  it('preserves original workspace and all props when retirement switch is off', () => {
    const props = { project: { name: 'โครงการ A' }, projects: [], user: { role: 'sales' }, initialTab: 'lead_tracker', onBack: vi.fn() };
    render(<SalesWorkspaceModeProvider mode="legacy"><SalesWorkspaceEntry {...props} /></SalesWorkspaceModeProvider>);
    expect(screen.getByText('legacy workspace')).toBeInTheDocument(); expect(mock.legacy.mock.calls[0][0]).toEqual(props);
    expect(mock.central).not.toHaveBeenCalled();
  });
  it('mounts only the central project reader; legacy Lead tab/panels never mount', () => {
    const back = vi.fn();
    render(<SalesWorkspaceModeProvider mode="central"><SalesWorkspaceEntry project={{ name: 'โครงการ A' }} initialTab="lead_tracker" onBack={back} /></SalesWorkspaceModeProvider>);
    expect(mock.legacy).not.toHaveBeenCalled();
    expect(mock.central.mock.calls[0][0]).toEqual({ initialProjectName: 'โครงการ A', initialTab: 'booked', initialView: 'map', onBack: back });
  });
  it('preserves a transferred deep entry and does not invent a default project', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesWorkspaceEntry initialTab="transferred" /></SalesWorkspaceModeProvider>);
    expect(mock.central.mock.calls[0][0]).toMatchObject({ initialProjectName: null, initialTab: 'transferred' });
  });
  it('routes old daily Visit entry to central work without mounting legacy schedule/writers', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesWorkspaceEntry project={{ name: 'โครงการ & A' }} initialTab="daily_visits" /></SalesWorkspaceModeProvider>);
    expect(screen.getByRole('link', { name: 'เปิด Lead ส่วนกลาง →' })).toHaveAttribute('href', '/sales-crm');
    const projectLink = screen.getByRole('link', { name: 'ดูลูกค้าจองของโครงการ →' }).getAttribute('href')!;
    expect(new URL(projectLink, 'https://test.invalid').searchParams.get('projectName')).toBe('โครงการ & A');
    expect(mock.legacy).not.toHaveBeenCalled(); expect(mock.central).not.toHaveBeenCalled();
  });
  it('fails closed for missing provider or incomplete configuration, and supports Back', () => {
    const back = vi.fn(); render(<SalesWorkspaceEntry onBack={back} />);
    expect(screen.getByRole('alert')).toBeInTheDocument(); fireEvent.click(screen.getByText('กลับหน้าก่อนหน้า')); expect(back).toHaveBeenCalledOnce();
    expect(mock.legacy).not.toHaveBeenCalled(); expect(mock.central).not.toHaveBeenCalled();
  });
  it('the direct sales route uses the same boundary', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesPage /></SalesWorkspaceModeProvider>);
    expect(mock.central).toHaveBeenCalledOnce(); expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('root client entry cannot bypass the server-injected mode or directly mount SalesKanban', () => {
    const root = readFileSync('app/page.tsx', 'utf8'), layout = readFileSync('app/layout.tsx', 'utf8');
    expect(root).toContain("import('@/components/sales/SalesWorkspaceEntry')"); expect(root).not.toContain('<SalesKanban');
    expect(layout).toContain('<SalesWorkspaceModeProvider mode={projectWorkspaceMode()} postBookingEnabled={postBookingEnabled()}>{children}</SalesWorkspaceModeProvider>');
  });
});
