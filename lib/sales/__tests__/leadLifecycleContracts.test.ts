import { describe, expect, it } from 'vitest';
import { LeadLifecycleInputError, parseLeadLifecycleInput } from '../leadLifecycleContracts';

const ID = 'AAAAAAAA-BBBB-4000-8000-CCCCCCCCCCCC';
const close = {
    requestId: ID, command: 'close_lost', customerId: ID, interestId: null,
    expectedRevision: ID, expectedActionId: null, reason: ' ลูกค้าแจ้งว่าไม่สนใจแล้ว ',
};
const reassign = { ...close, command: 'reassign_owner', newOwnerUserId: ID };

describe('lifecycle command input contract', () => {
    it('canonicalizes IDs and trims the reason without mutating the input', () => {
        const original = Object.freeze({ ...reassign, interestId: ID, expectedActionId: ID });
        expect(parseLeadLifecycleInput(original)).toEqual({
            ...original, requestId: ID.toLowerCase(), customerId: ID.toLowerCase(), interestId: ID.toLowerCase(),
            expectedRevision: ID.toLowerCase(), expectedActionId: ID.toLowerCase(), newOwnerUserId: ID.toLowerCase(), reason: close.reason.trim(),
        });
        expect(original.reason).toBe(close.reason);
        expect(original.newOwnerUserId).toBe(ID);
    });

    it('keeps explicit central scope and absent action as null', () => {
        expect(parseLeadLifecycleInput(close)).toMatchObject({ command: 'close_lost', interestId: null, expectedActionId: null });
        expect(parseLeadLifecycleInput(reassign)).toMatchObject({ command: 'reassign_owner', newOwnerUserId: ID.toLowerCase() });
    });

    it('does not invent authorization, target eligibility or state from IDs', () => {
        // Actor, ownership, active Sales, current revision/action and booking state are DB checks.
        expect(parseLeadLifecycleInput({ ...reassign, customerId: ID, newOwnerUserId: ID })).toMatchObject({ newOwnerUserId: ID.toLowerCase() });
    });

    it.each(['requestId', 'command', 'customerId', 'interestId', 'expectedRevision', 'expectedActionId', 'reason', 'newOwnerUserId'])('requires own field %s', key => {
        const input: Record<string, unknown> = { ...reassign };
        delete input[key];
        expect(() => parseLeadLifecycleInput(input)).toThrow(LeadLifecycleInputError);
        expect(() => parseLeadLifecycleInput(Object.assign(Object.create({ [key]: reassign[key as keyof typeof reassign] }), input))).toThrow(LeadLifecycleInputError);
    });

    it.each(['actor', 'role', 'ownerUserId', 'createdByUserId', 'status', 'intakeStatus', 'recordedAt', 'dueAt', 'asOf', 'nextAction', 'kpiCredit', 'legacy_source_lead_id', '__proto__'])('rejects injected field %s', key => {
        expect(() => parseLeadLifecycleInput({ ...close, [key]: 'untrusted' })).toThrow(LeadLifecycleInputError);
        expect(() => parseLeadLifecycleInput({ ...reassign, [key]: 'untrusted' })).toThrow(LeadLifecycleInputError);
    });

    it('forbids a target owner on close_lost', () => {
        expect(() => parseLeadLifecycleInput({ ...close, newOwnerUserId: ID })).toThrow(LeadLifecycleInputError);
    });

    it.each([undefined, null, [], 'close_lost', 0, true, {}, new Date()])('rejects malformed root %j', value => {
        expect(() => parseLeadLifecycleInput(value)).toThrow(LeadLifecycleInputError);
    });

    it.each([undefined, null, '', 'close', 'CLOSE_LOST', 'reopen', 'reassign_owner ', {}])('rejects unsupported command %j', command => {
        expect(() => parseLeadLifecycleInput({ ...close, command })).toThrow(LeadLifecycleInputError);
    });

    it.each(['requestId', 'customerId', 'expectedRevision', 'newOwnerUserId'])('requires a strict UUID for %s', key => {
        for (const value of [null, undefined, '', 'not-a-uuid', 7, {}, `${ID}\n`, `${ID}\r`, ` ${ID}`, `${ID} `]) {
            expect(() => parseLeadLifecycleInput({ ...reassign, [key]: value })).toThrow(LeadLifecycleInputError);
        }
    });

    it.each(['interestId', 'expectedActionId'])('requires null or strict UUID for %s, never omission/blank', key => {
        for (const value of [undefined, '', 'null', false, {}, `${ID}\n`]) {
            expect(() => parseLeadLifecycleInput({ ...close, [key]: value })).toThrow(LeadLifecycleInputError);
        }
    });

    it.each([null, undefined, '', '   ', '\u00a0', 1, {}, [], 'ก'.repeat(1001)])('rejects blank, nontext or overlength reason %j', reason => {
        expect(() => parseLeadLifecycleInput({ ...close, reason })).toThrow(LeadLifecycleInputError);
    });

    it.each(['\u0000', '\t', '\n', '\r', '\u001f', '\u007f', '\u0085', '\u009f', '\u2028', '\u2029', '\ud800', '\udfff'])('rejects control/line/lone-surrogate U+%s before trimming', character => {
        expect(() => parseLeadLifecycleInput({ ...close, reason: character })).toThrow(LeadLifecycleInputError);
        expect(() => parseLeadLifecycleInput({ ...close, reason: `เหตุผล${character}เพิ่มเติม` })).toThrow(LeadLifecycleInputError);
        expect(() => parseLeadLifecycleInput({ ...close, reason: `เหตุผล${character}` })).toThrow(LeadLifecycleInputError);
    });

    it('counts Unicode scalar characters consistently with SQL and preserves valid emoji', () => {
        expect(parseLeadLifecycleInput({ ...close, reason: ` ${'😀'.repeat(1000)} ` }).reason).toBe('😀'.repeat(1000));
        expect(() => parseLeadLifecycleInput({ ...close, reason: '😀'.repeat(1001) })).toThrow(LeadLifecycleInputError);
        expect(parseLeadLifecycleInput({ ...close, reason: 'ลูกค้าขอเปลี่ยนผู้ดูแล 🙏' }).reason).toBe('ลูกค้าขอเปลี่ยนผู้ดูแล 🙏');
    });
});
