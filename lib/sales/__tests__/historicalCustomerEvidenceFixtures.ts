import { bid } from './bookingFixtures';
import type { HistoricalCustomerEvidenceScope, HistoricalCustomerEvidenceSnapshot } from '../historicalCustomerEvidenceContracts';
export const historyScope: HistoricalCustomerEvidenceScope = { customerId: bid(2), interestId: null, saleId: null, page: 0 };
export function evidenceSnapshot(scope = historyScope): HistoricalCustomerEvidenceSnapshot {
  return { ...scope, contractVersion: 'historical_customer_evidence_v1', actor: { userId: bid(8), role: 'sales' }, hasMore: false, readOnly: true,
    records: [{ key: `${bid(10)}:926`, customerId: scope.customerId, projectName: scope.interestId || scope.saleId ? 'โครงการ A' : null,
      projectNames: scope.interestId || scope.saleId ? ['โครงการ A'] : [],
      interestId: scope.interestId, saleId: scope.saleId, sourceRow: 926, events: [{ kind: 'visited', date: '2026-08-23', precision: 'day' }] }] };
}
