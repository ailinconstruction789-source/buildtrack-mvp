import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseVisitsInput, parseVisitsResult, parseVisitsScope, parseVisitsSnapshot,
  type VisitsInput, type VisitsResult, type VisitsScope, type VisitsSnapshot } from './visitsContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, CONFLICT: 409, SCOPE_CLOSED: 409, ACTOR_CHANGED: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class VisitsApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'VisitsApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface VisitsApi {
  read(scope: VisitsScope): Promise<VisitsSnapshot>;
  save(input: VisitsInput, actorUserId: string): Promise<VisitsResult>;
}
const unknown = () => new VisitsApiError('UNKNOWN_RESULT', 'ยังยืนยันผลไม่ได้ กรุณาตรวจด้วยคำขอเดิม ห้ามสร้างคำขอใหม่');
async function request(path: string, input?: VisitsInput, actorUserId?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new VisitsApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  const actor = bookingUuid(data.session.user.id);
  if (input && actor !== actorUserId) throw new VisitsApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป ให้กลับเข้าบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new VisitsApiError(failure.code, failure.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  return { data: envelope.data, status: response.status, actor };
}
export const visitsApi: VisitsApi = {
  read: async scope => {
    let normalized: VisitsScope;
    try { normalized = parseVisitsScope(scope); } catch { throw new VisitsApiError('INVALID_INPUT', 'ลูกค้า โครงการที่สนใจ หรือลำดับหน้าไม่ถูกต้อง', 400); }
    const response = await request(`/api/sales-crm/visits?${new URLSearchParams({ customerId: normalized.customerId, interestId: normalized.interestId,
      appointmentPage: String(normalized.appointmentPage), visitPage: String(normalized.visitPage), eventPage: String(normalized.eventPage) })}`);
    try {
      const snapshot = parseVisitsSnapshot(response.data, normalized);
      if (response.status !== 200 || snapshot.actor.userId !== response.actor) throw unknown();
      return snapshot;
    } catch { throw new VisitsApiError('READ_UNAVAILABLE', 'ตรวจนัดหมายและการเข้าชมไม่ได้ กรุณาโหลดใหม่'); }
  },
  save: async (input, actor) => {
    let normalized: VisitsInput;
    try { normalized = parseVisitsInput(input); } catch { throw new VisitsApiError('INVALID_INPUT', 'ข้อมูลนัดหมายหรือการเข้าชมไม่ถูกต้อง', 400); }
    const response = await request('/api/sales-crm/visits', normalized, actor);
    try { const result = parseVisitsResult(response.data, normalized); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
};
