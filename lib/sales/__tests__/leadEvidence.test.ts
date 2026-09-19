import { describe, expect, it } from 'vitest';
import {
    evaluateQualification, parseEvidenceTimestamp, validateAttemptLog, validateNextAction,
    type AttemptLogEvidence, type EvidenceContext, type EvidenceScope, type NextActionEvidence,
    type PreliminaryLoanReadinessEvidence, type QualificationEvidence,
} from '../leadEvidence';

const scope: EvidenceScope = { kind: 'customer', customerId: 'customer-1' };
const interestScope: EvidenceScope = { kind: 'interest', customerId: 'customer-1', interestId: 'interest-a' };
const context: EvidenceContext = { scope, owner: { userId: 'sales-1', role: 'sales', active: true }, asOf: '2026-09-16T12:00:00+07:00' };
const stamp = { id: 'evidence-1', scope, recordedByUserId: 'recorder-1', occurredAt: '2026-09-16T09:00:00+07:00', recordedAt: '2026-09-16T09:10:00+07:00' };
const action: NextActionEvidence = { ...stamp, id: 'action-1', ownerUserId: 'sales-1', action: 'โทรติดตามความต้องการ', dueAt: '2026-09-16T14:00:00+07:00', status: 'open' };
const contact: AttemptLogEvidence = { ...stamp, id: 'contact-1', performedByUserId: 'sales-1', action: 'สอบถามความต้องการ', channel: 'โทร', result: 'contact_success' };
const loan: PreliminaryLoanReadinessEvidence = { ...stamp, id: 'readiness-1', state: 'known', summary: 'บันทึกข้อมูลรายได้และเอกสารที่ต้องเตรียมแล้ว ยังไม่ใช่การอนุมัติกู้' };
const qualified: QualificationEvidence = {
    ...stamp, id: 'qualification-1', contact, genuineInterest: true, projectName: null,
    needs: 'ต้องการบ้านใกล้ที่ทำงาน', budget: 2_000_000, loanReadiness: null,
    stage: { code: 'following_up', activity: 'active' }, nextAction: action,
};

describe('strict evidence timestamps', () => {
    it('normalizes explicit offsets without a local machine timezone', () => {
        expect(parseEvidenceTimestamp('2026-09-16T12:00:00+07:00')).toBe(parseEvidenceTimestamp('2026-09-16T05:00:00Z'));
        expect(parseEvidenceTimestamp('2026-09-16T01:00:00-04:00')).toBe(parseEvidenceTimestamp('2026-09-16T05:00:00Z'));
        expect(parseEvidenceTimestamp('2024-02-29T00:00:00.123Z')).toBe(BigInt(Date.UTC(2024, 1, 29, 0, 0, 0, 123)) * BigInt(1000));
        expect(parseEvidenceTimestamp('2000-02-29T00:00:00Z')).not.toBeNull();
        expect(parseEvidenceTimestamp('0099-01-01T00:00:00Z')).toBe(BigInt(Date.parse('0099-01-01T00:00:00Z')) * BigInt(1000));
    });

    it('preserves all six PostgreSQL fractional digits and equivalent offsets exactly', () => {
        const base = BigInt(Date.UTC(2026, 8, 16, 5)) * BigInt(1000);
        expect(parseEvidenceTimestamp('2026-09-16T05:00:00.979649+00:00')).toBe(base + BigInt(979649));
        expect(parseEvidenceTimestamp('2026-09-16T12:00:00.979649+07:00')).toBe(base + BigInt(979649));
        expect(parseEvidenceTimestamp('2026-09-16T01:00:00.979649-04:00')).toBe(base + BigInt(979649));
        expect(parseEvidenceTimestamp('2026-09-16T05:00:00.000001Z')).toBe(base + BigInt(1));
        expect(parseEvidenceTimestamp('2026-09-16T05:00:00.1Z')).toBe(base + BigInt(100000));
        expect(parseEvidenceTimestamp('1969-12-31T23:59:59.999999Z')).toBe(BigInt(-1));
        expect(parseEvidenceTimestamp('2024-02-29T23:59:59.999999-01:00')).toBe(parseEvidenceTimestamp('2024-03-01T00:59:59.999999Z'));
    });

    it.each([
        null, undefined, 123, '', '2026-09-16', '2026-09-16T12:00:00', '2026-09-16 12:00:00Z',
        '2026-02-29T12:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T12:00:00Z',
        '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-09-00T00:00:00Z',
        '2026-09-16T24:00:00Z', '2026-09-16T12:60:00Z', '2026-09-16T12:00:60Z',
        '2026-09-16T12:00:00+24:00', '2026-09-16T12:00:00+07:60', '2026-09-16T12:00:00-00:00',
        '2026-09-16T12:00:00.1234567Z', '0000-01-01T00:00:00Z', '2026-09-16T12:00:00Z ',
    ])('rejects noncalendar/ambiguous timestamp %j', value => {
        expect(parseEvidenceTimestamp(value)).toBeNull();
    });
});

