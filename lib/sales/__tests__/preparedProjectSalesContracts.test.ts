import { describe, expect, it } from 'vitest';
import { parsePreparedProjectSalesSnapshot, parseProjectSalesSnapshot } from '../projectSalesContracts';
import { pid, projectScope, projectSnapshot } from './projectSalesFixtures';
const scope = projectScope({ tab: 'all' });
function prepared() {
  const data = projectSnapshot(scope);
  data.actor.role = 'admin';
  data.prepared = { batchId: pid(9), snapshotDate: '2026-09-28', pendingUnlinkedHistories: 1 };
  data.rows[0] = { ...data.rows[0], bookingRound: null, historyEvidence: { sourceRow: 881,
    bookedDate: '2026-09-01', transferredDate: null, cancelledDate: null, held: false } };
  return data;
}
describe('prepared project history is separate from operational sales', () => {
  it('retains day evidence and unknown round without inventing a timestamp', () => {
    const data = prepared(), result = parsePreparedProjectSalesSnapshot(data, scope);
    expect(result).toEqual(data);
    expect(result.rows[0]).toMatchObject({ bookingRound: null, bookedAt: null, previousSaleId: null });
  });
  it('does not silently let prepared data through the live API parser', () => {
    expect(() => parseProjectSalesSnapshot(prepared(), scope)).toThrow();
    expect(() => parsePreparedProjectSalesSnapshot(projectSnapshot(scope), scope)).toThrow();
    const data = prepared(); delete data.prepared;
    expect(() => parseProjectSalesSnapshot(data, scope)).toThrow();
    data.rows[0].bookingRound = 1;
    expect(() => parseProjectSalesSnapshot(data, scope)).toThrow();
  });
  it('keeps cancelled unknown-plot history visible and explicitly held', () => {
    const data = prepared(); Object.assign(data.rows[0], { stage: 'cancelled', plotId: null, plotName: null });
    data.rows[0].historyEvidence!.held = true;
    expect(parsePreparedProjectSalesSnapshot(data, scope).rows[0].plotId).toBeNull();
    data.rows[0].historyEvidence!.held = false;
    expect(() => parsePreparedProjectSalesSnapshot(data, scope)).toThrow();
  });
  it.each(['2026-02-30', '0000-01-01', '2026-9-1', '2026-09-01T00:00:00Z', 'not-a-date'])('rejects invalid day evidence %s', day => {
    const data = prepared(); data.rows[0].historyEvidence!.bookedDate = day;
    expect(() => parsePreparedProjectSalesSnapshot(data, scope)).toThrow();
  });
  it.each([{ bookingRound: 1 }, { previousSaleId: pid(4) }, { bookedAt: '2026-09-01T00:00:00Z' },
    { cancelledAt: '2026-09-02T00:00:00Z' }, { listPrice: 0 }, { discountAmount: 0 }, { historyEvidence: undefined },
    { stage: 'contracted' }])('rejects inferred operational fields %j', override => {
    const data = prepared(); Object.assign(data.rows[0], override);
    expect(() => parsePreparedProjectSalesSnapshot(data, scope)).toThrow();
  });
  it('requires reviewed Admin-shaped preview and explicit unlinked count', () => {
    for (const role of ['sales', 'owner'] as const) {
      const data = prepared(); data.actor.role = role;
      expect(() => parsePreparedProjectSalesSnapshot(data, scope)).toThrow();
    }
    for (const count of [-1, NaN, 1.5]) {
      const data = prepared(); data.prepared!.pendingUnlinkedHistories = count;
      expect(() => parsePreparedProjectSalesSnapshot(data, scope)).toThrow();
    }
  });
  it('projects fields explicitly and rejects mixed rows', () => {
    const data = prepared();
    expect(parsePreparedProjectSalesSnapshot({ ...data, legacy_snapshot: 'PRIVATE' }, scope)).not.toHaveProperty('legacy_snapshot');
    data.rows.push(projectSnapshot(scope).rows[0]);
    expect(() => parsePreparedProjectSalesSnapshot(data, scope)).toThrow();
  });
});
