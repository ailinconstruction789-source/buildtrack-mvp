import type { SalesReportScope, SalesReportSnapshot } from '../salesReportsContracts';
export const reportActor = '20000000-0000-4000-8000-000000000001';
export const reportScope = (overrides: Partial<SalesReportScope> = {}): SalesReportScope => ({ projectName: null, fromDate: null, toDate: null, ...overrides });
export const reportSnapshot = (scope = reportScope()): SalesReportSnapshot => ({ ...scope,
  actor: { userId: reportActor, role: 'sales' }, projects: [{ name: 'โครงการ A' }, { name: 'โครงการ & B' }],
  totals: { customers: 54, interests: scope.projectName ? 54 : 60, bookingRounds: 70, cancelledRounds: 9, netBookedHomes: 61,
    inProgress: 50, transferred: 11, knownNetSaleValue: '999999999999999.91', unknownNetSaleValueCount: 3,
    unknownBookedAtRounds: 4, unknownCancelledAtRounds: 2 },
  stageCounts: { booked: 40, contracted: 2, downpayment: 1, document_prep: 1, loan_submitted: 1,
    loan_rejected: 1, loan_approved: 2, transfer_pending: 2, transferred: 7, handover: 4, cancelled: 9 },
  coverage: { unknownLeadDateCustomers: 5, excludedUnknownLeadDateCustomers: scope.fromDate ? 5 : 0 },
});
