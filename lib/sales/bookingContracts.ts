import { isCentralUuid, parseCentralCreateInput } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { SALE_STAGES, type CrmRole, type SaleStage } from './workflow';
import { assertImportedBookingRow, parseImportedBookingHistory, type ImportedBookingHistory } from './importedBookingHistory';

export const BOOKING_CONTRACT_VERSION = 'booking_history_v1';
export const BOOKING_MAX_BYTES = 16384;
export const CANCELLATION_CATEGORIES = ['booking_cancelled', 'downpayment_abandoned', 'final_loan_rejection', 'other'] as const;
export type CancellationCategory = typeof CANCELLATION_CATEGORIES[number];
export interface BookingNewCustomer { name: string; phone: string; channel: string; notes: string; assignedSalesUserId: string | null }
interface Base { requestId: string; reason: string }
export type BookingInput =
  | (Base & { command: 'book'; customerId: string | null; newCustomer: BookingNewCustomer | null; projectName: string;
      expectedInterestRevision: string | null; plotId: string; paymentMethod: 'cash' | 'mortgage';
      bookingRoute: 'visited' | 'without_visit'; visitId: string | null; listPriceSatang: number; discountSatang: number;
      depositSatang: number; previousSaleId: string | null })
  | (Base & { command: 'cancel'; customerId: string; saleId: string; expectedSaleRevision: string; cancellationCategory: CancellationCategory })
  | (Base & { command: 'resume_follow_up'; customerId: string; saleId: string; expectedSaleRevision: string;
      expectedInterestRevision: string; expectedActionId: string | null; nextAction: { action: string; dueAt: string } });
