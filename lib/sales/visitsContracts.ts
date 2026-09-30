import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import type { CrmRole } from './workflow';

export const VISITS_CONTRACT_VERSION = 'visits_v1';
export const VISITS_MAX_BYTES = 16384;
export const APPOINTMENT_STATUSES = ['scheduled', 'rescheduled', 'attended', 'no_show', 'cancelled'] as const;
export const VISIT_COMMANDS = ['schedule', 'reschedule', 'cancel_appointment', 'no_show', 'check_in', 'cancel_visit'] as const;
export type VisitCommand = typeof VISIT_COMMANDS[number];
interface Base { requestId: string; customerId: string; interestId: string; expectedInterestRevision: string; reason: string; occurredAt: string }
interface AppointmentRef { appointmentId: string; expectedAppointmentRevision: string }
export type VisitsInput =
  | (Base & { command: 'schedule'; startsAt: string; endsAt: string | null })
  | (Base & AppointmentRef & { command: 'reschedule'; startsAt: string; endsAt: string | null })
  | (Base & AppointmentRef & { command: 'cancel_appointment' | 'no_show' })
  | (Base & { command: 'check_in'; appointmentId: string | null; expectedAppointmentRevision: string | null })
  | (Base & { command: 'cancel_visit'; visitId: string; expectedVisitRevision: string });
