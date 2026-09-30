import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { view, enabled, followUpEnabled } = vi.hoisted(() => ({ view: vi.fn(), enabled: vi.fn(), followUpEnabled: vi.fn() }));
vi.mock('../VisitSopWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>SOP workspace</p>; } }));
vi.mock('@/lib/sales/visitSopServer', () => ({ visitSopEnabled: enabled }));
vi.mock('@/lib/sales/leadWorkServer', () => ({ visitFollowUpEnabled: followUpEnabled }));
import Page from '@/app/sales-crm/sop/page';
import { sopAnchor, sopId } from '@/lib/sales/__tests__/visitSopFixtures';
beforeEach(() => { vi.clearAllMocks(); enabled.mockReturnValue(true); followUpEnabled.mockReturnValue(false); }); afterEach(cleanup);
describe('SOP gated page', () => {
  it('does not mount or read query while disabled', async () => {
    enabled.mockReturnValue(false); render(await Page({ searchParams: new Promise(() => {}) })); expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('awaits and validates the appointment anchor', async () => {
    let resolve!: (value: Record<string, string>) => void; const page = Page({ searchParams: new Promise(done => { resolve = done; }) });
    expect(view).not.toHaveBeenCalled(); resolve({ customerId: sopId(1), interestId: sopId(2), appointmentId: sopId(3) }); render(await page); expect(view).toHaveBeenCalledWith({ anchor: sopAnchor(), followUpEnabled: false });
  });
  it('accepts an explicit Visit instead of an appointment', async () => {
    render(await Page({ searchParams: Promise.resolve({ customerId: sopId(1), interestId: sopId(2), visitId: sopId(4) }) }));
    expect(view).toHaveBeenCalledWith({ anchor: { ...sopAnchor(), appointmentId: null, visitId: sopId(4) }, followUpEnabled: false });
  });
  it('passes the independent follow-up gate without opening generic lifecycle', async () => {
    followUpEnabled.mockReturnValue(true);
    render(await Page({ searchParams: Promise.resolve({ customerId: sopId(1), interestId: sopId(2), appointmentId: sopId(3) }) }));
    expect(view).toHaveBeenCalledWith({ anchor: sopAnchor(), followUpEnabled: true });
  });
  it.each([{}, { customerId: sopId(1), interestId: sopId(2) }, { customerId: sopId(1), interestId: sopId(2), appointmentId: sopId(3), visitId: sopId(4) },
    { customerId: [sopId(1)], interestId: sopId(2), visitId: sopId(4) }, { customerId: sopId(1), interestId: sopId(2), visitId: sopId(4), eventPage: '0' }])('rejects malformed scope %j before mounting', async query => {
    render(await Page({ searchParams: Promise.resolve(query) })); expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
});
