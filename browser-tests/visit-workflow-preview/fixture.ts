/** Synthetic view-model only. NOT a database, authorization or transaction simulator. */
import { VisitsApiError, type VisitsApi } from '../../lib/sales/visitsClient';
import type { VisitsSnapshot } from '../../lib/sales/visitsContracts';
import { VisitSopApiError, type VisitSopApi } from '../../lib/sales/visitSopClient';
import { VISIT_SOP_TEMPLATE, VISIT_SOP_TEMPLATE_VERSION, type VisitSopSnapshot, type VisitSopRun } from '../../lib/sales/visitSopContracts';
import type { LeadWorkAction } from '../../lib/sales/leadWorkReadContracts';
import { LeadWorkApiError, type LeadWorkApi } from '../../lib/sales/leadWorkClient';
import { CustomerVoicesApiError, type CustomerVoicesApi, type CustomerVoicePublicApi } from '../../lib/sales/customerVoicesClient';
import { CUSTOMER_VOICES_FORM_VERSION, parseVoicePublicInput, type VoiceAnswers } from '../../lib/sales/customerVoicesContracts';
export const id = (n: number) => `bd300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const scope = { customerId: id(1), interestId: id(2) };
export const visitsHref = `/sales-crm/visits?${new URLSearchParams(scope)}`;
const key = 'synthetic-visit-workflow-v1';
export type FixtureRole = 'sales' | 'admin' | 'owner' | 'other_sales';
interface Store {
  role: FixtureRole; appointments: VisitsSnapshot['appointments']; visits: VisitsSnapshot['visits']; events: VisitsSnapshot['events'];
  run: VisitSopRun | null; sopEvents: VisitSopSnapshot['events']; actions: LeadWorkAction[];
  token: { id: string; token: string; expiresAt: string } | null;
  submission: { submittedAt: string; answers: VoiceAnswers } | null;
}
const fresh = (): Store => ({ role: 'sales', appointments: [], visits: [], events: [], run: null, sopEvents: [], actions: [], token: null, submission: null });
function load(): Store { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as Store : fresh(); }
export const state = load();
const persist = () => { localStorage.setItem(key, JSON.stringify(state)); window.dispatchEvent(new Event('synthetic-fixture-change')); };
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const clone = <T,>(value: T): T => structuredClone(value);
const actor = () => ({ userId: state.role === 'sales' ? id(5) : state.role === 'other_sales' ? id(8) : state.role === 'admin' ? id(6) : id(7), role: state.role === 'other_sales' ? 'sales' as const : state.role });
const sales = () => state.role === 'sales';
const canManage = () => sales() || state.role === 'admin';
const common = () => ({ ...scope, customerName: 'ลูกค้าจำลอง UI — ไม่มีข้อมูลจริง', projectName: 'โครงการจำลอง UI', ownerUserId: id(5), interestRevision: id(20), engagementStatus: 'legacy_unclassified' });
export function changeRole(role: FixtureRole) { state.role = role; persist(); location.reload(); }
export function reset() { localStorage.removeItem(key); location.href = visitsHref; }
export const visitsApi: VisitsApi = {
  async read(query) { return clone({ actor: actor(), scope: { ...common(), canEdit: canManage() }, appointments: state.appointments, visits: state.visits, events: state.events,
    appointmentPage: query.appointmentPage, visitPage: query.visitPage, eventPage: query.eventPage, appointmentsHasMore: false, visitsHasMore: false, eventsHasMore: false }); },
  async save(input, expectedActor) {
    if (!canManage() || expectedActor !== actor().userId) throw new VisitsApiError('FORBIDDEN', 'สิทธิ์จำลองไม่อนุญาต', 403);
    let appointment = 'appointmentId' in input ? state.appointments.find(row => row.id === input.appointmentId) : undefined;
    let visit = 'visitId' in input ? state.visits.find(row => row.id === input.visitId) : undefined;
    if (input.command === 'schedule') { appointment = { id: uid(), revision: uid(), startsAt: input.startsAt, endsAt: input.endsAt, status: 'scheduled', assignedSalesUserId: id(5), createdAt: now() }; state.appointments.unshift(appointment); }
    else if (input.command === 'check_in') { if (appointment) { appointment.status = 'attended'; appointment.revision = uid(); }
      visit = { id: uid(), revision: uid(), appointmentId: input.appointmentId, status: 'awaiting_voice', checkedInAt: input.occurredAt, checkedInByUserId: actor().userId, completedAt: null, completedVoiceId: null }; state.visits.unshift(visit);
    } else if (input.command === 'cancel_visit' && visit) { visit.status = 'cancelled'; visit.revision = uid(); }
    else if (appointment) { appointment.revision = uid(); if (input.command === 'reschedule') { appointment.startsAt = input.startsAt; appointment.endsAt = input.endsAt; appointment.status = 'rescheduled'; } else appointment.status = input.command === 'no_show' ? 'no_show' : 'cancelled'; }
    const eventId = uid(); state.events.unshift({ id: eventId, command: input.command, appointmentId: appointment?.id ?? null, visitId: visit?.id ?? null, occurredAt: input.occurredAt, recordedAt: now(), actorUserId: actor().userId, reason: input.reason, details: {} }); persist();
    return { ...scope, requestId: input.requestId, command: input.command, appointmentId: appointment?.id ?? null, appointmentRevision: appointment?.revision ?? null, visitId: visit?.id ?? null, visitRevision: visit?.revision ?? null, eventId, replayed: false };
  },
};
export const sopApi: VisitSopApi = {
  async read(query) {
    const appointment = state.appointments.find(row => row.id === query.appointmentId);
    const visit = state.visits.find(row => query.visitId ? row.id === query.visitId : row.appointmentId === query.appointmentId);
    return clone({ actor: actor(), scope: { ...common(), ...query, canWrite: sales() && state.run?.currentStage !== 'completed' },
      anchor: { appointmentStatus: appointment?.status ?? null, visitId: visit?.id ?? null, visitStatus: visit?.status ?? null, checkedInAt: visit?.checkedInAt ?? null },
      plots: [{ id: 'SYNTHETIC-HOUSE', name: 'บ้านจำลอง A1' }], plotsHasMore: false, run: state.run,
      nextAction: state.actions.find(row => row.status === 'open') ?? null, events: state.sopEvents, eventPage: query.eventPage, eventsHasMore: false });
  },
  async save(input, expectedActor) {
    if (!sales() || expectedActor !== actor().userId) throw new VisitSopApiError('FORBIDDEN', 'เฉพาะ Sales เจ้าของงาน', 403);
    const visit = state.visits.find(row => input.visitId ? row.id === input.visitId : row.appointmentId === input.appointmentId);
    if (input.command === 'start') state.run = { id: uid(), revision: uid(), plotId: input.plotId, responsibleSalesUserId: id(5), templateVersion: VISIT_SOP_TEMPLATE_VERSION, currentStage: 'stage_a',
      stageACompletedAt: null, stageBStartedAt: null, stageCCompletedAt: null, departedAt: null, recap: { feedback: '', objections: '' }, nextAction: null, nextFollowUpAt: null,
      items: (['stage_a', 'stage_c'] as const).flatMap(stage => VISIT_SOP_TEMPLATE[stage].map(([key, label]) => ({ stage, key, label, result: 'pending' as const, reason: null, answeredAt: null, answeredByUserId: null }))), createdAt: input.occurredAt, updatedAt: input.occurredAt };
    const run = state.run; if (!run) throw new VisitSopApiError('NOT_FOUND', 'ยังไม่มี SOP', 404);
    if (input.command === 'start_tour') { if (!visit) throw new VisitSopApiError('VISIT_REQUIRED', 'ต้องเช็คอินก่อน', 409); run.currentStage = 'stage_c'; run.stageBStartedAt = input.occurredAt; }
    if (input.command === 'save_stage' || input.command === 'complete_stage') {
      const next = state.actions.find(row => row.status === 'open');
      if (input.command === 'complete_stage' && input.stage === 'stage_c' && (!next || Date.parse(next.dueAt) <= Date.now())) throw new VisitSopApiError('NEXT_ACTION_REQUIRED', 'ต้องมีงานถัดไปที่ยังไม่ถึงกำหนด', 409);
      run.items = run.items.map(item => { const answer = input.answers.find(row => row.key === item.key); return answer ? { ...item, ...answer, answeredByUserId: answer.result === 'pending' ? null : id(5), answeredAt: answer.result === 'pending' ? null : input.occurredAt } : item; });
      if (input.recap) { run.recap = input.recap; run.departedAt = input.recap.departedAt; }
      if (input.command === 'complete_stage') { if (input.stage === 'stage_a') { run.currentStage = 'stage_b'; run.stageACompletedAt = input.occurredAt; } else { run.currentStage = 'completed'; run.stageCCompletedAt = input.occurredAt; run.nextAction = next!.action; run.nextFollowUpAt = next!.dueAt; } }
    }
    run.revision = uid(); run.updatedAt = input.occurredAt; const eventId = uid();
    state.sopEvents.unshift({ id: eventId, command: input.command, stage: run.currentStage, occurredAt: input.occurredAt, recordedAt: now(), actorUserId: actor().userId, reason: input.reason }); persist();
    return { ...scope, requestId: input.requestId, command: input.command, runId: run.id, runRevision: run.revision, stage: run.currentStage, appointmentId: input.appointmentId, visitId: visit?.id ?? null, eventId, replayed: false };
  },
};
export const followUpApi: LeadWorkApi = {
  async read() { return clone({ actor: actor(), scope, customer: { id: scope.customerId, name: common().customerName, phone: null, leadCreatedAt: null }, projectName: common().projectName,
    owner: { userId: id(5), displayName: 'Sales จำลอง', active: true }, scopeClosed: false, lifecycleRevision: id(20), canWrite: sales(), asOf: now(), currentAction: state.actions.find(row => row.status === 'open') ?? null, actions: state.actions, activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } }); },
  async save(input, expectedActor) { if (!sales() || expectedActor !== id(5) || input.command !== 'set_next_action') throw new LeadWorkApiError('FORBIDDEN', 'เฉพาะ Sales เจ้าของงาน', 403);
    state.actions = state.actions.map(row => row.status === 'open' ? { ...row, status: 'superseded', closedAt: now(), closeReason: input.reason } : row);
    const nextActionId = uid(); state.actions.unshift({ ...scope, id: nextActionId, ownerUserId: id(5), ...input.nextAction, recordedAt: now(), status: 'open', closedAt: null, closeReason: null }); persist(); return { nextActionId, activityId: null, replayed: false }; },
};
export const voiceApi: CustomerVoicesApi = {
  async read(query) { const visit = state.visits.find(row => row.id === query.visitId); if (!visit) throw new CustomerVoicesApiError('NOT_FOUND', 404);
    return clone({ actor: actor(), scope: { ...common(), ...query, canManage: canManage() && visit.status === 'awaiting_voice' }, visit, activeToken: state.token ? { id: state.token.id, expiresAt: state.token.expiresAt } : null,
      submission: state.submission ? { ...state.submission, answers: state.role === 'other_sales' ? null : state.submission.answers } : null, ttlHours: 24 }); },
  async save(input, expectedActor) { if (!canManage() || expectedActor !== actor().userId) throw new CustomerVoicesApiError('FORBIDDEN', 403);
    const tokenId = input.command === 'revoke' ? input.expectedTokenId! : uid(), expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    state.token = input.command === 'revoke' ? null : { id: tokenId, token: input.token!, expiresAt }; persist();
    return { requestId: input.requestId, command: input.command, visitId: input.visitId, tokenId, expiresAt, replayed: false }; },
};
export const publicApi: CustomerVoicePublicApi = {
  async request(raw) { const input = parseVoicePublicInput(raw);
    if (!state.token || state.token.token !== input.token || Date.parse(state.token.expiresAt) < Date.now()) throw new CustomerVoicesApiError('TOKEN_UNAVAILABLE', 410);
    if (input.command === 'open') return { formVersion: CUSTOMER_VOICES_FORM_VERSION, expiresAt: state.token.expiresAt };
    const visit = state.visits[0]; if (!visit || visit.status !== 'awaiting_voice') throw new CustomerVoicesApiError('TOKEN_UNAVAILABLE', 410);
    const submittedAt = now(); state.submission = { submittedAt, answers: input.answers }; visit.status = 'completed'; visit.completedAt = submittedAt; visit.completedVoiceId = uid(); visit.revision = uid(); state.token = null; persist();
    return { submitted: true, replayed: false };
  },
};
