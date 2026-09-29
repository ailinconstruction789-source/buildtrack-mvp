import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid, parseBookingInput, parseBookingContext, parseBookingResult, parseBookingSearch, type BookingInput, type BookingContext, type BookingResult, type BookingSearch } from './bookingContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, CONFLICT: 409, PLOT_UNAVAILABLE: 409, DUPLICATE_REVIEW_REQUIRED: 409, ACTOR_CHANGED: 409,
  PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class BookingApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'BookingApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface BookingApi {
  read(customerId: string | null, page: number): Promise<BookingContext>;
  search(query: string, page: number): Promise<BookingSearch>;
  save(input: BookingInput, actorUserId: string): Promise<BookingResult>;
}
const unknown = () => new BookingApiError('UNKNOWN_RESULT', 'ยังยืนยันผลไม่ได้ กรุณาลองด้วยคำขอเดิม ห้ามสร้างคำขอใหม่');
async function request(path: string, input?: BookingInput, actorUserId?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new BookingApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  const sessionActor = bookingUuid(data.session.user.id);
  if (input && sessionActor !== actorUserId) throw new BookingApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนไป กรุณากลับเข้าบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response;
  try { response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}) }); } catch { throw unknown(); }
  let envelope; try { envelope = bookingRecord(await response.json()); } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    const err = bookingRecord(envelope.error);
    if (typeof err.code === 'string' && typeof err.message === 'string') throw new BookingApiError(err.code, err.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  return { data: envelope.data, status: response.status, actorUserId: sessionActor };
}
export const bookingApi: BookingApi = {
  read: async (customerId, page) => {
    const params = new URLSearchParams({ page: String(page) }); if (customerId) params.set('customerId', customerId);
    const response = await request(`/api/sales-crm/bookings?${params}`);
    try {
      const context = parseBookingContext(response.data, customerId, page);
      if (context.actor.userId !== response.actorUserId || response.status !== 200) throw unknown();
      return context;
    } catch { throw new BookingApiError('READ_UNAVAILABLE', 'ตรวจสอบข้อมูลการจองไม่ได้ กรุณาโหลดใหม่'); }
  },
  search: async (query, page) => {
    const response = await request(`/api/sales-crm/bookings/search?${new URLSearchParams({ q: query, page: String(page) })}`);
    try { if (response.status !== 200) throw unknown(); return parseBookingSearch(response.data, page); }
    catch { throw new BookingApiError('READ_UNAVAILABLE', 'ตรวจสอบผลค้นหาไม่ได้ กรุณาลองใหม่'); }
  },
  save: async (input, actor) => {
    let parsed: BookingInput; try { parsed = parseBookingInput(input); } catch { throw new BookingApiError('INVALID_INPUT', 'ข้อมูลการจองไม่ครบหรือไม่ถูกต้อง', 400); }
    const response = await request('/api/sales-crm/bookings', parsed, actor);
    try { const result = parseBookingResult(response.data, parsed); if (response.status !== (result.replayed ? 200 : 201)) throw unknown(); return result; }
    catch { throw unknown(); }
  },
};
