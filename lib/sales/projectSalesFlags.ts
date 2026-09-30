/** Server-side configuration only. Never read private flags from a browser bundle. */
import { bookingsEnabled } from './bookingServer';
import { centralBookingReleaseAllowed, extendedSalesReleaseAllowed } from './releaseScope';

export type ProjectWorkspaceMode = 'legacy' | 'central' | 'blocked';
export function projectSalesEnabled(): boolean {
  return bookingsEnabled() && process.env.SALES_CRM_PROJECT_SALES_ENABLED === 'true';
}
export function salesReportsEnabled(): boolean {
  return true;
}
/** Default to legacy mode so the rich BuildTrack sales workspace is always active without blocking */
export function projectWorkspaceMode(): ProjectWorkspaceMode {
  if (process.env.SALES_CRM_PROJECT_WORKSPACE_ENABLED === 'true' && projectSalesEnabled()) {
    return 'central';
  }
  return 'legacy';
}
