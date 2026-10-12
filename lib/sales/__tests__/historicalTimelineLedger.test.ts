// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareHistoricalLedgerInput } from '../historicalTimelineLedger';
import type { HistoricalTimelineImportInput } from '../historicalTimelineImport';

const example = (): HistoricalTimelineImportInput => JSON.parse(readFileSync('sql/sales/runtime/fixtures/historical-timeline-input.example.json', 'utf8'));
describe('durable historical evidence payload', () => {
  it('retains every known/unknown day and binding without inventing Lead IDs or timestamps', () => {
    const source = example(), before = JSON.stringify(source);
    const candidate = prepareHistoricalLedgerInput(source);
    expect(candidate).toMatchObject({ version: 'historical-evidence-ledger-v1', businessWritesAllowed: false, leadRequired: false });
    expect(candidate.records.flatMap(row => row.source.events)).toHaveLength(7);
    expect(candidate.records.flatMap(row => row.source.events).filter(event => event.date === null)).toHaveLength(3);
    expect(JSON.stringify(source)).toBe(before);
    expect(candidate.records).not.toContainEqual(expect.objectContaining({ leadId: expect.anything() }));
  });
  it('canonicalizes row/event ordering for stable exact retries', () => {
    const source = example(), changed = structuredClone(source);
    changed.records.reverse(); changed.bindings.reverse(); changed.manifest.records.reverse();
    for (const row of changed.records) row.events.reverse();
    expect(prepareHistoricalLedgerInput(changed)).toEqual(prepareHistoricalLedgerInput(source));
  });
  it('refuses missing identity bindings rather than persisting an unlinked customer', () => {
    const source = example(); source.bindings.pop();
    expect(() => prepareHistoricalLedgerInput(source)).toThrow('HISTORICAL_LEDGER_REVIEW_REQUIRED');
  });
  it('rechecks mapping hash conflicts from raw evidence', () => {
    const source = example(); source.bindings[0].rowSha256 = 'f'.repeat(64);
    expect(() => prepareHistoricalLedgerInput(source)).toThrow('HISTORICAL_LEDGER_REVIEW_REQUIRED');
  });
  it('refuses a backwards historical business timeline', () => {
    const source = example(), row = source.records.find(row => row.kind === 'purchase')!;
    row.events = [
      { eventKey: 'transfer', kind: 'transferred', sequence: 1, date: null, precision: 'unknown', evidenceRef: 'synthetic-1' },
      { eventKey: 'booking', kind: 'booked', sequence: 2, date: null, precision: 'unknown', evidenceRef: 'synthetic-2' },
    ];
    expect(() => prepareHistoricalLedgerInput(source)).toThrow('HISTORICAL_LEDGER_REVIEW_REQUIRED');
  });
  it('does not accept a caller supplied prepared plan as raw input', () => {
    expect(() => prepareHistoricalLedgerInput({ ...example(), holds: [] })).toThrow();
  });
  it('keeps a change in evidence significant for persistence reconciliation', () => {
    const source = example(), changed = structuredClone(source);
    changed.records[0].events[0].evidenceRef = 'revised-independent-evidence';
    expect(prepareHistoricalLedgerInput(changed)).not.toEqual(prepareHistoricalLedgerInput(source));
  });
});
