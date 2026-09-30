import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { CUSTOMER_VOICES_FORM_VERSION, VOICE_SCORES, VOICE_OPTIONAL_TEXT, VOICE_CHOICES, type VoiceAnswers } from './customerVoicesTemplate';
export * from './customerVoicesTemplate';
export const CUSTOMER_VOICES_CONTRACT_VERSION = 'customer_voices_v1';
export const CUSTOMER_VOICES_MAX_BYTES = 16384;
export class CustomerVoicesInputError extends Error { constructor() { super('กรุณาตรวจแบบประเมินและข้อมูลอ้างอิง'); this.name = 'CustomerVoicesInputError'; } }
const invalid = (): never => { throw new CustomerVoicesInputError(); };
const rec = (v: unknown) => { try { return bookingRecord(v); } catch { return invalid(); } };
const uuid = (v: unknown) => { try { return bookingUuid(v); } catch { return invalid(); } };
const bool = (v: unknown) => typeof v === 'boolean' ? v : invalid();
const time = (v: unknown): string => typeof v === 'string' && parseEvidenceTimestamp(v) !== null ? v : invalid();
const nullableTime = (v: unknown) => v === null ? null : time(v);
const nullableId = (v: unknown) => v === null ? null : uuid(v);
function exact(v: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) invalid();
}
function line(v: unknown, max = 500): string {
  if (typeof v !== 'string' || !v.trim() || Array.from(v.trim()).length > max || Array.from(v).some(c => {
    const n = c.charCodeAt(0); return n < 32 || n >= 127 && n <= 159 || n === 0x2028 || n === 0x2029 || c.length === 1 && n >= 0xd800 && n <= 0xdfff;
  })) return invalid(); return v.trim();
}
export function parseVoiceToken(v: unknown): string { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : invalid(); }
export function parseVoiceAnswers(value: unknown): VoiceAnswers {
  const raw = rec(value), result: Record<string, string | number | boolean> = {};
  const scores = VOICE_SCORES.map(([key]) => key), texts = VOICE_OPTIONAL_TEXT.map(([key]) => key), choices = Object.values(VOICE_CHOICES).flat().map(([key]) => key);
  const allowed: readonly string[] = [...scores, ...texts, ...choices, 'monthly_rent'];
  if (Object.keys(raw).some(k => !allowed.includes(k))) invalid();
  for (const key of scores) {
    const n = raw[key]; if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) invalid(); result[key] = n as number;
  }
  for (const key of texts) if (Object.hasOwn(raw, key)) result[key] = line(raw[key]);
  for (const key of choices) if (Object.hasOwn(raw, key)) result[key] = bool(raw[key]);
  if (Object.hasOwn(raw, 'monthly_rent')) {
    const n = raw.monthly_rent;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 9999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(n))) invalid();
    result.monthly_rent = n as number;
  }
  return result as VoiceAnswers;
}
export interface VoiceScope { customerId: string; interestId: string; visitId: string }
export function parseVoiceScope(v: unknown): VoiceScope { const r = rec(v); exact(r, ['customerId', 'interestId', 'visitId']); return { customerId: uuid(r.customerId), interestId: uuid(r.interestId), visitId: uuid(r.visitId) }; }
export function parseVoiceQuery(url: string): VoiceScope {
  const params = new URL(url).searchParams;
  for (const k of params.keys()) if (!['customerId', 'interestId', 'visitId'].includes(k) || params.getAll(k).length !== 1) invalid();
  return parseVoiceScope(Object.fromEntries(params));
}
export interface VoiceStaffInput extends VoiceScope {
  requestId: string; command: 'issue' | 'revoke'; expectedInterestRevision: string; expectedVisitRevision: string;
  expectedTokenId: string | null; token: string | null; reason: string;
}
export function parseVoiceStaffInput(v: unknown): VoiceStaffInput {
  const r = rec(v); exact(r, ['requestId', 'command', 'customerId', 'interestId', 'visitId', 'expectedInterestRevision', 'expectedVisitRevision', 'expectedTokenId', 'token', 'reason']);
  if (r.command !== 'issue' && r.command !== 'revoke') invalid();
  const token = r.token === null ? null : parseVoiceToken(r.token);
  if ((r.command === 'issue') !== (token !== null)) invalid();
  const expectedTokenId = nullableId(r.expectedTokenId); if (r.command === 'revoke' && !expectedTokenId) invalid();
  return { ...parseVoiceScope({ customerId: r.customerId, interestId: r.interestId, visitId: r.visitId }), requestId: uuid(r.requestId),
    command: r.command as VoiceStaffInput['command'], expectedInterestRevision: uuid(r.expectedInterestRevision), expectedVisitRevision: uuid(r.expectedVisitRevision),
    expectedTokenId, token, reason: line(r.reason, 1000) };
}
export interface VoiceStaffResult { requestId: string; command: 'issue' | 'revoke'; visitId: string; tokenId: string; expiresAt: string; replayed: boolean }
export function parseVoiceStaffResult(v: unknown, input: VoiceStaffInput): VoiceStaffResult {
  const r = rec(v); exact(r, ['requestId', 'command', 'visitId', 'tokenId', 'expiresAt', 'replayed']);
  if (r.command !== input.command || uuid(r.requestId) !== input.requestId || uuid(r.visitId) !== input.visitId) invalid();
  const result = { requestId: input.requestId, command: input.command, visitId: input.visitId, tokenId: uuid(r.tokenId), expiresAt: time(r.expiresAt), replayed: bool(r.replayed) };
  if (input.command === 'revoke' && result.tokenId !== input.expectedTokenId) invalid(); return result;
}
export interface VoiceSnapshot {
  actor: { userId: string; role: 'sales' | 'admin' | 'owner' };
  scope: VoiceScope & { customerName: string; projectName: string; interestRevision: string; ownerUserId: string; canManage: boolean };
  visit: { revision: string; status: 'awaiting_voice' | 'completed' | 'cancelled'; checkedInAt: string; completedAt: string | null };
  activeToken: { id: string; expiresAt: string } | null;
  submission: { submittedAt: string; answers: VoiceAnswers | null } | null;
  ttlHours: number;
}
export function parseVoiceSnapshot(v: unknown, scope: VoiceScope): VoiceSnapshot {
  const r = rec(v), a = rec(r.actor), s = rec(r.scope), visit = rec(r.visit);
  if (!['sales', 'admin', 'owner'].includes(String(a.role))) invalid();
  const parsedScope = parseVoiceScope({ customerId: s.customerId, interestId: s.interestId, visitId: s.visitId });
  if (Object.keys(scope).some(k => scope[k as keyof VoiceScope] !== parsedScope[k as keyof VoiceScope])) invalid();
  if (!['awaiting_voice', 'completed', 'cancelled'].includes(String(visit.status))) invalid();
  const active = r.activeToken === null ? null : rec(r.activeToken), submission = r.submission === null ? null : rec(r.submission);
  const result: VoiceSnapshot = {
    actor: { userId: uuid(a.userId), role: a.role as VoiceSnapshot['actor']['role'] },
    scope: { ...parsedScope, customerName: line(s.customerName, 200), projectName: line(s.projectName, 200), interestRevision: uuid(s.interestRevision), ownerUserId: uuid(s.ownerUserId), canManage: bool(s.canManage) },
    visit: { revision: uuid(visit.revision), status: visit.status as VoiceSnapshot['visit']['status'], checkedInAt: time(visit.checkedInAt), completedAt: nullableTime(visit.completedAt) },
    activeToken: active ? { id: uuid(active.id), expiresAt: time(active.expiresAt) } : null,
    submission: submission ? { submittedAt: time(submission.submittedAt), answers: submission.answers === null ? null : parseVoiceAnswers(submission.answers) } : null,
    ttlHours: typeof r.ttlHours === 'number' && Number.isInteger(r.ttlHours) && r.ttlHours >= 1 && r.ttlHours <= 168 ? r.ttlHours : invalid(),
  };
  if ((result.visit.status === 'completed') !== !!result.submission || (result.visit.status === 'completed') !== !!result.visit.completedAt
    || result.visit.status !== 'awaiting_voice' && result.activeToken || result.scope.canManage && (result.visit.status !== 'awaiting_voice'
      || result.actor.role === 'owner' || result.actor.role === 'sales' && result.actor.userId !== result.scope.ownerUserId)) invalid();
  if (result.submission && (Date.parse(result.submission.submittedAt) !== Date.parse(result.visit.completedAt!)
    || Date.parse(result.submission.submittedAt) < Date.parse(result.visit.checkedInAt))) invalid();
  if (result.submission?.answers && result.actor.role === 'sales' && result.actor.userId !== result.scope.ownerUserId) invalid();
  return result;
}
export type VoicePublicInput = { command: 'open'; token: string } | { command: 'submit'; token: string; requestId: string; formVersion: string; answers: VoiceAnswers };
export function parseVoicePublicInput(v: unknown): VoicePublicInput {
  const r = rec(v); if (r.command !== 'open' && r.command !== 'submit') invalid();
  exact(r, r.command === 'open' ? ['command', 'token'] : ['command', 'token', 'requestId', 'formVersion', 'answers']);
  const token = parseVoiceToken(r.token); if (r.command === 'open') return { command: 'open', token };
  if (r.formVersion !== CUSTOMER_VOICES_FORM_VERSION) invalid();
  return { command: 'submit', token, requestId: uuid(r.requestId), formVersion: CUSTOMER_VOICES_FORM_VERSION, answers: parseVoiceAnswers(r.answers) };
}
export type VoicePublicResult = { formVersion: string; expiresAt: string } | { submitted: true; replayed: boolean };
export function parseVoicePublicResult(v: unknown, input: VoicePublicInput): VoicePublicResult {
  const r = rec(v);
  if (input.command === 'open') { exact(r, ['formVersion', 'expiresAt']); if (r.formVersion !== CUSTOMER_VOICES_FORM_VERSION) invalid(); return { formVersion: CUSTOMER_VOICES_FORM_VERSION, expiresAt: time(r.expiresAt) }; }
  exact(r, ['submitted', 'replayed']); if (r.submitted !== true) invalid(); return { submitted: true, replayed: bool(r.replayed) };
}
