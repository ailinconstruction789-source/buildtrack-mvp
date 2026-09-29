import type { ProjectSaleRow, ProjectSalesScope, ProjectSalesSnapshot } from '@/lib/sales/projectSalesContracts';

export const projectActorId = '19000000-0000-4000-8000-000000000001';
export const projectCustomerId = '19000000-0000-4000-8000-000000000002';
export const projectInterestId = '19000000-0000-4000-8000-000000000003';
export const oldProjectSaleId = '19000000-0000-4000-8000-000000000004';
export const newProjectSaleId = '19000000-0000-4000-8000-000000000005';
export const projectScope: ProjectSalesScope = { projectName: 'โครงการ A', tab: 'booked', query: '', page: 0 };

export function projectSalesSnapshot(scope: ProjectSalesScope = projectScope): ProjectSalesSnapshot {
  const common = {
    customerId: projectCustomerId, customerName: 'ลูกค้าคนเดิม', phone: null,
    interestId: projectInterestId, projectName: scope.projectName ?? 'โครงการ A',
    ownerUserId: projectActorId, ownerName: 'Sales ผู้ดูแล',
    plotId: null, plotName: null, previousSaleId: null,
    bookedAt: null, cancelledAt: null, cancellationReason: null,
    listPrice: null, discountAmount: null, salePrice: null, depositAmount: null, paymentMethod: null,
  };
  const history: ProjectSaleRow[] = [
    { ...common, saleId: oldProjectSaleId, stage: 'cancelled', bookingRound: 1, cancellationReason: 'ลูกค้าขอยกเลิกรอบแรก', cancelledAt: '2026-09-20T07:30:00Z' },
    { ...common, saleId: newProjectSaleId, stage: 'booked', bookingRound: 2, previousSaleId: oldProjectSaleId,
      plotId: 'A-2', plotName: 'แปลง 2', bookedAt: '2026-09-23T01:00:00Z', phone: '0812345678',
      listPrice: 2000000, discountAmount: 10000, salePrice: 1990000, depositAmount: 5000, paymentMethod: 'mortgage' },
  ];
  const rows: ProjectSaleRow[] = scope.tab === 'all' ? history : history.map((sale, index) => ({ ...sale,
    stage: scope.tab === 'cancelled' ? 'cancelled' : scope.tab === 'transferred' ? 'transferred' : 'booked',
    plotId: `A-${index + 1}`, plotName: `แปลง ${index + 1}`, previousSaleId: null,
    cancelledAt: scope.tab === 'cancelled' ? sale.cancelledAt : null,
    cancellationReason: scope.tab === 'cancelled' ? sale.cancellationReason : null,
  }));
  return {
    actor: { userId: projectActorId, role: 'sales' },
    ...scope, projects: [{ name: 'โครงการ A' }, { name: 'โครงการ B' }], hasMore: false,
    rows: scope.projectName ? rows : [],
  };
}
