// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clearVisitSopPending, readVisitSopPending, visitSopPendingKey, writeVisitSopPending } from '../visitSopPending';
import { sopId, sopInput } from './visitSopFixtures';
const memory = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };
describe('SOP immutable session receipt', () => {
  it('deep freezes checklist/recap evidence and preserves exact normalized payload', () => {
    const store = memory(), input = sopInput({ command: 'save_stage', stage: 'stage_c' }); const saved = writeVisitSopPending(sopId(5), input, store);
    expect(Object.isFrozen(saved)).toBe(true);
    if (saved.command !== 'save_stage') throw new Error('fixture');
    expect(Object.isFrozen(saved.answers)).toBe(true); expect(Object.isFrozen(saved.answers[0])).toBe(true); expect(Object.isFrozen(saved.recap)).toBe(true);
    expect(readVisitSopPending(sopId(5), store)).toEqual(input); expect(store.getItem(visitSopPendingKey(sopId(5)))).not.toMatch(/token|snapshot|customerName/);
  });
  it('allows exact retry only; different anchor/time/answers cannot replace or clear it', () => {
    const store = memory(), input = sopInput(); writeVisitSopPending(sopId(5), input, store); writeVisitSopPending(sopId(5), input, store);
    for (const change of [{ appointmentId: sopId(99) }, { reason: 'changed' }, { requestId: sopId(99) }, { occurredAt: '2026-09-24T06:00:00Z' }]) {
      expect(() => writeVisitSopPending(sopId(5), { ...input, ...change }, store)).toThrow(); expect(() => clearVisitSopPending(sopId(5), { ...input, ...change }, store)).toThrow();
    } expect(readVisitSopPending(sopId(99), store)).toBeNull(); expect(readVisitSopPending(sopId(5), store)).toEqual(input);
  });
  it.each(['broken', '{}', 'x'.repeat(131073), JSON.stringify({ version: 1, actorUserId: sopId(99), uncertain: true, input: sopInput() })])('retains corrupt receipt %# for review', raw => {
    const store = memory(); store.setItem(visitSopPendingKey(sopId(5)), raw); expect(() => readVisitSopPending(sopId(5), store)).toThrow();
    expect(() => clearVisitSopPending(sopId(5), sopInput(), store)).toThrow(); expect(store.getItem(visitSopPendingKey(sopId(5)))).toBe(raw);
  });
  it('verifies actual persist/remove and clears only matching successful evidence', () => {
    const store = memory(); expect(() => writeVisitSopPending(sopId(5), sopInput(), { ...store, setItem: () => undefined })).toThrow();
    writeVisitSopPending(sopId(5), sopInput(), store); expect(() => clearVisitSopPending(sopId(5), sopInput(), { ...store, removeItem: () => undefined })).toThrow();
    clearVisitSopPending(sopId(5), sopInput(), store); expect(readVisitSopPending(sopId(5), store)).toBeNull();
  });
});
