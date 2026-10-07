import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { view, enabled, visitsEnabled } = vi.hoisted(() => ({ view: vi.fn(), enabled: vi.fn(), visitsEnabled: vi.fn() }));
vi.mock('../ProjectInterestsWorkspace', () => ({ default: (props: unknown) => { view(props); return <p>Interests workspace</p>; } }));
vi.mock('@/lib/sales/projectInterestsServer', () => ({ projectInterestsEnabled: enabled }));
vi.mock('@/lib/sales/visitsServer', () => ({ visitsEnabled }));
import Page from '@/app/sales-crm/interests/page';
import { piId } from '@/lib/sales/__tests__/projectInterestsFixtures';
beforeEach(() => { vi.clearAllMocks(); enabled.mockReturnValue(true); visitsEnabled.mockReturnValue(false); });
afterEach(cleanup);
describe('gated project interest route', () => {
  it('does not mount or await query data while the feature is off', async () => {
    enabled.mockReturnValue(false); render(await Page({ searchParams: new Promise(() => {}) }));
    expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด'); expect(visitsEnabled).not.toHaveBeenCalled();
  });
  it('awaits and validates customerId, and passes the Visit server gate separately', async () => {
    let resolve!: (query: Record<string, string>) => void; const page = Page({ searchParams: new Promise(done => { resolve = done; }) });
    expect(view).not.toHaveBeenCalled(); visitsEnabled.mockReturnValue(true); resolve({ customerId: piId(1) }); render(await page);
    expect(view).toHaveBeenCalledWith({ customerId: piId(1), visitsEnabled: true });
  });
  it('keeps Visit links off unless its own feature is enabled', async () => {
    render(await Page({ searchParams: Promise.resolve({ customerId: piId(1) }) })); expect(view).toHaveBeenCalledWith({ customerId: piId(1), visitsEnabled: false });
  });
  it.each([{}, { customerId: 'bad' }, { customerId: [piId(1)] }, { customerId: piId(1), page: '0' }, { customerId: piId(1), interestId: piId(4) }])('blocks malformed query %j before mounting', async query => {
    render(await Page({ searchParams: Promise.resolve(query) })); expect(view).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
});
