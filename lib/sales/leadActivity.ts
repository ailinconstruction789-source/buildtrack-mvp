import { supabase } from '@/lib/supabase';
import { nativeLeadId, type LifecycleLead } from './leadLifecycle';

export interface LeadActivitySnapshot { lead: Record<string, unknown>; historyExists: boolean }
export async function readLeadActivitySnapshot(customer: LifecycleLead): Promise<LeadActivitySnapshot> {
  const id = nativeLeadId(customer);
  if (!id) throw new Error('ยังไม่มีรหัส Lead ที่เชื่อมกับลูกค้านี้ กรุณาตรวจการเชื่อมข้อมูลก่อนบันทึก');
  const result = await supabase.from('leads').select('*').eq('id', id).single();
  if (result.error) throw result.error;
  if (!result.data || result.data.id !== id) throw new Error('ไม่พบข้อมูล Lead ล่าสุด');
  // A status reset cannot erase a real, exactly linked purchase/rental history.
  const [sales, rentals] = await Promise.all([
    supabase.from('sales').select('id').eq('lead_id', id).limit(1),
    supabase.from('rental_contracts').select('id').eq('lead_id', id).limit(1),
  ]);
  if (sales.error) throw sales.error;
  if (rentals.error) throw rentals.error;
  return { lead: result.data, historyExists: Boolean(sales.data?.length || rentals.data?.length) };
}
/** Compare-and-set one summary row; this does not make the activity+summary atomic. */
export async function writeLeadActivitySummary(snapshot: LeadActivitySnapshot, patch: Record<string, unknown>): Promise<void> {
  let query = supabase.from('leads').update(patch).eq('id', snapshot.lead.id);
  query = snapshot.lead.updated_at == null ? query.is('updated_at', null) : query.eq('updated_at', snapshot.lead.updated_at);
  const result = await query.select('id').single();
  if (result.error) throw result.error;
  if (!result.data || result.data.id !== snapshot.lead.id) throw new Error('ข้อมูลลูกค้าเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
}
