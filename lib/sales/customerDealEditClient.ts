import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseCustomerDealEditInput, parseCustomerDealEditResult, customerDealEditScope, parseCustomerDealEditSnapshot,
  type CustomerDealEditInput, type CustomerDealEditResult, type CustomerDealEditSnapshot } from './customerDealEditContracts';
import type { CustomerDealReadScope } from './customerDealReadContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, CONFLICT: 409, ACTOR_CHANGED: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class CustomerDealEditApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'CustomerDealEditApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface CustomerDealEditApi {
  read(scope: CustomerDealReadScope, options?: { signal?: AbortSignal }): Promise<CustomerDealEditSnapshot>;
  save(input: CustomerDealEditInput, actorUserId: string): Promise<CustomerDealEditResult>;
}
const unknown = () => new CustomerDealEditApiError('UNKNOWN_RESULT', 'ยังยืนยันผลไม่ได้ กรุณาตรวจด้วยคำขอเดิม ห้ามสร้างคำขอใหม่');
async function request(path: string, input?: CustomerDealEditInput, actorUserId?: string, signal?: AbortSignal) {
  const { data, error } = await supabase.auth.getSession();
  if (signal?.aborted) throw new CustomerDealEditApiError('READ_UNAVAILABLE', 'ยกเลิกการโหลดแล้ว');
  if (error || !data.session) throw new CustomerDealEditApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  const actor = bookingUuid(data.session.user.id);
  if (input && actor !== actorUserId) throw new CustomerDealEditApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป ให้กลับเข้าบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', signal,
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new CustomerDealEditApiError(failure.code, failure.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  // A reply started under the previous account must not populate the new session.
  // A write may already have committed: keep its original pending command uncertain.
  try {
    const current = await supabase.auth.getSession();
    if (signal?.aborted || current.error || current.data.session?.user.id !== actor) throw new Error('actor changed');
  } catch {
    if (input) throw unknown();
    throw new CustomerDealEditApiError('READ_UNAVAILABLE', 'บัญชีเปลี่ยนระหว่างโหลด กรุณาเปิดรายการใหม่');
  }
  return { data: envelope.data, status: response.status, actor };
}
export const customerDealEditApi: CustomerDealEditApi = {
  read: async (scope, options = {}) => {
    let normalized: CustomerDealReadScope;
    try { normalized = customerDealEditScope(scope); } catch { throw new CustomerDealEditApiError('INVALID_INPUT', 'รหัสรายการหรือโครงการไม่ถูกต้อง', 400); }
    const response = await request(`/api/sales-crm/customer-deal/details?${new URLSearchParams({ ...normalized })}`, undefined, undefined, options.signal);
    try {
      const snapshot = parseCustomerDealEditSnapshot(response.data, normalized);
      if (response.status !== 200 || snapshot.actor.userId !== response.actor) throw unknown();
      return snapshot;
    } catch { throw new CustomerDealEditApiError('READ_UNAVAILABLE', 'ตรวจข้อมูลลูกค้าและดีลไม่ได้ กรุณาโหลดใหม่'); }
  },
  save: async (input, actor) => {
    let normalized: CustomerDealEditInput;
    try { normalized = parseCustomerDealEditInput(input); } catch { throw new CustomerDealEditApiError('INVALID_INPUT', 'ข้อมูลลูกค้าและดีลไม่ถูกต้อง', 400); }
    const response = await request('/api/sales-crm/customer-deal/details', normalized, actor);
    try { const result = parseCustomerDealEditResult(response.data, normalized); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
};
