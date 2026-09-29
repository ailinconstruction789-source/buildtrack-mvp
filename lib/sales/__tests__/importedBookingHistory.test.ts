import { describe, expect, it } from 'vitest';
import { assertImportedBookingRow, bookingRoundLabel, displayBookingHistoryDate, parseImportedBookingHistory } from '../importedBookingHistory';
import { parseBookingContext, parseBookingInput } from '../bookingContracts';
import { parseProjectSalesSnapshot } from '../projectSalesContracts';
import { bid, bookingContext, bookingInput } from './bookingFixtures';
import { projectScope, projectSnapshot } from './projectSalesFixtures';

const evidence = () => ({ source: 'customer_sheet' as const, batchId: bid(90), sourceRow: 966,
  sourceStage: 'cancelled' as const, bookedDate: '2024-07-22', cancelledDate: '2024-09-23', transferredDate: null });
const importedContext = () => {
  const result = bookingContext();
  result.sales[0].bookingRound = null; result.sales[0].importedHistory = evidence();
  return result;
};
describe('imported booking evidence in operational readers', () => {
  it('preserves source days, unknown round and money in the booking reader', () => {
    const parsed = parseBookingContext(importedContext(), bid(2), 0);
    expect(parsed.sales[0]).toMatchObject({ bookingRound: null, previousSaleId: null, bookedAt: null,
      cancelledAt: null, salePrice: null, depositAmount: null, importedHistory: evidence() });
  });
  it('connects the same customer/history to the project reader without operator preview metadata', () => {
    const scope = projectScope({ tab: 'all' }), snapshot = projectSnapshot(scope);
    Object.assign(snapshot.rows[0], { stage: 'cancelled', bookingRound: null, importedHistory: evidence() });
    expect(parseProjectSalesSnapshot(snapshot, scope).rows[0]).toMatchObject({ bookingRound: null, importedHistory: evidence() });
    expect(parseProjectSalesSnapshot(snapshot, scope)).not.toHaveProperty('prepared');
  });
  it('does not allow unknown rounds without validated import evidence', () => {
    for (const importedHistory of [undefined, null, {}, { ...evidence(), batchId: 'not-uuid' }]) {
      const context = importedContext(); Object.assign(context.sales[0], { importedHistory });
      expect(() => parseBookingContext(context, bid(2), 0)).toThrow();
      const scope = projectScope({ tab: 'all' }), snapshot = projectSnapshot(scope);
      Object.assign(snapshot.rows[0], { bookingRound: null, importedHistory });
      expect(() => parseProjectSalesSnapshot(snapshot, scope)).toThrow();
    }
  });
  it('accepts SQL null evidence for existing native rows without changing their shape', () => {
    const context = bookingContext(); Object.assign(context.sales[0], { importedHistory: null });
    expect(parseBookingContext(context, bid(2), 0)).toEqual(bookingContext());
  });
  it.each([{ bookingRound: 1 }, { previousSaleId: bid(4) }, { bookedAt: '2024-07-22T00:00:00Z' },
    { cancelledAt: '2024-09-23T00:00:00Z' }, { listPrice: 0 }, { discountAmount: 0 }, { stage: 'booked' }])('rejects invented/contradictory historical fields %j', override => {
    const context = importedContext(); Object.assign(context.sales[0], override);
    expect(() => parseBookingContext(context, bid(2), 0)).toThrow();
  });
  it.each(['2026-02-30', '0000-01-01', '2026-9-01', '2026-09-01T00:00:00Z', 'PRIVATE'])('rejects invalid source day %s', bookedDate => {
    expect(() => parseImportedBookingHistory({ ...evidence(), bookedDate })).toThrow();
  });
  it.each([{ sourceRow: 1 }, { sourceRow: 50001 }, { sourceRow: 1.5 }, { source: 'preview' },
    { sourceStage: 'lost' }, { sourceStage: 'booked' }, { bookedDate: '2025-01-01' },
    { transferredDate: '2024-09-23' }, { rawValues: ['PRIVATE'] }, { held: false }])('rejects malformed or unapproved evidence projection %j', override => {
    expect(() => parseImportedBookingHistory({ ...evidence(), ...override })).toThrow();
  });
  it('keeps native cancellation after import distinct from historical day evidence', () => {
    const context = importedContext();
    context.sales[0].importedHistory = { ...evidence(), sourceStage: 'booked', cancelledDate: null };
    context.sales[0].cancelledAt = '2026-09-29T10:00:00+07:00';
    expect(parseBookingContext(context, bid(2), 0).sales[0].cancelledAt).toBe(context.sales[0].cancelledAt);
  });
  it('accepts permission to cancel an active imported booking without inventing history', () => {
    const context = importedContext();
    Object.assign(context.sales[0], { stage: 'booked', canCancel: true, canResume: false,
      importedHistory: { ...evidence(), sourceStage: 'booked', cancelledDate: null } });
    expect(parseBookingContext(context, bid(2), 0).sales[0]).toMatchObject({ canCancel: true, bookingRound: null, bookedAt: null });
    context.sales[0].stage = 'cancelled';
    expect(() => parseBookingContext(context, bid(2), 0)).toThrow();
  });
  it('keeps source transfer closed instead of accepting it as a live booking', () => {
    const context = importedContext(), sale = context.sales[0];
    sale.importedHistory = { ...evidence(), sourceStage: 'transferred', cancelledDate: null, transferredDate: '2024-09-23' };
    expect(() => assertImportedBookingRow({ ...sale }, sale.importedHistory)).toThrow();
    sale.stage = 'handover'; sale.canResume = false;
    expect(() => parseBookingContext(context, bid(2), 0)).not.toThrow();
  });
  it('does not accept operator preview in the booking API or import evidence in a write request', () => {
    expect(() => parseBookingContext({ ...importedContext(), prepared: {} }, bid(2), 0)).toThrow();
    const context = importedContext(); Object.assign(context.sales[0], { historyEvidence: {} });
    expect(() => parseBookingContext(context, bid(2), 0)).toThrow();
    expect(() => parseBookingInput({ ...bookingInput(), importedHistory: evidence() })).toThrow();
    expect(() => parseBookingInput({ ...bookingInput(), newCustomer: { name: 'ใหม่', phone: null } })).toThrow();
  });
  it('does not turn source days into timestamps or zero-valued rounds', () => {
    expect(bookingRoundLabel(null)).toBe('รอบไม่ทราบ (ข้อมูลเดิม)');
    expect(bookingRoundLabel(2)).toBe('รอบ 2');
    expect(displayBookingHistoryDate(null, '2024-07-22')).toBe('22/07/2567 (ข้อมูลเดิม — ไม่ทราบเวลา)');
    expect(displayBookingHistoryDate(null, null)).toBe('ไม่ทราบ');
    expect(displayBookingHistoryDate('2026-09-29T10:00:00+07:00', '2024-07-22')).not.toContain('ข้อมูลเดิม');
  });
});
