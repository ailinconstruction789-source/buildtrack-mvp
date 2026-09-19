/** Write-ahead per-Admin/per-tab queue for the explicit Admin processing control.
 * Never sends from the preview/inbox; importing this module never runs a command.
 * Keeps the same request through reloads/uncertain outcomes, even if a later
 * attempt is definitely rejected: that does not disprove an earlier commit. */
import { isCentralUuid } from './centralContracts';
import { parseSlaProcessingInput, parseSlaProcessingResult, type SlaProcessingInput, type SlaProcessingResult } from './slaProcessingContracts';
import type { SlaProcessingApi } from './slaProcessingClient';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:first-contact-processing:pending:v1';
const running = new Set<string>();
export class SlaProcessingPendingError extends Error {
    constructor() { super('คำขอค้างยังตรวจสอบไม่ได้ ให้ Admin ตรวจผลก่อน ห้ามล้างคำขอหรือสร้างรหัสใหม่'); }
}
function actor(value: string): string {
    if (!isCentralUuid(value) || value.length !== 36) throw new SlaProcessingPendingError();
    return value.toLowerCase();
}
export function slaProcessingPendingKey(actorId: string): string { return `${PREFIX}:${actor(actorId)}`; }
function storageOrThrow(storage?: PendingStorage): PendingStorage {
    try { return storage ?? window.sessionStorage; } catch { throw new SlaProcessingPendingError(); }
}
const same = (a: SlaProcessingInput, b: SlaProcessingInput) => a.requestId === b.requestId && a.taskId === b.taskId;

/** One pending command across ALL tasks for this Admin. Never scan another actor. */
export function readSlaProcessingPending(actorId: string, storage?: PendingStorage): SlaProcessingInput | null {
    try {
        const raw = storageOrThrow(storage).getItem(slaProcessingPendingKey(actorId));
        if (raw === null) return null;
        if (raw.length > 4096) throw new SlaProcessingPendingError();
        const envelope: unknown = JSON.parse(raw);
        if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) throw new SlaProcessingPendingError();
        const value = envelope as Record<string, unknown>;
        if (Object.keys(value).length !== 4 || value.version !== 1 || value.actorId !== actor(actorId) || value.uncertain !== true
            || !Object.hasOwn(value, 'input')) throw new SlaProcessingPendingError();
        return parseSlaProcessingInput(value.input);
    } catch { throw new SlaProcessingPendingError(); }
}
function writeAhead(actorId: string, input: SlaProcessingInput, storage: PendingStorage) {
    try {
        const previous = readSlaProcessingPending(actorId, storage);
        if (previous && !same(previous, input)) throw new SlaProcessingPendingError();
        storage.setItem(slaProcessingPendingKey(actorId), JSON.stringify({ version: 1, actorId: actor(actorId), uncertain: true, input }));
        const saved = readSlaProcessingPending(actorId, storage);
        if (!saved || !same(saved, input)) throw new SlaProcessingPendingError();
    } catch { throw new SlaProcessingPendingError(); }
}

function clearMatching(actorId: string, input: SlaProcessingInput, target: PendingStorage): boolean {
    try {
        const pending = readSlaProcessingPending(actorId, target);
        if (!pending || !same(pending, input)) return false;
        target.removeItem(slaProcessingPendingKey(actorId));
        return target.getItem(slaProcessingPendingKey(actorId)) === null;
    } catch { return false; }
}

/** A verified GET may recover an already committed historical receipt. Bind all
 * three identities again before touching ONLY its matching local pending key.
 * Never call for not-found, an error, a different command, or a raw UI claim.
 * Current-account validation belongs to the receipt client and session fence.
 * No API/DB mutation, no new command, no clearing while a POST is in flight. */
export function settleSlaProcessingPendingReceipt(actorId: string, command: SlaProcessingInput, rawReceipt: unknown,
    storage?: PendingStorage): { receipt: SlaProcessingResult; pendingCleared: boolean } {
    const currentActor = actor(actorId), input = parseSlaProcessingInput(command);
    const receipt = parseSlaProcessingResult(rawReceipt, input, currentActor);
    if (running.has(currentActor)) return { receipt, pendingCleared: false };
    try { return { receipt, pendingCleared: clearMatching(currentActor, input, storageOrThrow(storage)) }; }
    catch { return { receipt, pendingCleared: false }; }
}

/** Call only on an explicit action, with the original request ID and actor.
 * No auto-retry, UUID generation, bulk run or timer. All failures keep the queue.
 * A known successful receipt stays successful if clearing local storage fails. */
export async function processPendingFirstContact(actorId: string, command: SlaProcessingInput,
    api: Pick<SlaProcessingApi, 'process'>, storage?: PendingStorage): Promise<{ receipt: SlaProcessingResult; pendingCleared: boolean }> {
    const currentActor = actor(actorId), input = parseSlaProcessingInput(command), target = storageOrThrow(storage);
    if (running.has(currentActor)) throw new SlaProcessingPendingError();
    writeAhead(currentActor, input, target);
    running.add(currentActor);
    try {
        const raw = await api.process(input, currentActor);
        const receipt = parseSlaProcessingResult(raw, input, currentActor);
        return { receipt, pendingCleared: clearMatching(currentActor, input, target) };
    } finally { running.delete(currentActor); }
}
