import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { view, enabled, sopEnabled, voicesEnabled } = vi.hoisted(() => ({ view: vi.fn(), enabled: vi.fn(), sopEnabled: vi.fn(), voicesEnabled: vi.fn() }));
vi.mock('../VisitsWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>Visit workspace</p>; } }));
vi.mock('@/lib/sales/visitsServer', () => ({ visitsEnabled: enabled }));
vi.mock('@/lib/sales/visitSopServer', () => ({ visitSopEnabled: sopEnabled }));
vi.mock('@/lib/sales/customerVoicesServer', () => ({ customerVoicesEnabled: voicesEnabled }));
import Page from '@/app/sales-crm/visits/page';
import { customerId, interestId } from './visitsFixtures';
beforeEach(() => { vi.clearAllMocks(); enabled.mockReturnValue(true); sopEnabled.mockReturnValue(false); voicesEnabled.mockReturnValue(false); });
afterEach(cleanup);
describe('gated visit page', () => {
  it('does not mount any reader when disabled, even if query parameters never resolve', async () => {
    enabled.mockReturnValue(false); render(await Page({ searchParams: new Promise(() => {}) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('awaits and strictly validates the customer and interest identifiers', async () => {
    let resolve!: (query: Record<string, string>) => void;
    const page = Page({ searchParams: new Promise(done => { resolve = done; }) }); expect(view).not.toHaveBeenCalled();
    resolve({ customerId, interestId }); render(await page); expect(view).toHaveBeenCalledWith({ customerId, interestId, sopEnabled: false, voicesEnabled: false });
  });
  it('passes the independent SOP gate without activating it', async () => {
    sopEnabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve({ customerId, interestId }) }));
    expect(view).toHaveBeenCalledWith({ customerId, interestId, sopEnabled: true, voicesEnabled: false });
  });
  it('passes the independent Customer Voices gate without activating it', async () => {
    voicesEnabled.mockReturnValue(true); render(await Page({ searchParams: Promise.resolve({ customerId, interestId }) }));
    expect(view).toHaveBeenCalledWith({ customerId, interestId, sopEnabled: false, voicesEnabled: true });
  });
  it.each([{}, { customerId }, { customerId, interestId: 'bad' }, { customerId: [customerId, customerId], interestId }, { customerId, interestId, page: '0' }])('blocks malformed query %j', async query => {
    render(await Page({ searchParams: Promise.resolve(query) })); expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
});
