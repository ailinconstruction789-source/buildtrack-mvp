import { bookingUuid } from './bookingContracts';
import { PURCHASE_STAGES, type PurchaseStage } from './purchaseFlow';

/** Offline review only. An evidence reference is not database identity verification or write permission. */
export const HISTORICAL_TIMELINE_EVENTS = ['visited', 'booked', 'contracted', 'document_requested',
  'loan_submitted', 'loan_rejected', 'loan_approved', 'transfer_pending', 'transferred', 'handover',
  'cancelled', 'rental_started', 'rental_renewed', 'rental_ended', 'rental_buyout'] as const;
export type HistoricalTimelineEventKind = typeof HISTORICAL_TIMELINE_EVENTS[number];
export type HistoricalTimelineStage = 'visited' | PurchaseStage | 'rental_active' | 'rental_ended' | 'rental_buyout';
export interface HistoricalTimelineEvent {
  eventKey: string; kind: HistoricalTimelineEventKind; sequence: number;
  date: string | null; precision: 'day' | 'unknown'; evidenceRef: string;
}
export interface HistoricalTimelineRecord {
  recordKey: string; rowNumber: number; rowSha256: string;
  customerKey: string; dealKey: string | null;
  kind: 'visit' | 'purchase' | 'rental'; stage: HistoricalTimelineStage;
  rentalType: 'A' | 'B' | 'C' | null; events: HistoricalTimelineEvent[];
}
export interface HistoricalTimelineBinding {
  recordKey: string; rowSha256: string; customerKey: string; dealKey: string | null;
  customerId: string; interestId: string; saleId: string | null; rentalId: string | null;
  evidenceRef: string;
}
export interface HistoricalTimelineManifest {
  version: 'historical-timeline-manifest-v1'; sourceSystem: string; datasetKey: string;
  snapshotSha256: string; mappingReviewRef: string;
  records: { recordKey: string; rowNumber: number; rowSha256: string }[];
}
export interface HistoricalTimelineImportInput {
  manifest: HistoricalTimelineManifest; records: HistoricalTimelineRecord[]; bindings: HistoricalTimelineBinding[];
}
export type HistoricalTimelineHold = 'DUPLICATE_SOURCE_RECORD' | 'SOURCE_RECORD_CONFLICT'
  | 'MAPPING_REQUIRED' | 'MAPPING_CONFLICT' | 'CUSTOMER_IDENTITY_CONFLICT' | 'DEAL_IDENTITY_CONFLICT'
  | 'DEAL_HISTORY_REVIEW' | 'TIMELINE_ORDER_CONFLICT' | 'STAGE_HISTORY_CONFLICT' | 'DUPLICATE_EVENT';
export interface HistoricalTimelinePreparedRow {
  source: HistoricalTimelineRecord; binding: HistoricalTimelineBinding | null;
  holds: HistoricalTimelineHold[]; protectedFromLost: boolean;
}
export interface HistoricalTimelineImportPlan {
  version: 'historical-timeline-plan-v1'; manifest: HistoricalTimelineManifest;
  rows: HistoricalTimelinePreparedRow[]; canonicalPlan: string;
  writesAllowed: false; importReady: false; leadRequired: false; replayEarlierSteps: false;
}
const fail = (code = 'HISTORICAL_TIMELINE_INPUT_INVALID'): never => { throw new Error(code); };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) return fail();
  return raw;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 200
    || /[\x00-\x1f\x7f-\x9f]/.test(value)) return fail();
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return fail();
  return value;
}
function integer(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) return fail();
  return value as number;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function nullableUuid(value: unknown): string | null { return value === null ? null : bookingUuid(value).toLowerCase(); }
