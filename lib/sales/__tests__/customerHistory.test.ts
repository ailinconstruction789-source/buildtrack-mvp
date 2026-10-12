import { describe, expect, it } from 'vitest';
import { customerHistoryTimeline, parseCustomerHistoryDates } from '../customerHistory';
import { parseCustomerDealReadSnapshot, parseCustomerDealReadScope } from '../customerDealReadContracts';
const id = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope = { saleId: id(1), projectName: 'Fixture project' };
const snapshot = () => ({ actor: { userId: id(9), role: 'sales' }, customer: { id: id(2), name: 'Fixture customer', phone: null },
  deal: { id: id(1), customerId: id(2), interestId: id(3), projectName: scope.projectName, plotId: 'P1', stage: 'transferred', leadId: null,
    origin: 'historical', revision: id(4), salePrice: 0, bankName: null, paymentMethod: null },
  history: customerHistoryTimeline({ created_at: '2026-10-09T10:00:00Z' }, undefined, { transferred: '2025-03-01' }), readOnly: true });
describe('historical customer evidence without a required Lead', () => {
  it('keeps a transferred customer without a Lead or earlier step dates', () => {
    const result = parseCustomerDealReadSnapshot(snapshot(), scope);
    expect(result.deal.leadId).toBeNull(); expect(result.deal.stage).toBe('transferred'); expect(result.deal.salePrice).toBe(0);
    expect(result.history.find(h => h.event === 'contracted')).toMatchObject({ date: null, precision: 'unknown' });
    expect(result.history.find(h => h.event === 'transferred')).toMatchObject({ date: '2025-03-01', occurredAt: null, precision: 'day' });
  });
  it('never substitutes import time, created_at or sale stage for visit/booking dates', () => {
    expect(customerHistoryTimeline({ crm_stage: 'transferred', created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:00:00Z' })
      .every(h => h.date === null && h.occurredAt === null)).toBe(true);
  });
  it('preserves an actual instant and a day-only visit without invented time', () => {
    const history = customerHistoryTimeline({ booked_at: '2026-03-01T18:00:00Z' }, undefined, { visited: '2026-03-03' });
    expect(history.find(h => h.event === 'booked')).toMatchObject({ date: '2026-03-02', precision: 'instant' });
    expect(history.find(h => h.event === 'visited')).toMatchObject({ date: '2026-03-03', precision: 'day', occurredAt: null });
  });
  it('does not lose exact source dates or upgrade day evidence to timestamps', () => {
    const history = customerHistoryTimeline({}, { source: 'customer_sheet', batchId: id(5), sourceRow: 2, sourceStage: 'cancelled', bookedDate: null, transferredDate: null, cancelledDate: '2026-05-01' });
    expect(history.find(h => h.event === 'cancelled')).toMatchObject({ date: '2026-05-01', occurredAt: null, source: 'historical_record' });
  });
  it.each(['2026-02-30','0000-01-01','2026-01-01T00:00:00Z','not a date'])('rejects invalid/instant historical civil date %s', value => {
    expect(() => parseCustomerHistoryDates({ booked: value })).toThrow();
  });
  it('flags contradictory known dates, without requiring unknown steps', () => {
    expect(() => parseCustomerHistoryDates({ booked: '2026-02-01', transferred: '2026-01-31' })).toThrow();
    expect(() => parseCustomerHistoryDates({ booked: '2026-02-01', cancelled: '2026-01-31' })).toThrow();
    expect(parseCustomerHistoryDates({ transferred: '2026-02-01' }).contracted).toBeNull();
  });
  it('rejects inconsistent calendar-day and instant evidence', () => {
    expect(() => customerHistoryTimeline({ booked_at: '2026-03-01T18:00:00Z' }, undefined, { booked: '2026-03-01' })).toThrow();
  });
  it('rejects conflicting known instants without using missing earlier steps as a requirement', () => {
    expect(() => customerHistoryTimeline({ booked_at: '2026-02-01T10:00:00Z', transferred_at: '2026-01-31T10:00:00Z' })).toThrow();
    expect(() => parseCustomerHistoryDates({ contracted: '2026-02-01', loan_submitted: '2026-01-31' })).toThrow();
    expect(() => parseCustomerHistoryDates({ contracted: '2026-02-01', cancelled: '2026-01-31' })).toThrow();
    expect(customerHistoryTimeline({ crm_transfer_date: '2025-03-01' }).find(h => h.event === 'transferred')).toMatchObject({ date: '2025-03-01', precision: 'day', occurredAt: null, source: 'recorded_event' });
    expect(() => customerHistoryTimeline({ crm_transfer_date: '2025-03-01' }, undefined, { transferred: '2025-03-02' })).toThrow();
  });
  it.each(['customerId', 'id', 'projectName'])('rejects a response with mismatched %s', field => {
    const result = snapshot(); (result.deal as Record<string,unknown>)[field] = field === 'projectName' ? 'Other project' : id(99);
    expect(() => parseCustomerDealReadSnapshot(result, scope)).toThrow();
  });
  it('does not permit missing evidence to masquerade as completion or an editable response', () => {
    const result = snapshot(); result.readOnly = false; expect(() => parseCustomerDealReadSnapshot(result, scope)).toThrow();
    const changed = snapshot(); changed.history[0].precision = 'day'; expect(() => parseCustomerDealReadSnapshot(changed, scope)).toThrow();
    expect(() => parseCustomerDealReadScope({ ...scope, customerName: 'Guess a person' })).toThrow();
  });
});


describe('actual day-only handover without fabricated older events', () => {
  it('preserves entered handover day and leaves old transfer unknown', () => {
    const rows = customerHistoryTimeline({ crm_handover_date: '2026-09-23' });
    expect(rows.find(row => row.event === 'handover')).toMatchObject({ date: '2026-09-23', occurredAt: null, precision: 'day', source: 'recorded_event' });
    expect(rows.find(row => row.event === 'transferred')).toMatchObject({ date: null, occurredAt: null, precision: 'unknown' });
  });
  it('rejects a handover day conflicting with actual recorded time or earlier than actual transfer', () => {
    expect(() => customerHistoryTimeline({ crm_handover_date: '2026-09-23', crm_handover_at: '2026-09-24T01:00:00+07:00' })).toThrow();
    expect(() => customerHistoryTimeline({ crm_handover_date: '2026-09-23', crm_transfer_date: '2026-09-24' })).toThrow();
  });
});
