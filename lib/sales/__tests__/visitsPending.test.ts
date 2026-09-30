// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clearVisitsPending, readVisitsPending, visitsPendingKey, writeVisitsPending } from '../visitsPending';
import { actorId, vid, visitInput } from '../../../components/sales/__tests__/visitsFixtures';
function storage() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; }
describe('immutable visit pending commands', () => {
  it('preserves explicit times and IDs, then clears only the matching command', () => {
    const store = storage(), input = visitInput('check_in'); writeVisitsPending(actorId, input, store);
    expect(readVisitsPending(actorId, store)).toEqual(input);
    expect(store.getItem(visitsPendingKey(actorId))).not.toMatch(/token|customerName|snapshot/);
    clearVisitsPending(actorId, input, store); expect(readVisitsPending(actorId, store)).toBeNull();
  });
  it('does not replace pending work when another scope, request, reason or time is supplied', () => {
    const store = storage(), input = visitInput(); writeVisitsPending(actorId, input, store);
    for (const patch of [{ interestId: vid(99) }, { customerId: vid(99) }, { requestId: vid(99) }, { reason: 'changed' }, { occurredAt: '2026-09-23T09:01:00+07:00' }]) {
      expect(() => writeVisitsPending(actorId, { ...input, ...patch }, store)).toThrow(); expect(() => clearVisitsPending(actorId, { ...input, ...patch }, store)).toThrow();
    }
    expect(readVisitsPending(actorId, store)).toEqual(input); expect(readVisitsPending(vid(99), store)).toBeNull();
  });
  it.each(['not json', '{}', 'x'.repeat(32769), JSON.stringify({ version: 1, actorUserId: vid(99), uncertain: true, input: visitInput() }),
    JSON.stringify({ version: 1, actorUserId: actorId, uncertain: false, input: visitInput() })])('retains malformed records for review', raw => {
    const store = storage(); store.setItem(visitsPendingKey(actorId), raw);
    expect(() => readVisitsPending(actorId, store)).toThrow(); expect(() => writeVisitsPending(actorId, visitInput(), store)).toThrow();
    expect(store.getItem(visitsPendingKey(actorId))).toBe(raw);
  });
  it('detects failed write verification and removal', () => {
    const store = storage(); expect(() => writeVisitsPending(actorId, visitInput(), { ...store, setItem: () => {} })).toThrow();
    writeVisitsPending(actorId, visitInput(), store); expect(() => clearVisitsPending(actorId, visitInput(), { ...store, removeItem: () => {} })).toThrow();
  });
});