function day(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return fail();
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail();
  return value;
}
/** Key order and input row order are irrelevant; event sequence and all evidence remain significant. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function event(value: unknown): HistoricalTimelineEvent {
  const raw = object(value, ['eventKey', 'kind', 'sequence', 'date', 'precision', 'evidenceRef']);
  if (!HISTORICAL_TIMELINE_EVENTS.includes(raw.kind as HistoricalTimelineEventKind)) return fail();
  const date = day(raw.date);
  if (raw.precision !== (date === null ? 'unknown' : 'day')) return fail();
  return { eventKey: text(raw.eventKey), kind: raw.kind as HistoricalTimelineEventKind,
    sequence: integer(raw.sequence, 10000), date, precision: date === null ? 'unknown' : 'day', evidenceRef: text(raw.evidenceRef) };
}
function record(value: unknown): HistoricalTimelineRecord {
  const raw = object(value, ['recordKey', 'rowNumber', 'rowSha256', 'customerKey', 'dealKey', 'kind', 'stage', 'rentalType', 'events']);
  if (!['visit', 'purchase', 'rental'].includes(raw.kind as string)
    || !['visited', ...PURCHASE_STAGES, 'rental_active', 'rental_ended', 'rental_buyout'].includes(raw.stage as string)
    || ![null, 'A', 'B', 'C'].includes(raw.rentalType as string)) return fail();
  const rowNumber = integer(raw.rowNumber, 50000);
  if (rowNumber < 2) return fail();
  return { recordKey: text(raw.recordKey), rowNumber, rowSha256: sha(raw.rowSha256),
    customerKey: text(raw.customerKey), dealKey: nullableText(raw.dealKey), kind: raw.kind as HistoricalTimelineRecord['kind'],
    stage: raw.stage as HistoricalTimelineStage, rentalType: raw.rentalType as HistoricalTimelineRecord['rentalType'],
    events: array(raw.events, 1000).map(event).sort((a, b) => a.sequence - b.sequence || compare(a.eventKey, b.eventKey)) };
}
function binding(value: unknown): HistoricalTimelineBinding {
  const raw = object(value, ['recordKey', 'rowSha256', 'customerKey', 'dealKey', 'customerId', 'interestId', 'saleId', 'rentalId', 'evidenceRef']);
  return { recordKey: text(raw.recordKey), rowSha256: sha(raw.rowSha256), customerKey: text(raw.customerKey),
    dealKey: nullableText(raw.dealKey), customerId: bookingUuid(raw.customerId).toLowerCase(),
    interestId: bookingUuid(raw.interestId).toLowerCase(), saleId: nullableUuid(raw.saleId), rentalId: nullableUuid(raw.rentalId), evidenceRef: text(raw.evidenceRef) };
}
function parseManifest(value: unknown): HistoricalTimelineManifest {
  const raw = object(value, ['version', 'sourceSystem', 'datasetKey', 'snapshotSha256', 'mappingReviewRef', 'records']);
  if (raw.version !== 'historical-timeline-manifest-v1') return fail();
  const records = array(raw.records, 50000).map(value => {
    const entry = object(value, ['recordKey', 'rowNumber', 'rowSha256']);
    const rowNumber = integer(entry.rowNumber, 50000);
    if (rowNumber < 2) return fail();
    return { recordKey: text(entry.recordKey), rowNumber, rowSha256: sha(entry.rowSha256) };
  }).sort((a, b) => compare(a.recordKey, b.recordKey));
  if (!records.length || new Set(records.map(row => row.recordKey)).size !== records.length
    || new Set(records.map(row => row.rowNumber)).size !== records.length) return fail('HISTORICAL_MANIFEST_AMBIGUOUS');
  return { version: 'historical-timeline-manifest-v1', sourceSystem: text(raw.sourceSystem), datasetKey: text(raw.datasetKey),
    snapshotSha256: sha(raw.snapshotSha256), mappingReviewRef: text(raw.mappingReviewRef), records };
}
const purchaseKinds = new Set<HistoricalTimelineEventKind>(['booked', 'contracted', 'document_requested', 'loan_submitted',
  'loan_rejected', 'loan_approved', 'transfer_pending', 'transferred', 'handover', 'cancelled']);
const rentalKinds = new Set<HistoricalTimelineEventKind>(['rental_started', 'rental_renewed', 'rental_ended', 'rental_buyout']);
function timelineHolds(row: HistoricalTimelineRecord): HistoricalTimelineHold[] {
  const holds: HistoricalTimelineHold[] = [], kinds = new Set(row.events.map(item => item.kind));
  if (new Set(row.events.map(item => item.eventKey)).size !== row.events.length
    || new Set(row.events.map(item => item.sequence)).size !== row.events.length) holds.push('DUPLICATE_EVENT');
  const history = row.events.filter(item => item.kind !== 'visited');
  let last: string | null = null;
  for (const item of history) {
    if (item.date && last && item.date < last) holds.push('TIMELINE_ORDER_CONFLICT');
    if (item.date) last = item.date;
  }
  // Unknown dates never erase the logical business order expressed by source sequence.
  const progression: Partial<Record<HistoricalTimelineEventKind, number>> = { booked: 0, contracted: 1, document_requested: 2,
    loan_submitted: 2, loan_rejected: 2, loan_approved: 2, transfer_pending: 3, transferred: 4, handover: 5 };
  let rank = -1;
  for (const item of history) {
    const next = progression[item.kind];
    if (next !== undefined) { if (next < rank) holds.push('TIMELINE_ORDER_CONFLICT'); rank = next; }
  }
  const eventsAfterTerminal = history.some((item, index) => ['cancelled', 'handover', 'rental_ended', 'rental_buyout'].includes(item.kind)
    && index < history.length - 1);
  if (eventsAfterTerminal) holds.push('STAGE_HISTORY_CONFLICT');
  const isPurchase = row.kind === 'purchase', isRental = row.kind === 'rental';
  if ((row.kind === 'visit' && (row.stage !== 'visited' || row.dealKey !== null || kinds.size > (kinds.has('visited') ? 1 : 0)))
    || (isPurchase && (!PURCHASE_STAGES.includes(row.stage as PurchaseStage) || row.dealKey === null || [...kinds].some(kind => rentalKinds.has(kind))))
    || (isRental && (!['rental_active', 'rental_ended', 'rental_buyout', 'cancelled'].includes(row.stage) || row.dealKey === null
      || [...kinds].some(kind => kind !== 'cancelled' && purchaseKinds.has(kind))))
    || (isRental ? row.rentalType === null : row.rentalType !== null)) holds.push('STAGE_HISTORY_CONFLICT');
  if ((kinds.has('cancelled') && row.stage !== 'cancelled') || (row.stage === 'cancelled' && (kinds.has('transferred') || kinds.has('handover')))
    || (kinds.has('transferred') && !['transferred', 'handover'].includes(row.stage))
    || (kinds.has('handover') && row.stage !== 'handover')
    || (kinds.has('rental_ended') && row.stage !== 'rental_ended') || (kinds.has('rental_buyout') && row.stage !== 'rental_buyout')
    || (kinds.has('rental_ended') && kinds.has('rental_buyout'))) holds.push('STAGE_HISTORY_CONFLICT');
  if (isPurchase && row.stage !== 'cancelled') {
    const stageRank: Record<PurchaseStage, number> = { booked: 0, contracted: 1, downpayment: 1, document_prep: 2,
      loan_submitted: 2, loan_rejected: 2, loan_approved: 2, transfer_pending: 3, transferred: 4, handover: 5, cancelled: 6 };
    if (rank > stageRank[row.stage as PurchaseStage]) holds.push('STAGE_HISTORY_CONFLICT');
  }
  if (isRental) {
    const start = history.findIndex(item => item.kind === 'rental_started');
    if (start > 0 && history.slice(0, start).some(item => rentalKinds.has(item.kind))) holds.push('TIMELINE_ORDER_CONFLICT');
  }
  return [...new Set(holds)].sort();
}
function protectsLost(row: HistoricalTimelineRecord): boolean {
  return row.kind !== 'visit' || row.dealKey !== null || row.stage !== 'visited'
    || row.events.some(item => purchaseKinds.has(item.kind) || rentalKinds.has(item.kind));
}

/** Does not import, authorize writes, issue IDs, infer Lead links or merge by name/phone. */
export function prepareHistoricalTimelineImport(value: unknown, prior?: HistoricalTimelineImportPlan): HistoricalTimelineImportPlan {
  const input = object(value, ['manifest', 'records', 'bindings']);
  const manifest = parseManifest(input.manifest), rawRecords = array(input.records, 50000);
  let eventCount = 0;
  // Bound total event work before parsing/copying each source event.
  for (const raw of rawRecords) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
    eventCount += array((raw as Record<string, unknown>).events, 1000).length;
    if (eventCount > 100000) return fail('HISTORICAL_TIMELINE_TOO_LARGE');
  }
  const records = rawRecords.map(record), bindings = array(input.bindings, 50000).map(binding);
  const expected = new Map(manifest.records.map(row => [row.recordKey, row]));
  if (records.some(row => !expected.has(row.recordKey)) || new Set(records.map(row => row.recordKey)).size !== expected.size
    || bindings.some(row => !expected.has(row.recordKey))) return fail('HISTORICAL_MANIFEST_COVERAGE_INVALID');
  const sources = new Map<string, HistoricalTimelineRecord[]>(), matches = new Map<string, HistoricalTimelineBinding[]>();
  for (const row of records) { const group = sources.get(row.recordKey) ?? []; group.push(row); sources.set(row.recordKey, group); }
  for (const row of bindings) { const group = matches.get(row.recordKey) ?? []; group.push(row); matches.set(row.recordKey, group); }
  const rows: HistoricalTimelinePreparedRow[] = records.map(source => {
    const entry = expected.get(source.recordKey)!, candidates = matches.get(source.recordKey) ?? [], holds = timelineHolds(source);
    if (sources.get(source.recordKey)!.length > 1) holds.push('DUPLICATE_SOURCE_RECORD');
    if (entry.rowSha256 !== source.rowSha256 || entry.rowNumber !== source.rowNumber) holds.push('SOURCE_RECORD_CONFLICT');
    let mapped = candidates.length === 1 ? candidates[0] : null;
    if (!candidates.length) holds.push('MAPPING_REQUIRED');
    else if (!mapped || mapped.rowSha256 !== source.rowSha256 || mapped.customerKey !== source.customerKey || mapped.dealKey !== source.dealKey
      || (source.kind === 'visit' && (mapped.saleId !== null || mapped.rentalId !== null))
      || (source.kind === 'purchase' && (mapped.saleId === null || mapped.rentalId !== null))
      || (source.kind === 'rental' && (mapped.rentalId === null || (source.stage === 'rental_buyout' ? mapped.saleId === null : mapped.saleId !== null)))) {
      holds.push('MAPPING_CONFLICT'); mapped = null;
    }
    return { source, binding: mapped, holds, protectedFromLost: protectsLost(source) || !!(mapped?.saleId || mapped?.rentalId) };
  });
  const customerTargets = new Map<string, Set<string>>(), dealTargets = new Map<string, Set<string>>(), targetSources = new Map<string, Set<string>>();
  const dealRecords = new Map<string, Set<string>>();
  for (const row of rows) if (row.source.dealKey !== null) {
    const keys = dealRecords.get(row.source.dealKey) ?? new Set<string>(); keys.add(row.source.recordKey); dealRecords.set(row.source.dealKey, keys);
  }
  for (const row of rows) if (row.binding) {
    const binding = row.binding;
    const set = customerTargets.get(row.source.customerKey) ?? new Set<string>(); set.add(binding.customerId); customerTargets.set(row.source.customerKey, set);
    if (row.source.dealKey !== null) {
      const target = canonical([binding.customerId, binding.interestId, binding.saleId, binding.rentalId]);
      const targets = dealTargets.get(row.source.dealKey) ?? new Set<string>(); targets.add(target); dealTargets.set(row.source.dealKey, targets);
      for (const id of [binding.saleId, binding.rentalId].filter((id): id is string => id !== null)) {
        const sourceKeys = targetSources.get(id) ?? new Set<string>(); sourceKeys.add(row.source.dealKey); targetSources.set(id, sourceKeys);
      }
    }
  }
  // Several independently keyed records claiming one deal need a reviewed consolidation policy.
  // Keep every event; never resolve contradictory dates or current stages by choosing a row.
  for (const row of rows) if (row.source.dealKey !== null && dealRecords.get(row.source.dealKey)!.size > 1) row.holds.push('DEAL_HISTORY_REVIEW');
  for (const row of rows) if (row.binding) {
    if (customerTargets.get(row.source.customerKey)!.size > 1) row.holds.push('CUSTOMER_IDENTITY_CONFLICT');
    if (row.source.dealKey !== null && (dealTargets.get(row.source.dealKey)!.size > 1
      || [row.binding.saleId, row.binding.rentalId].some(id => id !== null && targetSources.get(id)!.size > 1))) row.holds.push('DEAL_IDENTITY_CONFLICT');
  }
  // All rows for a customer with any deal evidence stay protected, including separate visit-only rows and holds.
  const protectedKeys = new Set(rows.filter(row => row.protectedFromLost).map(row => row.source.customerKey));
  const protectedIds = new Set(rows.filter(row => row.protectedFromLost && row.binding).map(row => row.binding!.customerId));
  for (const row of rows) {
    row.protectedFromLost ||= protectedKeys.has(row.source.customerKey) || (!!row.binding && protectedIds.has(row.binding.customerId));
    row.holds = [...new Set(row.holds)].sort();
  }
  rows.sort((a, b) => compare(a.source.recordKey, b.source.recordKey) || compare(canonical(a), canonical(b)));
  const body = { version: 'historical-timeline-plan-v1' as const, manifest, rows,
    writesAllowed: false as const, importReady: false as const, leadRequired: false as const, replayEarlierSteps: false as const };
  const canonicalPlan = canonical(body);
  if (prior) {
    const { canonicalPlan: recorded, ...priorBody } = prior;
    if (recorded !== canonical(priorBody) || recorded !== canonicalPlan) return fail('HISTORICAL_TIMELINE_PLAN_CHANGED');
  }
  return { ...body, canonicalPlan };
}

