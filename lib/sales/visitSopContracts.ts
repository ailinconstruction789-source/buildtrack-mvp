import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { VISIT_SOP_TEMPLATE, VISIT_SOP_TEMPLATE_VERSION, type VisitSopItemStage } from './visitSopTemplate';
import type { CrmRole } from './workflow';

export { VISIT_SOP_TEMPLATE, VISIT_SOP_TEMPLATE_VERSION, type VisitSopItemStage };
export const VISIT_SOP_CONTRACT_VERSION = 'visit_sop_v1';
export const VISIT_SOP_MAX_BYTES = 65536;
export const VISIT_SOP_COMMANDS = ['start', 'save_stage', 'complete_stage', 'start_tour'] as const;
export type VisitSopCommand = typeof VISIT_SOP_COMMANDS[number];
export type VisitSopStage = VisitSopItemStage | 'stage_b' | 'completed';
export type VisitSopAnswerResult = 'pending' | 'done' | 'not_applicable' | 'skipped';
export interface VisitSopAnchor { customerId: string; interestId: string; appointmentId: string | null; visitId: string | null }
export interface VisitSopScope extends VisitSopAnchor { eventPage: number }
export interface VisitSopAnswer { key: string; result: VisitSopAnswerResult; reason: string | null }
export interface VisitSopRecap { feedback: string; objections: string; departedAt: string | null }
interface Base extends VisitSopAnchor { requestId: string; expectedInterestRevision: string; occurredAt: string; reason: string }
interface RunRef { runId: string; expectedRunRevision: string }
export type VisitSopInput =
  | (Base & { command: 'start'; plotId: string })
  | (Base & RunRef & { command: 'start_tour' })
  | (Base & RunRef & { command: 'save_stage' | 'complete_stage'; stage: VisitSopItemStage; answers: VisitSopAnswer[]; recap: VisitSopRecap | null });
