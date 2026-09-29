import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseProjectSalesScope, parseProjectSalesSnapshot, type ProjectSalesScope, type ProjectSalesSnapshot } from './projectSalesContracts';

export class ProjectSalesApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'ProjectSalesApiError'; }
}
export interface ProjectSalesApi { read(scope: ProjectSalesScope): Promise<ProjectSalesSnapshot> }
const unavailable = () => new ProjectSalesApiError('READ_UNAVAILABLE', 'ตรวจข้อมูลลูกค้าจองไม่ได้ กรุณาโหลดใหม่');
export const projectSalesApi: ProjectSalesApi = {
  read: async scope => {
    let normalized: ProjectSalesScope;
    try { normalized = parseProjectSalesScope(scope); } catch { throw new ProjectSalesApiError('INVALID_INPUT', 'กรุณาเลือกโครงการและตัวกรองใหม่', 400); }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new ProjectSalesApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
    let actor: string; try { actor = bookingUuid(data.session.user.id); } catch { throw unavailable(); }
    const params = new URLSearchParams({ tab: normalized.tab, q: normalized.query, page: String(normalized.page) });
    if (normalized.projectName !== null) params.set('projectName', normalized.projectName);
    let response: Response, envelope: Record<string, unknown>;
    try {
      response = await fetch(`/api/sales-crm/project-sales?${params}`, { method: 'GET', cache: 'no-store', credentials: 'omit',
        headers: { Authorization: `Bearer ${data.session.access_token}` } });
      envelope = bookingRecord(await response.json());
    } catch { throw unavailable(); }
    if (!response.ok && !('data' in envelope) && envelope.error) {
      let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unavailable(); }
      if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new ProjectSalesApiError(failure.code, failure.message, response.status);
    }
    if (!response.ok || response.status !== 200 || !('data' in envelope) || 'error' in envelope) throw unavailable();
    try {
      const snapshot = parseProjectSalesSnapshot(envelope.data, normalized);
      if (snapshot.actor.userId !== actor) throw unavailable();
      return snapshot;
    } catch { throw unavailable(); }
  },
};