/** Classification review only: never updates a Lead, and requires a separate complete-history review. */
export function historicalTimelineLostEligibility(plan: HistoricalTimelineImportPlan, customerId: string,
  evidence: { historyReviewComplete: boolean; nativeLeadId: string | null; currentStage: string }) {
  const { canonicalPlan, ...body } = plan;
  if (canonical(body) !== canonicalPlan) return fail('HISTORICAL_TIMELINE_PLAN_CHANGED');
  const raw = object(evidence, ['historyReviewComplete', 'nativeLeadId', 'currentStage']);
  if (typeof raw.historyReviewComplete !== 'boolean') return fail();
  const status = text(raw.currentStage).toLowerCase();
  const id = bookingUuid(customerId).toLowerCase();
  const mappedRows = plan.rows.filter(row => row.binding?.customerId === id);
  const sourceKeys = new Set(mappedRows.map(row => row.source.customerKey));
  const rows = plan.rows.filter(row => row.binding?.customerId === id || sourceKeys.has(row.source.customerKey));
  const known = rows.length > 0 && rows.every(row => !row.holds.length);
  const protectedFromLost = rows.some(row => row.protectedFromLost);
  const lead = evidence.nativeLeadId === null ? null : bookingUuid(evidence.nativeLeadId);
  return { eligibleForReview: known && evidence.historyReviewComplete === true && lead !== null && !protectedFromLost
    && ['new', 'contacted', 'interested', 'considering', 'follow up', 'follow-up', 'follow_up', 'visit', 'visited', 'active'].includes(status),
    protectedFromLost, writesAllowed: false as const };
}