export interface BookingResult {
  command: BookingInput['command']; customerId: string; interestId: string; saleId: string;
  saleRevision: string; interestRevision: string; nextActionId: string | null; replayed: boolean;
}
export interface BookingContext {
  actor: { userId: string; role: CrmRole };
  customer: { id: string; name: string; phone: string | null; ownerUserId: string; revision: string } | null;
  projects: { name: string }[];
  salesOwners: { userId: string; displayName: string }[];
  interests: { id: string; projectName: string; ownerUserId: string; revision: string; status: string; currentActionId: string | null;
    canEdit: boolean; visits: { id: string; checkedInAt: string }[] }[];
  sales: { id: string; interestId: string; projectName: string; plotId: string | null; stage: SaleStage; revision: string;
    bookingRound: number | null; previousSaleId: string | null; bookedAt: string | null; cancelledAt: string | null;
    importedHistory?: ImportedBookingHistory;
    cancellationReason: string | null; cancellationCategory: CancellationCategory | null;
    listPrice: number | null; discountAmount: number | null; salePrice: number | null; depositAmount: number | null;
    paymentMethod: 'cash' | 'mortgage' | null; canCancel: boolean; canResume: boolean }[];
  page: number; hasMore: boolean;
}
export interface BookingSearch { customers: { id: string; name: string; phone: string | null }[]; page: number; hasMore: boolean }
export class BookingInputError extends Error {
  readonly code = 'INVALID_INPUT';
  constructor(message = 'ข้อมูลการจองไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง') { super(message); this.name = 'BookingInputError'; }
}
export function bookingRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BookingInputError();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new BookingInputError('ข้อมูลมีช่องที่ขาดหรือไม่อนุญาต');
}
export function bookingUuid(value: unknown): string {
  if (!isCentralUuid(value) || value.length !== 36) throw new BookingInputError('รหัสอ้างอิงไม่ถูกต้อง');
  return value.toLowerCase();
}
const nullableUuid = (value: unknown) => value === null ? null : bookingUuid(value);
function line(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max || Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029 || (char.length === 1 && code >= 0xd800 && code <= 0xdfff);
  })) throw new BookingInputError('กรุณากรอกข้อความบรรทัดเดียวให้ครบและไม่เกินกำหนด');
  return value.trim();
}
function text(value: unknown): string { if (typeof value !== 'string') throw new BookingInputError(); return value; }
const nullableText = (value: unknown) => value === null ? null : text(value);
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new BookingInputError(); return value; }
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new BookingInputError(); return value as T;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || /\s/u.test(value) || parseEvidenceTimestamp(value) === null) throw new BookingInputError('วันเวลาไม่ถูกต้องหรือต้องระบุเขตเวลา');
  return value;
}
const nullableTime = (value: unknown) => value === null ? null : timestamp(value);
function satang(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 99999999999) throw new BookingInputError('จำนวนเงินไม่ถูกต้อง');
  return value;
}
/** Exact decimal conversion, not parseFloat/round (which could silently change money). */
export function bahtToSatang(value: string): number {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value) || /\s/u.test(value)) throw new BookingInputError('จำนวนเงินต้องเป็นตัวเลข มีทศนิยมไม่เกิน 2 ตำแหน่ง');
  const [whole, fraction = ''] = value.split('.');
  return satang(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
export function parseBookingInput(value: unknown): BookingInput {
  const raw = bookingRecord(value), command = choice(raw.command, ['book', 'cancel', 'resume_follow_up']);
  const baseKeys = ['requestId', 'command', 'reason'];
  keys(raw, [...baseKeys, ...(command === 'book' ? ['customerId', 'newCustomer', 'projectName', 'expectedInterestRevision', 'plotId', 'paymentMethod', 'bookingRoute', 'visitId', 'listPriceSatang', 'discountSatang', 'depositSatang', 'previousSaleId']
    : command === 'cancel' ? ['customerId', 'saleId', 'expectedSaleRevision', 'cancellationCategory']
      : ['customerId', 'saleId', 'expectedSaleRevision', 'expectedInterestRevision', 'expectedActionId', 'nextAction'])]);
  const base = { requestId: bookingUuid(raw.requestId), reason: line(raw.reason, 1000) };
  if (command === 'book') {
    const customerId = nullableUuid(raw.customerId);
    let newCustomer: BookingNewCustomer | null = null;
    if (raw.newCustomer !== null) {
      const fresh = bookingRecord(raw.newCustomer); keys(fresh, ['name', 'phone', 'channel', 'notes', 'assignedSalesUserId']);
      const assignedSalesUserId = nullableUuid(fresh.assignedSalesUserId);
      const parsed = parseCentralCreateInput({ requestId: base.requestId, name: fresh.name, phone: fresh.phone, channel: fresh.channel, notes: fresh.notes, interests: [],
        ...(assignedSalesUserId ? { assignedSalesUserId } : {}) });
      newCustomer = { name: parsed.name, phone: parsed.phone, channel: parsed.channel, notes: parsed.notes, assignedSalesUserId };
    }
    if ((customerId === null) === (newCustomer === null)) throw new BookingInputError('เลือกลูกค้าเดิมหรือสร้างลูกค้าใหม่อย่างใดอย่างหนึ่ง');
    const expectedInterestRevision = nullableUuid(raw.expectedInterestRevision), previousSaleId = nullableUuid(raw.previousSaleId);
    const route = choice(raw.bookingRoute, ['visited', 'without_visit']), visitId = nullableUuid(raw.visitId);
    if ((route === 'visited') !== (visitId !== null) || (newCustomer && (visitId || expectedInterestRevision || previousSaleId))) throw new BookingInputError('หลักฐานเข้าชมหรือประวัติจองไม่ตรงกับลูกค้า');
    const listPriceSatang = satang(raw.listPriceSatang), discountSatang = satang(raw.discountSatang), depositSatang = satang(raw.depositSatang);
    if (listPriceSatang <= discountSatang || depositSatang > listPriceSatang - discountSatang) throw new BookingInputError('ราคาขายต้องมากกว่าศูนย์ และเงินจองต้องไม่เกินราคาขาย');
    return { ...base, command, customerId, newCustomer, projectName: line(raw.projectName, 200), expectedInterestRevision,
      plotId: line(raw.plotId, 200), paymentMethod: choice(raw.paymentMethod, ['cash', 'mortgage']), bookingRoute: route, visitId,
      listPriceSatang, discountSatang, depositSatang, previousSaleId };
  }
  const sale = { customerId: bookingUuid(raw.customerId), saleId: bookingUuid(raw.saleId), expectedSaleRevision: bookingUuid(raw.expectedSaleRevision) };
  if (command === 'cancel') return { ...base, ...sale, command, cancellationCategory: choice(raw.cancellationCategory, CANCELLATION_CATEGORIES) };
  const next = bookingRecord(raw.nextAction); keys(next, ['action', 'dueAt']);
  return { ...base, ...sale, command, expectedInterestRevision: bookingUuid(raw.expectedInterestRevision), expectedActionId: nullableUuid(raw.expectedActionId), nextAction: { action: line(next.action, 500), dueAt: timestamp(next.dueAt) } };
}
export function parseBookingResult(value: unknown, input: BookingInput): BookingResult {
  const raw = bookingRecord(value);
  const result = { command: choice(raw.command, ['book', 'cancel', 'resume_follow_up']), customerId: bookingUuid(raw.customerId), interestId: bookingUuid(raw.interestId),
    saleId: bookingUuid(raw.saleId), saleRevision: bookingUuid(raw.saleRevision), interestRevision: bookingUuid(raw.interestRevision), nextActionId: nullableUuid(raw.nextActionId), replayed: bool(raw.replayed) };
  if (result.command !== input.command || (input.customerId && result.customerId !== input.customerId)
    || (input.command !== 'book' && result.saleId !== input.saleId)
    || (input.command !== 'resume_follow_up' && result.nextActionId !== null)
    || (input.command === 'cancel' && result.saleRevision === input.expectedSaleRevision)
    || (input.command === 'resume_follow_up' && (!result.nextActionId || result.saleRevision !== input.expectedSaleRevision))) throw new BookingInputError();
  return result;
}
export function bookingPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000) throw new BookingInputError(); return value;
}
function array<T>(value: unknown, max: number, parse: (value: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new BookingInputError(); return value.map(item => parse(bookingRecord(item)));
}
function money(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new BookingInputError(); return value;
}
export function parseBookingContext(value: unknown, customerId: string | null, page: number): BookingContext {
  const raw = bookingRecord(value), actor = bookingRecord(raw.actor);
  if (Object.hasOwn(raw, 'prepared')) throw new BookingInputError();
  const customer = raw.customer === null ? null : bookingRecord(raw.customer);
  const context: BookingContext = {
    actor: { userId: bookingUuid(actor.userId), role: choice(actor.role, ['sales', 'admin', 'owner']) },
    customer: customer ? { id: bookingUuid(customer.id), name: text(customer.name), phone: nullableText(customer.phone), ownerUserId: bookingUuid(customer.ownerUserId), revision: bookingUuid(customer.revision) } : null,
    projects: array(raw.projects, 1000, item => ({ name: text(item.name) })),
    salesOwners: array(raw.salesOwners, 1000, item => ({ userId: bookingUuid(item.userId), displayName: text(item.displayName) })),
    interests: array(raw.interests, 1000, item => ({ id: bookingUuid(item.id), projectName: text(item.projectName), ownerUserId: bookingUuid(item.ownerUserId),
      revision: bookingUuid(item.revision), status: text(item.status), currentActionId: nullableUuid(item.currentActionId), canEdit: bool(item.canEdit),
      visits: array(item.visits, 50, visit => ({ id: bookingUuid(visit.id), checkedInAt: timestamp(visit.checkedInAt) })) })),
    sales: array(raw.sales, 50, item => {
      if (Object.hasOwn(item, 'historyEvidence')) throw new BookingInputError();
      const importedHistory = parseImportedBookingHistory(item.importedHistory);
      assertImportedBookingRow(item, importedHistory);
      return { id: bookingUuid(item.id), interestId: bookingUuid(item.interestId), projectName: text(item.projectName), plotId: nullableText(item.plotId), stage: choice(item.stage, SALE_STAGES),
        revision: bookingUuid(item.revision), bookingRound: item.bookingRound as number | null, previousSaleId: nullableUuid(item.previousSaleId), bookedAt: nullableTime(item.bookedAt), cancelledAt: nullableTime(item.cancelledAt),
        ...(importedHistory ? { importedHistory } : {}),
        cancellationReason: nullableText(item.cancellationReason), cancellationCategory: item.cancellationCategory === null ? null : choice(item.cancellationCategory, CANCELLATION_CATEGORIES),
        listPrice: money(item.listPrice), discountAmount: money(item.discountAmount), salePrice: money(item.salePrice), depositAmount: money(item.depositAmount),
        paymentMethod: item.paymentMethod === null ? null : choice(item.paymentMethod, ['cash', 'mortgage'] as const), canCancel: bool(item.canCancel), canResume: bool(item.canResume) };
    }), page: bookingPage(raw.page), hasMore: bool(raw.hasMore),
  };
  if (context.page !== page || (context.customer?.id ?? null) !== customerId || (!customerId && (context.interests.length || context.sales.length))) throw new BookingInputError();
  if (new Set(context.sales.map(sale => sale.id)).size !== context.sales.length || new Set(context.interests.map(interest => interest.id)).size !== context.interests.length) throw new BookingInputError();
  for (const sale of context.sales) {
    const interest = context.interests.find(item => item.id === sale.interestId);
    if (!interest || interest.projectName !== sale.projectName || (sale.canResume && sale.stage !== 'cancelled')
      || (sale.canCancel && ['cancelled', 'transferred', 'handover'].includes(sale.stage)) || (context.actor.role === 'owner' && (sale.canResume || sale.canCancel))) throw new BookingInputError();
  }
  return context;
}
export function parseBookingSearch(value: unknown, page: number): BookingSearch {
  const raw = bookingRecord(value);
  if (bookingPage(raw.page) !== page) throw new BookingInputError();
  return { customers: array(raw.customers, 25, item => ({ id: bookingUuid(item.id), name: text(item.name), phone: nullableText(item.phone) })), page, hasMore: bool(raw.hasMore) };
}
export function parseBookingQuery(url: string, search = false): { page: number; customerId: string | null; query: string } {
  const params = new URL(url).searchParams, allowed = search ? ['q', 'page'] : ['customerId', 'page'];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new BookingInputError();
  const page = params.get('page') ?? '0'; if (!/^(0|[1-9]\d{0,5})$/.test(page)) throw new BookingInputError();
  const query = search ? line(params.get('q'), 200) : '';
  if (search && query.length < 2) throw new BookingInputError('ค้นหาชื่อหรือเบอร์อย่างน้อย 2 ตัวอักษร');
  return { page: bookingPage(Number(page)), customerId: params.has('customerId') ? bookingUuid(params.get('customerId')) : null, query };
}
