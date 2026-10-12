import { prepareHistoricalTimelineImport, type HistoricalTimelineBinding, type HistoricalTimelineRecord } from './historicalTimelineImport';

export interface HistoricalLedgerRecord {
  source: HistoricalTimelineRecord;
  binding: HistoricalTimelineBinding;
}
/** Private evidence ledger only. This does not create CRM entities or activate their status. */
export interface HistoricalLedgerInput {
  version: 'historical-evidence-ledger-v1';
  sourceSystem: string;
  datasetKey: string;
  snapshotSha256: string;
  mappingReviewRef: string;
  records: HistoricalLedgerRecord[];
  businessWritesAllowed: false;
  leadRequired: false;
}

/** Revalidates raw input, rather than trusting a caller's prepared-plan holds or counters. */
export function prepareHistoricalLedgerInput(value: unknown): HistoricalLedgerInput {
  const plan = prepareHistoricalTimelineImport(value);
  if (plan.rows.some(row => row.holds.length || row.binding === null)) throw new Error('HISTORICAL_LEDGER_REVIEW_REQUIRED');
  if (plan.rows.length > 5000 || plan.rows.reduce((sum, row) => sum + row.source.events.length, 0) > 20000)
    throw new Error('HISTORICAL_LEDGER_TOO_LARGE');
  const result: HistoricalLedgerInput = {
    version: 'historical-evidence-ledger-v1', sourceSystem: plan.manifest.sourceSystem,
    datasetKey: plan.manifest.datasetKey, snapshotSha256: plan.manifest.snapshotSha256,
    mappingReviewRef: plan.manifest.mappingReviewRef,
    records: plan.rows.map(row => ({ source: row.source, binding: row.binding! })),
    businessWritesAllowed: false, leadRequired: false,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 8 * 1024 * 1024)
    throw new Error('HISTORICAL_LEDGER_TOO_LARGE');
  return result;
}
