import { isCentralUuid } from './centralContracts';
import { displayBangkokTime } from './leadWorkDates';

/** Read-only evidence from a completed, reviewed import; never a write payload. */
export interface ImportedBookingHistory {
  source: 'customer_sheet'; batchId: string; sourceRow: number;
  sourceStage: 'booked' | 'transferred' | 'cancelled';
  bookedDate: string | null; cancelledDate: string | null; transferredDate: string | null;
}
const invalid = (): never => { throw new Error('หลักฐานประวัติการจองไม่ครบหรือไม่ตรงกับรายการ'); };
function day(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return invalid();
  return value;
}
export function parseImportedBookingHistory(value: unknown): ImportedBookingHistory | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  const keys = ['source', 'batchId', 'sourceRow', 'sourceStage', 'bookedDate', 'cancelledDate', 'transferredDate'];
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))
    || raw.source !== 'customer_sheet' || !isCentralUuid(raw.batchId) || raw.batchId.length !== 36
    || !Number.isSafeInteger(raw.sourceRow) || (raw.sourceRow as number) < 2 || (raw.sourceRow as number) > 50000
    || !['booked', 'transferred', 'cancelled'].includes(raw.sourceStage as string)) return invalid();
  const bookedDate = day(raw.bookedDate), cancelledDate = day(raw.cancelledDate), transferredDate = day(raw.transferredDate);
  if ((cancelledDate && raw.sourceStage !== 'cancelled') || (transferredDate && raw.sourceStage !== 'transferred')
    || (bookedDate && [cancelledDate, transferredDate].some(date => date !== null && date < bookedDate))) return invalid();
  return { source: 'customer_sheet', batchId: raw.batchId.toLowerCase(), sourceRow: raw.sourceRow as number,
    sourceStage: raw.sourceStage as ImportedBookingHistory['sourceStage'], bookedDate, cancelledDate, transferredDate };
}

/** Do not accept a null round merely because a response calls itself legacy. */
export function assertImportedBookingRow(row: Record<string, unknown>, history: ImportedBookingHistory | undefined): void {
  if (!history) {
    if (!Number.isSafeInteger(row.bookingRound) || (row.bookingRound as number) < 1) invalid();
    return;
  }
  if (row.bookingRound !== null || row.previousSaleId !== null || row.bookedAt !== null
    || row.listPrice !== null || row.discountAmount !== null
    || (history.sourceStage === 'cancelled' && (row.stage !== 'cancelled' || row.cancelledAt !== null))
    || (history.sourceStage === 'transferred' && !['transferred', 'handover'].includes(row.stage as string))) invalid();
}

export function bookingRoundLabel(round: number | null): string {
  return round === null ? 'รอบไม่ทราบ (ข้อมูลเดิม)' : `รอบ ${round}`;
}

/** A source day is not an instant: no timezone conversion or synthetic midnight. */
export function displayBookingHistoryDate(eventTime: string | null, sourceDay?: string | null): string {
  if (eventTime !== null || sourceDay === undefined) return displayBangkokTime(eventTime);
  if (!sourceDay) return 'ไม่ทราบ';
  const checked = day(sourceDay);
  if (!checked) return 'ไม่ทราบ';
  const [year, month, date] = checked.split('-');
  return `${date}/${month}/${Number(year) + 543} (ข้อมูลเดิม — ไม่ทราบเวลา)`;
}
