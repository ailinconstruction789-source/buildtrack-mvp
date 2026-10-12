import { bookingRecord, bookingUuid } from './bookingContracts';
import { CUSTOMER_HISTORY_EVENTS, parseCustomerHistoryDates, type CustomerHistoryEvent } from './customerHistory';
import { parseProjectMapName } from './projectMapContracts';
import { parseTransferDate } from './postBookingContracts';
import type { CrmRole } from './workflow';

export const HISTORICAL_CUSTOMER_EVIDENCE_VERSION = 'historical_customer_evidence_v1';
export const HISTORICAL_CUSTOMER_EVIDENCE_PAGE_SIZE = 50;
export const HISTORICAL_CUSTOMER_EVIDENCE_MAX_PAGE = 199;
export interface HistoricalCustomerEvidenceScope { customerId: string; interestId: string | null; saleId: string | null; page: number }
export interface HistoricalCustomerEvidenceRecord {
  key: string; customerId: string; projectName: string | null; projectNames: string[]; interestId: string | null; saleId: string | null; sourceRow: number;
  events: { kind: CustomerHistoryEvent; date: string | null; precision: 'day' | 'unknown' }[];
}
export interface HistoricalCustomerEvidenceSnapshot extends HistoricalCustomerEvidenceScope {
  contractVersion: typeof HISTORICAL_CUSTOMER_EVIDENCE_VERSION; actor: { userId: string; role: CrmRole };
  hasMore: boolean; readOnly: true; records: HistoricalCustomerEvidenceRecord[];
}
function invalid(): never { throw new Error('ตรวจสอบประวัติจากข้อมูลต้นทางไม่ได้'); }
function keys(raw: Record<string, unknown>, expected: string[]) {
  if (Object.keys(raw).length !== expected.length || expected.some(key => !Object.hasOwn(raw, key))) invalid();
}
const optionalId = (value: unknown) => value === null ? null : bookingUuid(value);
export function parseHistoricalCustomerEvidenceScope(value: unknown): HistoricalCustomerEvidenceScope {
  const raw = bookingRecord(value); keys(raw, ['customerId', 'interestId', 'saleId', 'page']);
  if (!Number.isInteger(raw.page) || (raw.page as number) < 0 || (raw.page as number) > HISTORICAL_CUSTOMER_EVIDENCE_MAX_PAGE) invalid();
  return { customerId: bookingUuid(raw.customerId), interestId: optionalId(raw.interestId), saleId: optionalId(raw.saleId), page: raw.page as number };
}
export function parseHistoricalCustomerEvidenceQuery(url: string): HistoricalCustomerEvidenceScope {
  const params = new URL(url).searchParams;
  if ([...params.keys()].length !== 4 || ['customerId', 'interestId', 'saleId', 'page'].some(key => params.getAll(key).length !== 1)
    || !/^(0|[1-9][0-9]{0,2})$/.test(params.get('page') || '')) invalid();
  return parseHistoricalCustomerEvidenceScope({ customerId: params.get('customerId'), interestId: params.get('interestId') || null,
    saleId: params.get('saleId') || null, page: Number(params.get('page')) });
}
export function parseHistoricalCustomerEvidenceSnapshot(value: unknown, input: HistoricalCustomerEvidenceScope): HistoricalCustomerEvidenceSnapshot {
  const scope = parseHistoricalCustomerEvidenceScope(input), raw = bookingRecord(value), actor = bookingRecord(raw.actor);
  keys(raw, ['contractVersion', 'actor', 'customerId', 'interestId', 'saleId', 'page', 'hasMore', 'readOnly', 'records']); keys(actor, ['userId', 'role']);
  if (raw.contractVersion !== HISTORICAL_CUSTOMER_EVIDENCE_VERSION || raw.readOnly !== true || typeof raw.hasMore !== 'boolean'
    || !['sales', 'admin', 'owner'].includes(String(actor.role)) || !Array.isArray(raw.records)
    || raw.records.length > HISTORICAL_CUSTOMER_EVIDENCE_PAGE_SIZE || (raw.hasMore && raw.records.length !== HISTORICAL_CUSTOMER_EVIDENCE_PAGE_SIZE)
    || (scope.saleId && (raw.hasMore || raw.records.length > 1))) invalid();
  const returned = parseHistoricalCustomerEvidenceScope({ customerId: raw.customerId, interestId: raw.interestId, saleId: raw.saleId, page: raw.page });
  if (Object.keys(scope).some(key => scope[key as keyof HistoricalCustomerEvidenceScope] !== returned[key as keyof HistoricalCustomerEvidenceScope])) invalid();
  const seen = new Set<string>();
  const records = raw.records.map(value => {
    const row = bookingRecord(value); keys(row, ['key', 'customerId', 'projectName', 'projectNames', 'interestId', 'saleId', 'sourceRow', 'events']);
    if (typeof row.key !== 'string' || !row.key || row.key.length > 150 || /[\x00-\x20\x7f-\x9f\u2028\u2029]/.test(row.key)
      || seen.has(row.key) || !Number.isInteger(row.sourceRow) || (row.sourceRow as number) < 2 || (row.sourceRow as number) > 50000
      || !Array.isArray(row.events) || row.events.length < 1 || row.events.length > CUSTOMER_HISTORY_EVENTS.length
      || !Array.isArray(row.projectNames) || row.projectNames.length > 100) invalid();
    seen.add(row.key);
    const eventKinds = new Set<string>();
    const events = row.events.map(value => {
      const event = bookingRecord(value); keys(event, ['kind', 'date', 'precision']);
      if (!CUSTOMER_HISTORY_EVENTS.includes(event.kind as CustomerHistoryEvent) || eventKinds.has(String(event.kind))
        || !['day', 'unknown'].includes(String(event.precision)) || (event.precision === 'unknown' ? event.date !== null : event.date === null)) invalid();
      eventKinds.add(String(event.kind));
      return { kind: event.kind as CustomerHistoryEvent, date: event.date === null ? null : parseTransferDate(event.date), precision: event.precision as 'day' | 'unknown' };
    });
    parseCustomerHistoryDates(Object.fromEntries(events.map(event => [event.kind, event.date])));
    const projectNames = row.projectNames.map(parseProjectMapName);
    if (new Set(projectNames).size !== projectNames.length) invalid();
    const record: HistoricalCustomerEvidenceRecord = { key: row.key, customerId: bookingUuid(row.customerId),
      projectName: row.projectName === null ? null : parseProjectMapName(row.projectName), projectNames, interestId: optionalId(row.interestId), saleId: optionalId(row.saleId),
      sourceRow: row.sourceRow as number, events };
    if (record.customerId !== scope.customerId || (scope.interestId && record.interestId !== scope.interestId)
      || (scope.saleId && record.saleId !== scope.saleId) || (record.saleId && (!record.interestId || !record.projectName))
      || (record.projectName === null ? projectNames.length === 1 : projectNames.length !== 1 || projectNames[0] !== record.projectName)
      || (projectNames.length > 1 && (record.interestId !== null || record.saleId !== null))) invalid();
    return record;
  });
  return { ...returned, contractVersion: HISTORICAL_CUSTOMER_EVIDENCE_VERSION, actor: { userId: bookingUuid(actor.userId), role: actor.role as CrmRole },
    hasMore: raw.hasMore, readOnly: true, records };
}
