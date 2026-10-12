export type UnknownHistoryReason = 'unknown_project' | 'unknown_booking';
export interface UnknownHistoricalEvent {
  eventKey: string; kind: 'visited' | 'booked' | 'cancelled'; sequence: number;
  date: string | null; precision: 'day' | 'unknown'; evidenceRef: string;
}
export interface UnknownHistoricalRecord {
  sourceKey: string; rowNumber: number; rowSha256: string; customerKey: string;
  customerId: string; interestId: string | null; saleId: null;
  reason: UnknownHistoryReason; sourceStage: 'visited' | 'cancelled'; events: UnknownHistoricalEvent[];
}
export interface UnknownHistoricalEvidenceInput {
  version: 'unknown-historical-evidence-v1'; sourceSystem: string; datasetKey: string;
  snapshotSha256: string; mappingReviewRef: string; records: UnknownHistoricalRecord[];
  businessWritesAllowed: false; leadRequired: false;
}
const invalid = (): never => { throw new Error('UNKNOWN_HISTORY_INVALID'); };
const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : invalid();
const uuid = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : invalid();
const text = (value: unknown): string => typeof value === 'string' && value.length >= 1 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value : invalid();
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return invalid();
  return row;
}
function day(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : invalid();
}
/** A separate evidence archive: no unknown catalog objects, Lead replay, or business state changes. */
export function prepareUnknownHistoricalEvidence(value: unknown): UnknownHistoricalEvidenceInput {
  const raw = object(value, ['version', 'sourceSystem', 'datasetKey', 'snapshotSha256', 'mappingReviewRef', 'records', 'businessWritesAllowed', 'leadRequired']);
  if (raw.version !== 'unknown-historical-evidence-v1' || raw.businessWritesAllowed !== false || raw.leadRequired !== false
    || !Array.isArray(raw.records) || raw.records.length < 1 || raw.records.length > 5000) return invalid();
  const sourceKeys = new Set<string>(), sourceRows = new Set<number>(), identities = new Map<string, string>(), customers = new Map<string, string>();
  let eventCount = 0;
  const records: UnknownHistoricalRecord[] = raw.records.map(value => {
    const row = object(value, ['sourceKey', 'rowNumber', 'rowSha256', 'customerKey', 'customerId', 'interestId', 'saleId', 'reason', 'sourceStage', 'events']);
    const sourceKey = hash(row.sourceKey), customerKey = text(row.customerKey), customerId = uuid(row.customerId);
    const interestId = row.interestId === null ? null : uuid(row.interestId);
    if (!Number.isInteger(row.rowNumber) || (row.rowNumber as number) < 2 || (row.rowNumber as number) > 50000
      || sourceKeys.has(sourceKey) || sourceRows.has(row.rowNumber as number) || row.saleId !== null
      || (identities.has(customerKey) && identities.get(customerKey) !== customerId)
      || (customers.has(customerId) && customers.get(customerId) !== customerKey)
      || !Array.isArray(row.events) || row.events.length < 1 || row.events.length > 1000) return invalid();
    if (!((row.reason === 'unknown_project' && row.sourceStage === 'visited' && interestId === null)
      || (row.reason === 'unknown_booking' && row.sourceStage === 'cancelled'))) return invalid();
    sourceKeys.add(sourceKey); sourceRows.add(row.rowNumber as number); identities.set(customerKey, customerId); customers.set(customerId, customerKey);
    const eventKeys = new Set<string>(); let lastDay: string | null = null, lastRank = -1, bookings = 0, cancellations = 0;
    const events: UnknownHistoricalEvent[] = row.events.map((value, index) => {
      const ev = object(value, ['eventKey', 'kind', 'sequence', 'date', 'precision', 'evidenceRef']);
      const eventKey = text(ev.eventKey), date = day(ev.date);
      if (eventKeys.has(eventKey) || ev.sequence !== index + 1 || !['visited', 'booked', 'cancelled'].includes(ev.kind as string)
        || ev.precision !== (date === null ? 'unknown' : 'day') || (date !== null && lastDay !== null && date < lastDay)) return invalid();
      const rank = ev.kind === 'visited' ? 0 : ev.kind === 'booked' ? 1 : 2;
      if (rank < lastRank || (row.reason === 'unknown_project' && rank !== 0)
        || (ev.kind === 'booked' && ++bookings > 1) || (ev.kind === 'cancelled' && (++cancellations > 1 || bookings !== 1))) return invalid();
      lastRank = rank; if (date !== null) lastDay = date; eventKeys.add(eventKey); eventCount++;
      return { eventKey, kind: ev.kind as UnknownHistoricalEvent['kind'], sequence: index + 1, date,
        precision: date === null ? 'unknown' : 'day', evidenceRef: text(ev.evidenceRef) };
    });
    if (row.reason === 'unknown_booking' && (bookings !== 1 || cancellations !== 1 || events.at(-1)?.kind !== 'cancelled')) return invalid();
    return { sourceKey, rowNumber: row.rowNumber as number, rowSha256: hash(row.rowSha256), customerKey, customerId, interestId,
      saleId: null, reason: row.reason as UnknownHistoryReason, sourceStage: row.sourceStage as UnknownHistoricalRecord['sourceStage'], events };
  }).sort((a, b) => a.rowNumber - b.rowNumber);
  const result: UnknownHistoricalEvidenceInput = { version: 'unknown-historical-evidence-v1', sourceSystem: text(raw.sourceSystem),
    datasetKey: text(raw.datasetKey), snapshotSha256: hash(raw.snapshotSha256), mappingReviewRef: text(raw.mappingReviewRef),
    records, businessWritesAllowed: false, leadRequired: false };
  if (eventCount > 20000 || new TextEncoder().encode(JSON.stringify(result)).length > 8 * 1024 * 1024) return invalid();
  return result;
}
