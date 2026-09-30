import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ staff: vi.fn(), customer: vi.fn(), enabled: vi.fn() }));
vi.mock('../CustomerVoicesWorkspace', () => ({ default: (props: unknown) => { mock.staff(props); return <p>Staff voices workspace</p>; } }));
vi.mock('../CustomerVoicePublic', () => ({ default: () => { mock.customer(); return <p>Public voice form</p>; } }));
vi.mock('@/lib/sales/customerVoicesServer', () => ({ customerVoicesEnabled: mock.enabled }));
import StaffPage from '@/app/sales-crm/customer-voices/page';
import PublicPage, { metadata } from '@/app/customer-voices/page';
import config from '../../../next.config';
import { voiceScope } from '@/lib/sales/__tests__/customerVoicesFixtures';
beforeEach(() => { vi.clearAllMocks(); mock.enabled.mockReturnValue(true); });
afterEach(cleanup);
describe('Customer Voices gated pages', () => {
  it('does not mount any form/reader when disabled or await an unresolved query', async () => {
    mock.enabled.mockReturnValue(false); render(await StaffPage({ searchParams: new Promise(() => {}) })); expect(mock.staff).not.toHaveBeenCalled();
    cleanup(); render(PublicPage()); expect(mock.customer).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
  });
  it('passes only strict staff scope to the workspace', async () => {
    render(await StaffPage({ searchParams: Promise.resolve({ ...voiceScope() }) })); expect(mock.staff).toHaveBeenCalledWith({ scope: voiceScope() });
  });
  it.each([{}, { ...voiceScope(), visitId: 'bad' }, { ...voiceScope(), visitId: [voiceScope().visitId] }, { ...voiceScope(), token: 'secret' }])('does not mount staff reader for malformed scope %j', async query => {
    render(await StaffPage({ searchParams: Promise.resolve(query) })); expect(mock.staff).not.toHaveBeenCalled(); expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์');
  });
  it('public page renders no server-provided identity and is not indexed', () => {
    render(PublicPage()); expect(mock.customer).toHaveBeenCalledWith(); expect(metadata.robots).toEqual({ index: false, follow: false }); expect(metadata.referrer).toBe('no-referrer');
  });
  it('only public survey route receives privacy/frame headers without changing other routes', async () => {
    const rules = await config.headers!(); expect(rules).toHaveLength(1); expect(rules[0].source).toBe('/customer-voices');
    expect(rules[0].headers).toEqual(expect.arrayContaining([{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Cache-Control', value: 'no-store' }]));
  });
});
