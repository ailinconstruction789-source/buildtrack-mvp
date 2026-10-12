import { parseTransferDate, bangkokDateFromTimestamp } from './postBookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import type { ImportedBookingHistory } from './importedBookingHistory';

export const CUSTOMER_HISTORY_EVENTS = ['visited', 'booked', 'contracted', 'loan_submitted', 'transferred', 'handover', 'cancelled'] as const;
export type CustomerHistoryEvent = typeof CUSTOMER_HISTORY_EVENTS[number];
export interface CustomerHistoryDate {
  event: CustomerHistoryEvent;
  date: string | null;
  occurredAt: string | null;
  precision: 'day' | 'instant' | 'unknown';
  source: 'historical_record' | 'recorded_event' | 'not_recorded';
}
export type CustomerHistoryDates = Record<CustomerHistoryEvent, string | null>;

/** A partial historical timeline is evidence, not a command to complete earlier steps. */
export function parseCustomerHistoryDates(value: unknown): CustomerHistoryDates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ประวัติวันที่ไม่ถูกต้อง');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !CUSTOMER_HISTORY_EVENTS.includes(key as CustomerHistoryEvent))) throw new Error('ประวัติมีช่องที่ไม่อนุญาต');
  const result = Object.fromEntries(CUSTOMER_HISTORY_EVENTS.map(event => [event, raw[event] == null ? null : parseTransferDate(raw[event])])) as CustomerHistoryDates;
  // A visit may follow an earlier booking. Cancellation must not imply contract/loan completion.
  const purchase = ['booked', 'contracted', 'loan_submitted', 'transferred', 'handover'] as const;
  let previous: string | null = null;
  for (const event of purchase) {
    const date = result[event];
    if (date && previous && date < previous) throw new Error('วันที่ประวัติขัดกัน กรุณาตรวจต้นทาง');
    if (date) previous = date;
  }
  if (result.cancelled && purchase.some(event => result[event] !== null && result[event]! > result.cancelled!)) throw new Error('วันยกเลิกก่อนประวัติของดีล กรุณาตรวจต้นทาง');
  return result;
}

/** Never use import/created_at timestamps as business-event dates. */
export function customerHistoryTimeline(
  row: Record<string, unknown>, history?: ImportedBookingHistory,
  additionalDates: Partial<CustomerHistoryDates> = {},
): CustomerHistoryDate[] {
  const historical = parseCustomerHistoryDates({ ...additionalDates,
    handover: additionalDates.handover ?? row.crm_handover_date ?? null,
    booked: history?.bookedDate ?? additionalDates.booked ?? null,
    transferred: history?.transferredDate ?? additionalDates.transferred ?? row.crm_transfer_date ?? null,
    cancelled: history?.cancelledDate ?? additionalDates.cancelled ?? null });
  const timestamps: Record<CustomerHistoryEvent, unknown> = {
    visited: row.actual_visit_date, booked: row.booked_at, contracted: row.contracted_at,
    loan_submitted: row.loan_submission_date, transferred: row.transferred_at,
    handover: row.crm_handover_at, cancelled: row.cancelled_at,
  };
  const timeline: CustomerHistoryDate[] = CUSTOMER_HISTORY_EVENTS.map(event => {
    const timestamp = timestamps[event];
    if (timestamp != null) {
      if (typeof timestamp !== 'string' || parseEvidenceTimestamp(timestamp) === null) throw new Error('วันเวลาประวัติไม่ถูกต้อง');
      const date = bangkokDateFromTimestamp(timestamp);
      if (historical[event] && historical[event] !== date) throw new Error('ประวัติวันกับเวลาไม่ตรงกัน กรุณาตรวจต้นทาง');
      return { event, date, occurredAt: timestamp, precision: 'instant', source: 'recorded_event' };
    }
    if ((event === 'transferred' && row.crm_transfer_date != null) || (event === 'handover' && row.crm_handover_date != null)) {
      const date = parseTransferDate(event === 'handover' ? row.crm_handover_date : row.crm_transfer_date);
      if (historical[event] && historical[event] !== date) throw new Error('วันโอนที่บันทึกกับประวัติเดิมขัดกัน กรุณาตรวจต้นทาง');
      return { event, date, occurredAt: null, precision: 'day', source: 'recorded_event' };
    }
    return { event, date: historical[event], occurredAt: null,
      precision: historical[event] ? 'day' : 'unknown', source: historical[event] ? 'historical_record' : 'not_recorded' };
  });
  parseCustomerHistoryDates(Object.fromEntries(timeline.map(item => [item.event, item.date])));
  return timeline;
}
