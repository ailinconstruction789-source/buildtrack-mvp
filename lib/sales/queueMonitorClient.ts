import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import { watchNotificationActor } from './notificationClient';
import { parseQueueMonitorSnapshot, type QueueMonitorSnapshot } from './queueMonitorContracts';
export type { QueueMonitorSnapshot } from './queueMonitorContracts';

export class QueueMonitorClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'QueueMonitorClientError'; }
}
export interface QueueMonitorApi {
    read(expectedActorId?: string): Promise<QueueMonitorSnapshot>;
    watchActor?(expectedActorId: string, onInvalidated: () => void): () => void;
}
const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: 'หน้าตรวจคิวไม่รับตัวกรองหรือคำสั่งประมวลผล', UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน',
    FORBIDDEN: 'เฉพาะ Admin เท่านั้นที่ตรวจคิวแจ้งเตือนได้', FEATURE_DISABLED: 'ยังไม่เปิดหน้าตรวจคิวแจ้งเตือน',
    SETUP_REQUIRED: 'ระบบตรวจคิวแจ้งเตือนยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้ง',
    READ_UNAVAILABLE: 'โหลดข้อมูลตรวจคิวไม่ได้ กรุณาลองใหม่ภายหลัง',
};
const statuses: Readonly<Record<string, number>> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
    FEATURE_DISABLED: 503, SETUP_REQUIRED: 503, READ_UNAVAILABLE: 503 };
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknown = () => new QueueMonitorClientError('UNKNOWN_RESULT', 'ตรวจสอบข้อมูลคิวไม่ได้ กรุณาโหลดใหม่');
async function sameActor(actorId: string) {
    try {
        const { data, error } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id, token = data?.session?.access_token;
        if (error || typeof token !== 'string' || !token || !strictUuid(userId) || userId.toLowerCase() !== actorId) {
            throw new QueueMonitorClientError('ACTOR_CHANGED_AFTER_REQUEST', 'บัญชีเปลี่ยนหรือออกจากระบบระหว่างตรวจคิว กรุณาตรวจบัญชีและโหลดใหม่', 409);
        }
    } catch (error) {
        if (error instanceof QueueMonitorClientError) throw error;
        throw new QueueMonitorClientError('SESSION_UNAVAILABLE', 'ตรวจสอบบัญชีหลังโหลดไม่ได้ กรุณาตรวจบัญชีอีกครั้ง');
    }
}
/** GET only. The captured browser identity prevents displaying a previous
 * account's snapshot; only server verification of the bearer authorizes access. */
export async function loadQueueMonitorSnapshot(expectedActorId?: string): Promise<QueueMonitorSnapshot> {
    let token: string, actorId: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new QueueMonitorClientError('UNAUTHENTICATED', messages.UNAUTHENTICATED, 401);
        }
        const userId = data.session.user?.id;
        if (expectedActorId !== undefined && (!strictUuid(userId) || !strictUuid(expectedActorId) || userId.toLowerCase() !== expectedActorId.toLowerCase())) {
            throw new QueueMonitorClientError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป กรุณาตรวจบัญชีก่อนโหลดข้อมูลคิว', 409);
        }
        if (!strictUuid(userId)) throw new QueueMonitorClientError('UNAUTHENTICATED', messages.UNAUTHENTICATED, 401);
        token = data.session.access_token; actorId = userId.toLowerCase();
    } catch (error) {
        if (error instanceof QueueMonitorClientError) throw error;
        throw new QueueMonitorClientError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    let response: Response;
    try {
        response = await fetch('/api/sales-crm/queue-monitor', { method: 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}` } });
    } catch {
        await sameActor(actorId);
        throw new QueueMonitorClientError('NETWORK_ERROR', 'โหลดข้อมูลตรวจคิวไม่ได้ กรุณาตรวจการเชื่อมต่อ');
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
        if (Object.hasOwn(statuses, code) && statuses[code] === response.status) throw new QueueMonitorClientError(code, messages[code], response.status);
    }
    if (response.status !== 200 || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknown();
    try { return parseQueueMonitorSnapshot(envelope.data, actorId); } catch { throw unknown(); }
}
export const queueMonitorApi: QueueMonitorApi = { read: loadQueueMonitorSnapshot, watchActor: watchNotificationActor };
