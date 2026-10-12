import { bookingRecord, bookingUuid } from './bookingContracts';
import { customerHistoryTimeline, parseCustomerHistoryDates, type CustomerHistoryDates } from './customerHistory';
import { PURCHASE_STAGES, purchaseNextStages, type PurchaseStage } from './purchaseFlow';

/** Import review only. Caller declarations are not verified identity or permission to write. */
export interface HistoricalCustomerReview {
  source: { snapshotSha256: string; rowNumber: number; customerKey: string; dealKey: string | null };
  customer: { name: string; phone: string | null };
  existingCustomerId: string | null;
  nativeLeadId: string | null;
  leadLinkEvidenceRef: string | null;
  currentStage: 'visited' | PurchaseStage;
  paymentMethod: 'cash' | 'mortgage' | null;
  dates: CustomerHistoryDates;
  leadRequired: false;
  writesAllowed: false;
}
const invalid = (message: string): never => { throw new Error(message); };
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(value)) return invalid('ข้อมูลต้นทางไม่ถูกต้อง');
  return value.trim();
}
function nullableId(value: unknown): string | null { return value == null ? null : bookingUuid(value); }
export function reviewHistoricalCustomer(value: unknown): HistoricalCustomerReview {
  const raw = bookingRecord(value), source = bookingRecord(raw.source), customer = bookingRecord(raw.customer);
  const allowed = ['source','customer','existingCustomerId','nativeLeadId','leadLinkEvidenceRef','currentStage','paymentMethod','dates'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) || !/^[a-f0-9]{64}$/.test(String(source.snapshotSha256))
    || !Number.isSafeInteger(source.rowNumber) || (source.rowNumber as number) < 2 || (source.rowNumber as number) > 50000
    || !['visited', ...PURCHASE_STAGES].includes(raw.currentStage as PurchaseStage)
    || ![null,'cash','mortgage'].includes(raw.paymentMethod as string)) return invalid('ข้อมูลหรือสถานะนำเข้าไม่ถูกต้อง');
  const stage = raw.currentStage as HistoricalCustomerReview['currentStage'];
  const dealKey = source.dealKey == null ? null : text(source.dealKey);
  if ((stage === 'visited') !== (dealKey === null)) return invalid('ลูกค้าที่มีรายการขายต้องมีรหัสดีลต้นทางแยกจากรหัสลูกค้า');
  const leadId = nullableId(raw.nativeLeadId), evidence = raw.leadLinkEvidenceRef == null ? null : text(raw.leadLinkEvidenceRef);
  if ((leadId === null) !== (evidence === null)) return invalid('เชื่อม Lead เดิมได้เฉพาะเมื่อมีรหัสและหลักฐานการจับคู่');
  const dates = parseCustomerHistoryDates(raw.dates);
  if (stage === 'visited' && Object.entries(dates).some(([event,date]) => event !== 'visited' && date !== null)) return invalid('สถานะเยี่ยมชมขัดกับประวัติดีล กรุณาตรวจต้นทาง');
  if ((dates.cancelled && stage !== 'cancelled') || (stage === 'cancelled' && (dates.transferred || dates.handover))
    || (dates.transferred && !['transferred','handover'].includes(stage)) || (dates.handover && stage !== 'handover')) return invalid('วันที่ย้อนหลังขัดกับสถานะปัจจุบัน กรุณาตรวจต้นทาง');
  if (raw.paymentMethod === 'cash' && (stage.startsWith('loan_') || dates.loan_submitted)) return invalid('ข้อมูลเงินสดขัดกับประวัติสินเชื่อ กรุณาตรวจต้นทาง');
  return { source: { snapshotSha256: source.snapshotSha256 as string, rowNumber: source.rowNumber as number,
    customerKey: text(source.customerKey), dealKey }, customer: { name: text(customer.name), phone: customer.phone == null ? null : text(customer.phone) },
    existingCustomerId: nullableId(raw.existingCustomerId), nativeLeadId: leadId, leadLinkEvidenceRef: evidence,
    currentStage: stage, paymentMethod: raw.paymentMethod as HistoricalCustomerReview['paymentMethod'], dates,
    leadRequired: false, writesAllowed: false };
}
export function historicalCustomerContinuation(review: HistoricalCustomerReview) {
  return { currentStage: review.currentStage, leadRequired: false as const,
    nextPurchaseStages: review.currentStage === 'visited' ? [] : purchaseNextStages(review.currentStage, review.paymentMethod),
    history: customerHistoryTimeline({}, undefined, review.dates),
    needsPaymentMethod: review.currentStage !== 'visited' && !['transferred','handover','cancelled'].includes(review.currentStage) && review.paymentMethod === null,
    // Dates are historical evidence, never a command to replay or auto-complete earlier steps.
    replayEarlierSteps: false as const, writesAllowed: false as const };
}