describe('structured next action evidence', () => {
    it('accepts an open central next action without a project', () => {
        expect(validateNextAction(action, context)).toEqual({ status: 'valid', value: { timing: 'scheduled' } });
    });

    it('retains past-due evidence as overdue instead of changing or hiding its due date', () => {
        const overdue = { ...action, dueAt: '2026-09-15T12:00:00+07:00' };
        expect(validateNextAction(overdue, context)).toEqual({ status: 'valid', value: { timing: 'overdue' } });
        expect(overdue.dueAt).toBe('2026-09-15T12:00:00+07:00');
        expect(validateNextAction({ ...action, dueAt: context.asOf }, context)).toEqual({ status: 'valid', value: { timing: 'scheduled' } });
    });

    it('accepts a next action belonging to the exact interest scope', () => {
        expect(validateNextAction({ ...action, scope: interestScope }, { ...context, scope: interestScope }).status).toBe('valid');
    });

    it.each([null, undefined])('treats missing legacy action %j as unknown evidence', value => {
        expect(validateNextAction(value, context).status).toBe('needs_evidence');
    });

    it.each(['id', 'action', 'ownerUserId', 'recordedByUserId', 'occurredAt', 'recordedAt', 'dueAt', 'status'] as const)('requires %s', field => {
        expect(validateNextAction({ ...action, [field]: '' } as NextActionEvidence, context).status).toBe('needs_evidence');
    });

    it.each(['done', 'cancelled'] as const)('does not use a %s task as the current next action', status => {
        expect(validateNextAction({ ...action, status }, context).status).toBe('needs_evidence');
    });

    it.each([
        { scope: { kind: 'customer', customerId: 'customer-2' } },
        { scope: interestScope }, { ownerUserId: 'sales-2' }, { dueAt: '2026-02-30T12:00:00Z' },
        { scope: { kind: 'customer', customerId: 'customer-1', interestId: 'hidden-interest' } },
    ])('rejects foreign scope, owner, or malformed due: %j', change => {
        expect(validateNextAction({ ...action, ...change } as NextActionEvidence, context).status).toBe('invalid');
    });

    it('does not let an appointment for interest A cover interest B', () => {
        expect(validateNextAction({ ...action, scope: interestScope }, {
            ...context, scope: { ...interestScope, interestId: 'interest-b' },
        }).status).toBe('invalid');
    });

    it.each([
        { occurredAt: '2026-09-16T09:11:00+07:00' },
        { occurredAt: '2026-09-17T09:00:00+07:00', recordedAt: '2026-09-17T09:10:00+07:00' },
        { recordedAt: '2026-09-16T12:00:01+07:00' },
    ])('rejects reversed or future observation times: %j', change => {
        expect(validateNextAction({ ...action, ...change }, context).status).toBe('invalid');
    });

    it.each([
        { role: 'admin' }, { role: 'owner' }, { active: false }, { active: 'true' },
    ])('does not silently accept non-active-Sales owner evidence: %j', change => {
        expect(validateNextAction(action, { ...context, owner: { ...context.owner, ...change } } as EvidenceContext).status).toBe('invalid');
    });

    it('needs the owner and scope to be known, not inferred from the action', () => {
        expect(validateNextAction(action, { ...context, owner: null } as unknown as EvidenceContext).status).toBe('needs_evidence');
        expect(validateNextAction(action, { ...context, scope: null } as unknown as EvidenceContext).status).toBe('needs_evidence');
        expect(validateNextAction(action, { ...context, scope: { customerId: 'customer-1' } } as unknown as EvidenceContext).status).toBe('needs_evidence');
    });

    it('compares due dates at microsecond precision without resetting overdue evidence', () => {
        const preciseContext = { ...context, asOf: '2026-09-16T12:00:00.000002+07:00' };
        expect(validateNextAction({ ...action, dueAt: '2026-09-16T12:00:00.000001+07:00' }, preciseContext))
            .toEqual({ status: 'valid', value: { timing: 'overdue' } });
        expect(validateNextAction({ ...action, dueAt: preciseContext.asOf }, preciseContext))
            .toEqual({ status: 'valid', value: { timing: 'scheduled' } });
    });
});

