import type { VisitsInput, VisitsResult, VisitsScope, VisitsSnapshot } from '../visitsContracts';
export const viId = (n: number) => `23000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const viScope: VisitsScope = { customerId: viId(1), interestId: viId(2), appointmentPage: 0, visitPage: 0, eventPage: 0 };
export const viInput = (overrides: Record<string, unknown> = {}): Extract<VisitsInput, { command: 'schedule' }> => ({ command: 'schedule', requestId: viId(3), customerId: viId(1), interestId: viId(2),
  expectedInterestRevision: viId(4), reason: 'ลูกค้านัดเข้าชม', occurredAt: '2026-09-23T01:00:00Z', startsAt: '2026-09-24T08:00:00+07:00', endsAt: null, ...overrides });
export function viResult(input: VisitsInput = viInput(), overrides: Partial<VisitsResult> = {}): VisitsResult {
  return { requestId: input.requestId, command: input.command, customerId: input.customerId, interestId: input.interestId, appointmentId: input.command === 'check_in' ? input.appointmentId : viId(10),
    appointmentRevision: input.command === 'check_in' && input.appointmentId === null ? null : viId(11), visitId: input.command === 'check_in' ? viId(12) : input.command === 'cancel_visit' ? input.visitId : null,
    visitRevision: ['check_in', 'cancel_visit'].includes(input.command) ? viId(13) : null, eventId: viId(14), replayed: false, ...overrides };
}
export function viSnapshot(): VisitsSnapshot {
  return { actor: { userId: viId(5), role: 'sales' }, scope: { customerId: viId(1), customerName: 'SYNTHETIC Customer', interestId: viId(2), projectName: 'SYNTHETIC PROJECT',
    ownerUserId: viId(5), interestRevision: viId(4), engagementStatus: 'new', canEdit: true },
    appointments: [{ id: viId(10), revision: viId(11), startsAt: '2026-09-24T01:00:00Z', endsAt: null, status: 'scheduled', assignedSalesUserId: viId(5), createdAt: '2026-09-23T01:00:00Z' }],
    visits: [], events: [], appointmentPage: 0, appointmentsHasMore: false, visitPage: 0, visitsHasMore: false, eventPage: 0, eventsHasMore: false };
}
