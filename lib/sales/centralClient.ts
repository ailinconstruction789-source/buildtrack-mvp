import { supabase } from '@/lib/supabase';
import { EMPTY_CENTRAL_SEARCH, isCentralUuid, parseCentralSearchFilters, parseCentralSearchSnapshot } from './centralContracts';
import type { CentralApiEnvelope, CentralCreateInput, CentralCreateResult, CentralSearchFilters, CentralSearchSnapshot } from './centralContracts';

export class CentralApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
    this.name = 'CentralApiError';
  }
  get definitelyNotSaved(): boolean {
    const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
      SALES_OWNER_REQUIRED: 400, ACTOR_CHANGED: 409, PLOT_UNAVAILABLE: 409, DUPLICATE_REVIEW_REQUIRED: 409, CONFLICT: 409,
      PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
    return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status;
  }
}

export interface CentralApi {
  read(page: number, filters?: CentralSearchFilters): Promise<CentralSearchSnapshot>;
  create(input: CentralCreateInput, expectedActor: string): Promise<CentralCreateResult>;
  watchIdentity?(onChange: () => void): () => void;
}

async function request<T>(path: string, body?: CentralCreateInput, expectedActor?: string, token?: string): Promise<T> {
  let accessToken = token;
  if (!accessToken) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new CentralApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', 401);
    if (body && (!isCentralUuid(expectedActor) || data.session.user.id !== expectedActor)) {
      throw new CentralApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนแล้ว กรุณากลับบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
    }
    accessToken = data.session.access_token;
  }
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let envelope: CentralApiEnvelope<T>;
  try { envelope = await response.json() as CentralApiEnvelope<T>; }
  catch { throw new CentralApiError('UNKNOWN_RESULT', 'ตรวจสอบผลจากระบบไม่ได้ กรุณาลองใหม่ด้วยคำขอเดิม'); }
  if (envelope && typeof envelope === 'object' && 'error' in envelope &&
    envelope.error && typeof envelope.error.code === 'string' && typeof envelope.error.message === 'string') {
    throw new CentralApiError(envelope.error.code, envelope.error.message, response.status);
  }
  if (!response.ok || !envelope || typeof envelope !== 'object' || !('data' in envelope)) {
    throw new CentralApiError('UNKNOWN_RESULT', 'ตรวจสอบผลจากระบบไม่ได้ กรุณาลองใหม่ด้วยคำขอเดิม');
  }
  return envelope.data;
}

export const centralApi: CentralApi = {
  read: async (page, filters = EMPTY_CENTRAL_SEARCH) => {
    const normalized = parseCentralSearchFilters(filters);
    const before = await supabase.auth.getSession();
    if (before.error || !before.data.session) throw new CentralApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', 401);
    const params = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(normalized)) if (value !== '' && value !== false) params.set(key, String(value));
    const data = await request<unknown>(`/api/sales-crm/central?${params}`, undefined, undefined, before.data.session.access_token);
    const after = await supabase.auth.getSession();
    if (after.error || !after.data.session || after.data.session.user.id !== before.data.session.user.id) {
      throw new CentralApiError('UNAUTHENTICATED', 'บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดรายการใหม่', 401);
    }
    try {
      const result = parseCentralSearchSnapshot(data, normalized, page);
      if (result.actor.userId !== after.data.session.user.id) throw new Error('identity mismatch');
      return result;
    } catch { throw new CentralApiError('UNKNOWN_RESULT', 'ตรวจสอบขอบเขตผลค้นหาไม่ได้ กรุณาโหลดรายการใหม่'); }
  },
  watchIdentity: onChange => {
    let identity: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if ((identity !== undefined && next !== identity) || (identity === undefined && event !== 'INITIAL_SESSION')) onChange();
      identity = next;
    });
    return () => data.subscription.unsubscribe();
  },
  create: async (input, expectedActor) => {
    const result = await request<CentralCreateResult>('/api/sales-crm/central', input, expectedActor);
    if (!result || !isCentralUuid(result.customerId) || typeof result.replayed !== 'boolean') {
      throw new CentralApiError('UNKNOWN_RESULT', 'ตรวจสอบผลบันทึกไม่ได้ กรุณาลองใหม่ด้วยคำขอเดิม');
    }
    return result;
  },
};