describe('attempt log evidence', () => {
    it('distinguishes successful contact from complete effort that received no answer', () => {
        expect(validateAttemptLog(contact, context)).toEqual({ status: 'valid', value: { successfulContact: true } });
        expect(validateAttemptLog({ ...contact, result: 'no_answer' }, context)).toEqual({ status: 'valid', value: { successfulContact: false } });
    });

    it.each(['id', 'action', 'channel', 'result', 'performedByUserId', 'recordedByUserId', 'occurredAt', 'recordedAt'] as const)('requires complete %s', field => {
        expect(validateAttemptLog({ ...contact, [field]: '' } as AttemptLogEvidence, context).status).toBe('needs_evidence');
    });

    it('keeps unknown result and absent historical log as missing evidence', () => {
        expect(validateAttemptLog({ ...contact, result: 'unknown' }, context).status).toBe('needs_evidence');
        expect(validateAttemptLog(null, context).status).toBe('needs_evidence');
    });

    it.each([
        { scope: { kind: 'customer', customerId: 'customer-2' } },
        { scope: interestScope }, { result: 'done' }, { result: ['no_answer'] }, { channel: 123 },
        { occurredAt: '2026-09-16T09:00:00' }, { occurredAt: '2026-02-30T09:00:00Z' },
        { recordedAt: '2026-09-16T08:59:59+07:00' }, { recordedAt: '2026-09-17T00:00:00Z' },
    ])('rejects inconsistent/malformed attempts: %j', change => {
        expect(validateAttemptLog({ ...contact, ...change } as AttemptLogEvidence, context).status).toBe('invalid');
    });

    it('rejects one-microsecond reversed or future event times without truncation', () => {
        expect(validateAttemptLog({ ...contact, occurredAt: '2026-09-16T09:00:00.000002+07:00', recordedAt: '2026-09-16T09:00:00.000001+07:00' }, context).status).toBe('invalid');
        const preciseContext = { ...context, asOf: '2026-09-16T12:00:00.000001+07:00' };
        expect(validateAttemptLog({ ...contact, recordedAt: '2026-09-16T12:00:00.000002+07:00' }, preciseContext).status).toBe('invalid');
        expect(validateAttemptLog({ ...contact, recordedAt: preciseContext.asOf }, preciseContext).status).toBe('valid');
    });
});

