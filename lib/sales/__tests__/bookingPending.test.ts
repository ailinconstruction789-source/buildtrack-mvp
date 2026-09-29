import { describe, expect, it } from 'vitest';
import { bookingPendingKey, clearBookingPending, readBookingPending, writeBookingPending } from '../bookingPending';
import type { BookingInput } from '../bookingContracts';
const ACTOR = '00000000-0000-4000-8000-000000000001';
const input: BookingInput = { command: 'book', requestId: '00000000-0000-4000-8000-000000000002', reason: 'ไม่ได้เข้าชม', customerId: null,
  newCustomer: { name: 'ลูกค้า', phone: '0812345678', channel: 'Walk in', notes: '', assignedSalesUserId: null },
  projectName: 'A', expectedInterestRevision: null, plotId: 'A-1', paymentMethod: 'cash', bookingRoute: 'without_visit', visitId: null,
  listPriceSatang: 200000000, discountSatang: 0, depositSatang: 100000, previousSaleId: null };
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};
describe('booking write-ahead receipt', () => {
  it('stores only the normalized command for one actor, recoverable after refresh', () => {
    const store = memory(); expect(readBookingPending(ACTOR, store)).toBeNull();
    writeBookingPending(ACTOR, { ...input, reason: '  ไม่ได้เข้าชม  ' }, store);
    expect(readBookingPending(ACTOR, store)).toEqual(input);
    expect(JSON.parse(store.getItem(bookingPendingKey(ACTOR))!)).toEqual({ version: 1, actorUserId: ACTOR, uncertain: true, input });
  });
  it('allows exact retry but never overwrites another customer/command', () => {
    const store = memory(); writeBookingPending(ACTOR, input, store); writeBookingPending(ACTOR, input, store);
    expect(() => writeBookingPending(ACTOR, { ...input, plotId: 'A-2' }, store)).toThrow();
    expect(readBookingPending(ACTOR, store)).toEqual(input);
  });
  it('retains corrupt entries for review, even during clear', () => {
    const store = memory(); store.setItem(bookingPendingKey(ACTOR), '{broken');
    expect(() => readBookingPending(ACTOR, store)).toThrow();
    expect(() => clearBookingPending(ACTOR, input, store)).toThrow();
    expect(store.getItem(bookingPendingKey(ACTOR))).toBe('{broken');
  });
  it('never clears another command', () => {
    const store = memory(); writeBookingPending(ACTOR, input, store);
    expect(() => clearBookingPending(ACTOR, { ...input, reason: 'อื่น' }, store)).toThrow();
    expect(readBookingPending(ACTOR, store)).toEqual(input);
  });
  it('clears personal intake details only with a matching successful receipt', () => {
    const store = memory(); writeBookingPending(ACTOR, input, store); clearBookingPending(ACTOR, input, store);
    expect(store.getItem(bookingPendingKey(ACTOR))).toBeNull();
  });
  it('checks that storage really persisted and removed data', () => {
    const store = memory();
    expect(() => writeBookingPending(ACTOR, input, { ...store, setItem: () => undefined })).toThrow();
    writeBookingPending(ACTOR, input, store);
    expect(() => clearBookingPending(ACTOR, input, { ...store, removeItem: () => undefined })).toThrow();
  });
  it('isolates actor identities without placing tokens in keys', () => {
    const store = memory(); writeBookingPending(ACTOR, input, store);
    expect(readBookingPending('00000000-0000-4000-8000-000000000003', store)).toBeNull();
  });
  it('fails closed when storage is inaccessible', () => {
    const store = { ...memory(), getItem: () => { throw new Error('blocked'); } };
    expect(() => readBookingPending(ACTOR, store)).toThrow();
    expect(() => writeBookingPending(ACTOR, input, store)).toThrow();
  });
});
