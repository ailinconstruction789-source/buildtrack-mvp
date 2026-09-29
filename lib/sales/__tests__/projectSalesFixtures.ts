import type { ProjectSaleRow, ProjectSalesScope, ProjectSalesSnapshot } from '../projectSalesContracts';
export const pid = (n: number) => `19000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const projectScope = (overrides: Partial<ProjectSalesScope> = {}): ProjectSalesScope => ({ projectName: 'โครงการ A', tab: 'booked', query: '', page: 0, ...overrides });
export const projectSale = (overrides: Partial<ProjectSaleRow> = {}): ProjectSaleRow => ({
  saleId: pid(1), customerId: pid(2), customerName: 'ลูกค้าสมมติ', phone: null, interestId: pid(3), projectName: 'โครงการ A',
  ownerUserId: pid(8), ownerName: 'Sales สมมติ', plotId: 'P-1', plotName: 'A1', stage: 'booked', bookingRound: 1,
  previousSaleId: null, bookedAt: null, cancelledAt: null, cancellationReason: null,
  listPrice: null, discountAmount: null, salePrice: null, depositAmount: null, paymentMethod: null, ...overrides,
});
export const projectSnapshot = (scope = projectScope()): ProjectSalesSnapshot => ({ ...scope,
  actor: { userId: pid(8), role: 'sales' }, projects: [{ name: 'โครงการ A' }, { name: 'โครงการ B' }], hasMore: false,
  rows: scope.projectName ? [projectSale({ projectName: scope.projectName,
    stage: scope.tab === 'cancelled' ? 'cancelled' : scope.tab === 'transferred' ? 'transferred' : 'booked' })] : [],
});
