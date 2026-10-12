import { bookingRecord, bookingUuid, bookingPage } from './bookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { parseTransferDate } from './postBookingContracts';
import type { CrmRole } from './workflow';

export const RENTAL_COMMAND_VERSION = 'rental_lifecycle_v1';
export const RENTAL_COMMAND_MAX_BYTES = 16384;
export const RENTAL_PROGRAMS = ['program_a', 'program_b', 'program_c'] as const;
export const RENTAL_PAYMENT_KINDS = ['rent', 'savings', 'security_deposit', 'advance_rent'] as const;
export const RENTAL_COMMANDS = ['start', 'renew', 'record_payment', 'end', 'convert_to_buy'] as const;
export type RentalProgram = typeof RENTAL_PROGRAMS[number];
export type RentalPaymentKind = typeof RENTAL_PAYMENT_KINDS[number];
export interface RentalCommandScope {
  customerId: string; projectName: string; contractId: string | null;
  contractPage: number; eventPage: number; paymentPage: number; plotPage: number;
}
interface Base {
  requestId: string; customerId: string; interestId: string; projectName: string;
  expectedCustomerRevision: string; expectedInterestRevision: string; reason: string;
}
interface Existing extends Base { contractId: string; expectedContractRevision: string }
export type RentalCommandInput =
  | (Base & { command: 'start'; contractId: null; expectedContractRevision: null; plotId: string;
      programType: RentalProgram; startDate: string; durationMonths: number; monthlyRentSatang: number;
      securityDepositSatang: number; advanceRentSatang: number; savingsPerMonthSatang: number; basePriceSatang: number | null })
  | (Existing & { command: 'renew'; renewalMonths: number; monthlyRentSatang: number })
  | (Existing & { command: 'record_payment'; kind: RentalPaymentKind; amountSatang: number; paidDate: string; evidenceNote: string; reference: string })
  | (Existing & { command: 'end'; endDate: string })
  | (Existing & { command: 'convert_to_buy'; purchaseDate: string; paymentMethod: 'cash' | 'mortgage';
      listPriceSatang: number; discountSatang: number; depositSatang: number; bookingRoute: 'visited' | 'without_visit'; visitId: string | null });
export interface CanonicalRentalContract {
  id: string; customerId: string; interestId: string; projectName: string; plotId: string; ownerUserId: string;
  programType: RentalProgram; status: 'active' | 'renewed' | 'converted' | 'ended'; revision: string;
  startDate: string; endDate: string; monthlyRentSatang: number; securityDepositSatang: number; advanceRentSatang: number;
  savingsPerMonthSatang: number; basePriceSatang: number | null; confirmedSavingsSatang: number; confirmedDepositSatang: number;
  convertedSaleId: string | null; endedDate: string | null;
}
export interface RentalCommandEvent {
  id: string; contractId: string; command: RentalCommandInput['command']; occurredDate: string | null;
  recordedAt: string; actorUserId: string; reason: string;
}
export interface RentalPaymentEvidence {
  id: string; contractId: string; kind: RentalPaymentKind; amountSatang: number; paidDate: string;
  reference: string; evidenceNote: string; recordedAt: string; actorUserId: string;
}
export interface RentalCommandSnapshot {
  actor: { userId: string; role: CrmRole };
  customer: { id: string; name: string; phone: string | null; revision: string };
  interest: { id: string; projectName: string; ownerUserId: string; revision: string; canEdit: boolean };
  contracts: CanonicalRentalContract[]; contractPage: number; contractsHasMore: boolean;
  selectedContract: CanonicalRentalContract | null;
  events: RentalCommandEvent[]; eventPage: number; eventsHasMore: boolean;
  payments: RentalPaymentEvidence[]; paymentPage: number; paymentsHasMore: boolean;
  plots: { id: string; name: string | null; available: boolean }[]; plotPage: number; plotsHasMore: boolean;
}
export interface RentalCommandResult {
  requestId: string; command: RentalCommandInput['command']; customerId: string; interestId: string; contractId: string;
  contractRevision: string; interestRevision: string; saleId: string | null; saleRevision: string | null; replayed: boolean;
}
export class RentalCommandInputError extends Error {
  constructor(message = 'ข้อมูลสัญญาเช่าไม่ถูกต้อง กรุณาตรวจสอบ') { super(message); this.name = 'RentalCommandInputError'; }
}
const invalid = (message?: string): never => { throw new RentalCommandInputError(message); };
const rec = (v: unknown) => { try { return bookingRecord(v); } catch { return invalid(); } };
const uuid = (v: unknown) => { try { return bookingUuid(v); } catch { return invalid(); } };
const nullableUuid = (v: unknown) => v === null ? null : uuid(v);
function exact(r: Record<string, unknown>, names: readonly string[]) {
  if (Object.keys(r).length !== names.length || names.some(name => !Object.hasOwn(r, name))) invalid();
}
function line(v: unknown, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || Array.from(v.trim()).length > max || Array.from(v).some(c => {
    const n = c.charCodeAt(0); return n < 32 || (n >= 127 && n <= 159) || n === 0x2028 || n === 0x2029 || (c.length === 1 && n >= 0xd800 && n <= 0xdfff);
  })) return invalid();
  return v.trim();
}
const nullableLine = (v: unknown) => v === null ? null : line(v);
function choice<T extends string>(v: unknown, options: readonly T[]): T { return typeof v === 'string' && options.includes(v as T) ? v as T : invalid(); }
function amount(v: unknown, positive = false): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= (positive ? 1 : 0) && v <= 99999999999 ? v : invalid();
}
const nullableAmount = (v: unknown) => v === null ? null : amount(v, true);
const bool = (v: unknown) => typeof v === 'boolean' ? v : invalid();
const day = (v: unknown) => { try { return parseTransferDate(v); } catch { return invalid('กรุณาระบุวันที่จริงให้ถูกต้อง'); } };
const nullableDay = (v: unknown) => v === null ? null : day(v);
function months(v: unknown, minimum: number) { return typeof v === 'number' && Number.isInteger(v) && v >= minimum && v <= 120 ? v : invalid(); }
function page(v: unknown) { try { return bookingPage(v); } catch { return invalid(); } }
const timestamp = (v: unknown) => typeof v === 'string' && !/\s/u.test(v) && parseEvidenceTimestamp(v) !== null ? v : invalid();

