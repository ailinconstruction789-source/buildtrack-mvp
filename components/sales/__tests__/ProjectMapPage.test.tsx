import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ view: vi.fn(), enabled: vi.fn() }));
vi.mock('../ProjectSalesWorkspace', () => ({ default: (props: unknown) => { mock.view(props); return <p>Map workspace</p>; } }));
vi.mock('@/lib/sales/projectSalesFlags', () => ({ projectSalesEnabled: mock.enabled }));
import Page from '@/app/sales-crm/projects/map/page';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('read-only map entry', () => {
  it('keeps the existing release gate and does not await params when closed', async () => {
    mock.enabled.mockReturnValue(false); render(await Page({ searchParams: new Promise(() => {}) }));
    expect(mock.view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('opens a project chooser in map view with no implicit project', async () => {
    mock.enabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve({}) }));
    expect(mock.view).toHaveBeenCalledWith({ initialProjectName: null, initialView: 'map' });
  });
  it('accepts an exact project deep link', async () => {
    mock.enabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve({ projectName: 'โครงการ A' }) }));
    expect(mock.view).toHaveBeenCalledWith({ initialProjectName: 'โครงการ A', initialView: 'map' });
  });
  it.each([{ projectName: ['A', 'B'] }, { projectName: '' }, { page: '1' }, { tab: 'cancelled' }])('rejects malformed query %j', async query => {
    mock.enabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve(query) }));
    expect(mock.view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์โครงการไม่ถูกต้อง');
  });
});
