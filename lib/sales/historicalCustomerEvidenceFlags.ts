/** Server-only opt-in; installation and existing release capabilities are still required. */
import { projectSalesEnabled } from './projectSalesFlags';
import { extendedSalesReleaseAllowed } from './releaseScope';
export function historicalCustomerEvidenceEnabled(): boolean {
  return extendedSalesReleaseAllowed() && projectSalesEnabled() && process.env.SALES_CRM_HISTORICAL_EVIDENCE_ENABLED === 'true';
}
