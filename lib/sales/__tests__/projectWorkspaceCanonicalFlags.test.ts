// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectWorkspaceMode } from '../projectSalesFlags';
afterEach(() => vi.unstubAllEnvs());
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED', 'SALES_CRM_PROJECT_SALES_ENABLED'];
describe('explicit rich workspace reader cutover', () => {
  it('preserves legacy mode until an explicit workspace activation', () => {
    vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'false'); expect(projectWorkspaceMode()).toBe('legacy');
  });
  it('enables the rich canonical reader only with all existing dependencies', () => {
    flags.forEach(flag => vi.stubEnv(flag, 'true')); vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', ''); expect(projectWorkspaceMode()).toBe('central');
  });
  it.each(flags)('blocks an explicitly requested cutover when %s is unavailable', flag => {
    flags.forEach(flag => vi.stubEnv(flag, 'true')); vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', ''); vi.stubEnv(flag, 'false'); expect(projectWorkspaceMode()).toBe('blocked');
  });
  it('fails closed on an unknown bounded release', () => {
    flags.forEach(flag => vi.stubEnv(flag, 'true')); vi.stubEnv('SALES_CRM_PROJECT_WORKSPACE_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'unknown'); expect(projectWorkspaceMode()).toBe('blocked');
  });
});
