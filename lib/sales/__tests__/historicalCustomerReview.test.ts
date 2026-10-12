import { describe, expect, it } from 'vitest';
import { historicalCustomerContinuation, reviewHistoricalCustomer } from '../historicalCustomerReview';
import { bid } from './bookingFixtures';
const row = (currentStage = 'transferred') => ({ source: { snapshotSha256: 'a'.repeat(64), rowNumber: 2, customerKey: 'old-customer-1', dealKey: 'old-deal-1' },
  customer: { name: 'ลูกค้าเก่า', phone: null }, existingCustomerId: null, nativeLeadId: null, leadLinkEvidenceRef: null,
  currentStage, paymentMethod: 'mortgage', dates: {} });
describe('historical customer review independent of Lead existence', () => {
  it.each(['booked','contracted','transferred','cancelled','handover'])('keeps the real %s stage with no Lead and no earlier event dates', stage => {
    const review = reviewHistoricalCustomer(row(stage)), flow = historicalCustomerContinuation(review);
    expect(review.leadRequired).toBe(false); expect(review.nativeLeadId).toBeNull(); expect(flow.currentStage).toBe(stage);
    expect(flow.history.every(h => h.date === null)).toBe(true); expect(flow.replayEarlierSteps).toBe(false); expect(flow.writesAllowed).toBe(false);
  });
  it('preserves known contract and transfer days without inventing visit/booking times', () => {
    const review = reviewHistoricalCustomer({ ...row(), dates: { contracted: '2025-01-01', transferred: '2025-02-01' } });
    const history = historicalCustomerContinuation(review).history;
    expect(history.find(h => h.event === 'contracted')).toMatchObject({ date: '2025-01-01', occurredAt: null, precision: 'day' });
    expect(history.find(h => h.event === 'booked')?.date).toBeNull();
  });
  it('continues from the current stage instead of forcing booking again', () => {
    expect(historicalCustomerContinuation(reviewHistoricalCustomer(row('contracted'))).nextPurchaseStages).toEqual(['downpayment','document_prep','cancelled']);
    expect(historicalCustomerContinuation(reviewHistoricalCustomer(row())).nextPurchaseStages).toEqual(['handover']);
    expect(historicalCustomerContinuation(reviewHistoricalCustomer(row('cancelled'))).nextPurchaseStages).toEqual([]);
  });
  it('does not assume mortgage when the old payment method was never recorded', () => {
    const flow = historicalCustomerContinuation(reviewHistoricalCustomer({ ...row('contracted'), paymentMethod: null }));
    expect(flow.needsPaymentMethod).toBe(true); expect(flow.nextPurchaseStages).toEqual([]);
    const transferred = historicalCustomerContinuation(reviewHistoricalCustomer({ ...row(), paymentMethod: null }));
    expect(transferred.needsPaymentMethod).toBe(false); expect(transferred.nextPurchaseStages).toEqual(['handover']);
  });
  it('can preserve a verified Lead link but does not demand one for old deals', () => {
    expect(reviewHistoricalCustomer({ ...row(), nativeLeadId: bid(10), leadLinkEvidenceRef: 'reviewed-source-ref' }).nativeLeadId).toBe(bid(10));
    expect(() => reviewHistoricalCustomer({ ...row(), nativeLeadId: bid(10) })).toThrow();
  });
  it('keeps a source customer key distinct from a booking/deal key', () => {
    expect(() => reviewHistoricalCustomer({ ...row(), source: { ...row().source, dealKey: null } })).toThrow();
    const visit = reviewHistoricalCustomer({ ...row('visited'), source: { ...row().source, dealKey: null }, dates: { visited: '2025-01-01' } });
    expect(visit.source.dealKey).toBeNull(); expect(visit.leadRequired).toBe(false);
  });
  it.each([
    { dates: { transferred: '2025-01-01' }, currentStage: 'booked' },
    { dates: { cancelled: '2025-01-01' }, currentStage: 'transferred' },
    { dates: { booked: '2025-02-01', contracted: '2025-01-01' } },
    { dates: { transferred: '2025-02-30' } },
    { dates: { loan_submitted: '2025-01-01' }, paymentMethod: 'cash' },
    { created_at: '2026-10-09T00:00:00Z' },
    { role: 'admin' },
  ])('requires source review for conflicting or unsupported evidence %j', change => {
    expect(() => reviewHistoricalCustomer({ ...row(), ...change })).toThrow();
  });
  it('does not deduplicate distinct source customers with matching names or phone numbers', () => {
    const first = reviewHistoricalCustomer(row());
    const second = reviewHistoricalCustomer({ ...row(), source: { ...row().source, rowNumber: 3, customerKey: 'old-customer-2', dealKey: 'old-deal-2' } });
    expect(first.customer.name).toBe(second.customer.name); expect(first.source.customerKey).not.toBe(second.source.customerKey);
  });
});
