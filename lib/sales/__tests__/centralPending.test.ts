// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { centralPendingKey, clearCentralPending, readCentralPending, writeCentralPending } from '../centralPending';
const actor = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const input = { requestId: other, name: 'SYNTHETIC intake', phone: '0812345678', channel: 'โทร', notes: '', interests: [] };
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
describe('actor-bound central intake write-ahead pending', () => {
  it('preserves an exact request across remounts without exposing it to another actor', () => {
    const store = storage(); expect(readCentralPending(actor, store)).toBeNull();
    writeCentralPending(actor, input, store); expect(readCentralPending(actor, store)).toEqual(input);
    expect(readCentralPending(other, store)).toBeNull();
    expect(store.getItem(centralPendingKey(actor))).not.toMatch(/token|snapshot/);
    clearCentralPending(actor, input, store); expect(readCentralPending(actor, store)).toBeNull();
  });
  it('cannot overwrite or clear a different frozen input', () => {
    const store = storage(); writeCentralPending(actor, input, store);
    for (const changed of [{ ...input, name: 'different' }, { ...input, requestId: actor }]) {
      expect(() => writeCentralPending(actor, changed, store)).toThrow();
      expect(() => clearCentralPending(actor, changed, store)).toThrow();
    }
    expect(readCentralPending(actor, store)).toEqual(input);
  });
  it.each(['broken', '{}', 'x'.repeat(32769), JSON.stringify({ version: 1, actorUserId: other, uncertain: true, input }),
    JSON.stringify({ version: 1, actorUserId: actor, uncertain: false, input })])('fails closed on corrupt pending record', raw => {
    const store = storage(); store.setItem(centralPendingKey(actor), raw);
    expect(() => readCentralPending(actor, store)).toThrow(); expect(() => writeCentralPending(actor, input, store)).toThrow();
    expect(store.getItem(centralPendingKey(actor))).toBe(raw);
  });
  it('verifies persistence and cleanup and refuses unavailable storage', () => {
    const store = storage(); expect(() => writeCentralPending(actor, input, { ...store, setItem: () => {} })).toThrow();
    writeCentralPending(actor, input, store); expect(() => clearCentralPending(actor, input, { ...store, removeItem: () => {} })).toThrow();
    expect(() => readCentralPending(actor, { ...store, getItem: () => { throw new Error('blocked'); } })).toThrow();
  });
});
