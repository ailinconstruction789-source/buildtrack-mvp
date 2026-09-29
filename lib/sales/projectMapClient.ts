import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { ProjectSalesApiError } from './projectSalesClient';
import { parseProjectMapName, parseProjectMapSnapshot, type ProjectMapSnapshot } from './projectMapContracts';

export interface ProjectMapApi { read(projectName: string): Promise<ProjectMapSnapshot> }
const unavailable = () => new ProjectSalesApiError('READ_UNAVAILABLE', 'โหลดผังโครงการไม่ได้ กรุณาลองใหม่');
export const projectMapApi: ProjectMapApi = {
  async read(projectName) {
    const name = parseProjectMapName(projectName);
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new ProjectSalesApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
    const actor = bookingUuid(data.session.user.id);
    let response: Response, envelope: Record<string, unknown>;
    try {
      response = await fetch(`/api/sales-crm/project-map?${new URLSearchParams({ projectName: name })}`, {
        method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      envelope = bookingRecord(await response.json());
    } catch { throw unavailable(); }
    if (!response.ok && !('data' in envelope) && envelope.error) {
      const failure = bookingRecord(envelope.error);
      // Do not display arbitrary server/proxy error text to the user.
      if (failure.code === 'UNAUTHENTICATED') throw new ProjectSalesApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่', 401);
      if (failure.code === 'FORBIDDEN') throw new ProjectSalesApiError('FORBIDDEN', 'คุณไม่มีสิทธิ์ดูผังฝ่ายขาย', 403);
      throw unavailable();
    }
    if (response.status !== 200 || !('data' in envelope) || 'error' in envelope) throw unavailable();
    try {
      const snapshot = parseProjectMapSnapshot(envelope.data, name);
      if (snapshot.actor.userId !== actor) throw unavailable();
      return snapshot;
    } catch { throw unavailable(); }
  },
};
