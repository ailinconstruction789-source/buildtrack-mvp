import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseRentalCommandInput, parseRentalCommandResult, parseRentalCommandSnapshot,
  type RentalCommandInput, type RentalCommandResult, type RentalCommandSnapshot } from './rentalCommandContracts';
import { parseRentalCommandScope, type RentalCommandScope } from './rentalCommandContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, CONFLICT: 409, ACTOR_CHANGED: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class RentalCommandApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'RentalCommandApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface RentalCommandApi {
  read(scope: RentalCommandScope, options?: { signal?: AbortSignal }): Promise<RentalCommandSnapshot>;
  save(input: RentalCommandInput, actorUserId: string): Promise<RentalCommandResult>;
  watchIdentity?(onChange: () => void): () => void;
}
const unknown = () => new RentalCommandApiError('UNKNOWN_RESULT', 'ยังยืนยันผลไม่ได้ กรุณาตรวจด้วยคำขอเดิม ห้ามสร้างคำขอใหม่');
async function request(path: string, input?: RentalCommandInput, actorUserId?: string, signal?: AbortSignal) {
  const { data, error } = await supabase.auth.getSession();
  if (signal?.aborted) throw new RentalCommandApiError('READ_UNAVAILABLE', 'ยกเลิกการโหลดแล้ว');
  if (error || !data.session) throw new RentalCommandApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  const actor = bookingUuid(data.session.user.id);
  if (input && actor !== actorUserId) throw new RentalCommandApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป ให้กลับเข้าบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', signal,
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new RentalCommandApiError(failure.code, failure.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  // A reply started under the previous account must not populate the new session.
  // A write may already have committed: keep its original pending command uncertain.
  try {
    const current = await supabase.auth.getSession();
    if (signal?.aborted || current.error || current.data.session?.user.id !== actor) throw new Error('actor changed');
  } catch {
    if (input) throw unknown();
    throw new RentalCommandApiError('READ_UNAVAILABLE', 'บัญชีเปลี่ยนระหว่างโหลด กรุณาเปิดรายการใหม่');
  }
  return { data: envelope.data, status: response.status, actor };
}
export const rentalCommandApi: RentalCommandApi = {
  read: async (scope, options = {}) => {
    let normalized: RentalCommandScope;
    try { normalized = parseRentalCommandScope(scope); } catch { throw new RentalCommandApiError('INVALID_INPUT', 'รหัสลูกค้า สัญญา หรือโครงการไม่ถูกต้อง', 400); }
    const response = await request(`/api/sales-crm/rentals?${new URLSearchParams({ customerId: normalized.customerId, projectName: normalized.projectName,
      ...(normalized.contractId ? { contractId: normalized.contractId } : {}), contractPage: String(normalized.contractPage), eventPage: String(normalized.eventPage), paymentPage: String(normalized.paymentPage), plotPage: String(normalized.plotPage) })}`, undefined, undefined, options.signal);
    try {
      const snapshot = parseRentalCommandSnapshot(response.data, normalized);
      if (response.status !== 200 || snapshot.actor.userId !== response.actor) throw unknown();
      return snapshot;
    } catch { throw new RentalCommandApiError('READ_UNAVAILABLE', 'ตรวจข้อมูลการเช่าไม่ได้ กรุณาโหลดใหม่'); }
  },
  save: async (input, actor) => {
    let normalized: RentalCommandInput;
    try { normalized = parseRentalCommandInput(input); } catch { throw new RentalCommandApiError('INVALID_INPUT', 'ข้อมูลการเช่าไม่ถูกต้อง', 400); }
    const response = await request('/api/sales-crm/rentals', normalized, actor);
    try { const result = parseRentalCommandResult(response.data, normalized); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
  watchIdentity: onChange => {
    let identity: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if ((identity !== undefined && identity !== next) || (identity === undefined && event !== 'INITIAL_SESSION')) onChange();
      identity = next;
    });
    return () => data.subscription.unsubscribe();
  },
};
