import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseProjectInterestInput, parseProjectInterestResult, parseProjectInterestsScope, parseProjectInterestsSnapshot,
  type ProjectInterestInput, type ProjectInterestResult, type ProjectInterestsScope, type ProjectInterestsSnapshot } from './projectInterestsContracts';

const definitive: Record<string, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  STALE_STATE: 409, SCOPE_CLOSED: 409, PROJECT_EXISTS: 409, PLOT_UNAVAILABLE: 409, ACTOR_CHANGED: 409,
  PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SETUP_REQUIRED: 503, FEATURE_DISABLED: 503 };
export class ProjectInterestsApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'ProjectInterestsApiError'; }
  get definitelyNotSaved() { return Object.hasOwn(definitive, this.code) && definitive[this.code] === this.status; }
}
export interface ProjectInterestsApi {
  read(scope: ProjectInterestsScope): Promise<ProjectInterestsSnapshot>;
  save(input: ProjectInterestInput, expectedActor: string): Promise<ProjectInterestResult>;
  watchIdentity?(onChange: () => void): () => void;
}
const unknown = () => new ProjectInterestsApiError('UNKNOWN_RESULT', 'ยังยืนยันผลไม่ได้ ให้ตรวจด้วยคำขอเดิม ห้ามเริ่มคำขอใหม่');
async function request(path: string, input?: ProjectInterestInput, expectedActor?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ProjectInterestsApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
  let actor: string;
  try { actor = bookingUuid(data.session.user.id); } catch { throw new ProjectInterestsApiError('UNAUTHENTICATED', 'ตรวจบัญชีไม่ได้ กรุณาเข้าสู่ระบบใหม่', 401); }
  if (input && actor !== expectedActor) throw new ProjectInterestsApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนแล้ว ให้กลับบัญชีเดิมเพื่อตรวจคำขอค้าง', 409);
  let response: Response, envelope: Record<string, unknown>;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    envelope = bookingRecord(await response.json());
  } catch { throw unknown(); }
  if (!response.ok && !('data' in envelope) && envelope.error) {
    let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unknown(); }
    if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new ProjectInterestsApiError(failure.code, failure.message, response.status);
  }
  if (!response.ok || !('data' in envelope) || 'error' in envelope) throw unknown();
  return { data: envelope.data, status: response.status, actor };
}
export const projectInterestsApi: ProjectInterestsApi = {
  read: async scope => {
    let normalized: ProjectInterestsScope;
    try { normalized = parseProjectInterestsScope(scope); } catch { throw new ProjectInterestsApiError('INVALID_INPUT', 'ลูกค้าหรือลำดับหน้าไม่ถูกต้อง', 400); }
    const response = await request(`/api/sales-crm/interests?${new URLSearchParams({ customerId: normalized.customerId, page: String(normalized.page) })}`);
    const after = await supabase.auth.getSession();
    if (after.error || !after.data.session || after.data.session.user.id !== response.actor) {
      throw new ProjectInterestsApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', 409);
    }
    try {
      const result = parseProjectInterestsSnapshot(response.data, normalized);
      if (response.status !== 200 || result.actor.userId !== response.actor) throw unknown();
      return result;
    } catch { throw new ProjectInterestsApiError('READ_UNAVAILABLE', 'ตรวจข้อมูลโครงการที่สนใจไม่ได้ กรุณาโหลดใหม่'); }
  },
  save: async (input, expectedActor) => {
    let normalized: ProjectInterestInput;
    try { normalized = parseProjectInterestInput(input); } catch { throw new ProjectInterestsApiError('INVALID_INPUT', 'กรุณาตรวจโครงการ แปลง และเหตุผล', 400); }
    const response = await request('/api/sales-crm/interests', normalized, expectedActor);
    try {
      const result = parseProjectInterestResult(response.data, normalized);
      if (response.status !== (result.replayed ? 200 : 201)) throw unknown();
      return result;
    } catch { throw unknown(); }
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
