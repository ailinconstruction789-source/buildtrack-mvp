import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parsePostBookingInput, parsePostBookingResult, parsePostBookingScope, parsePostBookingSnapshot,
  type PostBookingInput, type PostBookingResult, type PostBookingScope, type PostBookingSnapshot } from './postBookingContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, CONFLICT: 409, ACTOR_CHANGED: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class PostBookingApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'PostBookingApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface PostBookingApi {
  read(scope: PostBookingScope): Promise<PostBookingSnapshot>;
  save(input: PostBookingInput, actorUserId: string): Promise<PostBookingResult>;
}
const unknown = () => new PostBookingApiError('UNKNOWN_RESULT', 'ยังยืนยันผลไม่ได้ กรุณาตรวจด้วยคำขอเดิม ห้ามสร้างคำขอใหม่');
async function request(path: string, input?: PostBookingInput, actorUserId?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new PostBookingApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  const actor = bookingUuid(data.session.user.id);
  if (input && actor !== actorUserId) throw new PostBookingApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป ให้กลับเข้าบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new PostBookingApiError(failure.code, failure.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  return { data: envelope.data, status: response.status, actor };
}
export const postBookingApi: PostBookingApi = {
  read: async scope => {
    let normalized: PostBookingScope;
    try { normalized = parsePostBookingScope(scope); } catch { throw new PostBookingApiError('INVALID_INPUT', 'รหัสจองหรือลำดับหน้าไม่ถูกต้อง', 400); }
    const response = await request(`/api/sales-crm/post-booking?${new URLSearchParams({ saleId: normalized.saleId, attemptPage: String(normalized.attemptPage), eventPage: String(normalized.eventPage) })}`);
    try {
      const snapshot = parsePostBookingSnapshot(response.data, normalized);
      if (response.status !== 200 || snapshot.actor.userId !== response.actor) throw unknown();
      return snapshot;
    } catch { throw new PostBookingApiError('READ_UNAVAILABLE', 'ตรวจงานหลังจองไม่ได้ กรุณาโหลดใหม่'); }
  },
  save: async (input, actor) => {
    let normalized: PostBookingInput;
    try { normalized = parsePostBookingInput(input); } catch { throw new PostBookingApiError('INVALID_INPUT', 'ข้อมูลหลังจองไม่ถูกต้อง', 400); }
    const response = await request('/api/sales-crm/post-booking', normalized, actor);
    try { const result = parsePostBookingResult(response.data, normalized); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
};
