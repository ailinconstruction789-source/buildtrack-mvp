import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../PostBookingWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>Post-booking workspace</p>; } }));
import Page from '@/app/sales-crm/post-booking/page';
import PostBookingLink from '../PostBookingLink';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
const saleId = '21000000-0000-4000-8000-000000000001';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED', 'SALES_CRM_POST_BOOKING_ENABLED'];
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
const enable = () => { for (const name of flags) vi.stubEnv(name, 'true'); };
describe('post-booking page and gated entry', () => {
  it.each(flags)('does not mount readers without exact %s=true', async flag => {
    enable(); vi.stubEnv(flag, 'TRUE'); render(await Page({ searchParams: Promise.resolve({ saleId }) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('awaits and validates the actual booking ID', async () => {
    enable(); let resolve!: (query: Record<string, string>) => void;
    const page = Page({ searchParams: new Promise(done => { resolve = done; }) });
    expect(view).not.toHaveBeenCalled(); resolve({ saleId }); render(await page);
    expect(view).toHaveBeenCalledWith({ saleId });
  });
  it.each([{}, { saleId: 'bad' }, { saleId: [saleId, saleId] }, { saleId, customerId: saleId }])('blocks malformed query %j', async query => {
    enable(); render(await Page({ searchParams: Promise.resolve(query) })); expect(view).not.toHaveBeenCalled();
    expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
  it('does not advertise an unavailable post-booking action', () => {
    const { rerender } = render(<PostBookingLink saleId={saleId} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    rerender(<SalesWorkspaceModeProvider mode="central"><PostBookingLink saleId={saleId} /></SalesWorkspaceModeProvider>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    rerender(<SalesWorkspaceModeProvider mode="central" postBookingEnabled><PostBookingLink saleId={saleId} /></SalesWorkspaceModeProvider>);
    expect(screen.getByRole('link')).toHaveAttribute('href', `/sales-crm/post-booking?saleId=${saleId}`);
  });
});
