import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import { watchNotificationActor } from './notificationClient';
import { parseSlaPreviewPage, parseSlaPreviewSnapshot } from './slaPreviewContracts';
import type { SlaPreviewSnapshot } from './slaPreviewTypes';
export type { SlaPreviewSnapshot, SlaPreviewRow } from './slaPreviewTypes';

export class SlaPreviewClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'SlaPreviewClientError'; }
}
export interface SlaPreviewApi {
    read(page?: number): Promise<SlaPreviewSnapshot>;
    watchActor?(expectedActorId: string, onInvalidated: () => void): () => void;
}
const messages: Readonly<Record<string, string>> = {
    INVALID_INPUT: 'ข้อมูลคำขอดูตัวอย่าง SLA ไม่ถูกต้อง', UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน',
    FORBIDDEN: 'เฉพาะ Admin เท่านั้นที่ดูตัวอย่าง SLA ได้', FEATURE_DISABLED: 'ยังไม่เปิดหน้าตัวอย่าง SLA',
    SETUP_REQUIRED: 'ตัวอย่าง SLA ยังไม่พร้อม กรุณาให้ Admin ตรวจการติดตั้งและรูปแบบข้อมูล',
    READ_UNAVAILABLE: 'โหลดตัวอย่าง SLA ไม่ได้ กรุณาลองใหม่ภายหลัง ไม่มีการเปลี่ยนข้อมูล',
};
const statuses: Readonly<Record<string, number>> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
    FEATURE_DISABLED: 503, SETUP_REQUIRED: 503, READ_UNAVAILABLE: 503 };
const strictUuid = (value: unknown): value is string => isCentralUuid(value) && value.length === 36;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknown = () => new SlaPreviewClientError('UNKNOWN_RESULT', 'ตรวจสอบข้อมูลตัวอย่าง SLA ไม่ได้ กรุณาลองโหลดใหม่ ไม่มีการเปลี่ยนข้อมูล');
async function sameActor(actorId: string) {
    try {
        const { data, error } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (error || !data?.session?.access_token || !strictUuid(userId) || userId.toLowerCase() !== actorId) {
            throw new SlaPreviewClientError('ACTOR_CHANGED_AFTER_REQUEST', 'บัญชีเปลี่ยนหรือออกจากระบบระหว่างโหลด กรุณาตรวจบัญชีใหม่', 409);
        }
    } catch (error) {
        if (error instanceof SlaPreviewClientError) throw error;
        throw new SlaPreviewClientError('SESSION_UNAVAILABLE', 'ตรวจสอบบัญชีหลังโหลดไม่ได้ กรุณาตรวจบัญชีใหม่');
    }
}
export async function loadSlaPreviewSnapshot(page = 0): Promise<SlaPreviewSnapshot> {
    let selected: number;
    try { selected = parseSlaPreviewPage(page); } catch { throw new SlaPreviewClientError('INVALID_INPUT', messages.INVALID_INPUT, 400); }
    let token: string, actorId: string;
    try {
        const { data, error } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (error || !data?.session || typeof data.session.access_token !== 'string' || !data.session.access_token || !strictUuid(userId)) {
            throw new SlaPreviewClientError('UNAUTHENTICATED', messages.UNAUTHENTICATED, 401);
        }
        token = data.session.access_token; actorId = userId.toLowerCase();
    } catch (error) {
        if (error instanceof SlaPreviewClientError) throw error;
        throw new SlaPreviewClientError('SESSION_UNAVAILABLE', 'ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    }
    let response: Response;
    try {
        response = await fetch(`/api/sales-crm/sla-preview?page=${selected}`, { method: 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}` } });
    } catch {
        await sameActor(actorId);
        throw new SlaPreviewClientError('NETWORK_ERROR', 'โหลดตัวอย่าง SLA ไม่ได้ กรุณาตรวจการเชื่อมต่อ');
    }
    await sameActor(actorId);
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch { await sameActor(actorId); throw unknown(); }
    // The body may stream after the first identity check. Never hand an old
    // account's snapshot to a new account, including during the initial load.
    await sameActor(actorId);
    if (!record(envelope)) throw unknown();
    if (!response.ok && !('data' in envelope) && record(envelope.error) && typeof envelope.error.code === 'string'
        && typeof envelope.error.message === 'string') {
        const code = envelope.error.code;
        if (Object.hasOwn(statuses, code) && statuses[code] === response.status) throw new SlaPreviewClientError(code, messages[code], response.status);
    }
    if (response.status !== 200 || !Object.hasOwn(envelope, 'data') || 'error' in envelope) throw unknown();
    try { return parseSlaPreviewSnapshot(envelope.data, selected, actorId); } catch { throw unknown(); }
}
/** Reuses only the synchronous privacy listener; no notification fetch/write. */
export const slaPreviewApi: SlaPreviewApi = { read: loadSlaPreviewSnapshot, watchActor: watchNotificationActor };
