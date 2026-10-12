import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseCustomerDealReadScope, parseCustomerDealReadQuery, type CustomerDealReadScope } from './customerDealReadContracts';
import { SALE_STAGES, type SaleStage, type CrmRole } from './workflow';

export const CUSTOMER_DEAL_EDIT_VERSION = 'customer_deal_details_v1';
export const CUSTOMER_DEAL_EDIT_MAX_BYTES = 16384;
export interface CustomerProfileEdit { name: string; phone: string | null; occupation: string | null }
export interface DealDetailsEdit { salePriceSatang: number | null; bankName: string | null }
export interface CustomerDealEditInput {
  requestId: string; command: 'update_details'; customerId: string; saleId: string; projectName: string;
  expectedCustomerRevision: string; expectedInterestRevision: string; expectedSaleRevision: string;
  expectedCustomerDetailsRevision: string | null; expectedDealDetailsRevision: string | null;
  reason: string; profile: CustomerProfileEdit | null; dealDetails: DealDetailsEdit | null;
}
export interface CustomerDealEditSnapshot {
  actor: { userId: string; role: CrmRole };
  customer: CustomerProfileEdit & { id: string; ownerUserId: string; revision: string; detailsRevision: string | null;
    canEdit: boolean; sourceName: string; sourcePhone: string | null };
  deal: { id: string; customerId: string; interestId: string; ownerUserId: string; projectName: string; plotId: string | null; stage: SaleStage;
    revision: string; interestRevision: string; detailsRevision: string | null; salePrice: number | null; sourceSalePrice: number | null;
    bankName: string | null; sourceBankName: string | null; paymentMethod: 'cash' | 'mortgage' | null; canEdit: boolean };
}
export interface CustomerDealEditResult {
  requestId: string; command: 'update_details'; customerId: string; interestId: string; saleId: string;
  customerRevision: string; interestRevision: string; saleRevision: string;
  customerDetailsRevision: string | null; dealDetailsRevision: string | null; replayed: boolean;
}
export class CustomerDealEditInputError extends Error {
  constructor() { super('ข้อมูลลูกค้า ราคา หรือธนาคารไม่ถูกต้อง กรุณาตรวจสอบ'); this.name = 'CustomerDealEditInputError'; }
}
const invalid = (): never => { throw new CustomerDealEditInputError(); };
const rec = (v: unknown) => { try { return bookingRecord(v); } catch { return invalid(); } };
const uuid = (v: unknown) => { try { return bookingUuid(v); } catch { return invalid(); } };
const nullableUuid = (v: unknown) => v === null ? null : uuid(v);
function keys(r: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(r).length !== expected.length || expected.some(k => !Object.hasOwn(r, k))) invalid();
}
function line(v: unknown, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || Array.from(v.trim()).length > max
    || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(v)
    || Array.from(v).some(c => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)) return invalid();
  return v.trim();
}
const nullableLine = (v: unknown, max = 200) => v === null ? null : line(v, max);
function profilePhone(v: unknown): string | null {
  const phone = nullableLine(v, 32);
  if (phone !== null && (!/^\+?[0-9 ()-]+$/.test(phone) || !/^[0-9]{7,15}$/.test(phone.replace(/[^0-9]/g, '')))) return invalid();
  return phone;
}
function satang(v: unknown): number | null {
  if (v === null) return null;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 99999999999 ? v : invalid();
}
function baht(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 999999999.99
    || Math.abs(Math.round(v * 100) / 100 - v) > 0.00000001) return invalid();
  return v;
}
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
export const customerDealEditScope = (v: unknown): CustomerDealReadScope => {
  try { return parseCustomerDealReadScope(v); } catch { return invalid(); }
};
export function parseCustomerDealEditInput(v: unknown): CustomerDealEditInput {
  const raw = rec(v);
  keys(raw, ['requestId','command','customerId','saleId','projectName','expectedCustomerRevision','expectedInterestRevision',
    'expectedSaleRevision','expectedCustomerDetailsRevision','expectedDealDetailsRevision','reason','profile','dealDetails']);
  if (raw.command !== 'update_details' || (raw.profile === null && raw.dealDetails === null)) return invalid();
  let profile: CustomerProfileEdit | null = null, dealDetails: DealDetailsEdit | null = null;
  if (raw.profile !== null) {
    const p = rec(raw.profile); keys(p, ['name','phone','occupation']);
    profile = { name: line(p.name), phone: profilePhone(p.phone), occupation: nullableLine(p.occupation) };
  }
  if (raw.dealDetails !== null) {
    const p = rec(raw.dealDetails); keys(p, ['salePriceSatang','bankName']);
    dealDetails = { salePriceSatang: satang(p.salePriceSatang), bankName: nullableLine(p.bankName) };
  }
  return { requestId: uuid(raw.requestId), command: 'update_details', customerId: uuid(raw.customerId),
    ...customerDealEditScope({ saleId: raw.saleId, projectName: raw.projectName }),
    expectedCustomerRevision: uuid(raw.expectedCustomerRevision), expectedInterestRevision: uuid(raw.expectedInterestRevision),
    expectedSaleRevision: uuid(raw.expectedSaleRevision), expectedCustomerDetailsRevision: nullableUuid(raw.expectedCustomerDetailsRevision),
    expectedDealDetailsRevision: nullableUuid(raw.expectedDealDetailsRevision), reason: line(raw.reason, 1000), profile, dealDetails };
}
export function parseCustomerDealEditSnapshot(v: unknown, scope: CustomerDealReadScope): CustomerDealEditSnapshot {
  const raw = rec(v), a = rec(raw.actor), c = rec(raw.customer), d = rec(raw.deal);
  if (!['sales','admin','owner'].includes(String(a.role)) || !SALE_STAGES.includes(d.stage as SaleStage)
    || ![null,'cash','mortgage'].includes(d.paymentMethod as string | null)) return invalid();
  const result: CustomerDealEditSnapshot = {
    actor: { userId: uuid(a.userId), role: a.role as CrmRole },
    customer: { id: uuid(c.id), name: line(c.name), phone: nullableLine(c.phone, 100), occupation: nullableLine(c.occupation),
      ownerUserId: uuid(c.ownerUserId), revision: uuid(c.revision), detailsRevision: nullableUuid(c.detailsRevision), canEdit: bool(c.canEdit),
      sourceName: line(c.sourceName), sourcePhone: nullableLine(c.sourcePhone, 100) },
    deal: { id: uuid(d.id), customerId: uuid(d.customerId), interestId: uuid(d.interestId), ownerUserId: uuid(d.ownerUserId), projectName: line(d.projectName),
      plotId: nullableLine(d.plotId), stage: d.stage as SaleStage, revision: uuid(d.revision), interestRevision: uuid(d.interestRevision),
      detailsRevision: nullableUuid(d.detailsRevision), salePrice: baht(d.salePrice), sourceSalePrice: baht(d.sourceSalePrice),
      bankName: nullableLine(d.bankName), sourceBankName: nullableLine(d.sourceBankName), paymentMethod: d.paymentMethod as 'cash' | 'mortgage' | null,
      canEdit: bool(d.canEdit) },
  };
  if (result.deal.id !== scope.saleId || result.deal.projectName !== scope.projectName || result.customer.id !== result.deal.customerId
    || (result.deal.plotId === null && result.deal.stage !== 'cancelled')
    || (result.customer.canEdit && (result.actor.role === 'owner' || (result.actor.role === 'sales' && result.actor.userId !== result.customer.ownerUserId)))
    || (result.deal.canEdit && (result.actor.role === 'owner' || (result.actor.role === 'sales' && (result.actor.userId !== result.deal.ownerUserId
      || ['cancelled','transferred','handover'].includes(result.deal.stage)))))) return invalid();
  return result;
}
export function parseCustomerDealEditResult(v: unknown, input: CustomerDealEditInput): CustomerDealEditResult {
  const r = rec(v);
  const result: CustomerDealEditResult = { requestId: uuid(r.requestId), command: 'update_details', customerId: uuid(r.customerId),
    interestId: uuid(r.interestId), saleId: uuid(r.saleId), customerRevision: uuid(r.customerRevision), interestRevision: uuid(r.interestRevision),
    saleRevision: uuid(r.saleRevision), customerDetailsRevision: nullableUuid(r.customerDetailsRevision), dealDetailsRevision: nullableUuid(r.dealDetailsRevision), replayed: bool(r.replayed) };
  if (r.command !== input.command || result.requestId !== input.requestId || result.customerId !== input.customerId || result.saleId !== input.saleId
    || result.customerRevision !== input.expectedCustomerRevision || result.interestRevision !== input.expectedInterestRevision || result.saleRevision !== input.expectedSaleRevision
    || (input.profile !== null ? result.customerDetailsRevision === null || result.customerDetailsRevision === input.expectedCustomerDetailsRevision : result.customerDetailsRevision !== input.expectedCustomerDetailsRevision)
    || (input.dealDetails !== null ? result.dealDetailsRevision === null || result.dealDetailsRevision === input.expectedDealDetailsRevision : result.dealDetailsRevision !== input.expectedDealDetailsRevision)) return invalid();
  return result;
}

export function parseCustomerDealEditQuery(url: string): CustomerDealReadScope {
  try { return parseCustomerDealReadQuery(url); } catch { return invalid(); }
}
