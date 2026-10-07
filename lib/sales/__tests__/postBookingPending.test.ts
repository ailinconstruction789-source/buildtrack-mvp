// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clearPostBookingPending, postBookingPendingKey, readPostBookingPending, writePostBookingPending } from '../postBookingPending';
import { pbid, pbInput, pbTransfer } from './postBookingFixtures';
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
describe('immutable post-booking pending commands', () => {
  it('retains the exact date-only transfer across retries, refusing a changed date without fabricating time', () => {
    const store = storage(), input = pbTransfer(); writePostBookingPending(pbid(6), input, store);
    expect(readPostBookingPending(pbid(6), store)).toEqual(input);
    expect(store.getItem(postBookingPendingKey(pbid(6)))).not.toMatch(/occurredAt|evidenceNote|00:00/);
    expect(() => writePostBookingPending(pbid(6), { ...input, transferDate: '2026-09-22' }, store)).toThrow();
    expect(readPostBookingPending(pbid(6), store)).toEqual(input);
    clearPostBookingPending(pbid(6), input, store); expect(readPostBookingPending(pbid(6), store)).toBeNull();
  });
  it('writes/reads exact payload without clock conversion, then clears only matching command', () => {
    const store = storage(); expect(readPostBookingPending(pbid(6), store)).toBeNull();
    expect(writePostBookingPending(pbid(6), pbInput(), store)).toEqual(pbInput()); expect(readPostBookingPending(pbid(6), store)).toEqual(pbInput());
    expect(store.getItem(postBookingPendingKey(pbid(6)))).not.toMatch(/token|customerName|snapshot/);
    clearPostBookingPending(pbid(6), pbInput(), store); expect(readPostBookingPending(pbid(6), store)).toBeNull();
  });
  it('blocks changing sale, request, evidence or clearing the wrong pending command', () => {
    const store = storage(); writePostBookingPending(pbid(6), pbInput(), store);
    for (const patch of [{ saleId: pbid(98) }, { requestId: pbid(98) }, { evidenceNote: 'changed' }]) {
      expect(() => writePostBookingPending(pbid(6), { ...pbInput(), ...patch }, store)).toThrow();
      expect(() => clearPostBookingPending(pbid(6), { ...pbInput(), ...patch }, store)).toThrow();
    }
    expect(readPostBookingPending(pbid(6), store)).toEqual(pbInput()); expect(readPostBookingPending(pbid(99), store)).toBeNull();
  });
  it.each(['not json', '{}', 'x'.repeat(32769), JSON.stringify({ version: 1, actorUserId: pbid(99), uncertain: true, input: pbInput() }),
    JSON.stringify({ version: 1, actorUserId: pbid(6), uncertain: false, input: pbInput() })])('does not silently discard broken receipts', raw => {
    const store = storage(); store.setItem(postBookingPendingKey(pbid(6)), raw); expect(() => readPostBookingPending(pbid(6), store)).toThrow();
    expect(() => writePostBookingPending(pbid(6), pbInput(), store)).toThrow(); expect(store.getItem(postBookingPendingKey(pbid(6)))).toBe(raw);
  });
  it('detects failed readback and removal without clearing its failure', () => {
    const store = storage(); expect(() => writePostBookingPending(pbid(6), pbInput(), { ...store, setItem: () => {} })).toThrow();
    writePostBookingPending(pbid(6), pbInput(), store); expect(() => clearPostBookingPending(pbid(6), pbInput(), { ...store, removeItem: () => {} })).toThrow();
  });
});
