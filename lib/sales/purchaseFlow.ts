/** Shared purchase path for Lead, Project Map and the gated CRM workspace.
 * This is a choice/validation rule, never database write authorization.
 */
export const PURCHASE_STAGES = [
  'booked', 'contracted', 'downpayment', 'document_prep', 'loan_submitted',
  'loan_rejected', 'loan_approved', 'transfer_pending', 'transferred', 'handover', 'cancelled',
] as const;
export type PurchaseStage = typeof PURCHASE_STAGES[number];
export type PurchaseMethod = 'cash' | 'mortgage';
export const PURCHASE_NEXT: Readonly<Record<PurchaseStage, readonly PurchaseStage[]>> = {
  booked: ['contracted', 'cancelled'],
  contracted: ['downpayment', 'document_prep', 'transfer_pending', 'cancelled'],
  downpayment: ['document_prep', 'transfer_pending', 'cancelled'],
  document_prep: ['loan_submitted', 'transfer_pending', 'cancelled'],
  loan_submitted: ['loan_rejected', 'loan_approved', 'cancelled'],
  loan_rejected: ['document_prep', 'cancelled'],
  loan_approved: ['transfer_pending', 'cancelled'],
  transfer_pending: ['transferred', 'cancelled'],
  transferred: ['handover'], handover: [], cancelled: [],
};
export function purchaseNextStages(stage: string, method: string | null): PurchaseStage[] {
  // A recorded transfer already happened; an unknown old payment method must not force a new loan/booking.
  if (stage === 'transferred') return ['handover'];
  if (!PURCHASE_STAGES.includes(stage as PurchaseStage) || !['cash', 'mortgage'].includes(method ?? '')) return [];
  if (method === 'cash' && stage.startsWith('loan_')) return [];
  return PURCHASE_NEXT[stage as PurchaseStage].filter(next =>
    !(method === 'cash' && next.startsWith('loan_'))
    && (next !== 'transfer_pending' || method === 'cash' || stage === 'loan_approved'));
}
