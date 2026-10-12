import { describe, expect, it } from 'vitest';
import { parsePostBookingInput, parsePostBookingResult, parsePostBookingSnapshot, postBookingTargets, type PostBookingInput } from '../postBookingContracts';
import { pbid, pbResult, pbScope, pbSnapshot, pbTransfer } from './postBookingFixtures';

const input = (): Extract<PostBookingInput, { command: 'confirm_handover' }> => {
  const { transferDate: _date, ...common } = pbTransfer();
  return { ...common, command: 'confirm_handover', reason: 'ลูกค้ารับมอบบ้านแล้ว', handoverDate: '2026-09-23' };
};
const historical = () => {
  const s = pbSnapshot(); s.sale.stage = 'transferred'; s.sale.paymentMethod = null; s.sale.bookedAt = null;
  s.sale.importedHistory = { source: 'customer_sheet', batchId: pbid(71), sourceRow: 2, sourceStage: 'transferred',
    bookedDate: null, transferredDate: null, cancelledDate: null };
  return s;
};
const handedOver = () => {
  const s = historical(); s.sale.stage = 'handover'; s.sale.canEdit = false; s.sale.handoverDate = '2026-09-23';
  s.events = [{ id: pbid(10), command: 'confirm_handover', fromStage: 'transferred', toStage: 'handover',
    occurredAt: null, recordedAt: '2026-09-23T10:00:00+07:00', actorUserId: pbid(6), reason: 'รับมอบบ้านแล้ว', evidenceNote: null,
    loanAttemptId: null, transferDate: null, handoverDate: '2026-09-23' }];
  return s;
};

describe('handover and partial historical purchase evidence', () => {
  it('allows transferred customers to receive keys without a native Lead or known old payment method', () => {
    expect(postBookingTargets('transferred', null)).toEqual(['handover']);
    expect(parsePostBookingSnapshot(historical(), pbScope()).sale.canEdit).toBe(true);
    expect(parsePostBookingInput(input())).toEqual(input());
  });
  it.each([{ occurredAt: '2026-09-23T00:00:00+07:00' }, { evidenceNote: 'เอกสาร' }, { transferDate: '2026-09-23' },
    { leadId: pbid(90) }, { paymentMethod: 'mortgage' }, { importedHistory: {} }])('rejects invented evidence or unrelated command fields %j', patch => {
    expect(() => parsePostBookingInput({ ...input(), ...patch })).toThrow();
  });
  it.each([null, '', '2026-02-29', '2026-04-31', '0000-01-01', '2026-09-23T00:00:00Z'])('requires a real valid civil handover day %s', day => {
    expect(() => parsePostBookingInput({ ...input(), handoverDate: day })).toThrow();
  });
  it('checks handover receipt and does not invent an old transfer date', () => {
    expect(parsePostBookingResult(pbResult(input()), input()).transferDate).toBeNull();
    for (const patch of [{ handoverDate: null }, { handoverDate: '2026-09-22' }, { transferDate: '2026-09-23' },
      { loanAttemptId: pbid(9) }, { stage: 'transferred' }, { command: 'confirm_transfer' }]) {
      expect(() => parsePostBookingResult({ ...pbResult(input()), ...patch }, input())).toThrow();
    }
  });
  it('shows one day-only handover event with unknown prior dates preserved', () => {
    const snapshot = parsePostBookingSnapshot(handedOver(), pbScope());
    expect(snapshot.sale.transferDate).toBeNull(); expect(snapshot.sale.bookedAt).toBeNull();
    expect(snapshot.events[0].occurredAt).toBeNull(); expect(snapshot.events[0].handoverDate).toBe('2026-09-23');
  });
  it.each([{ occurredAt: '2026-09-23T00:00:00Z' }, { evidenceNote: 'สมมติ' }, { transferDate: '2026-09-23' },
    { handoverDate: '2026-09-24' }, { fromStage: 'booked' }, { loanAttemptId: pbid(9) }])('rejects inconsistent handover event %j', patch => {
    const s = handedOver(); Object.assign(s.events[0], patch); expect(() => parsePostBookingSnapshot(s, pbScope())).toThrow();
  });
  it('orders actual handover against known imported transfer days and respects terminal state', () => {
    const s = handedOver(); s.sale.importedHistory!.transferredDate = '2026-09-24';
    expect(() => parsePostBookingSnapshot(s, pbScope())).toThrow();
    s.sale.importedHistory!.transferredDate = null; s.sale.canEdit = true;
    expect(() => parsePostBookingSnapshot(s, pbScope())).toThrow();
  });
  it('rejects earlier imported stages hidden behind a terminal transferred display', () => {
    const s = historical(); s.sale.importedHistory!.sourceStage = 'cancelled';
    expect(() => parsePostBookingSnapshot(s, pbScope())).toThrow();
  });
});
