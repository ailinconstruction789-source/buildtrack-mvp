import { describe, expect, it } from 'vitest';
import { LeadWorkInputError, parseLeadWorkInput } from '../leadWorkContracts';

const ID = 'AAAAAAAA-BBBB-4000-8000-CCCCCCCCCCCC';
const setAction = {
    requestId: ID, command: 'set_next_action', customerId: ID, interestId: null, expectedActionId: null,
    nextAction: { action: ' โทรติดตาม ', dueAt: '2026-09-16T15:00:00.979649+07:00' }, reason: ' ลูกค้าขอนัดใหม่ ',
};
const attempt = { action: 'โทรสอบถามความต้องการ', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-16T10:00:00.123456+07:00' };
const recordAttempt = { ...setAction, command: 'record_attempt', attempt };

describe('lead work command input boundary', () => {
    it('canonicalizes UUIDs and text but preserves timestamp precision and offset', () => {
        expect(parseLeadWorkInput({ ...setAction, interestId: ID, expectedActionId: ID })).toEqual({
            ...setAction, requestId: ID.toLowerCase(), customerId: ID.toLowerCase(), interestId: ID.toLowerCase(), expectedActionId: ID.toLowerCase(),
            nextAction: { ...setAction.nextAction, action: 'โทรติดตาม' }, reason: 'ลูกค้าขอนัดใหม่',
        });
    });

    it('allows explicit null scope/action references and complete attempt evidence', () => {
        expect(parseLeadWorkInput(setAction)).toMatchObject({ command: 'set_next_action', interestId: null, expectedActionId: null });
        expect(parseLeadWorkInput(recordAttempt)).toMatchObject({ command: 'record_attempt', attempt });
    });

    it('does not decide current time or scope ownership from client-side context', () => {
        expect(parseLeadWorkInput({ ...recordAttempt,
            nextAction: { ...setAction.nextAction, dueAt: '1970-01-01T00:00:00Z' },
            attempt: { ...attempt, occurredAt: '2099-01-01T00:00:00.000001Z' },
        })).toMatchObject({ nextAction: { dueAt: '1970-01-01T00:00:00Z' }, attempt: { occurredAt: '2099-01-01T00:00:00.000001Z' } });
    });

    it.each(['requestId', 'command', 'customerId', 'interestId', 'expectedActionId', 'nextAction', 'reason'])('requires an own field %s even when its value may be null', key => {
        const input: Record<string, unknown> = { ...setAction };
        delete input[key];
        expect(() => parseLeadWorkInput(input)).toThrow(LeadWorkInputError);
    });

    it.each(['actor', 'role', 'ownerUserId', 'createdByUserId', 'status', 'qualified', 'kpiCredit', 'recordedAt', '__proto__'])('rejects injected authority/evidence field %s', key => {
        expect(() => parseLeadWorkInput({ ...setAction, [key]: 'attacker' })).toThrow(LeadWorkInputError);
    });

    it.each(['action', 'dueAt'])('requires exact nextAction field %s', key => {
        const next: Record<string, unknown> = { ...setAction.nextAction };
        delete next[key];
        expect(() => parseLeadWorkInput({ ...setAction, nextAction: next })).toThrow(LeadWorkInputError);
    });

    it('rejects injected nested fields, an omitted attempt, and an attempt on the wrong command', () => {
        expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, ownerUserId: ID } })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, recordedAt: attempt.occurredAt } })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, command: 'record_attempt' })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, attempt })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: undefined })).toThrow(LeadWorkInputError);
    });

    it.each(['action', 'channel', 'result', 'occurredAt'])('requires complete attempt field %s', key => {
        const incomplete: Record<string, unknown> = { ...attempt };
        delete incomplete[key];
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: incomplete })).toThrow(LeadWorkInputError);
    });

    it.each(['requestId', 'customerId', 'interestId', 'expectedActionId'])('rejects non-UUID %s', key => {
        expect(() => parseLeadWorkInput({ ...setAction, [key]: 'sales-name' })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, [key]: undefined })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, [key]: `${ID}\n` })).toThrow(LeadWorkInputError);
    });

    it.each(['\u0000', 'text\u0000value', '\u001f', '\u007f', '\u0085', 'text\u009f', '\n', '\r', '\t', '\u2028', '\u2029'])(
        'rejects controls/line separators before trimming: %j', text => {
            expect(() => parseLeadWorkInput({ ...setAction, reason: text })).toThrow(LeadWorkInputError);
            expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, action: text } })).toThrow(LeadWorkInputError);
            expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, action: text } })).toThrow(LeadWorkInputError);
        },
    );

    it.each(['\ud800', '\udfff', 'text\ud800value', 'text\udfffvalue'])('rejects lone surrogates accepted by JSON.parse: %j', text => {
        const fromJson: string = JSON.parse(JSON.stringify(text));
        expect(() => parseLeadWorkInput({ ...setAction, reason: fromJson })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, action: fromJson } })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, action: fromJson } })).toThrow(LeadWorkInputError);
    });

    it('preserves valid surrogate-pair emoji in every text field', () => {
        const text = '🏠 นัดชมบ้าน 😊';
        expect(parseLeadWorkInput({ ...recordAttempt, reason: text, nextAction: { ...setAction.nextAction, action: text }, attempt: { ...attempt, action: text } }))
            .toMatchObject({ reason: text, nextAction: { action: text }, attempt: { action: text } });
    });

    it('enforces nonempty single-line Unicode code-point length bounds', () => {
        expect(parseLeadWorkInput({ ...setAction, reason: 'ก'.repeat(1000), nextAction: { ...setAction.nextAction, action: '🏠'.repeat(500) } })).toBeDefined();
        expect(() => parseLeadWorkInput({ ...setAction, reason: 'ก'.repeat(1001) })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, reason: '   ' })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, action: '🏠'.repeat(501) } })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, action: 'a'.repeat(501) } })).toThrow(LeadWorkInputError);
    });

    it.each(['2026-02-29T09:00:00Z', '2026-04-31T09:00:00Z', '2026-09-16', '2026-09-16T09:00:00',
        '2026-09-16T24:00:00Z', '2026-09-16T09:00:00.1234567Z', '2026-09-16T09:00:00-00:00', '', null])(
        'rejects invalid/ambiguous due or occurred timestamp %j', timestamp => {
            expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, dueAt: timestamp } })).toThrow(LeadWorkInputError);
            expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, occurredAt: timestamp } })).toThrow(LeadWorkInputError);
        },
    );

    it.each(['\n', '\r', '\r\n', '\u2028', '\u2029', ' ', '\t', '\u0085', '\u0000'])(
        'rejects final whitespace/control %j instead of accepting the regex end-anchor position', suffix => {
            expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, dueAt: `${setAction.nextAction.dueAt}${suffix}` } })).toThrow(LeadWorkInputError);
            expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, occurredAt: `${attempt.occurredAt}${suffix}` } })).toThrow(LeadWorkInputError);
        },
    );

    it('rejects surrounding spaces rather than silently normalizing timestamp input', () => {
        expect(() => parseLeadWorkInput({ ...setAction, nextAction: { ...setAction.nextAction, dueAt: ` ${setAction.nextAction.dueAt} ` } })).toThrow(LeadWorkInputError);
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, occurredAt: ` ${attempt.occurredAt} ` } })).toThrow(LeadWorkInputError);
    });

    it.each(['phone', 'chat', 'email', 'in_person', 'other'])('accepts contract channel %s', channel => {
        expect(parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, channel } })).toMatchObject({ attempt: { channel } });
    });

    it.each(['contact_success', 'no_answer', 'customer_requested_later', 'other'])('accepts contract result %s without inferring qualification', result => {
        expect(parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, result } })).toMatchObject({ attempt: { result } });
    });

    it.each([{ channel: 'call' }, { channel: '' }, { channel: ['phone'] }, { result: 'done' }, { result: 'unknown' }, { result: null }])('rejects invalid attempt enums %j', change => {
        expect(() => parseLeadWorkInput({ ...recordAttempt, attempt: { ...attempt, ...change } })).toThrow(LeadWorkInputError);
    });

    it.each([null, [], 'text', 123, {}, { ...setAction, command: 'qualify' }, { ...setAction, reason: false }, { ...setAction, nextAction: null }])('rejects malformed input %j', input => {
        expect(() => parseLeadWorkInput(input)).toThrow(LeadWorkInputError);
    });

    it('does not mutate frozen input or accept inherited required fields', () => {
        const input = Object.freeze({ ...setAction, nextAction: Object.freeze({ ...setAction.nextAction }) });
        const before = JSON.stringify(input);
        parseLeadWorkInput(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(() => parseLeadWorkInput(Object.create(setAction))).toThrow(LeadWorkInputError);
    });
});
