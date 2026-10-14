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
export interface SalesTimelineEntry { id?: string; status: string; timestamp: string; note: string }

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

/** Keep every real transition. Date-only fallbacks fill gaps without repeating recorded milestones. */
export function mergeSalesTimeline(recorded: SalesTimelineEntry[], fallback: SalesTimelineEntry[]): SalesTimelineEntry[] {
  const milestones = new Set(recorded.map(row => JSON.stringify([row.status, customerBusinessDay(row.timestamp)])));
  return [...recorded, ...fallback.filter(row => !milestones.has(JSON.stringify([row.status, customerBusinessDay(row.timestamp)])))]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
