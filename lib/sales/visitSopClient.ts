import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseVisitSopInput, parseVisitSopResult, parseVisitSopScope, parseVisitSopSnapshot,
  type VisitSopInput, type VisitSopResult, type VisitSopScope, type VisitSopSnapshot } from './visitSopContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, SCOPE_CLOSED: 409, ALREADY_STARTED: 409, INCOMPLETE_STAGE: 409, VISIT_REQUIRED: 409, ACTOR_CHANGED: 409, NEXT_ACTION_REQUIRED: 409,
  PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class VisitSopApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'VisitSopApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface VisitSopApi {
  read(scope: VisitSopScope): Promise<VisitSopSnapshot>;
  save(input: VisitSopInput, expectedActor: string): Promise<VisitSopResult>;
  watchIdentity?(onChange: () => void): () => void;
}
const unknown = () => new VisitSopApiError('UNKNOWN_RESULT', 'ยังยืนยันผล SOP ไม่ได้ ให้ตรวจด้วยคำขอเดิม ห้ามเริ่มคำขอใหม่');
async function request(path: string, input?: VisitSopInput, expectedActor?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new VisitSopApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  let actor: string; try { actor = bookingUuid(data.session.user.id); } catch { throw new VisitSopApiError('UNAUTHENTICATED', 'ตรวจบัญชีไม่ได้', 401); }
  if (input && actor !== expectedActor) throw new VisitSopApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนแล้ว ให้กลับบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new VisitSopApiError(failure.code, failure.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  return { data: envelope.data, status: response.status, actor };
}
export const visitSopApi: VisitSopApi = {
  read: async scope => {
    let normalized: VisitSopScope; try { normalized = parseVisitSopScope(scope); } catch { throw new VisitSopApiError('INVALID_INPUT', 'ขอบเขต SOP ไม่ถูกต้อง', 400); }
    const params = new URLSearchParams({ customerId: normalized.customerId, interestId: normalized.interestId, eventPage: String(normalized.eventPage) });
    if (normalized.appointmentId) params.set('appointmentId', normalized.appointmentId); else params.set('visitId', normalized.visitId!);
    const response = await request(`/api/sales-crm/sop?${params}`);
    const after = await supabase.auth.getSession();
    if (after.error || !after.data.session || after.data.session.user.id !== response.actor) throw new VisitSopApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', 409);
    try {
      const snapshot = parseVisitSopSnapshot(response.data, normalized);
      if (response.status !== 200 || snapshot.actor.userId !== response.actor) throw unknown();
      return snapshot;
    } catch { throw new VisitSopApiError('READ_UNAVAILABLE', 'ตรวจข้อมูล SOP ไม่ได้ กรุณาโหลดใหม่'); }
  },
  save: async (input, actor) => {
    let normalized: VisitSopInput; try { normalized = parseVisitSopInput(input); } catch { throw new VisitSopApiError('INVALID_INPUT', 'กรุณาตรวจรายการ SOP เหตุผล และวันเวลาจริง', 400); }
    const response = await request('/api/sales-crm/sop', normalized, actor);
    try { const result = parseVisitSopResult(response.data, normalized); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
  watchIdentity: onChange => {
    let identity: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (identity !== undefined && identity !== next || identity === undefined && event !== 'INITIAL_SESSION') onChange();
      identity = next;
    }); return () => data.subscription.unsubscribe();
  },
};
