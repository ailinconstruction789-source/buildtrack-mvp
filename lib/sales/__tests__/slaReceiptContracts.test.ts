import { describe, expect, it } from 'vitest';
import { SLA_RECEIPT_CONTRACT_VERSION, SlaReceiptInputError, SlaReceiptProjectionError,
    parseSlaReceiptContext, parseSlaReceiptLookup, parseSlaReceiptQuery } from '../slaReceiptContracts';
const ADMIN = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc', OTHER = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000002', TASK = '00000000-0000-4000-8000-000000000003';
const AT = '2026-09-17T02:45:00.123456Z', INPUT = { requestId: REQUEST, taskId: TASK };
const actor = { userId: ADMIN, role: 'admin' };
function receipt() { return { actor, ...INPUT, processedAt: AT, replayed: false, outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: AT,
    staffDueAt: null, notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null, withdrawnCount: 0 }; }
function lookup() { return { actor, ...INPUT, found: true, receipt: receipt() }; }

describe('strict context or exact command receipt query', () => {
    it('pins receipt review contract and treats no query as context', () => {
        expect(SLA_RECEIPT_CONTRACT_VERSION).toBe('first_contact_receipt_review_v1'); expect(parseSlaReceiptQuery('https://app.test/api')).toBeNull();
    });
    it('normalizes strict UUID case and accepts either key order', () => {
        expect(parseSlaReceiptQuery(`https://app.test/?taskId=${TASK}&requestId=${ADMIN.toUpperCase()}`)).toEqual({ requestId: ADMIN, taskId: TASK });
    });
    it.each([`requestId=${REQUEST}`, `taskId=${TASK}`, `requestId=&taskId=${TASK}`, `requestId=${REQUEST}&taskId=bad`,
        `requestId=${REQUEST}%0A&taskId=${TASK}`, `requestId=${REQUEST}&taskId=${TASK}&requestId=${REQUEST}`,
        `requestId=${REQUEST}&taskId=${TASK}&taskId=${TASK}`, `requestId=${REQUEST}&taskId=${TASK}&actorId=${ADMIN}`,
        'page=0', 'process=true'])('rejects malformed/duplicate/extra query%s', query => {
        expect(() => parseSlaReceiptQuery(`https://app.test/?${query}`)).toThrow(SlaReceiptInputError);
    });
});
describe('minimal verified Admin context', () => {
    it.each([true, false])('preserves processingEnabled%s without exposing DBdetails', processingEnabled => {
        expect(parseSlaReceiptContext({ actor: { ...actor, private: 'hidden' }, processingEnabled, source: {} }, ADMIN)).toEqual({ actor, processingEnabled });
    });
    it.each([null, [], {}, { actor, processingEnabled: 'true' }, { actor: { ...actor, role: 'owner' }, processingEnabled: true },
        { actor: { ...actor, userId: OTHER }, processingEnabled: true }, { actor: { ...actor, userId: `${ADMIN}\n` }, processingEnabled: true }])('rejects malformed/otheractor context%j', value => {
        expect(() => parseSlaReceiptContext(value, ADMIN)).toThrow(SlaReceiptProjectionError);
    });
});
describe('historical own-command receipt projection', () => {
    it('strips raw ledger/source/private data and preserves original processedAt/replayed', () => {
        expect(parseSlaReceiptLookup({ ...lookup(), requestPayload: INPUT, ledgerRow: {}, receipt: { ...receipt(), rawCalendar: {}, income: 999, actor: { ...actor, email: 'private' } } }, INPUT, ADMIN)).toEqual(lookup());
    });
    it('foundfalse is only an observation, never a definitive no-commit field', () => {
        const result = parseSlaReceiptLookup({ actor, ...INPUT, found: false, receipt: null, definitelyNotProcessed: true }, INPUT, ADMIN);
        expect(result).toEqual({ actor, ...INPUT, found: false, receipt: null }); expect(result).not.toHaveProperty('definitelyNotProcessed');
    });
    it.each([null, [], {}, { ...lookup(), found: 'true' }, { ...lookup(), found: false }, { ...lookup(), receipt: null },
        { ...lookup(), requestId: OTHER }, { ...lookup(), taskId: OTHER }, { ...lookup(), actor: { userId: OTHER, role: 'admin' } },
        { ...lookup(), actor: { userId: ADMIN, role: 'sales' } }, { ...lookup(), receipt: { ...receipt(), actor: { userId: OTHER, role: 'admin' } } },
        { ...lookup(), receipt: { ...receipt(), requestId: OTHER } }, { ...lookup(), receipt: { ...receipt(), taskId: OTHER } },
        { ...lookup(), receipt: { ...receipt(), processedAt: `${AT}\n` } }, { ...lookup(), receipt: { ...receipt(), staffDueAt: AT } }])('rejects contradictory or unbound lookup%j', value => {
        expect(() => parseSlaReceiptLookup(value, INPUT, ADMIN)).toThrow(SlaReceiptProjectionError);
    });
    it('requires every lookup field including explicitnull for absence', () => {
        for (const key of Object.keys(lookup())) {
            const value: Record<string, unknown> = lookup(); delete value[key]; expect(() => parseSlaReceiptLookup(value, INPUT, ADMIN), key).toThrow(SlaReceiptProjectionError);
        }
        expect(() => parseSlaReceiptLookup({ actor, ...INPUT, found: false }, INPUT, ADMIN)).toThrow(SlaReceiptProjectionError);
    });
});
