import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { view, enabled } = vi.hoisted(() => ({ view: vi.fn(), enabled: vi.fn() }));
vi.mock('../VisitFollowUpWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>follow-up workspace</p>; } }));
vi.mock('@/lib/sales/leadWorkServer', () => ({ visitFollowUpEnabled: enabled }));
import Page from '@/app/sales-crm/visit-follow-up/page';
const customerId = '00000000-0000-4000-8000-000000000001', interestId = '00000000-0000-4000-8000-000000000002';
beforeEach(() => { vi.clearAllMocks(); enabled.mockReturnValue(true); }); afterEach(cleanup);
describe('narrow follow-up page gate', () => {
  it('does not resolve query or mount browser reads while disabled', async () => {
    enabled.mockReturnValue(false); render(await Page({ searchParams: new Promise(() => {}) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('awaits both required scope IDs', async () => {
    let resolve!: (value: Record<string, string>) => void;
    const page = Page({ searchParams: new Promise(done => { resolve = done; }) });
    expect(view).not.toHaveBeenCalled(); resolve({ customerId, interestId }); render(await page);
    expect(view).toHaveBeenCalledWith({ scope: { customerId, interestId } });
  });
  it.each([{}, { customerId }, { customerId, interestId: '' }, { customerId, interestId: 'bad' },
    { customerId: [customerId], interestId }, { customerId, interestId: [interestId] }, { customerId, interestId, mode: 'record_attempt' },
    { customerId, interestId, visitId: customerId }])('rejects malformed or expanded query %j', async query => {
    render(await Page({ searchParams: Promise.resolve(query) })); expect(view).not.toHaveBeenCalled();
    expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
});
