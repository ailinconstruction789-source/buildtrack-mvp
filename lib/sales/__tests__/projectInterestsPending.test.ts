import { describe, expect, it } from 'vitest';
import { clearProjectInterestsPending, projectInterestsPendingKey, readProjectInterestsPending, writeProjectInterestsPending } from '../projectInterestsPending';
import { piId, piInput } from './projectInterestsFixtures';
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};
describe('project interest write-ahead session receipt', () => {
  it('normalizes and freezes one actor command, without token or full snapshot', () => {
    const store = memory(), input = piInput(); expect(readProjectInterestsPending(piId(6), store)).toBeNull();
    const result = writeProjectInterestsPending(piId(6), { ...input, reason: ` ${input.reason} ` }, store);
    expect(result).toEqual(input); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(readProjectInterestsPending(piId(6), store))).toBe(true);
    expect(JSON.parse(store.getItem(projectInterestsPendingKey(piId(6)))!)).toEqual({ version: 1, actorUserId: piId(6), uncertain: true, input });
  });
  it('retries exact payload, but never replaces it with another customer/project', () => {
    const store = memory(); writeProjectInterestsPending(piId(6), piInput(), store); writeProjectInterestsPending(piId(6), piInput(), store);
    for (const input of [piInput({ customerId: piId(8) }), piInput({ projectName: 'อื่น' }), piInput({ requestId: piId(8) })]) {
      expect(() => writeProjectInterestsPending(piId(6), input, store)).toThrow();
    } expect(readProjectInterestsPending(piId(6), store)).toEqual(piInput());
  });
  it('isolates actor records and only clears the matching receipt', () => {
    const store = memory(); writeProjectInterestsPending(piId(6), piInput(), store); expect(readProjectInterestsPending(piId(8), store)).toBeNull();
    expect(() => clearProjectInterestsPending(piId(6), piInput({ reason: 'อื่น' }), store)).toThrow();
    clearProjectInterestsPending(piId(6), piInput(), store); expect(readProjectInterestsPending(piId(6), store)).toBeNull();
  });
  it.each(['{broken', JSON.stringify({ version: 1, actorUserId: piId(8), uncertain: true, input: piInput() }), 'x'.repeat(32769)])('preserves corrupt/mismatched data %# for Admin review', raw => {
    const store = memory(); store.setItem(projectInterestsPendingKey(piId(6)), raw);
    expect(() => readProjectInterestsPending(piId(6), store)).toThrow(); expect(() => clearProjectInterestsPending(piId(6), piInput(), store)).toThrow();
    expect(store.getItem(projectInterestsPendingKey(piId(6)))).toBe(raw);
  });
  it('verifies storage really persisted and removed the command', () => {
    const store = memory(); expect(() => writeProjectInterestsPending(piId(6), piInput(), { ...store, setItem: () => undefined })).toThrow();
    writeProjectInterestsPending(piId(6), piInput(), store);
    expect(() => clearProjectInterestsPending(piId(6), piInput(), { ...store, removeItem: () => undefined })).toThrow();
  });
  it('blocks writes when storage is inaccessible', () => {
    const store = { ...memory(), getItem: () => { throw new Error('denied'); } };
    expect(() => readProjectInterestsPending(piId(6), store)).toThrow(); expect(() => writeProjectInterestsPending(piId(6), piInput(), store)).toThrow();
  });
});