export interface VisitSopResult {
  requestId: string; command: VisitSopCommand; customerId: string; interestId: string; runId: string; runRevision: string;
  stage: VisitSopStage; appointmentId: string | null; visitId: string | null; eventId: string; replayed: boolean;
}
export interface VisitSopItem extends VisitSopAnswer { stage: VisitSopItemStage; label: string; answeredByUserId: string | null; answeredAt: string | null }
export interface VisitSopRun {
  id: string; revision: string; plotId: string; responsibleSalesUserId: string; templateVersion: string; currentStage: VisitSopStage;
  stageACompletedAt: string | null; stageBStartedAt: string | null; stageCCompletedAt: string | null; departedAt: string | null;
  recap: { feedback: string; objections: string }; nextAction: string | null; nextFollowUpAt: string | null;
  items: VisitSopItem[]; createdAt: string; updatedAt: string;
}
export interface VisitSopSnapshot {
  actor: { userId: string; role: CrmRole };
  scope: VisitSopAnchor & { customerName: string; projectName: string; ownerUserId: string; interestRevision: string; engagementStatus: string; canWrite: boolean };
  anchor: { appointmentStatus: 'scheduled' | 'rescheduled' | 'attended' | 'no_show' | 'cancelled' | null;
    visitId: string | null; visitStatus: 'awaiting_voice' | 'completed' | 'cancelled' | null; checkedInAt: string | null };
  plots: { id: string; name: string }[]; plotsHasMore: boolean; run: VisitSopRun | null;
  nextAction: { id: string; action: string; dueAt: string } | null;
  events: { id: string; command: VisitSopCommand; stage: VisitSopStage; occurredAt: string; recordedAt: string; actorUserId: string; reason: string }[];
  eventPage: number; eventsHasMore: boolean;
}
export class VisitSopInputError extends Error {
  constructor(message = 'ข้อมูล SOP ไม่ถูกต้อง กรุณาตรวจสอบ') { super(message); this.name = 'VisitSopInputError'; }
}
const invalid = (message?: string): never => { throw new VisitSopInputError(message); };
const rec = (value: unknown) => { try { return bookingRecord(value); } catch { return invalid(); } };
const uuid = (value: unknown) => { try { return bookingUuid(value); } catch { return invalid(); } };
const nullableId = (value: unknown) => value === null ? null : uuid(value);
function exact(raw: Record<string, unknown>, keys: string[]) {
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) invalid();
}
function line(value: unknown, max = 1000, blank = false, preserve = false): string {
  if (typeof value !== 'string' || !blank && !value.trim() || Array.from(value).some(char => {
    const n = char.charCodeAt(0); return n <= 31 || n >= 127 && n <= 159 || n === 0x2028 || n === 0x2029 || char.length === 1 && n >= 0xd800 && n <= 0xdfff;
  })) return invalid('กรุณาระบุข้อความบรรทัดเดียวที่ถูกต้อง');
  const result = preserve ? value : value.trim(); if (Array.from(result).length > max) invalid('ข้อความยาวเกินกำหนด'); return result;
}
function choice<T extends string>(value: unknown, values: readonly T[]): T { return typeof value === 'string' && values.includes(value as T) ? value as T : invalid(); }
const bool = (value: unknown) => typeof value === 'boolean' ? value : invalid();
const time = (value: unknown): string => typeof value === 'string' && parseEvidenceTimestamp(value) !== null ? value : invalid('กรุณาระบุวันเวลาจริงพร้อมเขตเวลา');
const nullableTime = (value: unknown) => value === null ? null : time(value);
const page = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000 ? value : invalid();
const earlier = (a: string, b: string) => parseEvidenceTimestamp(a)! < parseEvidenceTimestamp(b)!;
const stages = ['stage_a', 'stage_b', 'stage_c', 'completed'] as const;
const results = ['pending', 'done', 'not_applicable', 'skipped'] as const;
function anchor(raw: Record<string, unknown>): VisitSopAnchor {
  const result = { customerId: uuid(raw.customerId), interestId: uuid(raw.interestId), appointmentId: nullableId(raw.appointmentId), visitId: nullableId(raw.visitId) };
  if ((result.appointmentId === null) === (result.visitId === null)) invalid('เลือกนัดหมายหรือ Visit อย่างใดอย่างหนึ่ง'); return result;
}
export function parseVisitSopScope(value: unknown): VisitSopScope {
  const raw = rec(value); exact(raw, ['customerId', 'interestId', 'appointmentId', 'visitId', 'eventPage']);
  return { ...anchor(raw), eventPage: page(raw.eventPage) };
}
export function parseVisitSopQuery(url: string): VisitSopScope {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['customerId', 'interestId', 'appointmentId', 'visitId', 'eventPage'].includes(key) || params.getAll(key).length !== 1) invalid();
  const value = params.get('eventPage') ?? '0'; if (!/^(0|[1-9]\d{0,5})$/.test(value)) invalid();
  return { ...anchor({ customerId: params.get('customerId'), interestId: params.get('interestId'), appointmentId: params.get('appointmentId'), visitId: params.get('visitId') }), eventPage: page(Number(value)) };
}
export function parseVisitSopPageQuery(value: Record<string, string | string[] | undefined>): VisitSopAnchor {
  if (Object.keys(value).some(key => !['customerId', 'interestId', 'appointmentId', 'visitId'].includes(key))) invalid();
  return anchor({ ...value, appointmentId: value.appointmentId ?? null, visitId: value.visitId ?? null });
}
function answers(value: unknown, stage: VisitSopItemStage): VisitSopAnswer[] {
  if (!Array.isArray(value) || value.length !== VISIT_SOP_TEMPLATE[stage].length) return invalid('กรุณาตอบรายการของช่วงนี้ให้ครบ');
  const parsed = value.map(value => {
    const row = rec(value); exact(row, ['key', 'result', 'reason']);
    const result = { key: line(row.key, 100), result: choice(row.result, results), reason: row.reason === null ? null : line(row.reason) };
    if (['not_applicable', 'skipped'].includes(result.result) && result.reason === null) invalid('ไม่เกี่ยวข้องหรือข้ามต้องมีเหตุผล'); return result;
  });
  if (new Set(parsed.map(row => row.key)).size !== parsed.length || VISIT_SOP_TEMPLATE[stage].some(([key]) => !parsed.some(row => row.key === key))) invalid();
  // Canonical order makes exact retries independent of browser item iteration.
  return VISIT_SOP_TEMPLATE[stage].map(([key]) => parsed.find(row => row.key === key)!);
}
export function parseVisitSopInput(value: unknown): VisitSopInput {
  const raw = rec(value), command = choice(raw.command, VISIT_SOP_COMMANDS);
  exact(raw, ['requestId', 'customerId', 'interestId', 'appointmentId', 'visitId', 'expectedInterestRevision', 'command', 'occurredAt', 'reason',
    ...(command === 'start' ? ['plotId'] : ['runId', 'expectedRunRevision', ...(command === 'start_tour' ? [] : ['stage', 'answers', 'recap'])])]);
  const base = { ...anchor(raw), requestId: uuid(raw.requestId), expectedInterestRevision: uuid(raw.expectedInterestRevision), occurredAt: time(raw.occurredAt), reason: line(raw.reason) };
  if (command === 'start') return { ...base, command, plotId: line(raw.plotId, 255, false, true) };
  const run = { runId: uuid(raw.runId), expectedRunRevision: uuid(raw.expectedRunRevision) };
  if (command === 'start_tour') return { ...base, ...run, command };
  const stage = choice(raw.stage, ['stage_a', 'stage_c']), rows = answers(raw.answers, stage);
  let recap: VisitSopRecap | null = null;
  if (stage === 'stage_a') { if (raw.recap !== null) invalid(); }
  else {
    const r = rec(raw.recap); exact(r, ['feedback', 'objections', 'departedAt']);
    recap = { feedback: line(r.feedback, 2000, true), objections: line(r.objections, 2000, true), departedAt: nullableTime(r.departedAt) };
    if (recap.departedAt && earlier(base.occurredAt, recap.departedAt)) invalid('เวลาลูกค้ากลับต้องไม่หลังเวลาทำรายการ');
  }
  if (command === 'complete_stage' && (rows.some(row => row.result === 'pending') || stage === 'stage_c' && (!recap?.feedback || !recap.objections || !recap.departedAt))) invalid('กรุณากรอกงานและสรุปของช่วงนี้ให้ครบก่อนยืนยัน');
  return { ...base, ...run, command, stage, answers: rows, recap };
}
export function parseVisitSopResult(value: unknown, input: VisitSopInput): VisitSopResult {
  const raw = rec(value), result: VisitSopResult = { requestId: uuid(raw.requestId), command: choice(raw.command, VISIT_SOP_COMMANDS), customerId: uuid(raw.customerId), interestId: uuid(raw.interestId),
    runId: uuid(raw.runId), runRevision: uuid(raw.runRevision), stage: choice(raw.stage, stages), appointmentId: nullableId(raw.appointmentId), visitId: nullableId(raw.visitId), eventId: uuid(raw.eventId), replayed: bool(raw.replayed) };
  const expectedStage = input.command === 'start' ? 'stage_a' : input.command === 'start_tour' ? 'stage_c' : input.command === 'save_stage' ? input.stage : input.stage === 'stage_a' ? 'stage_b' : 'completed';
  if (result.requestId !== input.requestId || result.command !== input.command || result.customerId !== input.customerId || result.interestId !== input.interestId
    || input.appointmentId !== null && result.appointmentId !== input.appointmentId || input.visitId !== null && result.visitId !== input.visitId
    || result.stage !== expectedStage || input.command !== 'start' && (result.runId !== input.runId || result.runRevision === input.expectedRunRevision)
    || ['stage_c', 'completed'].includes(result.stage) && result.visitId === null) invalid();
  return result;
}
export function parseVisitSopSnapshot(value: unknown, expected: VisitSopScope): VisitSopSnapshot {
  const raw = rec(value), actor = rec(raw.actor), scope = rec(raw.scope), a = rec(raw.anchor);
  const result: VisitSopSnapshot = {
    actor: { userId: uuid(actor.userId), role: choice(actor.role, ['sales', 'admin', 'owner']) },
    scope: { ...anchor(scope), customerName: line(scope.customerName, 200), projectName: line(scope.projectName, 200, false, true), ownerUserId: uuid(scope.ownerUserId), interestRevision: uuid(scope.interestRevision),
      engagementStatus: choice(scope.engagementStatus, ['new', 'contacted', 'considering', 'follow_up', 'nurture', 'lost', 'legacy_unclassified']), canWrite: bool(scope.canWrite) },
    anchor: { appointmentStatus: a.appointmentStatus === null ? null : choice(a.appointmentStatus, ['scheduled', 'rescheduled', 'attended', 'no_show', 'cancelled'] as const), visitId: nullableId(a.visitId),
      visitStatus: a.visitStatus === null ? null : choice(a.visitStatus, ['awaiting_voice', 'completed', 'cancelled'] as const), checkedInAt: nullableTime(a.checkedInAt) },
    plots: [], plotsHasMore: bool(raw.plotsHasMore), run: null, nextAction: null, events: [], eventPage: page(raw.eventPage), eventsHasMore: bool(raw.eventsHasMore),
  };
  if (['customerId', 'interestId', 'appointmentId', 'visitId'].some(k => result.scope[k as keyof VisitSopAnchor] !== expected[k as keyof VisitSopAnchor]) || result.eventPage !== expected.eventPage
    || (result.anchor.visitId === null) !== (result.anchor.visitStatus === null) || (result.anchor.visitId === null) !== (result.anchor.checkedInAt === null)
    || expected.visitId !== null && expected.visitId !== result.anchor.visitId
    || expected.appointmentId !== null && result.anchor.appointmentStatus === null) invalid();
  if (!Array.isArray(raw.plots) || raw.plots.length > 200 || result.plotsHasMore && raw.plots.length !== 200) invalid();
  result.plots = (raw.plots as unknown[]).map(v => { const p = rec(v); return { id: line(p.id, 255, false, true), name: line(p.name, 255, false, true) }; });
  if (new Set(result.plots.map(p => p.id)).size !== result.plots.length) invalid();
  if (raw.nextAction !== null) { const n = rec(raw.nextAction); result.nextAction = { id: uuid(n.id), action: line(n.action, 1000), dueAt: time(n.dueAt) }; }
  if (raw.run !== null) {
    const r = rec(raw.run), recap = rec(r.recap);
    const run: VisitSopRun = { id: uuid(r.id), revision: uuid(r.revision), plotId: line(r.plotId, 255, false, true), responsibleSalesUserId: uuid(r.responsibleSalesUserId),
      templateVersion: choice(r.templateVersion, [VISIT_SOP_TEMPLATE_VERSION]), currentStage: choice(r.currentStage, stages),
      stageACompletedAt: nullableTime(r.stageACompletedAt), stageBStartedAt: nullableTime(r.stageBStartedAt), stageCCompletedAt: nullableTime(r.stageCCompletedAt), departedAt: nullableTime(r.departedAt),
      recap: { feedback: line(recap.feedback, 2000, true), objections: line(recap.objections, 2000, true) }, nextAction: r.nextAction === null ? null : line(r.nextAction, 1000), nextFollowUpAt: nullableTime(r.nextFollowUpAt),
      items: [], createdAt: time(r.createdAt), updatedAt: time(r.updatedAt) };
    if (!Array.isArray(r.items) || r.items.length !== 29) invalid();
    run.items = (r.items as unknown[]).map(v => {
      const row = rec(v), stage = choice(row.stage, ['stage_a', 'stage_c']), key = line(row.key, 100), label = line(row.label, 255);
      if (!VISIT_SOP_TEMPLATE[stage].some(([k, l]) => k === key && l === label)) invalid();
      const item: VisitSopItem = { stage, key, label, result: choice(row.result, results), reason: row.reason === null ? null : line(row.reason), answeredByUserId: nullableId(row.answeredByUserId), answeredAt: nullableTime(row.answeredAt) };
      if (['not_applicable', 'skipped'].includes(item.result) && !item.reason || (item.answeredByUserId === null) !== (item.answeredAt === null)
        || (item.result === 'pending' ? item.answeredAt !== null || item.answeredByUserId !== null : item.answeredAt === null)) invalid();
      return item;
    });
    if (new Set(run.items.map(i => i.key)).size !== 29 || earlier(run.updatedAt, run.createdAt)
      || (run.currentStage === 'stage_a') !== (run.stageACompletedAt === null)
      || (['stage_a', 'stage_b'].includes(run.currentStage)) !== (run.stageBStartedAt === null)
      || (run.currentStage === 'completed') !== (run.stageCCompletedAt !== null)
      || run.stageACompletedAt && run.stageBStartedAt && earlier(run.stageBStartedAt, run.stageACompletedAt)
      || ['stage_c', 'completed'].includes(run.currentStage) && (result.anchor.visitId === null || result.anchor.checkedInAt === null
        || earlier(run.stageBStartedAt!, result.anchor.checkedInAt))
      || run.departedAt && (!run.stageBStartedAt || earlier(run.departedAt, run.stageBStartedAt))
      || run.currentStage !== 'stage_a' && run.items.some(i => i.stage === 'stage_a' && i.result === 'pending')
      || run.currentStage === 'completed' && (run.items.some(i => i.result === 'pending') || !run.departedAt || !run.nextAction || !run.nextFollowUpAt || !run.recap.feedback || !run.recap.objections || earlier(run.stageCCompletedAt!, run.departedAt))) invalid();
    result.run = run;
  }
  // Unknown imported classification stays unknown; a real new appointment/Visit can still have operational permission.
  if (result.scope.canWrite && (result.actor.role !== 'sales' || result.actor.userId !== result.scope.ownerUserId || result.scope.engagementStatus === 'lost'
    || ['cancelled', 'no_show'].includes(result.anchor.appointmentStatus ?? '') || result.anchor.visitStatus === 'cancelled' || result.run?.currentStage === 'completed')) invalid();
  if (!Array.isArray(raw.events) || raw.events.length > 50 || result.eventsHasMore && raw.events.length !== 50) invalid();
  result.events = (raw.events as unknown[]).map(v => {
    const e = rec(v), event = { id: uuid(e.id), command: choice(e.command, VISIT_SOP_COMMANDS), stage: choice(e.stage, stages), occurredAt: time(e.occurredAt), recordedAt: time(e.recordedAt), actorUserId: uuid(e.actorUserId), reason: line(e.reason) };
    if (earlier(event.recordedAt, event.occurredAt)) invalid(); return event;
  });
  if (new Set(result.events.map(e => e.id)).size !== result.events.length || result.run === null && result.events.length) invalid();
  return result;
}
