import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseSalesReportScope, parseSalesReportSnapshot, type SalesReportScope, type SalesReportSnapshot } from './salesReportsContracts';

export class SalesReportsApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'SalesReportsApiError'; }
}
export interface SalesReportsApi { read(scope: SalesReportScope): Promise<SalesReportSnapshot> }
const unavailable = () => new SalesReportsApiError('READ_UNAVAILABLE', 'ตรวจรายงานไม่ได้ กรุณาโหลดใหม่');
export const salesReportsApi: SalesReportsApi = {
  read: async scope => {
    let normalized: SalesReportScope;
    try { normalized = parseSalesReportScope(scope); } catch { throw new SalesReportsApiError('INVALID_INPUT', 'กรุณาเลือกโครงการและช่วงวันที่ Lead ใหม่', 400); }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new SalesReportsApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401);
    let actor: string; try { actor = bookingUuid(data.session.user.id); } catch { throw unavailable(); }
    const params = new URLSearchParams();
    if (normalized.projectName !== null) params.set('projectName', normalized.projectName);
    if (normalized.fromDate !== null && normalized.toDate !== null) { params.set('fromDate', normalized.fromDate); params.set('toDate', normalized.toDate); }
    let response: Response, envelope: Record<string, unknown>;
    try {
      response = await fetch(`/api/sales-crm/reports?${params}`, { method: 'GET', cache: 'no-store', credentials: 'omit',
        headers: { Authorization: `Bearer ${data.session.access_token}` } });
      envelope = bookingRecord(await response.json());
    } catch { throw unavailable(); }
    if (!response.ok && !('data' in envelope) && envelope.error) {
      let failure: Record<string, unknown>; try { failure = bookingRecord(envelope.error); } catch { throw unavailable(); }
      if (typeof failure.code === 'string' && typeof failure.message === 'string') throw new SalesReportsApiError(failure.code, failure.message, response.status);
    }
    if (!response.ok || response.status !== 200 || !('data' in envelope) || 'error' in envelope) throw unavailable();
    try {
      const snapshot = parseSalesReportSnapshot(envelope.data, normalized);
      if (snapshot.actor.userId !== actor) throw unavailable();
      return snapshot;
    } catch { throw unavailable(); }
  },
};
