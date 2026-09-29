import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../BookingWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>Booking workspace</p>; } }));
import Page from '@/app/sales-crm/bookings/page';
import { customerId } from './bookingFixtures';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED'];
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
const enable = () => { for (const name of flags) vi.stubEnv(name, 'true'); };
describe('central booking route', () => {
  it.each(flags)('does not mount browser readers without exact %s=true', async flag => {
    enable(); vi.stubEnv(flag, 'TRUE'); render(await Page({ searchParams: Promise.resolve({}) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('awaits searchParams and supplies the validated existing customer', async () => {
    enable(); let resolve!: (value: Record<string, string>) => void;
    const result = Page({ searchParams: new Promise(done => { resolve = done; }) });
    expect(view).not.toHaveBeenCalled(); resolve({ customerId }); render(await result);
    expect(view).toHaveBeenCalledWith({ initialCustomerId: customerId });
  });
  it('opens search-first without a customer', async () => {
    enable(); render(await Page({ searchParams: Promise.resolve({}) })); expect(view).toHaveBeenCalledWith({ initialCustomerId: null });
  });
  it.each([{ customerId: ['one', 'two'] }, { customerId: 'bad' }, { project: 'A' }])('blocks invalid query %j before mounting', async query => {
    enable(); render(await Page({ searchParams: Promise.resolve(query) })); expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
});
