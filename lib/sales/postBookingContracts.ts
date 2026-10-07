import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { SALE_STAGES, type CrmRole, type PaymentMethod, type SaleStage } from './workflow';

export const POST_BOOKING_CONTRACT_VERSION = 'post_booking_v2';
export const POST_BOOKING_MAX_BYTES = 16384;
export const POST_BOOKING_ADVANCE_STAGES = ['contracted', 'downpayment', 'document_prep', 'transfer_pending'] as const;
export type PostBookingAdvanceStage = typeof POST_BOOKING_ADVANCE_STAGES[number];
interface CommandBase {
  requestId: string; customerId: string; saleId: string; expectedSaleRevision: string; expectedInterestRevision: string;
  reason: string;
}
interface Base extends CommandBase { evidenceNote: string; occurredAt: string }
export type PostBookingInput =
  | (Base & { command: 'advance'; nextStage: PostBookingAdvanceStage })
  | (Base & { command: 'submit_loan'; bankName: string })
  | (Base & { command: 'loan_result'; loanAttemptId: string; result: 'approved' | 'rejected'; approvedAmountSatang: number | null })
  | (CommandBase & { command: 'confirm_transfer'; transferDate: string });
export interface PostBookingResult {
  requestId: string; command: PostBookingInput['command']; customerId: string; interestId: string; saleId: string;
  saleRevision: string; stage: SaleStage; eventId: string; loanAttemptId: string | null; transferDate: string | null; replayed: boolean;
}
export interface PostBookingScope { saleId: string; attemptPage: number; eventPage: number }
export interface PurchaseLoanAttempt {
  id: string; saleId: string; interestId: string; attemptNumber: number; bankName: string;
  status: 'submitted' | 'pending' | 'rejected' | 'approved' | 'withdrawn';
  submittedAt: string | null; resultAt: string | null; resultReason: string | null;
  approvedAmount: number | null; recordedByUserId: string;
}
export interface PostBookingEvent {
  id: string; command: PostBookingInput['command']; fromStage: SaleStage; toStage: SaleStage;
  occurredAt: string | null; recordedAt: string; actorUserId: string; reason: string; evidenceNote: string | null;
  loanAttemptId: string | null; transferDate: string | null;
}
export interface PostBookingSnapshot {
  actor: { userId: string; role: CrmRole };
  sale: { id: string; customerId: string; customerName: string; interestId: string; projectName: string; plotId: string | null;
    stage: SaleStage; paymentMethod: PaymentMethod | null; bookedAt: string | null; contractedAt: string | null; transferDate: string | null;
    revision: string; interestRevision: string; ownerUserId: string; canEdit: boolean };
  latestAttempt: PurchaseLoanAttempt | null; attempts: PurchaseLoanAttempt[]; attemptPage: number; attemptsHasMore: boolean;
  events: PostBookingEvent[]; eventPage: number; eventsHasMore: boolean;
}
export class PostBookingInputError extends Error {
  constructor(message = 'ข้อมูลหลังจองไม่ถูกต้อง กรุณาตรวจสอบ') { super(message); this.name = 'PostBookingInputError'; }
}
const invalid = (message?: string): never => { throw new PostBookingInputError(message); };
const record = (value: unknown): Record<string, unknown> => { try { return bookingRecord(value); } catch { return invalid(); } };
const uuid = (value: unknown): string => { try { return bookingUuid(value); } catch { return invalid('รหัสอ้างอิงไม่ถูกต้อง'); } };
const nullableUuid = (value: unknown) => value === null ? null : uuid(value);
function keys(raw: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(raw).length !== expected.length || expected.some(key => !Object.hasOwn(raw, key))) invalid();
}
function line(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max || Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029 || (char.length === 1 && code >= 0xd800 && code <= 0xdfff);
  })) return invalid('กรุณากรอกข้อความบรรทัดเดียวให้ครบและไม่เกินกำหนด');
  return value.trim();
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? value as T : invalid();
}
function time(value: unknown): string {
  return typeof value === 'string' && parseEvidenceTimestamp(value) !== null ? value : invalid('วันเวลาต้องถูกต้องและระบุเขตเวลา');
}
const nullableTime = (value: unknown) => value === null ? null : time(value);
/** A known calendar day is not an invented midnight timestamp. */
export function parseTransferDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('กรุณาระบุวันโอนจริงให้ถูกต้อง');
  const [year, month, day] = value.split('-').map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return invalid('กรุณาระบุวันโอนจริงให้ถูกต้อง');
  return value;
}
export function bangkokDateFromTimestamp(value: string): string {
  const instant = parseEvidenceTimestamp(value);
  if (instant === null) return invalid();
  const milliseconds = instant / BigInt(1000) - (instant < BigInt(0) && instant % BigInt(1000) !== BigInt(0) ? BigInt(1) : BigInt(0));
  return parseTransferDate(new Date(Number(milliseconds) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10));
}
export function displayTransferDate(value: string | null): string {
  if (value === null) return 'ไม่ทราบวันโอน';
  const [year, month, day] = parseTransferDate(value).split('-').map(Number);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${day} ${months[month - 1]} ${year + 543}`;
}
const nullableDate = (value: unknown) => value === null ? null : parseTransferDate(value);
const nullableText = (value: unknown) => value === null ? null : typeof value === 'string' ? value : invalid();
const bool = (value: unknown) => typeof value === 'boolean' ? value : invalid();
const page = (value: unknown): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000 ? value : invalid();
export function parsePostBookingScope(value: unknown): PostBookingScope {
  const raw = record(value); keys(raw, ['saleId', 'attemptPage', 'eventPage']);
  return { saleId: uuid(raw.saleId), attemptPage: page(raw.attemptPage), eventPage: page(raw.eventPage) };
}
export function parsePostBookingQuery(url: string): PostBookingScope {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['saleId', 'attemptPage', 'eventPage'].includes(key) || params.getAll(key).length !== 1) return invalid();
  const attempt = params.get('attemptPage') ?? '0', event = params.get('eventPage') ?? '0';
  if (!/^(0|[1-9]\d{0,5})$/.test(attempt) || !/^(0|[1-9]\d{0,5})$/.test(event)) return invalid();
  return parsePostBookingScope({ saleId: params.get('saleId'), attemptPage: Number(attempt), eventPage: Number(event) });
}
export function parsePostBookingPageQuery(raw: Record<string, string | string[] | undefined>): string {
  if (Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'saleId')) return invalid();
  return uuid(raw.saleId);
}
export function parsePostBookingInput(value: unknown): PostBookingInput {
  const raw = record(value), command = choice(raw.command, ['advance', 'submit_loan', 'loan_result', 'confirm_transfer']);
  keys(raw, ['requestId', 'command', 'customerId', 'saleId', 'expectedSaleRevision', 'expectedInterestRevision', 'reason',
    ...(command === 'confirm_transfer' ? ['transferDate'] : ['evidenceNote', 'occurredAt',
      ...(command === 'advance' ? ['nextStage'] : command === 'submit_loan' ? ['bankName'] : ['loanAttemptId', 'result', 'approvedAmountSatang'])])]);
  const common: CommandBase = { requestId: uuid(raw.requestId), customerId: uuid(raw.customerId), saleId: uuid(raw.saleId),
    expectedSaleRevision: uuid(raw.expectedSaleRevision), expectedInterestRevision: uuid(raw.expectedInterestRevision),
    reason: line(raw.reason) };
  if (command === 'confirm_transfer') return { ...common, command, transferDate: parseTransferDate(raw.transferDate) };
  const base: Base = { ...common, evidenceNote: line(raw.evidenceNote), occurredAt: time(raw.occurredAt) };
  if (command === 'advance') return { ...base, command, nextStage: choice(raw.nextStage, POST_BOOKING_ADVANCE_STAGES) };
  if (command === 'submit_loan') return { ...base, command, bankName: line(raw.bankName, 200) };
  const result = choice(raw.result, ['approved', 'rejected']);
  const amount = raw.approvedAmountSatang;
  if (result === 'approved' ? typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999 : amount !== null) return invalid('ผลอนุมัติต้องระบุวงเงินที่อนุมัติจริง ผลปฏิเสธต้องไม่มีวงเงินอนุมัติ');
  return { ...base, command, result, loanAttemptId: uuid(raw.loanAttemptId), approvedAmountSatang: amount as number | null };
}
export function postBookingResultStage(input: PostBookingInput): SaleStage {
  if (input.command === 'confirm_transfer') return 'transferred';
  return input.command === 'advance' ? input.nextStage : input.command === 'submit_loan' ? 'loan_submitted' : input.result === 'approved' ? 'loan_approved' : 'loan_rejected';
}
/** UI choices only; SQL rechecks trusted current state/ownership/evidence under locks. */
export function postBookingTargets(stage: SaleStage, method: PaymentMethod | null): readonly SaleStage[] {
  if (method === null) return [];
  if (stage === 'transfer_pending') return ['transferred'];
  if (stage === 'booked') return ['contracted'];
  if (stage === 'contracted') return method === 'cash' ? ['downpayment', 'document_prep', 'transfer_pending'] : ['downpayment', 'document_prep'];
  if (stage === 'downpayment') return method === 'cash' ? ['document_prep', 'transfer_pending'] : ['document_prep'];
  if (stage === 'document_prep') return method === 'cash' ? ['transfer_pending'] : ['loan_submitted'];
  if (method === 'mortgage' && stage === 'loan_rejected') return ['loan_submitted'];
  if (method === 'mortgage' && stage === 'loan_submitted') return ['loan_approved', 'loan_rejected'];
  if (method === 'mortgage' && stage === 'loan_approved') return ['transfer_pending'];
  return [];
}
export function parsePostBookingResult(value: unknown, input: PostBookingInput): PostBookingResult {
  const raw = record(value);
  const result: PostBookingResult = { requestId: uuid(raw.requestId), command: choice(raw.command, ['advance', 'submit_loan', 'loan_result', 'confirm_transfer']),
    customerId: uuid(raw.customerId), interestId: uuid(raw.interestId), saleId: uuid(raw.saleId), saleRevision: uuid(raw.saleRevision),
    stage: choice(raw.stage, SALE_STAGES), eventId: uuid(raw.eventId), loanAttemptId: nullableUuid(raw.loanAttemptId), transferDate: nullableDate(raw.transferDate), replayed: bool(raw.replayed) };
  if (result.requestId !== input.requestId || result.command !== input.command || result.customerId !== input.customerId || result.saleId !== input.saleId
    || result.stage !== postBookingResultStage(input) || result.saleRevision === input.expectedSaleRevision
    || (input.command === 'advance' || input.command === 'confirm_transfer' ? result.loanAttemptId !== null : result.loanAttemptId === null)
    || result.transferDate !== (input.command === 'confirm_transfer' ? input.transferDate : null)
    || (input.command === 'loan_result' && result.loanAttemptId !== input.loanAttemptId)) return invalid();
  return result;
}
export function parsePostBookingSnapshot(value: unknown, scope: PostBookingScope): PostBookingSnapshot {
  const raw = record(value), actor = record(raw.actor), sale = record(raw.sale);
  const result: PostBookingSnapshot = {
    actor: { userId: uuid(actor.userId), role: choice(actor.role, ['sales', 'admin', 'owner']) },
    sale: { id: uuid(sale.id), customerId: uuid(sale.customerId), customerName: line(sale.customerName, 200),
      interestId: uuid(sale.interestId), projectName: line(sale.projectName, 200), plotId: nullableText(sale.plotId),
      stage: choice(sale.stage, SALE_STAGES), paymentMethod: sale.paymentMethod === null ? null : choice<PaymentMethod>(sale.paymentMethod, ['cash', 'mortgage']),
      bookedAt: nullableTime(sale.bookedAt), contractedAt: nullableTime(sale.contractedAt), transferDate: nullableDate(sale.transferDate), revision: uuid(sale.revision),
      interestRevision: uuid(sale.interestRevision), ownerUserId: uuid(sale.ownerUserId), canEdit: bool(sale.canEdit) },
    latestAttempt: null, attempts: [], attemptPage: page(raw.attemptPage), attemptsHasMore: bool(raw.attemptsHasMore),
    events: [], eventPage: page(raw.eventPage), eventsHasMore: bool(raw.eventsHasMore),
  };
  if (result.sale.id !== scope.saleId || result.attemptPage !== scope.attemptPage || result.eventPage !== scope.eventPage
    || !Array.isArray(raw.attempts) || raw.attempts.length > 50 || !Array.isArray(raw.events) || raw.events.length > 50
    || (result.sale.plotId === null && result.sale.stage !== 'cancelled')
    || (result.sale.transferDate !== null && (!['transferred', 'handover'].includes(result.sale.stage)
      || [result.sale.bookedAt, result.sale.contractedAt].some(value => value !== null && result.sale.transferDate! < bangkokDateFromTimestamp(value))))
    || (result.sale.canEdit && (result.actor.role === 'owner' || postBookingTargets(result.sale.stage, result.sale.paymentMethod).length === 0
      || (result.actor.role === 'sales' && result.actor.userId !== result.sale.ownerUserId)))) return invalid();
  const attempt = (value: unknown): PurchaseLoanAttempt => {
    const item = record(value);
    if (!Number.isSafeInteger(item.attemptNumber) || (item.attemptNumber as number) < 1
      || (item.approvedAmount !== null && (typeof item.approvedAmount !== 'number' || !Number.isFinite(item.approvedAmount) || item.approvedAmount < 0))) return invalid();
    const loan: PurchaseLoanAttempt = { id: uuid(item.id), saleId: uuid(item.saleId), interestId: uuid(item.interestId), attemptNumber: item.attemptNumber as number,
      bankName: line(item.bankName, 200), status: choice(item.status, ['submitted', 'pending', 'rejected', 'approved', 'withdrawn']),
      submittedAt: nullableTime(item.submittedAt), resultAt: nullableTime(item.resultAt), resultReason: nullableText(item.resultReason),
      approvedAmount: item.approvedAmount as number | null, recordedByUserId: uuid(item.recordedByUserId) };
    if (loan.saleId !== result.sale.id || loan.interestId !== result.sale.interestId) return invalid();
    if (loan.submittedAt && loan.resultAt && parseEvidenceTimestamp(loan.resultAt)! < parseEvidenceTimestamp(loan.submittedAt)!) return invalid();
    return loan;
  };
  result.latestAttempt = raw.latestAttempt === null ? null : attempt(raw.latestAttempt);
  result.attempts = raw.attempts.map(attempt);
  result.events = raw.events.map(value => {
    const item = record(value);
    const event: PostBookingEvent = { id: uuid(item.id), command: choice(item.command, ['advance', 'submit_loan', 'loan_result', 'confirm_transfer']),
      fromStage: choice(item.fromStage, SALE_STAGES), toStage: choice(item.toStage, SALE_STAGES), occurredAt: nullableTime(item.occurredAt),
      recordedAt: time(item.recordedAt), actorUserId: uuid(item.actorUserId), reason: line(item.reason), evidenceNote: item.evidenceNote === null ? null : line(item.evidenceNote),
      loanAttemptId: nullableUuid(item.loanAttemptId), transferDate: nullableDate(item.transferDate) };
    if (result.sale.paymentMethod !== null && !postBookingTargets(event.fromStage, result.sale.paymentMethod).includes(event.toStage)) return invalid();
    if (event.command === 'confirm_transfer') {
      if (event.fromStage !== 'transfer_pending' || event.toStage !== 'transferred' || event.transferDate === null
        || event.transferDate !== result.sale.transferDate || event.transferDate > bangkokDateFromTimestamp(event.recordedAt)
        || event.occurredAt !== null || event.evidenceNote !== null || event.loanAttemptId !== null) return invalid();
    } else if (event.occurredAt === null || event.evidenceNote === null || event.transferDate !== null
      || parseEvidenceTimestamp(event.occurredAt)! > parseEvidenceTimestamp(event.recordedAt)!
      || (event.command === 'advance' ? !POST_BOOKING_ADVANCE_STAGES.includes(event.toStage as PostBookingAdvanceStage) || event.loanAttemptId !== null
        : event.command === 'submit_loan' ? event.toStage !== 'loan_submitted' || event.loanAttemptId === null
          : !['loan_approved', 'loan_rejected'].includes(event.toStage) || event.loanAttemptId === null)) return invalid();
    return event;
  });
  if ((result.attemptsHasMore && result.attempts.length !== 50) || (result.eventsHasMore && result.events.length !== 50)
    || new Set(result.attempts.map(row => row.id)).size !== result.attempts.length || new Set(result.events.map(row => row.id)).size !== result.events.length
    || result.attempts.some((row, index) => index > 0 && row.attemptNumber >= result.attempts[index - 1].attemptNumber)
    || (result.latestAttempt === null && (result.attempts.length > 0 || result.attemptsHasMore))
    || (result.attemptPage === 0 && JSON.stringify(result.latestAttempt) !== JSON.stringify(result.attempts[0] ?? null))
    || result.attempts.some(row => row.attemptNumber > (result.latestAttempt?.attemptNumber ?? 0))) return invalid();
  return result;
}
