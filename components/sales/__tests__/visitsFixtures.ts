import type { VisitCommand, VisitsInput, VisitsResult, VisitsScope, VisitsSnapshot } from '@/lib/sales/visitsContracts';

export const vid = (id: number) => `61000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
export const actorId = vid(1), customerId = vid(2), interestId = vid(3), appointmentId = vid(4), visitId = vid(6);
export const visitsScope = (patch: Partial<VisitsScope> = {}): VisitsScope => ({ customerId, interestId, appointmentPage: 0, visitPage: 0, eventPage: 0, ...patch });
export function visitInput(command: VisitCommand = 'schedule'): VisitsInput {
  const base = { requestId: vid(10), customerId, interestId, expectedInterestRevision: vid(9), reason: 'ลูกค้ายืนยันข้อมูลจริง', occurredAt: '2026-09-23T09:00:00+07:00' };
  const ref = { appointmentId, expectedAppointmentRevision: vid(5) };
  if (command === 'schedule') return { ...base, command, startsAt: '2026-09-24T10:00:00+07:00', endsAt: null };
  if (command === 'reschedule') return { ...base, command, ...ref, startsAt: '2026-09-24T11:00:00+07:00', endsAt: '2026-09-24T12:00:00+07:00' };
  if (command === 'cancel_visit') return { ...base, command, visitId, expectedVisitRevision: vid(7) };
  if (command === 'check_in') return { ...base, command, appointmentId: null, expectedAppointmentRevision: null };
  return { ...base, command, ...ref };
}
export function visitsSnapshot(scope = visitsScope()): VisitsSnapshot {
  return { actor: { userId: actorId, role: 'sales' }, scope: { customerId: scope.customerId, interestId: scope.interestId, customerName: 'ลูกค้านัดชม',
    projectName: 'โครงการทดสอบ A', ownerUserId: actorId, interestRevision: vid(9), engagementStatus: 'considering', canEdit: true },
    appointmentPage: scope.appointmentPage, appointmentsHasMore: false, visitPage: scope.visitPage, visitsHasMore: false, eventPage: scope.eventPage, eventsHasMore: false,
    appointments: [{ id: appointmentId, revision: vid(5), startsAt: '2026-09-24T10:00:00+07:00', endsAt: null, status: 'scheduled', assignedSalesUserId: actorId, createdAt: '2026-09-23T09:00:00+07:00' }],
    visits: [{ id: visitId, revision: vid(7), appointmentId: null, status: 'awaiting_voice', checkedInAt: '2026-09-23T09:00:00+07:00', checkedInByUserId: actorId, completedAt: null, completedVoiceId: null }],
    events: [{ id: vid(8), command: 'schedule', appointmentId, visitId: null, occurredAt: '2026-09-23T09:00:00+07:00', recordedAt: '2026-09-23T09:01:00+07:00',
      actorUserId: actorId, reason: 'ลูกค้ายืนยันนัดหมาย', details: { startsAt: '2026-09-24T10:00:00+07:00', endsAt: null, status: 'scheduled' } }] };
}
export function visitResult(input = visitInput(), replayed = false): VisitsResult {
  const isVisit = input.command === 'check_in' || input.command === 'cancel_visit';
  const id = input.command === 'check_in' ? input.appointmentId : input.command === 'cancel_visit' ? null : input.command === 'schedule' ? appointmentId : input.appointmentId;
  return { requestId: input.requestId, command: input.command, customerId: input.customerId, interestId: input.interestId,
    appointmentId: id, appointmentRevision: id ? vid(30) : null, visitId: isVisit ? input.command === 'cancel_visit' ? input.visitId : visitId : null,
    visitRevision: isVisit ? vid(31) : null, eventId: vid(32), replayed };
}
