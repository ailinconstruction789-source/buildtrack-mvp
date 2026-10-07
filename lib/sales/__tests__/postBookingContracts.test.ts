import { describe, expect, it } from 'vitest';
import { parsePostBookingInput, parsePostBookingPageQuery, parsePostBookingQuery, parsePostBookingResult, parsePostBookingSnapshot, postBookingTargets, parseTransferDate, displayTransferDate, bangkokDateFromTimestamp } from '../postBookingContracts';
import { pbAttempt, pbid, pbInput, pbLoanResult, pbResult, pbScope, pbSnapshot, pbSubmit, pbTransfer } from './postBookingFixtures';
import { SALE_STAGES, validateSaleTransition, type SaleStage } from '../workflow';

describe('post-booking contracts (not write authorization)', () => {
  it.each([pbInput(), pbSubmit(), pbLoanResult()])('projects exact command %j preserving microseconds', input => {
    expect(parsePostBookingInput(input)).toEqual(input); expect(parsePostBookingResult(pbResult(input), input)).toEqual(pbResult(input));
  });
  it.each([{ role: 'admin' }, { nextStage: 'transferred' }, { nextStage: 'handover' }, { command: 'cancel' }, { reason: '' },
    { evidenceNote: '' }, { evidenceNote: 'a\nb' }, { occurredAt: '2026-02-29T10:00:00Z' }, { occurredAt: '2026-09-23T10:00' },
    { occurredAt: '2026-09-23T10:00:00-00:00' }, { occurredAt: '2026-09-23T10:00:00.1234567Z' }, { expectedInterestRevision: null }])('rejects invalid/unapproved input %j', patch => {
    expect(() => parsePostBookingInput({ ...pbInput(), ...patch })).toThrow();
  });
  it.each([null, 0, -1, 1.1, 100000000000, '10000', NaN, Infinity])('approval requires positive bounded integer satang %j', amount => {
    expect(() => parsePostBookingInput({ ...pbLoanResult(), approvedAmountSatang: amount })).toThrow();
  });
  it('rejection has no approved money and a submission has an explicit bank', () => {
    const rejected = { ...pbLoanResult(), result: 'rejected', approvedAmountSatang: null };
    expect(parsePostBookingInput(rejected)).toEqual(rejected);
    expect(() => parsePostBookingInput({ ...rejected, approvedAmountSatang: 0 })).toThrow();
    expect(() => parsePostBookingInput({ ...pbSubmit(), bankName: ' ' })).toThrow();
  });
  it('requires sale scope, two independent pages, no role or customer overrides', () => {
    expect(parsePostBookingQuery(`https://test.invalid/?saleId=${pbid(1)}`)).toEqual(pbScope());
    expect(parsePostBookingPageQuery({ saleId: pbid(1) })).toBe(pbid(1));
    for (const query of ['&attemptPage=-1', '&eventPage=01', '&role=admin', `&saleId=${pbid(2)}`]) expect(() => parsePostBookingQuery(`https://test.invalid/?saleId=${pbid(1)}${query}`)).toThrow();
    expect(() => parsePostBookingPageQuery({ saleId: [pbid(1)] })).toThrow();
    expect(() => parsePostBookingPageQuery({ saleId: pbid(1), eventPage: '1' })).toThrow();
  });
  it.each([{ requestId: pbid(90) }, { saleId: pbid(90) }, { customerId: pbid(90) }, { command: 'submit_loan' },
    { stage: 'transferred' }, { loanAttemptId: pbid(9) }, { saleRevision: pbid(3) }])('binds receipts to exact input %j', patch => {
    expect(() => parsePostBookingResult({ ...pbResult(), ...patch }, pbInput())).toThrow();
  });
  it('offers final transfer only from pending, no handover/cancel or mortgage shortcut, matching domain rules', () => {
    expect(postBookingTargets('contracted', 'mortgage')).not.toContain('transfer_pending');
    expect(postBookingTargets('loan_rejected', 'mortgage')).toEqual(['loan_submitted']);
    for (const stage of SALE_STAGES) for (const method of ['cash', 'mortgage', null] as const) {
      const targets = postBookingTargets(stage, method);
      if (stage !== 'transfer_pending' || method === null) expect(targets).not.toContain('transferred');
      else expect(targets).toEqual(['transferred']);
      expect(targets).not.toContain('cancelled'); expect(targets).not.toContain('handover');
      if (method === null) { expect(targets).toEqual([]); continue; }
      for (const nextStage of targets) {
        const result = validateSaleTransition({ actor: { userId: pbid(6), role: 'sales', active: true },
          interest: { id: pbid(5), customerId: pbid(2), projectName: 'A', ownerUserId: pbid(6), workspaceState: 'project_active', engagementStatus: 'considering' },
          sale: { id: pbid(1), interestId: pbid(5), plotId: 'A1', stage, paymentMethod: method }, nextStage, reason: 'ทดสอบ',
          loanHistory: stage === 'loan_rejected' ? [{ id: pbid(91), saleId: pbid(1), attemptNumber: 1, status: 'rejected' }] : [],
          newLoanAttempt: nextStage === 'loan_submitted' ? { id: pbid(92), saleId: pbid(1), attemptNumber: stage === 'loan_rejected' ? 2 : 1, status: 'submitted' } : undefined });
        expect(result.ok).toBe(true);
      }
    }
  });
  it('projects a safe snapshot and keeps unknown legacy evidence null', () => {
    const data = pbSnapshot(); data.sale.bookedAt = null;
    expect(parsePostBookingSnapshot({ ...data, privateIncome: 9999 }, pbScope())).toEqual(data);
    data.sale.paymentMethod = null; data.sale.canEdit = false;
    expect(parsePostBookingSnapshot(data, pbScope()).sale.paymentMethod).toBeNull();
  });
  it('rejects actor/ownership editing claims and cross-sale attempt relations', () => {
    for (const stage of ['cancelled', 'transferred', 'handover'] as SaleStage[]) {
      const data = pbSnapshot(); data.sale.stage = stage; expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
    }
    const data = pbSnapshot(); data.actor.role = 'owner'; expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
    data.actor.role = 'sales'; data.sale.ownerUserId = pbid(93); expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
    data.sale.canEdit = false; data.attempts = [pbAttempt({ saleId: pbid(94) })]; data.latestAttempt = data.attempts[0];
    expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
  });
  it('rejects mismatched latest attempt, duplicates, chronology and pagination', () => {
    const data = pbSnapshot(); data.latestAttempt = pbAttempt(); data.attempts = [pbAttempt()];
    expect(parsePostBookingSnapshot(data, pbScope())).toEqual(data);
    data.latestAttempt.status = 'approved'; expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
    data.latestAttempt = data.attempts[0]; data.attemptsHasMore = true; expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
    data.attemptsHasMore = false; data.attempts.push(data.attempts[0]); expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
    data.attempts = [pbAttempt({ resultAt: '2026-09-22T00:00:00Z' })]; data.latestAttempt = data.attempts[0]; expect(() => parsePostBookingSnapshot(data, pbScope())).toThrow();
  });
  it('accepts an actual calendar transfer day without time or document evidence', () => {
    const input = pbTransfer(); expect(parsePostBookingInput(input)).toEqual(input);
    expect(input).not.toHaveProperty('occurredAt'); expect(input).not.toHaveProperty('evidenceNote');
    expect(parsePostBookingResult(pbResult(input), input)).toEqual(pbResult(input));
    for (const patch of [{ occurredAt: '2026-09-23T00:00:00+07:00' }, { evidenceNote: '' }, { documentRef: 'X' }, { reason: '' }]) {
      expect(() => parsePostBookingInput({ ...input, ...patch })).toThrow();
    }
    for (const patch of [{ transferDate: null }, { transferDate: '2026-09-22' }, { loanAttemptId: pbid(9) }, { stage: 'transfer_pending' }]) {
      expect(() => parsePostBookingResult({ ...pbResult(input), ...patch }, input)).toThrow();
    }
  });
  it.each(['', '2026-2-01', '2026-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '10000-01-01', '2026-09-23T00:00:00Z', '2026-09-23 ', '23/09/2026'])('rejects invalid transfer date %s', transferDate => {
    expect(() => parseTransferDate(transferDate)).toThrow(); expect(() => parsePostBookingInput({ ...pbTransfer(), transferDate })).toThrow();
  });
  it.each(['2000-02-29', '2024-02-29', '0001-01-01', '9999-12-31'])('preserves valid transfer date %s exactly', value => {
    expect(parseTransferDate(value)).toBe(value);
  });
  it('formats a date without fabricating a clock, and compares dates using Bangkok boundaries', () => {
    expect(displayTransferDate('2026-09-23')).toBe('23 ก.ย. 2569'); expect(displayTransferDate(null)).toBe('ไม่ทราบวันโอน');
    expect(bangkokDateFromTimestamp('2026-09-22T16:59:59.999999Z')).toBe('2026-09-22');
    expect(bangkokDateFromTimestamp('2026-09-22T17:00:00Z')).toBe('2026-09-23');
    expect(bangkokDateFromTimestamp('1969-12-31T16:59:59.999999Z')).toBe('1969-12-31');
  });
  it('keeps date-only transfer events distinct from recorded time and legacy unknown transfers', () => {
    const snapshot = pbSnapshot(); snapshot.sale.stage = 'transferred'; snapshot.sale.canEdit = false;
    expect(parsePostBookingSnapshot(snapshot, pbScope()).sale.transferDate).toBeNull();
    snapshot.sale.transferDate = '2026-09-23';
    snapshot.events = [{ id: pbid(10), command: 'confirm_transfer', fromStage: 'transfer_pending', toStage: 'transferred',
      occurredAt: null, recordedAt: '2026-09-22T17:00:00Z', actorUserId: pbid(6), reason: 'โอนจริง', evidenceNote: null, loanAttemptId: null, transferDate: '2026-09-23' }];
    expect(parsePostBookingSnapshot(snapshot, pbScope())).toEqual(snapshot);
    for (const patch of [{ occurredAt: '2026-09-23T00:00:00+07:00' }, { evidenceNote: 'เลขเอกสาร' }, { transferDate: '2026-09-24' }, { fromStage: 'booked' }]) {
      expect(() => parsePostBookingSnapshot({ ...snapshot, events: [{ ...snapshot.events[0], ...patch }] }, pbScope())).toThrow();
    }
    snapshot.sale.transferDate = '2026-09-21'; expect(() => parsePostBookingSnapshot(snapshot, pbScope())).toThrow();
  });
});
