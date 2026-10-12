import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseHistoricalCustomerEvidenceScope, parseHistoricalCustomerEvidenceSnapshot,
  type HistoricalCustomerEvidenceScope, type HistoricalCustomerEvidenceSnapshot } from './historicalCustomerEvidenceContracts';

export interface HistoricalCustomerEvidenceApi {
  read(scope: HistoricalCustomerEvidenceScope, options?: { signal?: AbortSignal }): Promise<HistoricalCustomerEvidenceSnapshot>;
  watchIdentity?(onChange: (actorId: string | null) => void): () => void;
}
export const historicalCustomerEvidenceApi: HistoricalCustomerEvidenceApi = {
  async read(input, options = {}) {
    const scope = parseHistoricalCustomerEvidenceScope(input), initial = await supabase.auth.getSession();
    if (initial.error || !initial.data.session) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const actor = bookingUuid(initial.data.session.user.id);
    if (options.signal?.aborted) throw new Error('ยกเลิกการโหลดประวัติแล้ว');
    const query = new URLSearchParams({ customerId: scope.customerId, interestId: scope.interestId || '', saleId: scope.saleId || '', page: String(scope.page) });
    const response = await fetch(`/api/sales-crm/customer-history?${query}`, { cache: 'no-store', credentials: 'omit', signal: options.signal,
      headers: { Authorization: `Bearer ${initial.data.session.access_token}` } });
    const envelope = bookingRecord(await response.json());
    if (!response.ok || response.status !== 200 || envelope.error || !('data' in envelope)) throw new Error('โหลดประวัติจากต้นทางไม่สำเร็จ');
    const snapshot = parseHistoricalCustomerEvidenceSnapshot(envelope.data, scope), current = await supabase.auth.getSession();
    if (options.signal?.aborted || current.error || current.data.session?.user.id !== actor || snapshot.actor.userId !== actor)
      throw new Error('บัญชีเปลี่ยนระหว่างโหลด กรุณาเปิดประวัติใหม่');
    return snapshot;
  },
  watchIdentity(onChange) {
    let identity: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next !== identity) { identity = next; onChange(next); }
    });
    return () => data.subscription.unsubscribe();
  },
};
