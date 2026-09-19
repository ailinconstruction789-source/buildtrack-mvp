import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import {
    parseNotificationPage, parseNotificationReadInput, parseNotificationReadResult, parseNotificationSnapshot,
    type NotificationReadInput, type NotificationReadResult, type NotificationSnapshot,
} from './notificationContracts';
export type { NotificationReadInput, NotificationReadResult, NotificationSnapshot, SalesNotification } from './notificationContracts';

const rejections: Readonly<Record<string, readonly number[]>> = {
    INVALID_INPUT: [400], UNAUTHENTICATED: [401], FORBIDDEN: [403], NOT_AVAILABLE: [404], ACTOR_CHANGED: [409],
    PAYLOAD_TOO_LARGE: [413], UNSUPPORTED_MEDIA_TYPE: [415], SETUP_REQUIRED: [503], FEATURE_DISABLED: [503],
};
const safeMessages: Readonly<Record<string, string>> = {
    INVALID_INPUT: 'ข้อมูลแจ้งเตือนไม่ถูกต้อง กรุณาตรวจสอบคำขอ',
    UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', FORBIDDEN: 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบแจ้งเตือน',
    NOT_AVAILABLE: 'แจ้งเตือนนี้ไม่พร้อมใช้งานแล้ว กรุณาโหลดรายการใหม่',
    ACTOR_CHANGED: 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป กรุณาตรวจบัญชีและโหลดรายการใหม่ก่อนทำเครื่องหมายอ่านแล้ว',
    PAYLOAD_TOO_LARGE: 'ข้อมูลคำขอมีขนาดเกินกำหนด', UNSUPPORTED_MEDIA_TYPE: 'กรุณาส่งคำขอเป็น JSON',
    SETUP_REQUIRED: 'ระบบแจ้งเตือนยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและสิทธิ์', FEATURE_DISABLED: 'ยังไม่เปิดระบบแจ้งเตือนในแอป',
    READ_UNAVAILABLE: 'โหลดแจ้งเตือนไม่ได้ กรุณาลองโหลดใหม่ภายหลัง',
    SERVICE_UNAVAILABLE: 'ยังยืนยันผลอ่านแล้วไม่ได้ กรุณาโหลดใหม่หรือลองซ้ำกับแจ้งเตือนรายการเดิม',
};
export class NotificationClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'NotificationClientError'; }
    // This describes this attempt only; a previous uncertain acknowledgment may
    // already have succeeded. Retrying the SAME notice never changes read_at back.
    get definitelyNotSaved(): boolean { return Object.hasOwn(rejections, this.code) && rejections[this.code].includes(this.status); }
}
export interface NotificationApi {
    read(page?: number): Promise<NotificationSnapshot>;
    markRead(input: NotificationReadInput, expectedActorId: string): Promise<NotificationReadResult>;
    watchActor?(expectedActorId: string, onInvalidated: () => void): () => void;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const unknownResult = (writing: boolean) => new NotificationClientError('UNKNOWN_RESULT', writing
    ? 'ยังยืนยันผลอ่านแล้วไม่ได้ กรุณาโหลดใหม่หรือลองซ้ำกับแจ้งเตือนรายการเดิม'
    : 'ตรวจสอบข้อมูลแจ้งเตือนไม่ได้ กรุณาลองโหลดใหม่');
async function assertSameActorAfterRequest(actorId: string) {
    // A POST may already have succeeded. Neither an identity change nor a failed
    // recheck after the request can be classified as definitely not saved.
    try {
        const { data, error } = await supabase.auth.getSession();
        const currentId = data?.session?.user?.id;
        if (error || !data?.session?.access_token || !strictUuid(currentId) || currentId.toLowerCase() !== actorId) {
            throw new NotificationClientError('ACTOR_CHANGED_AFTER_REQUEST',
                'บัญชีเปลี่ยนหรือออกจากระบบระหว่างคำขอ กรุณาโหลดรายการใหม่ ผลอ่านแล้วของบัญชีเดิมอาจบันทึกสำเร็จแล้ว', 409);
        }
    } catch (error) {
        if (error instanceof NotificationClientError) throw error;
        throw new NotificationClientError('SESSION_UNAVAILABLE', 'ตรวจสอบบัญชีหลังคำขอไม่ได้ กรุณาโหลดรายการใหม่ ผลอ่านแล้วอาจบันทึกสำเร็จแล้ว');
    }
}
async function request(path: string, input?: NotificationReadInput, expectedActorId?: string) {
    let token: string, actorId: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token) {
            throw new NotificationClientError('UNAUTHENTICATED', safeMessages.UNAUTHENTICATED, 401);
        }
        const userId = data.session.user?.id;
        if (input && (!strictUuid(userId) || !strictUuid(expectedActorId) || userId.toLowerCase() !== expectedActorId.toLowerCase())) {
            throw new NotificationClientError('ACTOR_CHANGED', safeMessages.ACTOR_CHANGED, 409);
        }
        if (!strictUuid(userId)) throw new NotificationClientError('UNAUTHENTICATED', safeMessages.UNAUTHENTICATED, 401);
        // This intent binding does not authorize: the API and RPC still verify the
        // exact same captured bearer, trusted active role and recipient themselves.
        actorId = userId.toLowerCase(); token = data.session.access_token;
    } catch (error) {
        if (error instanceof NotificationClientError) throw error;
        throw new NotificationClientError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    let response: Response;
    try {
        response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
            ...(input ? { body: JSON.stringify(input) } : {}),
        });
    } catch {
        await assertSameActorAfterRequest(actorId);
        throw new NotificationClientError('NETWORK_ERROR', input
            ? 'การเชื่อมต่อขัดข้อง ผลอ่านแล้วยังไม่แน่ชัด กรุณาลองซ้ำกับแจ้งเตือนรายการเดิม'
            : 'โหลดแจ้งเตือนไม่ได้ กรุณาตรวจการเชื่อมต่อ');
    }
    // Check before parsing too: a malformed/proxy response must not bypass the
    // identity invalidation that tells the UI to discard the previous inbox.
    await assertSameActorAfterRequest(actorId);
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch {
        await assertSameActorAfterRequest(actorId);
        throw unknownResult(!!input);
    }
    // The response body can arrive after headers and after the pre-parse check.
    // Initial inbox loads do not have a mounted actor watcher yet, so recheck
    // after this await before returning any private data or definite rejection.
    await assertSameActorAfterRequest(actorId);
    if (!record(envelope)) throw unknownResult(!!input);
    if (!response.ok && !('data' in envelope) && record(envelope.error) && typeof envelope.error.code === 'string'
        && typeof envelope.error.message === 'string') {
        const code = envelope.error.code;
        const allowedStatus = Object.hasOwn(rejections, code) ? rejections[code].includes(response.status)
            : ['SERVICE_UNAVAILABLE', 'READ_UNAVAILABLE'].includes(code) && response.status === 503;
        if (Object.hasOwn(safeMessages, code) && allowedStatus) throw new NotificationClientError(code, safeMessages[code], response.status);
    }
    if (!response.ok || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknownResult(!!input);
    return { data: envelope.data, status: response.status, actorId };
}
export async function loadNotificationSnapshot(page = 0): Promise<NotificationSnapshot> {
    let selected: number;
    try { selected = parseNotificationPage(page); }
    catch { throw new NotificationClientError('INVALID_INPUT', safeMessages.INVALID_INPUT, 400); }
    const response = await request(`/api/sales-crm/notifications?page=${selected}`);
    try {
        if (response.status !== 200) throw unknownResult(false);
        return parseNotificationSnapshot(response.data, selected, response.actorId);
    } catch { throw unknownResult(false); }
}
export async function markNotificationRead(input: NotificationReadInput, expectedActorId: string): Promise<NotificationReadResult> {
    let normalized: NotificationReadInput;
    try { normalized = parseNotificationReadInput(input); }
    catch { throw new NotificationClientError('INVALID_INPUT', safeMessages.INVALID_INPUT, 400); }
    const response = await request('/api/sales-crm/notifications', normalized, expectedActorId);
    try {
        if (response.status !== 200) throw unknownResult(true);
        return parseNotificationReadResult(response.data, normalized);
    } catch { throw unknownResult(true); }
}
/** UI privacy invalidation only; no auth decision, role claim or network request.
 * Keep this callback synchronous: auth callbacks must not re-enter auth methods.
 */
export function watchNotificationActor(expectedActorId: string, onInvalidated: () => void): () => void {
    let disposed = false, invalidated = false;
    const invalidate = () => {
        if (!disposed && !invalidated) { invalidated = true; onInvalidated(); }
    };
    if (!strictUuid(expectedActorId)) { invalidate(); return () => { disposed = true; }; }
    try {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            const userId = session?.user?.id;
            if (!strictUuid(userId) || userId.toLowerCase() !== expectedActorId.toLowerCase()) invalidate();
        });
        if (!data?.subscription || typeof data.subscription.unsubscribe !== 'function') {
            invalidate(); return () => { disposed = true; };
        }
        return () => {
            if (disposed) return;
            disposed = true;
            try { data.subscription.unsubscribe(); } catch { /* Local listener cleanup only. */ }
        };
    } catch { invalidate(); return () => { disposed = true; }; }
}
export const notificationApi: NotificationApi = { read: loadNotificationSnapshot, markRead: markNotificationRead, watchActor: watchNotificationActor };