export interface VisitsScope { customerId: string; interestId: string; appointmentPage: number; visitPage: number; eventPage: number }
export interface VisitsResult {
  requestId: string; command: VisitCommand; customerId: string; interestId: string; appointmentId: string | null;
  appointmentRevision: string | null; visitId: string | null; visitRevision: string | null; eventId: string; replayed: boolean;
}
export interface VisitAppointment {
  id: string; revision: string; startsAt: string; endsAt: string | null; status: typeof APPOINTMENT_STATUSES[number]; assignedSalesUserId: string; createdAt: string;
}
export interface VisitRow {
  id: string; revision: string; appointmentId: string | null; status: 'awaiting_voice' | 'completed' | 'cancelled';
  checkedInAt: string; checkedInByUserId: string; completedAt: string | null; completedVoiceId: string | null;
}
export interface VisitsEvent {
  id: string; command: VisitCommand; appointmentId: string | null; visitId: string | null;
  occurredAt: string; recordedAt: string; actorUserId: string; reason: string; details: Record<string, string | null>;
}
export interface VisitsSnapshot {
  actor: { userId: string; role: CrmRole };
  scope: { customerId: string; customerName: string; interestId: string; projectName: string; ownerUserId: string;
    interestRevision: string; engagementStatus: string; canEdit: boolean };
  appointments: VisitAppointment[]; visits: VisitRow[]; events: VisitsEvent[];
  appointmentPage: number; appointmentsHasMore: boolean; visitPage: number; visitsHasMore: boolean; eventPage: number; eventsHasMore: boolean;
}
export class VisitsInputError extends Error {
  constructor(message = 'ข้อมูลนัดหมายหรือเข้าชมไม่ถูกต้อง กรุณาตรวจสอบ') { super(message); this.name = 'VisitsInputError'; }
}
const invalid = (message?: string): never => { throw new VisitsInputError(message); };
function rec(value: unknown) { try { return bookingRecord(value); } catch { return invalid(); } }
function uuid(value: unknown) { try { return bookingUuid(value); } catch { return invalid('รหัสอ้างอิงไม่ถูกต้อง'); } }
const nullableId = (value: unknown) => value === null ? null : uuid(value);
function exact(raw: Record<string, unknown>, keys: string[]) {
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) invalid();
}
function line(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max || Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code <= 31 || code >= 127 && code <= 159 || code === 0x2028 || code === 0x2029 || char.length === 1 && code >= 0xd800 && code <= 0xdfff;
  })) return invalid('กรุณากรอกข้อความบรรทัดเดียวให้ครบและไม่เกินกำหนด');
  return value.trim();
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : invalid();
}
function time(value: unknown): string {
  return typeof value === 'string' && parseEvidenceTimestamp(value) !== null ? value : invalid('กรุณาระบุวันเวลาจริงพร้อมเขตเวลา');
}
const nullableTime = (value: unknown) => value === null ? null : time(value);
const page = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000 ? value : invalid();
const bool = (value: unknown) => typeof value === 'boolean' ? value : invalid();
const earlier = (left: string, right: string) => parseEvidenceTimestamp(left)! < parseEvidenceTimestamp(right)!;
export function activeAppointment(status: VisitAppointment['status']) { return status === 'scheduled' || status === 'rescheduled'; }
export function parseVisitsScope(value: unknown): VisitsScope {
  const raw = rec(value); exact(raw, ['customerId', 'interestId', 'appointmentPage', 'visitPage', 'eventPage']);
  return { customerId: uuid(raw.customerId), interestId: uuid(raw.interestId), appointmentPage: page(raw.appointmentPage), visitPage: page(raw.visitPage), eventPage: page(raw.eventPage) };
}
export function parseVisitsQuery(url: string): VisitsScope {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['customerId', 'interestId', 'appointmentPage', 'visitPage', 'eventPage'].includes(key) || params.getAll(key).length !== 1) invalid();
  const readPage = (key: string) => { const value = params.get(key) ?? '0'; return /^(0|[1-9]\d{0,5})$/.test(value) ? page(Number(value)) : invalid(); };
  return { customerId: uuid(params.get('customerId')), interestId: uuid(params.get('interestId')), appointmentPage: readPage('appointmentPage'), visitPage: readPage('visitPage'), eventPage: readPage('eventPage') };
}
export function parseVisitsPageQuery(value: Record<string, string | string[] | undefined>): Pick<VisitsScope, 'customerId' | 'interestId'> {
  exact(value, ['customerId', 'interestId']); return { customerId: uuid(value.customerId), interestId: uuid(value.interestId) };
}
export function parseVisitsInput(value: unknown): VisitsInput {
  const raw = rec(value), command = choice(raw.command, VISIT_COMMANDS);
  const baseKeys = ['requestId', 'command', 'customerId', 'interestId', 'expectedInterestRevision', 'reason', 'occurredAt'];
  exact(raw, [...baseKeys, ...(command === 'schedule' ? ['startsAt', 'endsAt'] : command === 'cancel_visit' ? ['visitId', 'expectedVisitRevision']
    : ['appointmentId', 'expectedAppointmentRevision', ...(command === 'reschedule' ? ['startsAt', 'endsAt'] : [])])]);
  const base: Base = { requestId: uuid(raw.requestId), customerId: uuid(raw.customerId), interestId: uuid(raw.interestId),
    expectedInterestRevision: uuid(raw.expectedInterestRevision), reason: line(raw.reason), occurredAt: time(raw.occurredAt) };
  if (command === 'cancel_visit') return { ...base, command, visitId: uuid(raw.visitId), expectedVisitRevision: uuid(raw.expectedVisitRevision) };
  if (command === 'check_in') {
    const appointmentId = nullableId(raw.appointmentId), expectedAppointmentRevision = nullableId(raw.expectedAppointmentRevision);
    if ((appointmentId === null) !== (expectedAppointmentRevision === null)) invalid();
    return { ...base, command, appointmentId, expectedAppointmentRevision };
  }
  if (command === 'schedule' || command === 'reschedule') {
    const startsAt = time(raw.startsAt), endsAt = nullableTime(raw.endsAt);
    if (endsAt !== null && !earlier(startsAt, endsAt)) invalid('เวลาสิ้นสุดต้องหลังเวลาเริ่มนัด');
    return command === 'schedule' ? { ...base, command, startsAt, endsAt }
      : { ...base, command, startsAt, endsAt, appointmentId: uuid(raw.appointmentId), expectedAppointmentRevision: uuid(raw.expectedAppointmentRevision) };
  }
  return { ...base, command, appointmentId: uuid(raw.appointmentId), expectedAppointmentRevision: uuid(raw.expectedAppointmentRevision) };
}
export function parseVisitsResult(value: unknown, input: VisitsInput): VisitsResult {
  const raw = rec(value);
  const result: VisitsResult = { requestId: uuid(raw.requestId), command: choice(raw.command, VISIT_COMMANDS), customerId: uuid(raw.customerId), interestId: uuid(raw.interestId),
    appointmentId: nullableId(raw.appointmentId), appointmentRevision: nullableId(raw.appointmentRevision), visitId: nullableId(raw.visitId), visitRevision: nullableId(raw.visitRevision), eventId: uuid(raw.eventId), replayed: bool(raw.replayed) };
  if (result.requestId !== input.requestId || result.command !== input.command || result.customerId !== input.customerId || result.interestId !== input.interestId
    || (result.appointmentId === null) !== (result.appointmentRevision === null) || (result.visitId === null) !== (result.visitRevision === null)) invalid();
  if (input.command === 'cancel_visit') {
    if (result.visitId !== input.visitId || result.visitRevision === input.expectedVisitRevision) invalid();
  } else if (input.command === 'check_in') {
    if (result.visitId === null || result.appointmentId !== input.appointmentId || input.appointmentId !== null && result.appointmentRevision === input.expectedAppointmentRevision) invalid();
  } else if (result.appointmentId === null || result.visitId !== null
    || input.command !== 'schedule' && (result.appointmentId !== input.appointmentId || result.appointmentRevision === input.expectedAppointmentRevision)) invalid();
  return result;
}
export function parseVisitsSnapshot(value: unknown, expected: VisitsScope): VisitsSnapshot {
  const raw = rec(value), actor = rec(raw.actor), scope = rec(raw.scope);
  const result: VisitsSnapshot = {
    actor: { userId: uuid(actor.userId), role: choice(actor.role, ['sales', 'admin', 'owner']) },
    scope: { customerId: uuid(scope.customerId), customerName: line(scope.customerName, 200), interestId: uuid(scope.interestId), projectName: line(scope.projectName, 200),
      ownerUserId: uuid(scope.ownerUserId), interestRevision: uuid(scope.interestRevision), engagementStatus: line(scope.engagementStatus, 100), canEdit: bool(scope.canEdit) },
    appointmentPage: page(raw.appointmentPage), appointmentsHasMore: bool(raw.appointmentsHasMore), visitPage: page(raw.visitPage), visitsHasMore: bool(raw.visitsHasMore),
    eventPage: page(raw.eventPage), eventsHasMore: bool(raw.eventsHasMore), appointments: [], visits: [], events: [],
  };
  if (result.scope.customerId !== expected.customerId || result.scope.interestId !== expected.interestId
    || ['appointmentPage', 'visitPage', 'eventPage'].some(key => result[key as 'appointmentPage'] !== expected[key as 'appointmentPage'])
    || result.scope.canEdit && (result.actor.role === 'owner' || result.scope.engagementStatus === 'lost' || result.actor.role === 'sales' && result.actor.userId !== result.scope.ownerUserId)) invalid();
  const rows = (value: unknown, hasMore: boolean): unknown[] => {
    if (!Array.isArray(value) || value.length > 50 || hasMore && value.length !== 50) return invalid(); return value;
  };
  result.appointments = rows(raw.appointments, result.appointmentsHasMore).map(value => {
    const item = rec(value);
    const appointment: VisitAppointment = { id: uuid(item.id), revision: uuid(item.revision), startsAt: time(item.startsAt), endsAt: nullableTime(item.endsAt),
      status: choice(item.status, APPOINTMENT_STATUSES), assignedSalesUserId: uuid(item.assignedSalesUserId), createdAt: time(item.createdAt) };
    if (appointment.endsAt !== null && !earlier(appointment.startsAt, appointment.endsAt)) invalid(); return appointment;
  });
  result.visits = rows(raw.visits, result.visitsHasMore).map(value => {
    const item = rec(value);
    const visit: VisitRow = { id: uuid(item.id), revision: uuid(item.revision), appointmentId: nullableId(item.appointmentId), status: choice(item.status, ['awaiting_voice', 'completed', 'cancelled']),
      checkedInAt: time(item.checkedInAt), checkedInByUserId: uuid(item.checkedInByUserId), completedAt: nullableTime(item.completedAt), completedVoiceId: nullableId(item.completedVoiceId) };
    if (visit.status === 'completed' ? visit.completedAt === null || visit.completedVoiceId === null || earlier(visit.completedAt, visit.checkedInAt)
      : visit.completedAt !== null || visit.completedVoiceId !== null) invalid(); return visit;
  });
  result.events = rows(raw.events, result.eventsHasMore).map(value => {
    const item = rec(value), details = rec(item.details);
    const event: VisitsEvent = { id: uuid(item.id), command: choice(item.command, VISIT_COMMANDS), appointmentId: nullableId(item.appointmentId), visitId: nullableId(item.visitId),
      occurredAt: time(item.occurredAt), recordedAt: time(item.recordedAt), actorUserId: uuid(item.actorUserId), reason: line(item.reason), details: {} };
    if (earlier(event.recordedAt, event.occurredAt)) invalid();
    for (const [key, value] of Object.entries(details)) {
      if (!['startsAt', 'endsAt', 'status', 'previousStartsAt', 'previousEndsAt', 'previousStatus'].includes(key)) invalid();
      event.details[key] = value === null ? null : key.endsWith('At') ? time(value) : line(value, 100);
    }
    if (event.command === 'check_in' || event.command === 'cancel_visit' ? event.visitId === null : event.appointmentId === null || event.visitId !== null) invalid();
    return event;
  });
  for (const list of [result.appointments, result.visits, result.events]) if (new Set(list.map(item => item.id)).size !== list.length) invalid();
  return result;
}
