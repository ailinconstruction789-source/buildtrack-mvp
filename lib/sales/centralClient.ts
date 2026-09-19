import { supabase } from '@/lib/supabase';
import { isCentralUuid } from './centralContracts';
import type { CentralApiEnvelope, CentralCreateInput, CentralCreateResult, CentralSnapshot } from './centralContracts';

export class CentralApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
    this.name = 'CentralApiError';
  }
  get definitelyNotSaved(): boolean {
    return this.code !== 'IDEMPOTENCY_CONFLICT' &&
      ((this.status >= 400 && this.status < 500) || this.code === 'SETUP_REQUIRED' || this.code === 'FEATURE_DISABLED');
  }
}

export interface CentralApi {
  read(page: number): Promise<CentralSnapshot>;
  create(input: CentralCreateInput): Promise<CentralCreateResult>;
}

async function request<T>(path: string, body?: CentralCreateInput): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new CentralApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ BuildTrack ก่อน', 401);
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
  read: page => request<CentralSnapshot>(`/api/sales-crm/central?page=${page}`),
  create: async input => {
    const result = await request<CentralCreateResult>('/api/sales-crm/central', input);
    if (!result || !isCentralUuid(result.customerId) || typeof result.replayed !== 'boolean') {
      throw new CentralApiError('UNKNOWN_RESULT', 'ตรวจสอบผลบันทึกไม่ได้ กรุณาลองใหม่ด้วยคำขอเดิม');
    }
    return result;
  },
};
