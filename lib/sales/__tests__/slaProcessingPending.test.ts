import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processPendingFirstContact, readSlaProcessingPending, settleSlaProcessingPendingReceipt, slaProcessingPendingKey } from '../slaProcessingPending';
import type { SlaProcessingResult } from '../slaProcessingContracts';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const input = { requestId: '00000000-0000-4000-8000-000000000003', taskId: '00000000-0000-4000-8000-000000000004' };
const receipt: SlaProcessingResult = { actor: { userId: ADMIN, role: 'admin' }, ...input,
    processedAt: '2026-09-17T03:00:00.000001Z', replayed: false, outcome: 'held', reason: 'MISSING_CALENDAR',
    serviceDueAt: '2026-09-17T03:30:00Z', staffDueAt: null, notificationId: null, notificationType: null,
    completedByActivityId: null, completedAt: null, withdrawnCount: 0 };
beforeEach(() => sessionStorage.clear());
const envelope = () => ({ version: 1, actorId: ADMIN, uncertain: true, input });

describe('one explicit pending processing command per Admin per tab', () => {
    it('writes and verifies the minimal uncertain command BEFORE calling the processor', async () => {
        const process = vi.fn(async () => {
            expect(readSlaProcessingPending(ADMIN)).toEqual(input);
            expect(JSON.parse(sessionStorage.getItem(slaProcessingPendingKey(ADMIN))!)).toEqual(envelope());
            return receipt;
        });
        expect(await processPendingFirstContact(ADMIN, input, { process })).toEqual({ receipt, pendingCleared: true });
        expect(process).toHaveBeenCalledExactlyOnceWith(input, ADMIN);
        expect(readSlaProcessingPending(ADMIN)).toBeNull();
    });
    it('uncertain failure survives reload and a later definitely-rejected attempt; new command is blocked', async () => {
        const process = vi.fn().mockRejectedValueOnce(new Error('network'))
            .mockRejectedValueOnce(Object.assign(new Error('forbidden now'), { definitelyNotProcessed: true }));
        await expect(processPendingFirstContact(ADMIN, input, { process })).rejects.toThrow('network');
        const recovered = readSlaProcessingPending(ADMIN)!;
        await expect(processPendingFirstContact(ADMIN, recovered, { process })).rejects.toThrow('forbidden now');
        await expect(processPendingFirstContact(ADMIN, { ...input, requestId: OTHER }, { process })).rejects.toThrow(/Admin/);
        await expect(processPendingFirstContact(ADMIN, { ...input, taskId: OTHER }, { process })).rejects.toThrow(/Admin/);
        expect(readSlaProcessingPending(ADMIN)).toEqual(input); expect(process).toHaveBeenCalledTimes(2);
    });
    it('does not retry itself; an explicit SAME-command retry can consume the stored historical receipt', async () => {
        const process = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ...receipt, replayed: true });
        await expect(processPendingFirstContact(ADMIN, input, { process })).rejects.toThrow();
        expect(process).toHaveBeenCalledOnce();
        const result = await processPendingFirstContact(ADMIN, readSlaProcessingPending(ADMIN)!, { process });
        expect(result.receipt.replayed).toBe(true); expect(result.pendingCleared).toBe(true);
        expect(process.mock.calls).toEqual([[input, ADMIN], [input, ADMIN]]);
    });
    it('blocks concurrent commands for the same actor, including duplicate clicks', async () => {
        let finish!: (value: SlaProcessingResult) => void;
        const process = vi.fn(() => new Promise<SlaProcessingResult>(resolve => { finish = resolve; }));
        const active = processPendingFirstContact(ADMIN, input, { process });
        await expect(processPendingFirstContact(ADMIN, input, { process })).rejects.toThrow(/Admin/);
        expect(process).toHaveBeenCalledOnce(); finish(receipt); await active;
    });
    it('isolates different Admins and never replays a prior Admin command under the new account', async () => {
        const process = vi.fn().mockRejectedValue(new Error('lost'));
        await expect(processPendingFirstContact(ADMIN, input, { process })).rejects.toThrow();
        expect(readSlaProcessingPending(OTHER)).toBeNull();
        const otherProcess = vi.fn().mockResolvedValue({ ...receipt, actor: { userId: OTHER, role: 'admin' } });
        await processPendingFirstContact(OTHER, input, { process: otherProcess });
        expect(readSlaProcessingPending(ADMIN)).toEqual(input); expect(readSlaProcessingPending(OTHER)).toBeNull();
    });
    it.each([{ actor: { userId: OTHER, role: 'admin' } }, { taskId: OTHER }, { requestId: OTHER }, { outcome: 'invalid' }])('keeps the request after mismatched/malformed success %#', async change => {
        await expect(processPendingFirstContact(ADMIN, input, { process: vi.fn().mockResolvedValue({ ...receipt, ...change }) })).rejects.toThrow();
        expect(readSlaProcessingPending(ADMIN)).toEqual(input);
    });
    it('reports a known receipt separately when clearing storage fails', async () => {
        const storage = { getItem: sessionStorage.getItem.bind(sessionStorage), setItem: sessionStorage.setItem.bind(sessionStorage),
            removeItem: vi.fn(() => { throw new Error('denied'); }) };
        expect(await processPendingFirstContact(ADMIN, input, { process: vi.fn().mockResolvedValue(receipt) }, storage))
            .toEqual({ receipt, pendingCleared: false });
        expect(readSlaProcessingPending(ADMIN)).toEqual(input);
    });
    it('does not erase a different/corrupt command replaced while waiting', async () => {
        const process = vi.fn(async () => { sessionStorage.setItem(slaProcessingPendingKey(ADMIN), 'corrupt'); return receipt; });
        expect((await processPendingFirstContact(ADMIN, input, { process })).pendingCleared).toBe(false);
        expect(sessionStorage.getItem(slaProcessingPendingKey(ADMIN))).toBe('corrupt');
    });
    it.each(['null', '[]', '{}', 'not JSON', 'x'.repeat(4097),
        JSON.stringify({ ...envelope(), actorId: OTHER }), JSON.stringify({ ...envelope(), uncertain: false }),
        JSON.stringify({ ...envelope(), version: 2 }), JSON.stringify({ ...envelope(), token: 'not-allowed' }),
        JSON.stringify({ ...envelope(), input: { ...input, staffDueAt: 'forged' } }),
    ])('blocks corrupt storage before sending %#', async raw => {
        const key = slaProcessingPendingKey(ADMIN); sessionStorage.setItem(key, raw); const process = vi.fn();
        expect(() => readSlaProcessingPending(ADMIN)).toThrow(/Admin/);
        await expect(processPendingFirstContact(ADMIN, input, { process })).rejects.toThrow(/Admin/);
        expect(process).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(raw);
    });
    it.each(['read', 'write', 'silent-write'] as const)('blocks %s storage failure before any request', async failure => {
        const process = vi.fn();
        const storage = { getItem: vi.fn(() => { if (failure === 'read') throw new Error('private'); return null; }),
            setItem: vi.fn(() => { if (failure === 'write') throw new Error('private'); }), removeItem: vi.fn() };
        await expect(processPendingFirstContact(ADMIN, input, { process }, storage)).rejects.toThrow(/Admin/);
        expect(process).not.toHaveBeenCalled();
    });
});

