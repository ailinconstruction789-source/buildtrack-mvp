import { describe, expect, it } from 'vitest';
import { applyDemoAction, demoAccess, initialDemoAccounts, type DemoAction } from '../accountAccessDemo';

const approval = (change: Partial<Extract<DemoAction, { type: 'review' }>> = {}): DemoAction => ({
  type: 'review', reviewer: 'admin', expectedRevision: 1, reason: 'ตรวจตัวอย่างแล้ว',
  reference: 'DEMO-001', confirmed: true, ...change,
});

describe('isolated in-memory account access examples (not authorization)', () => {
  it('unban does not reactivate CRM, and reviewed recovery increments the revision', () => {
    const original = initialDemoAccounts()[0];
    const banned = applyDemoAction(original, { type: 'ban' }).account;
    expect(demoAccess(banned)).toEqual({ ownerEligible: false, canUseCrm: false });
    const unbanned = applyDemoAction(banned, { type: 'unban' }).account;
    expect(unbanned).toMatchObject({ banned: false, crmActive: false, reviewRevision: 1 });
    const recovered = applyDemoAction(unbanned, approval());
    expect(recovered.error).toBe(false);
    expect(recovered.account).toMatchObject({ crmActive: true, reviewRevision: 2 });
    expect(recovered.account.events).toHaveLength(3);
    expect(original).toEqual(initialDemoAccounts()[0]);
  });
  it('logout blocks the session but leaves ownership available; login never restores suspended CRM', () => {
    const signedOut = applyDemoAction(initialDemoAccounts()[0], { type: 'logout' }).account;
    expect(demoAccess(signedOut)).toEqual({ ownerEligible: true, canUseCrm: false });
    expect(demoAccess(applyDemoAction(signedOut, { type: 'login' }).account).canUseCrm).toBe(true);
    const pending = applyDemoAction(initialDemoAccounts()[2], { type: 'logout' }).account;
    expect(demoAccess(applyDemoAction(pending, { type: 'login' }).account).canUseCrm).toBe(false);
  });
  it.each(['owner', 'sales'] as const)('%s cannot approve in the demonstration', reviewer => {
    const original = initialDemoAccounts()[2];
    const result = applyDemoAction(original, approval({ reviewer }));
    expect(result.error).toBe(true); expect(result.account).toBe(original);
  });
  it.each([
    { reason: '   ' }, { reference: ' ' }, { confirmed: false },
    { expectedRevision: 0 }, { reason: 'x'.repeat(501) }, { reference: 'x'.repeat(121) },
  ])('rejects incomplete or stale reviews without changing state: %j', change => {
    const original = initialDemoAccounts()[2];
    const result = applyDemoAction(original, approval(change));
    expect(result.error).toBe(true); expect(result.account).toBe(original);
  });
  it('blocks review while banned and repeated approval after recovery', () => {
    expect(applyDemoAction(initialDemoAccounts()[1], approval()).error).toBe(true);
    const recovered = applyDemoAction(initialDemoAccounts()[2], approval()).account;
    const duplicate = applyDemoAction(recovered, approval({ expectedRevision: 2 }));
    expect(duplicate.error).toBe(true); expect(duplicate.account).toBe(recovered);
  });
  it('denies impossible repeated transitions without appending history', () => {
    for (const [index, type] of [[1, 'ban'], [0, 'unban'], [0, 'login'], [1, 'login']] as const) {
      const original = initialDemoAccounts()[index];
      const result = applyDemoAction(original, { type });
      expect(result.error).toBe(true); expect(result.account).toBe(original);
    }
    const signedOut = applyDemoAction(initialDemoAccounts()[0], { type: 'logout' }).account;
    expect(applyDemoAction(signedOut, { type: 'logout' }).account).toBe(signedOut);
  });
  it('keeps existing events and trims new evidence without retaining form whitespace', () => {
    const original = initialDemoAccounts()[2];
    const updated = applyDemoAction(original, approval({ reason: ' เหตุผล ', reference: ' DEMO-002 ' })).account;
    expect(updated.events[0]).toEqual(original.events[0]);
    expect(updated.events[1]).toMatchObject({ sequence: 2, reason: 'เหตุผล', reference: 'DEMO-002' });
    expect(initialDemoAccounts()[2]).toEqual(original);
  });
});
