/** Server-side configuration only. Never read private flags from a browser bundle. */
import { bookingsEnabled } from './bookingServer';
import { centralBookingReleaseAllowed, extendedSalesReleaseAllowed } from './releaseScope';

export type ProjectWorkspaceMode = 'legacy' | 'central' | 'blocked';
export function projectSalesEnabled(): boolean {
  return bookingsEnabled() && process.env.SALES_CRM_PROJECT_SALES_ENABLED === 'true';
}
export function salesReportsEnabled(): boolean {
  return extendedSalesReleaseAllowed() && projectSalesEnabled();
}
/** Previewing the reader is separate from retiring the old workspace. Both default off. */
export function projectWorkspaceMode(): ProjectWorkspaceMode {
  if (!centralBookingReleaseAllowed()) return 'blocked';
  if (process.env.SALES_CRM_PROJECT_WORKSPACE_ENABLED !== 'true') return extendedSalesReleaseAllowed() ? 'legacy' : 'blocked';
  return projectSalesEnabled() ? 'central' : 'blocked';
}
