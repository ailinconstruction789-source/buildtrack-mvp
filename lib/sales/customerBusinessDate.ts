import { parseEvidenceTimestamp } from './leadEvidence';
import { bangkokDateFromTimestamp, parseTransferDate } from './postBookingContracts';
import { hasDealHistory } from './leadLifecycle';

/** A business date never comes from an import timestamp or an assumed current year. */
export function customerBusinessDay(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseTransferDate(value);
    return parseEvidenceTimestamp(value) === null ? null : bangkokDateFromTimestamp(value);
  } catch { return null; }
}

/** Forecasts belong to a booking, never to another customer on the same plot. */
export function customerExpectedTransferDay(sale: {
  expected_transfer_date?: unknown; expectedTransferDate?: unknown; expectedTransfer?: unknown;
}): string | null {
  if ('expectedTransfer' in sale) return customerBusinessDay(sale.expectedTransfer);
  if ('expectedTransferDate' in sale) return customerBusinessDay(sale.expectedTransferDate);
  return customerBusinessDay(sale.expected_transfer_date);
}

/** An unknown actual transfer day must stay unknown even when a forecast exists. */
export function customerActualTransferDay(item: {
  transferredDate?: unknown;
  history?: Array<{ status?: string; timestamp?: unknown }>;
}): string | null {
  return customerBusinessDay(item.transferredDate)
    ?? customerBusinessDay(item.history?.find(event => event.status === 'Transferred')?.timestamp);
}
export function customerOperationalYear(item: Record<string, unknown> | null): number | null {
  if (!item) return null;
  const history = item.importedHistory && typeof item.importedHistory === 'object'
    ? item.importedHistory as Record<string, unknown> : {};
  const events = [item.transferred_date, item.transferredAt, history.transferredDate,
    item.booking_date, item.bookedAt, history.bookedDate, item.actual_visit_date, item.appointment_date,
    item.rental_start_date, item.lease_start_date];
  // Creation is valid intake metadata for a native Lead, never booking/visit evidence for a CRM deal.
  if ((item.sourceKind == null || item.sourceKind === 'lead') && item._isMergedSalesRecord !== true
    && !item.crmCustomerId && !item.importedHistory && !hasDealHistory(item)) {
    events.push(item.lead_date, item.created_at);
  }
  for (const value of events) {
    const day = customerBusinessDay(value);
    if (day) return Number(day.slice(0, 4));
  }
  return null;
}