describe('verified read-only receipt reconciles only the exact pending command', () => {
    beforeEach(() => sessionStorage.setItem(slaProcessingPendingKey(ADMIN), JSON.stringify(envelope())));
    it('uses a validated historical receipt to clear only the matching local queue without POST', () => {
        sessionStorage.setItem(slaProcessingPendingKey(OTHER), JSON.stringify({ ...envelope(), actorId: OTHER }));
        expect(settleSlaProcessingPendingReceipt(ADMIN, input, receipt)).toEqual({ receipt, pendingCleared: true });
        expect(readSlaProcessingPending(ADMIN)).toBeNull(); expect(readSlaProcessingPending(OTHER)).toEqual(input);
    });
    it.each([null, { found: false, receipt: null }, { ...receipt, actor: { userId: OTHER, role: 'admin' } },
        { ...receipt, requestId: OTHER }, { ...receipt, taskId: OTHER }, { ...receipt, outcome: 'invalid' }])('rejects absent/unbound proof %# without touching queue', value => {
        expect(() => settleSlaProcessingPendingReceipt(ADMIN, input, value)).toThrow();
        expect(readSlaProcessingPending(ADMIN)).toEqual(input);
    });
    it.each(['corrupt', JSON.stringify({ ...envelope(), input: { ...input, taskId: OTHER } })])('does not clear externally replaced storage %#', raw => {
        sessionStorage.setItem(slaProcessingPendingKey(ADMIN), raw);
        expect(settleSlaProcessingPendingReceipt(ADMIN, input, receipt)).toEqual({ receipt, pendingCleared: false });
        expect(sessionStorage.getItem(slaProcessingPendingKey(ADMIN))).toBe(raw);
    });
    it('keeps receipt confirmed when storage clear throws or silently fails', () => {
        for (const removeItem of [vi.fn(() => { throw new Error('denied'); }), vi.fn()]) {
            const storage = { getItem: sessionStorage.getItem.bind(sessionStorage), setItem: sessionStorage.setItem.bind(sessionStorage), removeItem };
            expect(settleSlaProcessingPendingReceipt(ADMIN, input, receipt, storage)).toEqual({ receipt, pendingCleared: false });
            expect(readSlaProcessingPending(ADMIN)).toEqual(input);
        }
    });
    it('cannot release the same-Admin single-flight guard through receipt GET during a POST', async () => {
        let finish!: (value: SlaProcessingResult) => void;
        const active = processPendingFirstContact(ADMIN, input, { process: () => new Promise(resolve => { finish = resolve; }) });
        expect(settleSlaProcessingPendingReceipt(ADMIN, input, receipt).pendingCleared).toBe(false);
        expect(readSlaProcessingPending(ADMIN)).toEqual(input);
        finish(receipt); await active; expect(readSlaProcessingPending(ADMIN)).toBeNull();
    });
});
