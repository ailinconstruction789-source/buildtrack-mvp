import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import { watchNotificationActor } from './notificationClient';
import { parseSlaProcessingInput, parseSlaProcessingResult, type SlaProcessingInput, type SlaProcessingResult } from './slaProcessingContracts';
export type { SlaProcessingInput, SlaProcessingResult } from './slaProcessingContracts';

const definiteStatuses: Readonly<Record<string, number>> = {
    INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_AVAILABLE: 404, ACTOR_CHANGED: 409,
    IDEMPOTENCY_CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
    FEATURE_DISABLED: 503, SETUP_REQUIRED: 503, PRECHECK_UNAVAILABLE: 503, SESSION_UNAVAILABLE: 0,
};
const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: 'คำขอประมวลผล SLA ไม่ถูกต้อง', UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน',
    FORBIDDEN: 'เฉพาะ Admin เท่านั้นที่ประมวลผล SLA ได้', NOT_AVAILABLE: 'งานนี้ไม่พร้อมประมวลผล กรุณาตรวจรายการล่าสุด',
    IDEMPOTENCY_CONFLICT: 'หมายเลขคำขอนี้ผูกกับข้อมูลอื่นแล้ว กรุณาให้ Admin ตรวจสอบ อย่าเปลี่ยนคำขอเพื่อข้ามข้อขัดแย้ง',
    PAYLOAD_TOO_LARGE: 'คำขอประมวลผลมีขนาดเกินกำหนด', UNSUPPORTED_MEDIA_TYPE: 'กรุณาส่งคำขอเป็น JSON',
    FEATURE_DISABLED: 'ยังไม่เปิดระบบประมวลผล SLA', SETUP_REQUIRED: 'ระบบประมวลผล SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง',
    PRECHECK_UNAVAILABLE: 'ตรวจความพร้อมก่อนประมวลผลไม่ได้ คำขอครั้งนี้ยังไม่ถูกส่งไปประมวลผล',
    UNKNOWN_RESULT: 'ยังยืนยันผลประมวลผลไม่ได้ ให้ลองซ้ำด้วยคำขอเดิมเท่านั้น อย่าสร้างคำขอใหม่',
};
export class SlaProcessingClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0, private readonly confirmedNotProcessed = false) {
        super(message); this.name = 'SlaProcessingClientError';
    }
    /** Describes THIS attempt only. A prior uncertain call with the same request
     * may already have committed; never discard that history on a later denial. */
    get definitelyNotProcessed(): boolean {
        return this.confirmedNotProcessed && Object.hasOwn(definiteStatuses, this.code) && definiteStatuses[this.code] === this.status;
    }
}
export interface SlaProcessingApi {
    process(input: SlaProcessingInput, expectedActorId: string): Promise<SlaProcessingResult>;
    watchActor?(expectedActorId: string, onInvalidated: () => void): () => void;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const unknown = () => new SlaProcessingClientError('UNKNOWN_RESULT', messages.UNKNOWN_RESULT, 503);
async function sameActorAfterRequest(actorId: string) {
    try {
        const { data, error } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (error || !data?.session?.access_token || !strictUuid(userId) || userId.toLowerCase() !== actorId) {
            throw new SlaProcessingClientError('ACTOR_CHANGED_AFTER_REQUEST', 'บัญชีเปลี่ยนระหว่างคำขอ ผลเดิมอาจบันทึกแล้ว กรุณาตรวจบัญชีเดิมก่อนลองคำขอเดิมซ้ำ', 409);
        }
    } catch (error) {
        if (error instanceof SlaProcessingClientError) throw error;
        throw new SlaProcessingClientError('SESSION_UNAVAILABLE', 'ตรวจบัญชีหลังคำขอไม่ได้ ผลอาจบันทึกแล้ว กรุณาตรวจบัญชีเดิมก่อนลองคำขอเดิมซ้ำ');
    }
}
export async function processFirstContact(input: SlaProcessingInput, expectedActorId: string): Promise<SlaProcessingResult> {
    let command: SlaProcessingInput;
    try { command = parseSlaProcessingInput(input); }
    catch { throw new SlaProcessingClientError('INVALID_INPUT', messages.INVALID_INPUT, 400, true); }
    let token: string, actorId: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new SlaProcessingClientError('UNAUTHENTICATED', messages.UNAUTHENTICATED, 401, true);
        }
        const userId = data.session.user?.id;
        if (!strictUuid(userId) || !strictUuid(expectedActorId) || userId.toLowerCase() !== expectedActorId.toLowerCase()) {
            throw new SlaProcessingClientError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป กรุณาตรวจบัญชีเดิมและคำขอเดิมก่อนประมวลผล', 409, true);
        }
        token = data.session.access_token; actorId = userId.toLowerCase();
    } catch (error) {
        if (error instanceof SlaProcessingClientError) throw error;
        throw new SlaProcessingClientError('SESSION_UNAVAILABLE', 'ตรวจสอบบัญชีก่อนส่งไม่ได้ คำขอครั้งนี้ยังไม่ถูกส่ง', 0, true);
    }
    let response: Response;
    try {
        response = await fetch('/api/sales-crm/sla-process', { method: 'POST', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    } catch {
        await sameActorAfterRequest(actorId);
        throw new SlaProcessingClientError('NETWORK_ERROR', 'การเชื่อมต่อขัดข้อง ผลอาจบันทึกแล้ว ให้ลองด้วยคำขอเดิมเท่านั้น');
    }
    await sameActorAfterRequest(actorId);
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch { await sameActorAfterRequest(actorId); throw unknown(); }
    await sameActorAfterRequest(actorId);
    if (!record(envelope)) throw unknown();
    if (!response.ok && !('data' in envelope) && record(envelope.error) && typeof envelope.error.code === 'string'
        && typeof envelope.error.message === 'string') {
        const error = envelope.error, code = error.code as string;
        // A definite abort needs BOTH the exact safe code/status AND the explicit
        // phase proof from this API. Missing/contradictory proof stays uncertain.
        if (Object.hasOwn(messages, code) && Object.hasOwn(definiteStatuses, code) && definiteStatuses[code] === response.status
            && error.definitelyNotProcessed === true) throw new SlaProcessingClientError(code, messages[code], response.status, true);
        if (code === 'UNKNOWN_RESULT' && response.status === 503 && error.definitelyNotProcessed === false) throw unknown();
    }
    if (response.status !== 200 || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknown();
    try { return parseSlaProcessingResult(envelope.data, command, actorId); } catch { throw unknown(); }
}
/** Privacy invalidation only; no automatic processing, retry or UUID creation. */
export const slaProcessingApi: SlaProcessingApi = { process: processFirstContact, watchActor: watchNotificationActor };
