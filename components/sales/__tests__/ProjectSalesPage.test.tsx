import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view, enabled } = vi.hoisted(() => ({ view: vi.fn(), enabled: vi.fn<() => boolean>() }));
vi.mock('../ProjectSalesWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>Project Sales workspace</p>; } }));
vi.mock('@/lib/sales/projectSalesServer', () => ({ projectSalesEnabled: enabled }));
import Page from '@/app/sales-crm/projects/page';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('project booked customers page', () => {
  it('does not mount the browser reader or await input while the feature is off', async () => {
    enabled.mockReturnValue(false);
    render(await Page({ searchParams: new Promise(() => {}) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });

  it('opens only the project chooser without a query', async () => {
    enabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve({}) }));
    expect(view).toHaveBeenCalledWith({ initialProjectName: null, initialTab: 'booked' });
  });

  it('awaits and validates project and tab before mounting', async () => {
    enabled.mockReturnValue(true); let resolve!: (value: Record<string, string>) => void;
    const page = Page({ searchParams: new Promise(done => { resolve = done; }) });
    expect(view).not.toHaveBeenCalled(); resolve({ projectName: 'โครงการ A', tab: 'cancelled' }); render(await page);
    expect(view).toHaveBeenCalledWith({ initialProjectName: 'โครงการ A', initialTab: 'cancelled' });
  });

  it.each([
    { projectName: ['A', 'B'] }, { tab: ['booked', 'all'] }, { projectName: '' }, { tab: 'unknown' },
    { customerId: '19000000-0000-4000-8000-000000000002' }, { query: 'hidden' }, { page: '1' }, { projectName: 'A\nB' },
  ])('rejects malformed page query %j without a reader', async query => {
    enabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve(query) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์โครงการไม่ถูกต้อง');
  });
});
