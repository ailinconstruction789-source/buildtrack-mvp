import { describe, expect, it } from 'vitest';
import { bahtToSatang, parseBookingContext, parseBookingInput, parseBookingQuery, parseBookingResult, parseBookingSearch } from '../bookingContracts';
import { bid, bookingContext, bookingInput, bookingResult } from './bookingFixtures';

describe('booking request and history contracts', () => {
  it('accepts existing-customer booking without inventing a Visit', () => expect(parseBookingInput(bookingInput())).toEqual(bookingInput()));
  it('accepts one atomic customer-plus-booking intent', () => {
    const input = { ...bookingInput(), customerId: null, expectedInterestRevision: null, newCustomer: { name: 'ลูกค้าใหม่', phone: '0812345678', channel: 'Walk in', notes: '', assignedSalesUserId: null } };
    expect(parseBookingInput(input)).toEqual(input);
  });
  it.each([{ owner: bid(8) }, { role: 'admin' }, { bookedAt: '2020-01-01' }, { discountApproved: true }])('rejects unauthorized fields %j', extra => {
    expect(() => parseBookingInput({ ...bookingInput(), ...extra })).toThrow();
  });
  it.each([{ customerId: null }, { newCustomer: {} }, { listPriceSatang: 0 }, { discountSatang: 250000000 }, { depositSatang: 250000001 },
    { listPriceSatang: 2.55 }, { reason: ' ' }, { requestId: `${bid(1)}\n` }, { expectedInterestRevision: undefined }, { plotId: '\u0000' }, { bookingRoute: 'visited' }, { visitId: bid(4) }])('rejects invalid intent %j', extra => {
    expect(() => parseBookingInput({ ...bookingInput(), ...extra })).toThrow();
  });
  it('requires Visit proof to be explicit and lets the database validate its relationship', () => {
    expect(parseBookingInput({ ...bookingInput(), bookingRoute: 'visited', visitId: bid(10) })).toMatchObject({ visitId: bid(10) });
  });
  it.each(['1.005', '-1', '1e2', '1,000', ' 1', '1\n', 'Infinity', '1000000000', '', '01'])('never rounds or coerces money: %s', value => expect(() => bahtToSatang(value)).toThrow());
  it.each([['0', 0], ['123.45', 12345], ['0.01', 1], ['2500000', 250000000]] as const)('converts %s baht exactly', (value, expected) => expect(bahtToSatang(value)).toBe(expected));
  it('requires cancellation reason/category and trusted revision', () => {
    const input = { requestId: bid(1), command: 'cancel', customerId: bid(2), saleId: bid(5), expectedSaleRevision: bid(6), reason: 'ลูกค้ายกเลิก', cancellationCategory: 'booking_cancelled' };
    expect(parseBookingInput(input)).toEqual(input);
    expect(() => parseBookingInput({ ...input, cancellationCategory: 'lost' })).toThrow();
  });
  it('requires a next action with timezone for explicit resume', () => {
    const input = { requestId: bid(1), command: 'resume_follow_up', customerId: bid(2), saleId: bid(5), expectedSaleRevision: bid(6), expectedInterestRevision: bid(4), expectedActionId: null,
      reason: 'กลับมาติดตาม', nextAction: { action: 'โทร', dueAt: '2026-10-01T09:00:00+07:00' } };
    expect(parseBookingInput(input)).toEqual(input);
    expect(() => parseBookingInput({ ...input, nextAction: { action: 'โทร', dueAt: '2026-10-01T09:00' } })).toThrow();
    expect(() => parseBookingResult({ ...bookingResult(), command: 'resume_follow_up', nextActionId: bid(11), saleRevision: bid(12) }, parseBookingInput(input))).toThrow();
  });
  it('preserves unknown historical money/dates and cancelled round', () => {
    const context = parseBookingContext(bookingContext(), bid(2), 0);
    expect(context.sales[0]).toMatchObject({ stage: 'cancelled', bookingRound: 1, bookedAt: null, cancelledAt: null, salePrice: null, depositAmount: null });
  });
  it('rejects wrong-customer/context, duplicate history, invalid relations, and role permissions', () => {
    expect(() => parseBookingContext(bookingContext(), bid(20), 0)).toThrow();
    const context = bookingContext(); context.sales.push({ ...context.sales[0] });
    expect(() => parseBookingContext(context, bid(2), 0)).toThrow();
    context.sales.pop(); context.sales[0].interestId = bid(40);
    expect(() => parseBookingContext(context, bid(2), 0)).toThrow();
    const owner = bookingContext(); owner.actor.role = 'owner';
    expect(() => parseBookingContext(owner, bid(2), 0)).toThrow();
  });
  it('validates write receipts against the original intent', () => {
    expect(parseBookingResult(bookingResult(), bookingInput())).toEqual(bookingResult());
    expect(() => parseBookingResult({ ...bookingResult(), customerId: bid(30) }, bookingInput())).toThrow();
    expect(() => parseBookingResult({ ...bookingResult(), command: 'cancel' }, bookingInput())).toThrow();
  });
  it.each(['?page=-1', '?page=1.5', '?page=1&page=2', '?customerId=bad', '?admin=true'])('rejects ambiguous queries %s', query => {
    expect(() => parseBookingQuery(`https://test.invalid/${query}`)).toThrow();
  });
  it('searches bounded results without merging equal names/phones', () => {
    expect(parseBookingQuery('https://test.invalid/?q=ลูกค้า&page=1', true)).toEqual({ query: 'ลูกค้า', page: 1, customerId: null });
    expect(() => parseBookingQuery('https://test.invalid/?q=a', true)).toThrow();
    expect(parseBookingSearch({ customers: [{ id: bid(2), name: 'เดิม', phone: null }, { id: bid(22), name: 'เดิม', phone: null }], page: 1, hasMore: false }, 1).customers).toHaveLength(2);
  });
});
