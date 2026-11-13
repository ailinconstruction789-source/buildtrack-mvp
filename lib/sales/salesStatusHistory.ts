import { supabase } from '@/lib/supabase';
import { customerBusinessDay } from './customerBusinessDate';

export interface SalesStatusHistoryRow {
  id: string;
  entity_type: 'lead' | 'sale';
  entity_id: string;
  new_status: string;
  created_at: string;
  changed_by: string | null;
}
export interface SalesTimelineEntry { id?: string; status: string; timestamp: string; note: string; recordedAt?: string | null }

/** Read only the exact selected customer's parents, with stable ordering across pages. */
export async function loadSalesStatusHistory(leadId: string | null, saleId: string | null): Promise<SalesStatusHistoryRow[]> {
  const scopes: Array<['lead' | 'sale', string]> = [];
  if (leadId) scopes.push(['lead', leadId]);
  if (saleId) scopes.push(['sale', saleId]);
  const batches = await Promise.all(scopes.map(async ([type, id]) => {
    const rows: SalesStatusHistoryRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase.from('status_history')
        .select('id,entity_type,entity_id,new_status,created_at,changed_by')
        .eq('entity_type', type).eq('entity_id', id)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 999);
      if (result.error) throw new Error(result.error.message || 'โหลดประวัติสถานะไม่สำเร็จ');
      const page = (result.data || []) as SalesStatusHistoryRow[];
      rows.push(...page.filter(row => row.entity_type === type && row.entity_id === id));
      if (page.length < 1000) return rows;
    }
  }));
  return [...new Map(batches.flat().map(row => [row.id, row])).values()];
}

export function stagePriority(status: string | null | undefined): number {
  if (!status) return 0;
  const s = String(status).toLowerCase().trim();
  if (s.includes('cancel') || s.includes('ยกเลิก') || s.includes('lost') || s.includes('ยุติ')) return 120;
  if (s.includes('handover') || s.includes('ส่งมอบ')) return 110;
  if (s.includes('transferred') || s.includes('โอนกรรมสิทธิ์') || s.includes('โอนแล้ว')) return 100;
  if (s.includes('rent') || s.includes('เช่า')) return 95;
  if (s.includes('transferpending') || s.includes('transfer_pending') || s.includes('รอโอน')) return 90;
  if (s.includes('approved') || s.includes('อนุมัติ')) return 80;
  if (s.includes('rejected') || s.includes('ไม่ผ่าน')) return 75;
  if (s.includes('loan') || s.includes('สินเชื่อ') || s.includes('ยื่นกู้') || s.includes('รอผล')) return 70;
  if (s.includes('document') || s.includes('เอกสาร')) return 60;
  if (s.includes('downpayment') || s.includes('ดาวน์')) return 50;
  if (s.includes('contract') || s.includes('สัญญา')) return 40;
  if (s.includes('reserv') || s.includes('book') || s.includes('จอง')) return 30;
  if (s.includes('negotiat') || s.includes('เจรจา')) return 20;
  if (s.includes('visit') || s.includes('เยี่ยมชม') || s.includes('follow') || s.includes('active') || s.includes('new')) return 10;
  return 0;
}

/** Keep every real transition. Date-only fallbacks fill gaps without repeating recorded milestones.
 * Orders primarily by workflow stage progression priority (e.g. Transferred / Handover at the top),
 * then by timestamp descending within the same stage.
 */
export function mergeSalesTimeline(recorded: SalesTimelineEntry[], fallback: SalesTimelineEntry[]): SalesTimelineEntry[] {
  const milestones = new Set(recorded.map(row => JSON.stringify([row.status, customerBusinessDay(row.timestamp)])));
  return [...recorded, ...fallback.filter(row => !milestones.has(JSON.stringify([row.status, customerBusinessDay(row.timestamp)])))]
    .sort((a, b) => {
      const pA = stagePriority(a.status);
      const pB = stagePriority(b.status);
      if (pA !== pB) return pB - pA;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
}
