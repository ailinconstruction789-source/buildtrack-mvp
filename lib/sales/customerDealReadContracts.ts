import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseProjectMapName } from './projectMapContracts';
import { SALE_STAGES, type SaleStage, type CrmRole } from './workflow';
import { CUSTOMER_HISTORY_EVENTS, parseCustomerHistoryDates, type CustomerHistoryDate } from './customerHistory';
import { parseEvidenceTimestamp } from './leadEvidence';
import { parseTransferDate, bangkokDateFromTimestamp } from './postBookingContracts';

export interface CustomerDealReadScope { saleId: string; projectName: string }
export interface CustomerDealReadSnapshot {
  actor: { userId: string; role: CrmRole };
  customer: { id: string; name: string; phone: string | null };
  deal: { id: string; customerId: string; interestId: string; projectName: string; plotId: string | null;
    stage: SaleStage; leadId: string | null; origin: 'historical' | 'live'; revision: string;
    salePrice: number | null; bankName: string | null; paymentMethod: 'cash' | 'mortgage' | null };
  history: CustomerHistoryDate[];
  readOnly: true;
  detailsEditingAvailable?: boolean;
}
const invalid = (): never => { throw new Error('ตรวจสอบข้อมูลลูกค้าและดีลไม่ได้'); };
const line = (v: unknown): string => typeof v === 'string' && v.trim() && v.length <= 200
  && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(v) ? v.trim() : invalid();
export function parseCustomerDealReadScope(value: unknown): CustomerDealReadScope {
  const raw = bookingRecord(value);
  if (Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'saleId') || !Object.hasOwn(raw, 'projectName')) return invalid();
  return { saleId: bookingUuid(raw.saleId), projectName: parseProjectMapName(raw.projectName) };
}
export function parseCustomerDealReadQuery(url: string): CustomerDealReadScope {
  const params = new URL(url).searchParams;
  if ([...params.keys()].length !== 2 || params.getAll('saleId').length !== 1 || params.getAll('projectName').length !== 1) return invalid();
  return parseCustomerDealReadScope({ saleId: params.get('saleId'), projectName: params.get('projectName') });
}
export function parseCustomerDealReadSnapshot(value: unknown, scope: CustomerDealReadScope): CustomerDealReadSnapshot {
  const raw = bookingRecord(value), actor = bookingRecord(raw.actor), customer = bookingRecord(raw.customer), deal = bookingRecord(raw.deal);
  if (raw.detailsEditingAvailable !== undefined && typeof raw.detailsEditingAvailable !== 'boolean') return invalid();
  if (raw.detailsEditingAvailable === true && actor.role === 'owner') return invalid();
  if (!['sales', 'admin', 'owner'].includes(String(actor.role)) || raw.readOnly !== true
    || !['historical', 'live'].includes(String(deal.origin)) || !SALE_STAGES.includes(deal.stage as SaleStage)
    || ![null, 'cash', 'mortgage'].includes(deal.paymentMethod as null | string)
    || (deal.salePrice !== null && (typeof deal.salePrice !== 'number' || !Number.isFinite(deal.salePrice) || deal.salePrice < 0))
    || !Array.isArray(raw.history) || raw.history.length !== CUSTOMER_HISTORY_EVENTS.length) return invalid();
  const result: CustomerDealReadSnapshot = {
    actor: { userId: bookingUuid(actor.userId), role: actor.role as CrmRole },
    customer: { id: bookingUuid(customer.id), name: line(customer.name), phone: customer.phone === null ? null : line(customer.phone) },
    deal: { id: bookingUuid(deal.id), customerId: bookingUuid(deal.customerId), interestId: bookingUuid(deal.interestId),
      projectName: line(deal.projectName), plotId: deal.plotId === null ? null : line(deal.plotId),
      stage: deal.stage as SaleStage, leadId: deal.leadId === null ? null : bookingUuid(deal.leadId), origin: deal.origin as 'historical' | 'live', revision: bookingUuid(deal.revision),
      salePrice: deal.salePrice as number | null, bankName: deal.bankName === null ? null : line(deal.bankName), paymentMethod: deal.paymentMethod as 'cash' | 'mortgage' | null },
    history: raw.history.map((value, index) => {
      const h = bookingRecord(value);
      if (h.event !== CUSTOMER_HISTORY_EVENTS[index] || !['day', 'instant', 'unknown'].includes(String(h.precision))) return invalid();
      const date = h.date === null ? null : parseTransferDate(h.date);
      if (h.precision === 'unknown' ? date !== null || h.occurredAt !== null || h.source !== 'not_recorded'
        : h.precision === 'day' ? date === null || h.occurredAt !== null || !['historical_record','recorded_event'].includes(String(h.source))
          : typeof h.occurredAt !== 'string' || parseEvidenceTimestamp(h.occurredAt) === null || h.source !== 'recorded_event'
            || date !== bangkokDateFromTimestamp(h.occurredAt as string)) return invalid();
      return { event: CUSTOMER_HISTORY_EVENTS[index], date, occurredAt: h.occurredAt as string | null,
        precision: h.precision as CustomerHistoryDate['precision'], source: h.source as CustomerHistoryDate['source'] };
    }), readOnly: true, ...(raw.detailsEditingAvailable === undefined ? {} : { detailsEditingAvailable: raw.detailsEditingAvailable as boolean }),
  };
  if (result.deal.id !== scope.saleId || result.deal.projectName !== scope.projectName || result.customer.id !== result.deal.customerId
    || (result.deal.plotId === null && result.deal.stage !== 'cancelled')) return invalid();
  parseCustomerHistoryDates(Object.fromEntries(result.history.map(item => [item.event, item.date])));
  return result;
}
