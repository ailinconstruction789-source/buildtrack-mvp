import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseVoicePublicInput, parseVoicePublicResult, parseVoiceScope, parseVoiceSnapshot, parseVoiceStaffInput, parseVoiceStaffResult,
  type VoicePublicInput, type VoicePublicResult, type VoiceScope, type VoiceSnapshot, type VoiceStaffInput, type VoiceStaffResult } from './customerVoicesContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, SCOPE_CLOSED: 409, TOKEN_UNAVAILABLE: 410, ACTOR_CHANGED: 409,
  PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, FEATURE_DISABLED: 503, SETUP_REQUIRED: 503 };
const messages: Record<string, string> = {
  INVALID_INPUT: 'กรุณาตรวจแบบประเมินและข้อมูลอ้างอิง', UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบก่อน',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้', NOT_FOUND: 'ไม่พบรายการที่เข้าถึงได้', STALE_STATE: 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด',
  SCOPE_CLOSED: 'Visit นี้ปิดแล้ว ไม่สามารถทำรายการเพิ่ม', TOKEN_UNAVAILABLE: 'ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาติดต่อฝ่ายขาย',
  ACTOR_CHANGED: 'บัญชีเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', PAYLOAD_TOO_LARGE: 'ข้อมูลยาวเกินกำหนด',
  UNSUPPORTED_MEDIA_TYPE: 'รูปแบบคำขอไม่ถูกต้อง', FEATURE_DISABLED: 'แบบประเมินยังไม่เปิดใช้งาน', SETUP_REQUIRED: 'แบบประเมินยังไม่พร้อมใช้งาน',
  READ_UNAVAILABLE: 'โหลดข้อมูลแบบประเมินไม่ได้ กรุณาลองใหม่',
};
/** Never expose server error messages: a transport failure may contain the secret link or answers. */
export class CustomerVoicesApiError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(messages[code] ?? 'ยังยืนยันผลไม่ได้ ให้ตรวจด้วยคำขอเดิม ห้ามส่งคำขอใหม่'); this.name = 'CustomerVoicesApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface CustomerVoicesApi {
  read(scope: VoiceScope): Promise<VoiceSnapshot>;
  save(input: VoiceStaffInput, expectedActor: string): Promise<VoiceStaffResult>;
  watchIdentity?(onChange: () => void): () => void;
}
export interface CustomerVoicePublicApi { request(input: VoicePublicInput): Promise<VoicePublicResult> }
const unknown = () => new CustomerVoicesApiError('UNKNOWN_RESULT');
async function transport(path: string, input?: VoicePublicInput | VoiceStaffInput, jwt?: string) {
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let error: Record<string, unknown>; try { error = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof error.code === 'string') throw new CustomerVoicesApiError(error.code, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  return { data: envelope.data, status: response.status };
}
// Only staff operations load the auth client. The public form never reads a session or adds a JWT.
async function staffSession() {
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new CustomerVoicesApiError('UNAUTHENTICATED', 401);
  try { return { actor: bookingUuid(data.session.user.id), jwt: data.session.access_token }; }
  catch { throw new CustomerVoicesApiError('UNAUTHENTICATED', 401); }
}
export const customerVoicesApi: CustomerVoicesApi = {
  read: async scope => {
    let normalized: VoiceScope; try { normalized = parseVoiceScope(scope); } catch { throw new CustomerVoicesApiError('INVALID_INPUT', 400); }
    const before = await staffSession();
    const response = await transport(`/api/sales-crm/customer-voices?${new URLSearchParams({ ...normalized })}`, undefined, before.jwt);
    const after = await staffSession(); if (before.actor !== after.actor) throw new CustomerVoicesApiError('ACTOR_CHANGED', 409);
    try { const snapshot = parseVoiceSnapshot(response.data, normalized); if (response.status !== 200 || snapshot.actor.userId !== before.actor) throw unknown(); return snapshot; }
    catch { throw new CustomerVoicesApiError('READ_UNAVAILABLE'); }
  },
  save: async (input, expectedActor) => {
    let normalized: VoiceStaffInput; try { normalized = parseVoiceStaffInput(input); } catch { throw new CustomerVoicesApiError('INVALID_INPUT', 400); }
    const session = await staffSession(); if (session.actor !== expectedActor) throw new CustomerVoicesApiError('ACTOR_CHANGED', 409);
    const response = await transport('/api/sales-crm/customer-voices', normalized, session.jwt);
    try { const result = parseVoiceStaffResult(response.data, normalized); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
  watchIdentity: onChange => {
    let stopped = false, unsubscribe: (() => void) | undefined, identity: string | null | undefined;
    void import('@/lib/supabase').then(({ supabase }) => {
      if (stopped) return;
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        const next = session?.user.id ?? null;
        if (identity !== undefined && identity !== next || identity === undefined && event !== 'INITIAL_SESSION') onChange();
        identity = next;
      }); unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => { if (!stopped) onChange(); });
    return () => { stopped = true; unsubscribe?.(); };
  },
};
export const customerVoicePublicApi: CustomerVoicePublicApi = {
  request: async input => {
    let normalized: VoicePublicInput; try { normalized = parseVoicePublicInput(input); } catch { throw new CustomerVoicesApiError('INVALID_INPUT', 400); }
    const response = await transport('/api/customer-voices', normalized);
    try {
      const result = parseVoicePublicResult(response.data, normalized);
      if (response.status !== ('submitted' in result && !result.replayed ? 201 : 200)) throw unknown();
      return result;
    } catch { throw unknown(); }
  },
};
