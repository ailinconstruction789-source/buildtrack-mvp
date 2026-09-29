import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const map = vi.hoisted(() => vi.fn());
vi.mock('../ProjectSalesMap', () => ({ default: (props: { projectName: string }) => { map(props); return <p>Map for {props.projectName}</p>; } }));
import ProjectSalesWorkspace from '../ProjectSalesWorkspace';
import { projectSalesSnapshot } from './projectSalesFixtures';
import type { ProjectSalesScope } from '@/lib/sales/projectSalesContracts';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('project map and booking list navigation', () => {
  it('shows map without inheriting filtered rows and can return to history', async () => {
    const api = { read: vi.fn(async (scope: ProjectSalesScope) => projectSalesSnapshot(scope)) };
    render(<ProjectSalesWorkspace initialProjectName="โครงการ A" initialTab="cancelled" api={api} />);
    await screen.findByRole('region', { name: 'รายการจองโครงการ โครงการ A' });
    fireEvent.click(screen.getByRole('button', { name: 'ผังโครงการ (Project Map)' }));
    expect(map).toHaveBeenLastCalledWith({ projectName: 'โครงการ A' });
    expect(screen.queryByLabelText('ค้นหาชื่อ เบอร์โทร หรือแปลง')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'รายการจองและประวัติ' }));
    expect(screen.getByRole('tab', { name: 'ประวัติยกเลิก' })).toHaveAttribute('aria-selected', 'true');
  });
  it('opens map after choosing a project, never silently selects another project', async () => {
    const api = { read: vi.fn(async (scope: ProjectSalesScope) => projectSalesSnapshot(scope)) };
    render(<ProjectSalesWorkspace initialView="map" api={api} />);
    await screen.findByText('เลือกโครงการเพื่อดูรายการจองและประวัติ');
    expect(map).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('โครงการ'), { target: { value: 'โครงการ A' } });
    await screen.findByText('Map for โครงการ A');
    expect(map).toHaveBeenLastCalledWith({ projectName: 'โครงการ A' });
  });
});
