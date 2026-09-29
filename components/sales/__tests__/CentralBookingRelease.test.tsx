import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ central: vi.fn<(props: Record<string, unknown>) => null>(() => null), report: vi.fn(() => null), work: vi.fn(() => null), client: vi.fn() }));
vi.mock('../CentralLeadsView', () => ({ default: mock.central }));
vi.mock('../LeadWorkView', () => ({ default: mock.work }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.client }));
import CentralPage from '@/app/sales-crm/page';
import WorkPage from '@/app/sales-crm/[customerId]/page';
import { bookingsEnabled } from '@/lib/sales/bookingServer';
import { projectSalesEnabled, projectWorkspaceMode, salesReportsEnabled } from '@/lib/sales/projectSalesFlags';
import { handleCentralGet } from '@/lib/sales/centralServer';
import { handleLeadWorkGet } from '@/lib/sales/leadWorkServer';
import { handleLeadLifecycleGet } from '@/lib/sales/leadLifecycleServer';

function flags(scope = 'central_booking') {
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope);
  for (const name of ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES', 'PROJECT_WORKSPACE', 'SCHEDULE', 'NOTIFICATIONS', 'SLA_PREVIEW', 'QUEUE_MONITOR']) {
    vi.stubEnv(`SALES_CRM_${name}_ENABLED`, 'true');
  }
}
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('bounded central-booking release', () => {
  it('keeps booking dependencies without advertising unavailable workflows', () => {
    flags(); render(<CentralPage />);
    expect(mock.central.mock.calls[0][0]).toMatchObject({ bookingEnabled: true, projectSalesEnabled: true,
      leadWorkEnabled: false, reportsEnabled: false, workScheduleEnabled: false, notificationsEnabled: false, slaPreviewEnabled: false, queueMonitorEnabled: false });
    expect(bookingsEnabled()).toBe(true); expect(projectSalesEnabled()).toBe(true); expect(projectWorkspaceMode()).toBe('central');
    expect(salesReportsEnabled()).toBe(false);
  });
  it('does not mount direct lead-work routes', async () => {
    flags(); render(await WorkPage({ params: Promise.resolve({ customerId: '00000000-0000-4000-8000-000000000001' }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText('ยังไม่เปิดงานติดตามลูกค้า')).toBeInTheDocument();
    expect(mock.report).not.toHaveBeenCalled(); expect(mock.work).not.toHaveBeenCalled();
  });
  it('denies excluded direct APIs before making any network calls', async () => {
    flags();
    for (const handler of [handleLeadWorkGet, handleLeadLifecycleGet]) {
      const reply = await handler(new Request('https://test.invalid/api'));
      expect(reply.status).toBe(503); expect((await reply.json()).error.code).toBe('FEATURE_DISABLED');
    }
    expect(mock.client).not.toHaveBeenCalled();
  });
  it.each(['CENTRAL_BOOKING', 'typo', ' '])('fails closed for unknown scope %j', async scope => {
    flags(scope);
    expect(bookingsEnabled()).toBe(false); expect(projectSalesEnabled()).toBe(false); expect(projectWorkspaceMode()).toBe('blocked');
    const reply = await handleCentralGet(new Request('https://test.invalid/api'));
    expect(reply.status).toBe(503); expect(mock.client).not.toHaveBeenCalled();
  });
  it('does not remount legacy project writers when the explicit release is incompletely configured', () => {
    flags(); vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'false'); expect(projectWorkspaceMode()).toBe('blocked');
  });
  it('preserves the old opt-in behavior when release scope is unset', () => {
    flags(''); render(<CentralPage />);
    expect(mock.central.mock.calls[0][0]).toMatchObject({ bookingEnabled: true, leadWorkEnabled: true, reportsEnabled: true });
    vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'false'); expect(projectWorkspaceMode()).toBe('legacy');
  });
});
