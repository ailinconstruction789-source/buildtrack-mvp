import { getLeadStage, type LeadStageInput } from './leadStage';

export interface LifecycleLead extends LeadStageInput {
  id?: unknown; customer_name?: unknown; leadId?: unknown; notes?: unknown;
  contract_status?: unknown; crm_stage?: unknown; crmStage?: unknown;
  contracted_at?: unknown; saleId?: unknown; active_rental_contract_id?: unknown;
  project_interest_id?: unknown; crmCustomerId?: unknown; sourceKind?: unknown;
  actual_visit_date?: unknown; rental_end_date?: unknown;
}
const text = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
/** The CRM customer's ID is not automatically a public.leads ID. */
export function nativeLeadId(lead: LifecycleLead): string | null {
  if (typeof lead.leadId === 'string' && lead.leadId.trim()) return lead.leadId;
  if ('leadId' in lead || lead.saleId || lead.project_interest_id || lead.crmCustomerId
    || (lead.sourceKind != null && lead.sourceKind !== 'lead')) return null;
  return typeof lead.customer_name === 'string' && typeof lead.id === 'string' && lead.id.trim() ? lead.id : null;
}
/** Even a cancelled purchase/rental is history, not an ordinary pre-booking Lost. */
export function hasDealHistory(lead: LifecycleLead): boolean {
  if (lead.saleId || lead.active_rental_contract_id || lead.booking_date || lead.booking_amount != null
    || lead.contracted_at || lead.transferred_date || lead.transferredAt || lead.rental_status || lead.rental_end_date) return true;
  if ([lead.status, lead.crm_status, lead.intakeStatus, lead.contract_status, lead.crm_stage, lead.crmStage]
    .some(value => /book|reserv|contract|downpayment|document.?prep|loan|approved|transfer|handover|cancel|rent|moved.?out|จอง|สัญญา|สินเชื่อ|ยื่นกู้|โอน|ส่งมอบ|ยกเลิก|เช่า|ย้ายออก/.test(text(value)))) return true;
  return /🏷️ บันทึกการจอง|สัญญาเช่า|ผู้เช่า/.test(String(lead.notes || ''));
}
export function isPreBookingLost(lead: LifecycleLead): boolean {
  return getLeadStage(lead) === 'lost' && !hasDealHistory(lead);
}
export function canMarkLeadLost(lead: LifecycleLead, linkedHistoryExists = false): boolean {
  return !linkedHistoryExists && !hasDealHistory(lead) && ['active', 'appointment'].includes(getLeadStage(lead));
}
export function followUpStatusPatch(lead: LifecycleLead, requested: string, linkedHistoryExists: boolean): Record<string, string> {
  if (requested === 'Lost' && !canMarkLeadLost(lead, linkedHistoryExists)) {
    throw new Error('ลูกค้าที่มีประวัติจอง ซื้อ หรือเช่า ต้องอัปเดตผลในรายการนั้น ไม่เปลี่ยนเป็น Lost');
  }
  if (linkedHistoryExists || hasDealHistory(lead) || !['active', 'appointment'].includes(getLeadStage(lead))) return {};
  if (!['Follow Up', 'Contacted', 'Interested', 'Lost', 'Unqualified', 'Nurture'].includes(requested)) {
    throw new Error('กรุณาเลือกสถานะการติดตามที่ถูกต้อง');
  }
  return { status: requested, crm_status: requested === 'Lost' ? 'Lost — ไม่สนใจ / ยุติการติดตาม' : requested };
}

/** Review only. No writes/imports and no name-based identity matching. */
export function planLegacyLeadReplacement(leads: readonly LifecycleLead[], historyLeadIds: ReadonlySet<string>) {
  const candidates: string[] = [];
  const excluded: { id: string | null; reason: 'deal_history' | 'not_follow_up' | 'identity_missing' | 'duplicate_identity' }[] = [];
  const frequencies = new Map<string, number>();
  for (const lead of leads) { const id = nativeLeadId(lead); if (id) frequencies.set(id, (frequencies.get(id) || 0) + 1); }
  for (const lead of leads) {
    const id = nativeLeadId(lead);
    if (!id) { excluded.push({ id, reason: 'identity_missing' }); continue; }
    if (frequencies.get(id)! > 1) { excluded.push({ id, reason: 'duplicate_identity' }); continue; }
    if (historyLeadIds.has(id) || hasDealHistory(lead)) { excluded.push({ id, reason: 'deal_history' }); continue; }
    if (!canMarkLeadLost(lead)) { excluded.push({ id, reason: 'not_follow_up' }); continue; }
    const status = text(lead.status);
    if (!['visit', 'follow up', 'follow-up', 'follow_up', 'contacted', 'interested', 'active', 'new'].includes(status)) {
      excluded.push({ id, reason: 'not_follow_up' }); continue;
    }
    candidates.push(id);
  }
  return { candidates, excluded, executable: false as const,
    replacementScope: 'existing_visit_records' as const,
    requires: ['reviewed_customer_links', 'history_inventory', 'approved_import_manifest', 'explicit_execution_approval'] as const };
}
