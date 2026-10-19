export type LeadStage = 'active' | 'appointment' | 'loan' | 'booked' | 'transferred' | 'rented' | 'lost';

export interface LeadStageInput {
  status?: unknown; crm_status?: unknown; intakeStatus?: unknown;
  notes?: unknown; auto_status?: unknown; booking_date?: unknown; booking_amount?: unknown;
  transferred_date?: unknown; transferredAt?: unknown; appointment_date?: unknown;
  rental_status?: unknown;
}

const text = (value: unknown) => typeof value === 'string' ? value.toLowerCase().trim() : '';
function explicitStage(value: string): LeadStage | null {
  if (/\b(lost|cancelled|canceled|closed_lost|dropped|unqualified|nurture|cold|movedout)\b|ยกเลิก|ไม่สนใจ|ยุติการซื้อ|สิ้นสุดสัญญา|ย้ายออก/.test(value)) return 'lost';
  if (/\b(transferred|closed_won|handover)\b|โอนกรรมสิทธิ์|โอนแล้ว/.test(value)) return 'transferred';
  if (/\b(booked|reserved|contracted|downpayment|documentprep|loanprocessing|loanrejected|approved|transfer[ _-]?pending|pendingcontract)\b|วางเงินจอง|จองแล้ว|จองเช่า|รอทำสัญญา|ทำสัญญาแล้ว/.test(value)) return 'booked';
  if (!value.includes('converted') && /rent|เช่า/.test(value)) return 'rented';
  if (/loan|pre.approv|สินเชื่อ|ยื่นกู้|เช็คเครดิต|เช็กเครดิต/.test(value)) return 'loan';
  if (/appointment|visit|นัด/.test(value)) return 'appointment';
  if (/^(active|new|follow[ _-]?up|contacted)$/.test(value)) return 'active';
  return null;
}

/** Current structured state wins over historical booking/rental notes. */
export function getLeadStage(lead: LeadStageInput | null | undefined): LeadStage {
  if (!lead) return 'active';
  const structured = [lead.status, lead.crm_status, lead.intakeStatus].map(value => explicitStage(text(value)));
  for (const stage of ['lost', 'transferred', 'rented', 'booked', 'loan', 'appointment', 'active'] as const) {
    if (structured.includes(stage)) return stage;
  }
  if (/^follow[ _-]?up$/.test(text(lead.status)) && /^follow[ _-]?up$/.test(text(lead.crm_status))) return 'active';
  if (lead.transferred_date || lead.transferredAt) return 'transferred';
  if (['active', 'renewed'].includes(text(lead.rental_status))) return 'rented';
  if (text(lead.rental_status) === 'pendingcontract') return 'booked';
  const notes = text(lead.notes);
  if (notes.includes('🏷️ บันทึกการจอง') || text(lead.auto_status).includes('จองแปลง') || lead.booking_date || lead.booking_amount != null) return 'booked';
  if (notes.includes('สัญญาเช่า') || notes.includes('ผู้เช่า')) return 'rented';
  if (lead.appointment_date) return 'appointment';
  return 'active';
}

export function isProtectedDealStage(lead: LeadStageInput | null | undefined): boolean {
  return ['booked', 'transferred', 'rented', 'lost', 'loan'].includes(getLeadStage(lead));
}

/** Omit deal fields from activity writes, rather than resending a stale snapshot. */
export function preserveLeadDealStage<T extends Record<string, unknown>>(lead: LeadStageInput | null | undefined, patch: T): T {
  const next = { ...patch };
  if (isProtectedDealStage(lead)) { delete next.status; delete next.crm_status; }
  return next;
}

export const canStartSalesDeal = (lead: LeadStageInput) => ['active', 'appointment', 'loan'].includes(getLeadStage(lead));
export const canEditSalesRole = (role: unknown) => ['sales', 'sale', 'admin', 'administrator', 'superadmin', 'manager'].includes(text(role));