describe('qualification evidence completeness, not KPI credit', () => {
    it('qualifies needs-only central work with successful contact, budget, active stage and next action', () => {
        expect(evaluateQualification(qualified, context)).toEqual({
            status: 'qualified', qualificationEvidenceId: 'qualification-1', contactEvidenceId: 'contact-1', nextActionTiming: 'scheduled',
        });
    });

    it('can use a selected project instead of a needs note', () => {
        expect(evaluateQualification({ ...qualified, projectName: 'โครงการ A', needs: null }, context).status).toBe('qualified');
    });

    it('can use evidenced preliminary loan readiness instead of a budget, without claiming bank approval', () => {
        expect(evaluateQualification({ ...qualified, budget: null, loanReadiness: loan }, context).status).toBe('qualified');
        expect(evaluateQualification({ ...qualified, budget: 0, loanReadiness: loan }, context).status).toBe('qualified');
    });

    it('retains overdue next-action evidence when qualification facts are otherwise complete', () => {
        expect(evaluateQualification({ ...qualified, nextAction: { ...action, dueAt: '2026-09-15T12:00:00+07:00' } }, context)).toMatchObject({ status: 'qualified', nextActionTiming: 'overdue' });
    });

    it.each([null, undefined, { name: 'ลูกค้า', phone: '0812345678' }])('does not qualify intake or unknown legacy evidence %j', value => {
        expect(evaluateQualification(value as QualificationEvidence | null | undefined, context).status).toBe('needs_evidence');
    });

    it.each([
        { contact: null }, { contact: { ...contact, result: 'no_answer' } }, { contact: { ...contact, result: 'unknown' } },
        { contact: { ...contact, channel: '' } }, { genuineInterest: null }, { genuineInterest: false },
        { projectName: null, needs: ' ' }, { budget: 0 }, { budget: null },
        { budget: null, loanReadiness: { ...loan, state: 'unknown' } },
        { budget: null, loanReadiness: { ...loan, summary: '' } },
        { budget: null, loanReadiness: { ...loan, recordedByUserId: '' } },
        { stage: null }, { stage: { code: '', activity: 'active' } },
        { stage: { code: 'legacy_unclassified', activity: 'unknown' } }, { stage: { code: 'closed', activity: 'inactive' } },
        { nextAction: null }, { nextAction: { ...action, dueAt: '' } }, { nextAction: { ...action, status: 'cancelled' } },
    ])('needs evidence when qualification facts are incomplete: %j', change => {
        expect(evaluateQualification({ ...qualified, ...change } as QualificationEvidence, context).status).toBe('needs_evidence');
    });

    it.each([
        { budget: NaN }, { budget: Infinity }, { budget: -1 }, { budget: '2000000' }, { genuineInterest: 'yes' },
        { contact: { ...contact, scope: { kind: 'customer', customerId: 'customer-2' } } },
        { contact: { ...contact, scope: interestScope } },
        { loanReadiness: { ...loan, scope: { kind: 'customer', customerId: 'customer-2' } } },
        { nextAction: { ...action, ownerUserId: 'sales-2' } },
        { stage: { code: 'new', activity: 'yes' } }, { occurredAt: '2026-02-29T00:00:00Z' },
        { recordedAt: '2026-09-16T08:59:59+07:00' }, { recordedAt: '2026-09-17T00:00:00Z' },
    ])('rejects inconsistent or malformed qualification evidence: %j', change => {
        expect(evaluateQualification({ ...qualified, ...change } as QualificationEvidence, context).status).toBe('invalid');
    });

    it('validates complete interest scope independently of customer-level scope', () => {
        const evidence = { ...qualified, scope: interestScope, contact: { ...contact, scope: interestScope }, nextAction: { ...action, scope: interestScope } };
        expect(evaluateQualification(evidence, { ...context, scope: interestScope }).status).toBe('qualified');
        expect(evaluateQualification(evidence, context).status).toBe('invalid');
    });

    it.each(['contact', 'loanReadiness', 'nextAction'] as const)('cannot use later %s facts to establish a backdated assessment', field => {
        const supporting = field === 'contact' ? contact : field === 'loanReadiness' ? loan : action;
        const late = { ...supporting, occurredAt: '2026-09-16T10:00:00+07:00', recordedAt: '2026-09-16T10:10:00+07:00' };
        expect(evaluateQualification({ ...qualified, [field]: late }, context)).toMatchObject({ status: 'invalid', issues: expect.arrayContaining([
            { code: 'TIME_ORDER', field: `${field}.occurredAt` }, { code: 'TIME_ORDER', field: `${field}.recordedAt` },
        ]) });
    });

    it.each(['contact', 'loanReadiness', 'nextAction'] as const)('rejects %s recorded after the assessment even if it occurred earlier', field => {
        const supporting = field === 'contact' ? contact : field === 'loanReadiness' ? loan : action;
        const late = { ...supporting, recordedAt: '2026-09-16T09:10:00.000001+07:00' };
        expect(evaluateQualification({ ...qualified, [field]: late }, context)).toMatchObject({ status: 'invalid', issues: expect.arrayContaining([
            { code: 'TIME_ORDER', field: `${field}.recordedAt` },
        ]) });
    });

    it('rejects support that occurs just one microsecond after the assessment', () => {
        expect(evaluateQualification({ ...qualified, contact: { ...contact, occurredAt: '2026-09-16T09:00:00.000001+07:00' } }, context))
            .toMatchObject({ status: 'invalid', issues: expect.arrayContaining([{ code: 'TIME_ORDER', field: 'contact.occurredAt' }]) });
    });

    it('accepts support available exactly at the assessment and leaves future task due dates intact', () => {
        expect(evaluateQualification({ ...qualified, loanReadiness: loan }, context).status).toBe('qualified');
        expect(action.dueAt).toBe('2026-09-16T14:00:00+07:00');
    });

    it.each(['\u0000', 'use\u0000less', '\u001f', 'text\u007f', '\u0085', 'text\u009f', '\n', 'text\tvalue'])(
        'rejects C0/C1 text throughout evidence fields without cleaning it into valid data: %j', text => {
            expect(validateNextAction({ ...action, id: text }, context).status).toBe('invalid');
            expect(validateNextAction({ ...action, action: text }, context).status).toBe('invalid');
            expect(validateAttemptLog({ ...contact, channel: text }, context).status).toBe('invalid');
            expect(validateAttemptLog({ ...contact, performedByUserId: text }, context).status).toBe('invalid');
            expect(validateAttemptLog({ ...contact, scope: { ...scope, customerId: text } }, context).status).toBe('invalid');
            expect(evaluateQualification({ ...qualified, needs: text }, context).status).toBe('invalid');
            expect(evaluateQualification({ ...qualified, projectName: text }, context).status).toBe('invalid');
            expect(evaluateQualification({ ...qualified, budget: null, loanReadiness: { ...loan, summary: text } }, context).status).toBe('invalid');
            expect(evaluateQualification({ ...qualified, loanReadiness: { ...loan, state: 'unknown', summary: text } }, context).status).toBe('invalid');
            expect(evaluateQualification({ ...qualified, stage: { code: text, activity: 'active' } }, context).status).toBe('invalid');
            const unchanged = { ...qualified, needs: text };
            evaluateQualification(unchanged, context);
            expect(unchanged.needs).toBe(text);
        },
    );

    it.each([false, 1, [], 'unknown'])('rejects malformed runtime evidence %j without throwing', value => {
        expect(evaluateQualification(value as unknown as QualificationEvidence, context).status).toBe('invalid');
        expect(validateNextAction(value as unknown as NextActionEvidence, context).status).toBe('invalid');
        expect(validateAttemptLog(value as unknown as AttemptLogEvidence, context).status).toBe('invalid');
    });

    it('rejects malformed nested objects and context without silently succeeding', () => {
        expect(evaluateQualification({ ...qualified, nextAction: true } as unknown as QualificationEvidence, context).status).toBe('invalid');
        expect(evaluateQualification(qualified, { ...context, asOf: '2026-02-30T12:00:00Z' }).status).toBe('invalid');
        expect(evaluateQualification(qualified, null as unknown as EvidenceContext).status).toBe('needs_evidence');
    });

    it('does not mutate frozen evidence, assign credit or update any scope/status', () => {
        function freeze<T>(value: T): T {
            if (value && typeof value === 'object') {
                Object.values(value).forEach(freeze);
                Object.freeze(value);
            }
            return value;
        }
        const evidence = freeze(structuredClone(qualified));
        const trustedContext = freeze(structuredClone(context));
        const before = JSON.stringify({ evidence, trustedContext });
        evaluateQualification(evidence, trustedContext);
        validateAttemptLog(evidence.contact, trustedContext);
        validateNextAction(evidence.nextAction, trustedContext);
        expect(JSON.stringify({ evidence, trustedContext })).toBe(before);
        expect(evaluateQualification(evidence, trustedContext)).not.toHaveProperty('credit');
        expect(evaluateQualification(evidence, trustedContext)).not.toHaveProperty('score');
    });
});
