import { canEditSalesRole } from './leadStage';
import { classifySalesDeal } from './dealClassification';
import {
  cancelRentalBookingTx,
  createTxRequestId,
  SalesTxError,
  translateSalesTxError,
} from './rentalTxClient';

export interface CancelRentalBookingParams {
  lead: Record<string, any>;
  actorId: string;
  actorRole?: unknown;
  canManage?: boolean;
  reason?: string | null;
  requestId?: string;
  skipConfirm?: boolean;
  confirm?: (message: string) => boolean;
}

export interface CancelRentalBookingResult {
  status: 'cancelled' | 'aborted' | 'already_cancelled' | 'stale_state' | 'error';
  message: string;
  shouldRefresh: boolean;
  plotReleased?: boolean;
  requestId?: string;
  errorCode?: string;
}

/**
 * Shared transactional cancellation command for pending rental bookings (`rental_pending`).
 * Used consistently across My Lead, LeadTrackerView, Central Lead, Project Map, and RentalManagementWorkspace.
 *
 * Guarantees:
 * - Enforces write permissions (`canManage` / `canEditSalesRole`)
 * - Rejects Active/Renewed contracts locally AND atomically inside PostgreSQL (`sales_tx_cancel_rental_booking`)
 * - Passes optimistic concurrency tokens (`expectedLeadRevision`, `expectedContractRevision`, `expectedLeadUpdatedAt`)
 *   so stale screens where PendingContract became Active are cleanly rejected with reload guidance
 * - Zero direct multi-table writes and zero fallback direct writes to `plots.sale_status` / `plots.has_customer`
 * - Never deletes customers via cascade deletion
 */
export async function cancelRentalBooking({
  lead,
  actorId,
  actorRole,
  canManage,
  reason,
  requestId,
  skipConfirm = false,
  confirm,
}: CancelRentalBookingParams): Promise<CancelRentalBookingResult> {
  const hasPermission =
    canManage !== undefined
      ? canManage && (actorRole == null || canEditSalesRole(actorRole))
      : actorRole == null
        ? false
        : canEditSalesRole(actorRole);

  if (!hasPermission) {
    return {
      status: 'error',
      message: 'บัญชีของคุณมีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถยกเลิกการจองเช่าได้',
      shouldRefresh: false,
      errorCode: 'SALES_TX_FORBIDDEN',
    };
  }

  const leadId = lead?.leadId || lead?.id;
  if (!leadId) {
    return {
      status: 'error',
      message: 'ไม่พบรหัสลูกค้า (Lead ID)',
      shouldRefresh: false,
      errorCode: 'SALES_TX_INVALID_INPUT',
    };
  }

  // Local guard for immediate UX feedback before confirmation dialog
  if (lead.status === 'Cancelled' || lead.rental_status === 'Cancelled') {
    return {
      status: 'already_cancelled',
      message: 'รายการนี้ถูกยกเลิกไปแล้ว',
      shouldRefresh: true,
    };
  }

  const classification = classifySalesDeal(lead);
  if (
    lead.rental_status === 'Active' ||
    lead.rental_status === 'Renewed' ||
    lead.status === 'Rented' ||
    classification.isRentalActive
  ) {
    return {
      status: 'stale_state',
      message:
        'สัญญานี้มีผลบังคับใช้ (Active) แล้ว ไม่สามารถยกเลิกด้วยการยกเลิกจองเช่าได้ กรุณาโหลดข้อมูลใหม่และใช้เมนูจัดการสัญญาเช่า',
      shouldRefresh: true,
      errorCode: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL',
    };
  }

  if (!classification.isRentalPending) {
    return {
      status: 'error',
      message: 'สถานะรายการนี้ไม่ใช่การจองเช่ารอทำสัญญา ไม่สามารถยกเลิกผ่านคำสั่งยกเลิกจองเช่าได้',
      shouldRefresh: false,
      errorCode: 'SALES_TX_CONFLICT',
    };
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    return {
      status: 'error',
      message: 'กรุณาระบุเหตุผลในการยกเลิกการจองเช่า',
      shouldRefresh: false,
      errorCode: 'SALES_TX_INVALID_INPUT',
    };
  }

  const customerDisplayName = lead.customer_name || lead.name || 'ลูกค้า';
  if (!skipConfirm) {
    const confirmFn =
      confirm ??
      ((msg: string) => (typeof window !== 'undefined' ? window.confirm(msg) : false));
    const ok = confirmFn(`ยืนยันยกเลิกการจองเช่าของคุณ "${customerDisplayName}" และคืนแปลงใช่หรือไม่?`);
    if (!ok) {
      return { status: 'aborted', message: '', shouldRefresh: false };
    }
  }

  const txRequestId = requestId || createTxRequestId();

  try {
    const result = await cancelRentalBookingTx({
      requestId: txRequestId,
      actorRole,
      leadId: String(leadId),
      contractId: lead.pending_rental_contract_id || lead.rental_contract_id || null,
      expectedLeadRevision: lead.deal_revision || null,
      expectedContractRevision: lead.contract_deal_revision || null,
      expectedLeadUpdatedAt: lead.updated_at || null,
      reason: trimmedReason,
    });

    return {
      status: 'cancelled',
      message: result.plotReleased
        ? `ยกเลิกการจองเช่าของคุณ "${customerDisplayName}" และคืนแปลงกลับสู่สถานะว่างเรียบร้อยแล้ว`
        : `ยกเลิกการจองเช่าของคุณ "${customerDisplayName}" เรียบร้อยแล้ว (คงสถานะแปลงไว้เนื่องจากไม่พบแปลงหรือมีผู้ถือสิทธิ์รายอื่น)`,
      shouldRefresh: true,
      plotReleased: result.plotReleased,
      requestId: txRequestId,
    };
  } catch (err) {
    const txErr: SalesTxError = translateSalesTxError(err);

    if (txErr.isAlreadyCancelled) {
      return {
        status: 'already_cancelled',
        message: txErr.message,
        shouldRefresh: true,
        requestId: txRequestId,
        errorCode: txErr.code,
      };
    }

    if (txErr.isStaleState) {
      return {
        status: 'stale_state',
        message: txErr.message,
        shouldRefresh: true,
        requestId: txRequestId,
        errorCode: txErr.code,
      };
    }

    return {
      status: 'error',
      message: txErr.message,
      shouldRefresh: false,
      requestId: txRequestId,
      errorCode: txErr.code,
    };
  }
}
