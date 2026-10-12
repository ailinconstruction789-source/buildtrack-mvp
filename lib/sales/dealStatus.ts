import { CASH_BANK_OPTION } from './banks';
import { PURCHASE_NEXT, purchaseNextStages } from './purchaseFlow';

export const salesDealStages = [
  { id: 'booked', label: 'Booked — จองแล้ว' },
  { id: 'contracted', label: 'Contracted — ทำสัญญาแล้ว' },
  { id: 'downpayment', label: 'Contracted — ชำระเงินดาวน์' },
  { id: 'document_prep', label: 'Contracted — เตรียมเอกสาร' },
  { id: 'loan_submitted', label: 'Loan Pre-Approval — อยู่ระหว่างเช็ก/ยื่น Pre-Approve' },
  { id: 'loan_rejected', label: 'Contracted — สินเชื่อไม่ผ่าน รอยื่นใหม่' },
  { id: 'loan_approved', label: 'Loan Approved — สินเชื่อผ่าน' },
  { id: 'transfer_pending', label: 'Transfer Pending — รอโอน' },
  { id: 'transferred', label: 'Transferred — โอนกรรมสิทธิ์แล้ว' },
  { id: 'handover', label: 'Handover — ส่งมอบบ้านแล้ว' },
  { id: 'cancelled', label: 'Cancelled — ยกเลิกจอง' },
];
export const nextSalesDealStages = PURCHASE_NEXT;
export function salesDealNextStages(stage: string, method: string): string[] {
  return purchaseNextStages(stage, method);
}
export function salesDealPaymentMethodOf(row: Record<string, unknown>): 'cash' | 'mortgage' {
  if (row.payment_method === 'cash' || row.payment_method === 'mortgage') return row.payment_method;
  const notes = String(row.notes || '');
  const latestMethod = notes.match(/• วิธีชำระเงิน: (เงินสด|กู้ธนาคาร)/)?.[1];
  if (latestMethod) return latestMethod === 'เงินสด' ? 'cash' : 'mortgage';
  if (row.bank_name) return row.bank_name === CASH_BANK_OPTION ? 'cash' : 'mortgage';
  return /เงินจองที่รับ:[^\n]*\(เงินสด\)/.test(notes) ? 'cash' : 'mortgage';
}
export function salesDealLeadStatus(stage: string): string {
  return stage === 'booked' ? 'Booked' : stage === 'transferred' ? 'Transferred' : stage === 'handover' ? 'Handover' : stage === 'cancelled' ? 'Cancelled' : 'Contracted';
}
export function salesDealContractStatus(stage: string): string {
  return stage === 'booked' ? 'Reserved' : ['transferred', 'handover'].includes(stage) ? 'Transferred' : stage === 'cancelled' ? 'Cancelled' : 'Contracted';
}
export function salesDealTransitionError(initial: string, target: string, method: string, evidence: {
  bank: string; reason: string; date: string; confirmed: boolean; saleId: string | null;
}): string | null {
  if (method === 'cash' && (initial.startsWith('loan_') || target.startsWith('loan_'))) return 'สถานะสินเชื่อไม่ตรงกับวิธีชำระเงินสด กรุณาตรวจข้อมูลก่อนบันทึก';
  if (initial === target) return null;
  if (!salesDealNextStages(initial, method).includes(target)) return 'ขั้นตอนนี้ไม่ตรงกับสถานะปัจจุบันหรือวิธีชำระเงิน';
  if (target === 'loan_submitted' && (!evidence.bank.trim() || evidence.bank === CASH_BANK_OPTION)) return 'กรุณาเลือกธนาคารก่อนยื่นสินเชื่อ';
  if (['loan_rejected', 'cancelled'].includes(target) && !evidence.reason.trim()) return 'กรุณาระบุเหตุผล';
  if (['transferred', 'handover', 'cancelled'].includes(target)) {
    if (!evidence.saleId) return 'ยังไม่มีรายการขายที่เชื่อมกับ Lead กรุณาตรวจการเชื่อมข้อมูลก่อนโอน ส่งมอบ หรือยกเลิก';
    const stamp = new Date(evidence.date + 'T12:00:00+07:00');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.date) || !Number.isFinite(stamp.getTime())
      || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(stamp) !== evidence.date) return 'กรุณาระบุวันที่ทำรายการที่ถูกต้อง';
    if (!evidence.confirmed) return 'กรุณายืนยันรายการก่อนบันทึก';
  }
  return null;
}
export function salesDealStageOf(lead: Record<string, unknown>): string {
  const nativeStatus = String(lead.status || lead.contract_status || lead.intakeStatus || '').toLowerCase().replace(/[ _-]/g, '');
  const stage = lead.crmStage ?? lead.crm_stage;
  if (['cancelled', 'canceled', 'lost'].includes(nativeStatus)) return 'cancelled';
  if (nativeStatus === 'handover' || (nativeStatus === 'transferred' && stage === 'handover')) return 'handover';
  if (nativeStatus === 'transferred') return 'transferred';
  if (typeof stage === 'string' && salesDealStages.some(s => s.id === stage)) return stage;
  const crm = String(lead.crm_status || '');
  if (crm.includes('ส่งมอบบ้านแล้ว')) return 'handover';
  if (crm.includes('สินเชื่อไม่ผ่าน')) return 'loan_rejected';
  if (crm.includes('รอโอน')) return 'transfer_pending';
  if (crm.includes('สินเชื่อผ่าน')) return 'loan_approved';
  if (crm.includes('Pre-Approval')) return 'loan_submitted';
  if (crm.includes('เตรียมเอกสาร')) return 'document_prep';
  if (crm.includes('เงินดาวน์')) return 'downpayment';
  const native: Record<string, string> = { contracted: 'contracted', downpayment: 'downpayment', documentprep: 'document_prep', loanprocessing: 'loan_submitted', loanrejected: 'loan_rejected', approved: 'loan_approved', transferpending: 'transfer_pending' };
  return native[nativeStatus] || 'booked';
}

export function salesDealActionLabel(row: Record<string, unknown>, canWrite: boolean): string {
  const stage = salesDealStageOf(row);
  if (canWrite && stage === 'transferred' && (row.leadId || row.saleId)) return 'อัปเดตส่งมอบ';
  return canWrite && !['transferred', 'handover', 'cancelled'].includes(stage) ? 'อัปเดตสถานะ' : 'ดูสถานะ';
}