export function parseRentalCommandScope(v: unknown): RentalCommandScope {
  const r = rec(v); exact(r, ['customerId','projectName','contractId','contractPage','eventPage','paymentPage','plotPage']);
  const result = { customerId: uuid(r.customerId), projectName: line(r.projectName), contractId: nullableUuid(r.contractId),
    contractPage: page(r.contractPage), eventPage: page(r.eventPage), paymentPage: page(r.paymentPage), plotPage: page(r.plotPage) };
  if (result.contractId === null && (result.eventPage !== 0 || result.paymentPage !== 0)) return invalid();
  return result;
}
export function parseRentalCommandQuery(url: string): RentalCommandScope {
  const params = new URL(url).searchParams;
  const allowed = ['customerId','projectName','contractId','contractPage','eventPage','paymentPage','plotPage'];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) return invalid();
  const paging: Record<string, number> = {};
  for (const key of ['contractPage','eventPage','paymentPage','plotPage']) {
    const value = params.get(key) ?? '0'; if (!/^(0|[1-9]\d{0,5})$/.test(value)) return invalid(); paging[key] = page(Number(value));
  }
  return parseRentalCommandScope({ customerId: params.get('customerId'), projectName: params.get('projectName'), contractId: params.get('contractId'), ...paging });
}
export function parseRentalCommandPageQuery(raw: Record<string, string | string[] | undefined>): Pick<RentalCommandScope,'customerId'|'projectName'|'contractId'> {
  if (Object.keys(raw).some(k => !['customerId','projectName','contractId'].includes(k)) || !Object.hasOwn(raw, 'customerId') || !Object.hasOwn(raw,'projectName')) return invalid();
  return { customerId: uuid(raw.customerId), projectName: line(raw.projectName), contractId: raw.contractId === undefined ? null : uuid(raw.contractId) };
}
export function parseRentalCommandInput(v: unknown): RentalCommandInput {
  const r = rec(v), command = choice(r.command, RENTAL_COMMANDS);
  const commonKeys = ['requestId','command','customerId','interestId','projectName','expectedCustomerRevision','expectedInterestRevision','contractId','expectedContractRevision','reason'];
  const commandKeys = command === 'start' ? ['plotId','programType','startDate','durationMonths','monthlyRentSatang','securityDepositSatang','advanceRentSatang','savingsPerMonthSatang','basePriceSatang']
    : command === 'renew' ? ['renewalMonths','monthlyRentSatang'] : command === 'end' ? ['endDate']
      : command === 'record_payment' ? ['kind','amountSatang','paidDate','evidenceNote','reference']
        : ['purchaseDate','paymentMethod','listPriceSatang','discountSatang','depositSatang','bookingRoute','visitId'];
  exact(r, [...commonKeys, ...commandKeys]);
  const common: Base = { requestId: uuid(r.requestId), customerId: uuid(r.customerId), interestId: uuid(r.interestId), projectName: line(r.projectName),
    expectedCustomerRevision: uuid(r.expectedCustomerRevision), expectedInterestRevision: uuid(r.expectedInterestRevision), reason: line(r.reason,1000) };
  if (command === 'start') {
    if (r.contractId !== null || r.expectedContractRevision !== null) return invalid();
    const programType = choice(r.programType, RENTAL_PROGRAMS), savingsPerMonthSatang = amount(r.savingsPerMonthSatang), basePriceSatang = nullableAmount(r.basePriceSatang);
    if ((programType !== 'program_b' && savingsPerMonthSatang !== 0) || (programType === 'program_c' && basePriceSatang === null)) return invalid();
    return { ...common, command, contractId: null, expectedContractRevision: null, plotId: line(r.plotId), programType,
      startDate: day(r.startDate), durationMonths: months(r.durationMonths,12), monthlyRentSatang: amount(r.monthlyRentSatang,true),
      securityDepositSatang: amount(r.securityDepositSatang), advanceRentSatang: amount(r.advanceRentSatang), savingsPerMonthSatang, basePriceSatang };
  }
  const existing: Existing = { ...common, contractId: uuid(r.contractId), expectedContractRevision: uuid(r.expectedContractRevision) };
  if (command === 'renew') return { ...existing, command, renewalMonths: months(r.renewalMonths,1), monthlyRentSatang: amount(r.monthlyRentSatang,true) };
  if (command === 'end') return { ...existing, command, endDate: day(r.endDate) };
  if (command === 'record_payment') return { ...existing, command, kind: choice(r.kind, RENTAL_PAYMENT_KINDS), amountSatang: amount(r.amountSatang,true),
    paidDate: day(r.paidDate), evidenceNote: line(r.evidenceNote,1000), reference: line(r.reference) };
  const bookingRoute = choice(r.bookingRoute,['visited','without_visit']), visitId = nullableUuid(r.visitId);
  const listPriceSatang = amount(r.listPriceSatang,true), discountSatang = amount(r.discountSatang), depositSatang = amount(r.depositSatang);
  if ((bookingRoute === 'visited') !== (visitId !== null) || discountSatang >= listPriceSatang || depositSatang > listPriceSatang - discountSatang) return invalid();
  return { ...existing, command, purchaseDate: day(r.purchaseDate), paymentMethod: choice(r.paymentMethod,['cash','mortgage']), bookingRoute, visitId, listPriceSatang, discountSatang, depositSatang };
}
function list<T>(v: unknown, parse: (r: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(v) || v.length > 50) return invalid(); return v.map(item => parse(rec(item)));
}
function contract(r: Record<string, unknown>): CanonicalRentalContract {
  const result: CanonicalRentalContract = { id: uuid(r.id), customerId: uuid(r.customerId), interestId: uuid(r.interestId), projectName: line(r.projectName),
    plotId: line(r.plotId), ownerUserId: uuid(r.ownerUserId), programType: choice(r.programType,RENTAL_PROGRAMS), status: choice(r.status,['active','renewed','converted','ended']),
    revision: uuid(r.revision), startDate: day(r.startDate), endDate: day(r.endDate), monthlyRentSatang: amount(r.monthlyRentSatang,true),
    securityDepositSatang: amount(r.securityDepositSatang), advanceRentSatang: amount(r.advanceRentSatang), savingsPerMonthSatang: amount(r.savingsPerMonthSatang),
    basePriceSatang: nullableAmount(r.basePriceSatang), confirmedSavingsSatang: amount(r.confirmedSavingsSatang), confirmedDepositSatang: amount(r.confirmedDepositSatang),
    convertedSaleId: nullableUuid(r.convertedSaleId), endedDate: nullableDay(r.endedDate) };
  if (result.endDate < result.startDate || (result.endedDate !== null && result.endedDate < result.startDate)
    || (result.programType !== 'program_b' && (result.savingsPerMonthSatang !== 0 || result.confirmedSavingsSatang !== 0))
    || (result.programType === 'program_c' && result.basePriceSatang === null)
    || (result.status === 'converted') !== (result.convertedSaleId !== null)
    || (['ended','converted'].includes(result.status)) !== (result.endedDate !== null)) return invalid();
  return result;
}
export function parseRentalCommandSnapshot(v: unknown, scope: RentalCommandScope): RentalCommandSnapshot {
  const r = rec(v), a = rec(r.actor), c = rec(r.customer), i = rec(r.interest);
  const result: RentalCommandSnapshot = { actor: { userId: uuid(a.userId), role: choice(a.role,['sales','admin','owner']) },
    customer: { id: uuid(c.id), name: line(c.name), phone: nullableLine(c.phone), revision: uuid(c.revision) },
    interest: { id: uuid(i.id), projectName: line(i.projectName), ownerUserId: uuid(i.ownerUserId), revision: uuid(i.revision), canEdit: bool(i.canEdit) },
    contracts: list(r.contracts,contract), contractPage: page(r.contractPage), contractsHasMore: bool(r.contractsHasMore),
    selectedContract: r.selectedContract === null ? null : contract(rec(r.selectedContract)),
    events: list(r.events,e => ({ id: uuid(e.id), contractId: uuid(e.contractId), command: choice(e.command,RENTAL_COMMANDS), occurredDate: nullableDay(e.occurredDate),
      recordedAt: timestamp(e.recordedAt), actorUserId: uuid(e.actorUserId), reason: line(e.reason,1000) })), eventPage: page(r.eventPage), eventsHasMore: bool(r.eventsHasMore),
    payments: list(r.payments,p => ({ id: uuid(p.id), contractId: uuid(p.contractId), kind: choice(p.kind,RENTAL_PAYMENT_KINDS), amountSatang: amount(p.amountSatang,true),
      paidDate: day(p.paidDate), reference: line(p.reference), evidenceNote: line(p.evidenceNote,1000), recordedAt: timestamp(p.recordedAt), actorUserId: uuid(p.actorUserId) })),
    paymentPage: page(r.paymentPage), paymentsHasMore: bool(r.paymentsHasMore),
    plots: list(r.plots,p => ({ id: line(p.id), name: nullableLine(p.name), available: bool(p.available) })), plotPage: page(r.plotPage), plotsHasMore: bool(r.plotsHasMore) };
  if (result.customer.id !== scope.customerId || result.interest.projectName !== scope.projectName
    || result.contractPage !== scope.contractPage || result.eventPage !== scope.eventPage || result.paymentPage !== scope.paymentPage || result.plotPage !== scope.plotPage
    || (result.selectedContract?.id ?? null) !== scope.contractId
    || (result.interest.canEdit && (result.actor.role === 'owner' || (result.actor.role === 'sales' && result.actor.userId !== result.interest.ownerUserId)))) return invalid();
  for (const item of [...result.contracts, ...(result.selectedContract ? [result.selectedContract] : [])]) {
    if (item.customerId !== result.customer.id || item.interestId !== result.interest.id || item.projectName !== scope.projectName || item.ownerUserId !== result.interest.ownerUserId) return invalid();
  }
  for (const items of [result.contracts,result.events,result.payments,result.plots]) if (new Set(items.map(x => x.id)).size !== items.length) return invalid();
  if (!result.selectedContract && (result.events.length || result.payments.length || result.eventsHasMore || result.paymentsHasMore)) return invalid();
  if ([...result.events,...result.payments].some(x => x.contractId !== scope.contractId)) return invalid();
  return result;
}
export function parseRentalCommandResult(v: unknown, input: RentalCommandInput): RentalCommandResult {
  const r = rec(v);
  const result: RentalCommandResult = { requestId: uuid(r.requestId), command: choice(r.command,RENTAL_COMMANDS), customerId: uuid(r.customerId), interestId: uuid(r.interestId),
    contractId: uuid(r.contractId), contractRevision: uuid(r.contractRevision), interestRevision: uuid(r.interestRevision), saleId: nullableUuid(r.saleId), saleRevision: nullableUuid(r.saleRevision), replayed: bool(r.replayed) };
  if (result.requestId !== input.requestId || result.command !== input.command || result.customerId !== input.customerId || result.interestId !== input.interestId
    || (input.contractId !== null && result.contractId !== input.contractId) || result.contractRevision === input.expectedContractRevision
    || (input.command === 'convert_to_buy' ? result.saleId === null || result.saleRevision === null : result.saleId !== null || result.saleRevision !== null)) return invalid();
  return result;
}
