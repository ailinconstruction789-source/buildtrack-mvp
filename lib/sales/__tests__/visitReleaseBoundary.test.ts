// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: client }));
import { centralBookingReleaseAllowed, extendedSalesReleaseAllowed, visitWorkflowReleaseAllowed } from '../releaseScope';
import { handleVisitsGet, handleVisitsPost, visitsEnabled } from '../visitsServer';
import { handleVisitSopGet, handleVisitSopPost, visitSopEnabled } from '../visitSopServer';
import { customerVoicesEnabled, handleCustomerVoicesGet, handleCustomerVoicesPost, handlePublicCustomerVoicePost } from '../customerVoicesServer';
import { handleLeadWorkGet } from '../leadWorkServer';
import { handleLeadLifecycleGet } from '../leadLifecycleServer';
import { bookingsEnabled } from '../bookingServer';
import { projectSalesEnabled, salesReportsEnabled } from '../projectSalesFlags';
import { postBookingEnabled } from '../postBookingServer';

const flags = ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES', 'POST_BOOKING', 'VISITS', 'VISIT_SOP', 'CUSTOMER_VOICES'];
const workflowHandlers = [handleVisitsGet, handleVisitsPost, handleVisitSopGet, handleVisitSopPost,
  handleCustomerVoicesGet, handleCustomerVoicesPost, handlePublicCustomerVoicePost];
beforeEach(() => { vi.clearAllMocks(); flags.forEach(name => vi.stubEnv(`SALES_CRM_${name}_ENABLED`, 'true')); });
afterEach(() => vi.unstubAllEnvs());

describe('local visit-release candidate boundary (not activation)', () => {
  it.each(['central_booking', 'CENTRAL_VISITS', 'central_visits ', 'unknown', ' '])('blocks all visit endpoints before any network for scope %j', async scope => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope);
    expect(visitWorkflowReleaseAllowed()).toBe(false);
    expect([visitsEnabled(), visitSopEnabled(), customerVoicesEnabled()]).toEqual([false, false, false]);
    for (const handler of workflowHandlers) {
      const response = await handler(new Request('https://test.invalid/api'));
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('FEATURE_DISABLED');
    }
    expect(client).not.toHaveBeenCalled();
  });
  it('keeps central booking and map available while lifecycle, follow-up and post-booking stay closed', async () => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits');
    expect(centralBookingReleaseAllowed()).toBe(true);
    expect([bookingsEnabled(), projectSalesEnabled(), visitsEnabled(), visitSopEnabled(), customerVoicesEnabled()]).toEqual([true, true, true, true, true]);
    expect([extendedSalesReleaseAllowed(), salesReportsEnabled(), postBookingEnabled()]).toEqual([false, false, false]);
    for (const handler of [handleLeadWorkGet, handleLeadLifecycleGet]) {
      const response = await handler(new Request('https://test.invalid/api'));
      expect((await response.json()).error.code).toBe('FEATURE_DISABLED');
    }
    expect(client).not.toHaveBeenCalled();
  });
  it.each(['V2', 'LEAD_WORK', 'LIFECYCLE', 'VISITS'])('still requires exact dependency flag %s', name => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits'); vi.stubEnv(`SALES_CRM_${name}_ENABLED`, 'TRUE');
    expect([visitsEnabled(), visitSopEnabled(), customerVoicesEnabled()]).toEqual([false, false, false]);
  });
  it('requires independent SOP and survey switches and preserves unscoped local tests', () => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits');
    vi.stubEnv('SALES_CRM_VISIT_SOP_ENABLED', 'false'); vi.stubEnv('SALES_CRM_CUSTOMER_VOICES_ENABLED', 'false');
    expect([visitsEnabled(), visitSopEnabled(), customerVoicesEnabled()]).toEqual([true, false, false]);
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', ''); expect(visitWorkflowReleaseAllowed()).toBe(true);
  });
});
