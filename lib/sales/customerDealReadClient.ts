import { supabase } from '@/lib/supabase';
import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseCustomerDealReadScope, parseCustomerDealReadSnapshot, type CustomerDealReadScope } from './customerDealReadContracts';

export const customerDealReadApi = {
  async read(input: CustomerDealReadScope, options: { signal?: AbortSignal } = {}) {
    const scope = parseCustomerDealReadScope(input);
    const initial = await supabase.auth.getSession();
    if (initial.error || !initial.data.session) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const actor = bookingUuid(initial.data.session.user.id);
    if (options.signal?.aborted) throw new Error('ยกเลิกการโหลดรายละเอียดแล้ว');
    const response = await fetch(`/api/sales-crm/customer-deal?${new URLSearchParams({ ...scope })}`, {
      cache: 'no-store', credentials: 'omit', signal: options.signal, headers: { Authorization: `Bearer ${initial.data.session.access_token}` },
    });
    const raw = bookingRecord(await response.json());
    if (!response.ok || response.status !== 200 || raw.error || !('data' in raw)) throw new Error('โหลดข้อมูลลูกค้า CRM ไม่สำเร็จ');
    const snapshot = parseCustomerDealReadSnapshot(raw.data, scope);
    const current = await supabase.auth.getSession();
    if (current.error || current.data.session?.user.id !== actor || snapshot.actor.userId !== actor) throw new Error('บัญชีเปลี่ยนระหว่างโหลด กรุณาเปิดรายการใหม่');
    return snapshot;
  },
};
