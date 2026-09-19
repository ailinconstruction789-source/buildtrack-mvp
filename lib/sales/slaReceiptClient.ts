import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import { watchNotificationActor } from './notificationClient';
import { parseSlaProcessingInput, type SlaProcessingInput } from './slaProcessingContracts';
import { parseSlaReceiptContext, parseSlaReceiptLookup, type SlaReceiptContext, type SlaReceiptLookup } from './slaReceiptContracts';
export type { SlaReceiptContext, SlaReceiptLookup } from './slaReceiptContracts';

export class SlaReceiptClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'SlaReceiptClientError'; }
}
export interface SlaReceiptApi {
    context(): Promise<SlaReceiptContext>;
    lookup(input: SlaProcessingInput, expectedActorId: string): Promise<SlaReceiptLookup>;
    watchActor?(expectedActorId: string, onInvalidated: () => void): () => void;
}
const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: 'ข้อมูลคำขอตรวจผล SLA ไม่ถูกต้อง', UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน',
    FORBIDDEN: 'เฉพาะ Admin เท่านั้นที่ตรวจผล SLA ได้', FEATURE_DISABLED: 'ยังไม่เปิดระบบตรวจผล SLA',
    SETUP_REQUIRED: 'ระบบตรวจผล SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง',
    READ_UNAVAILABLE: 'ตรวจผล SLA ไม่ได้ กรุณาลองตรวจด้วยคำขอเดิมภายหลัง ยังสรุปไม่ได้ว่าคำขอเดิมบันทึกหรือไม่',
};
const statuses: Readonly<Record<string, number>> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
    FEATURE_DISABLED: 503, SETUP_REQUIRED: 503, READ_UNAVAILABLE: 503 };
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknown = () => new SlaReceiptClientError('UNKNOWN_RESULT', 'ตรวจสอบผล SLA ไม่ได้ กรุณาตรวจคำขอเดิมอีกครั้ง ห้ามสรุปว่าคำขอเดิมไม่ถูกบันทึก');
async function sameActor(actorId: string) {
    try {
        const { data, error } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (error || !data?.session?.access_token || !strictUuid(userId) || userId.toLowerCase() !== actorId) {
            throw new SlaReceiptClientError('ACTOR_CHANGED_AFTER_REQUEST', 'บัญชีเปลี่ยนหรือออกจากระบบระหว่างตรวจผล กรุณาตรวจบัญชีเดิมและคำขอเดิม', 409);
        }
    } catch (error) {
        if (error instanceof SlaReceiptClientError) throw error;
        throw new SlaReceiptClientError('SESSION_UNAVAILABLE', 'ตรวจสอบบัญชีหลังโหลดไม่ได้ กรุณาตรวจบัญชีเดิมอีกครั้ง');
    }
}
async function request(input?: SlaProcessingInput, expectedActorId?: string) {
    let token: string, actorId: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new SlaReceiptClientError('UNAUTHENTICATED', messages.UNAUTHENTICATED, 401);
        }
        const userId = data.session.user?.id;
        if (input && (!strictUuid(userId) || !strictUuid(expectedActorId) || userId.toLowerCase() !== expectedActorId.toLowerCase())) {
            throw new SlaReceiptClientError('ACTOR_CHANGED', 'บัญชีไม่ตรงกับคำขอเดิม กรุณาตรวจบัญชีเดิมก่อนค้นหาผล', 409);
        }
        if (!strictUuid(userId)) throw new SlaReceiptClientError('UNAUTHENTICATED', messages.UNAUTHENTICATED, 401);
        token = data.session.access_token; actorId = userId.toLowerCase();
    } catch (error) {
        if (error instanceof SlaReceiptClientError) throw error;
        throw new SlaReceiptClientError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    const query = input ? `?${new URLSearchParams({ requestId: input.requestId, taskId: input.taskId })}` : '';
    let response: Response;
    try {
        response = await fetch(`/api/sales-crm/sla-receipts${query}`, { method: 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}` } });
    } catch {
        await sameActor(actorId);
        throw new SlaReceiptClientError('NETWORK_ERROR', 'ตรวจผล SLA ไม่ได้ กรุณาตรวจการเชื่อมต่อ ผลคำขอเดิมยังไม่แน่ชัด');
    }
    await sameActor(actorId);
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch { await sameActor(actorId); throw unknown(); }
    await sameActor(actorId);
    if (!record(envelope)) throw unknown();
    if (!response.ok && !('data' in envelope) && record(envelope.error) && typeof envelope.error.code === 'string'
        && typeof envelope.error.message === 'string') {
        const code = envelope.error.code;
        if (Object.hasOwn(statuses, code) && statuses[code] === response.status) throw new SlaReceiptClientError(code, messages[code], response.status);
    }
    if (response.status !== 200 || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknown();
    return { data: envelope.data, actorId };
}
export async function loadSlaReceiptContext(): Promise<SlaReceiptContext> {
    const response = await request();
    try { return parseSlaReceiptContext(response.data, response.actorId); } catch { throw unknown(); }
}
/** This GET never processes or replays a command. A missing receipt does not
 * clear sticky uncertainty and must not cause a new request ID to be generated. */
export async function lookupSlaReceipt(input: SlaProcessingInput, expectedActorId: string): Promise<SlaReceiptLookup> {
    let command: SlaProcessingInput;
    try { command = parseSlaProcessingInput(input); }
    catch { throw new SlaReceiptClientError('INVALID_INPUT', messages.INVALID_INPUT, 400); }
    const response = await request(command, expectedActorId);
    try { return parseSlaReceiptLookup(response.data, command, response.actorId); } catch { throw unknown(); }
}
export const slaReceiptApi: SlaReceiptApi = { context: loadSlaReceiptContext, lookup: lookupSlaReceipt, watchActor: watchNotificationActor };
