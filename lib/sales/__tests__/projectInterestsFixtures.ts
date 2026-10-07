import type { ProjectInterestInput, ProjectInterestResult, ProjectInterestsSnapshot } from '../projectInterestsContracts';
export const piId = (n: number) => `bc240000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const piScope = { customerId: piId(1), page: 0 };
export function piInput(change: Partial<ProjectInterestInput> = {}): ProjectInterestInput {
  return { requestId: piId(2), customerId: piId(1), expectedCustomerRevision: piId(3), projectName: 'โครงการสมมติ', plotId: null, reason: 'ลูกค้าขอเข้าชมโครงการ', ...change };
}
export function piResult(input = piInput(), change: Partial<ProjectInterestResult> = {}): ProjectInterestResult {
  return { requestId: input.requestId, customerId: input.customerId, interestId: piId(4), interestRevision: piId(5), ownerUserId: piId(6),
    projectName: input.projectName, plotId: input.plotId, eventId: piId(7), replayed: false, ...change };
}
export function piSnapshot(): ProjectInterestsSnapshot {
  return { actor: { userId: piId(6), role: 'sales' }, customer: { id: piId(1), name: 'ลูกค้าสมมติ', ownerUserId: piId(6), revision: piId(3), intakeStatus: 'new', canAdd: true },
    projects: [{ name: 'โครงการสมมติ' }], projectsHasMore: false, interests: [], page: 0, hasMore: false };
}
