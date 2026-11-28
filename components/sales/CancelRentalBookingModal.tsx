'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import SalesOverlay from './SalesOverlay';
import {
  cancelRentalBooking,
  type CancelRentalBookingResult,
} from '@/lib/sales/cancelRentalBooking';
import { createTxRequestId } from '@/lib/sales/rentalTxClient';
import { classifySalesDeal } from '@/lib/sales/dealClassification';

export interface CancelRentalBookingModalProps {
  isOpen: boolean;
  lead: Record<string, any> | null;
  actorId: string;
  actorRole?: unknown;
  canManage?: boolean;
  onClose: () => void;
  onCompleted: (result: CancelRentalBookingResult) => void | Promise<void>;
  onReloadRequired?: (result: CancelRentalBookingResult) => void | Promise<void>;
}

/**
 * Shared cancellation reason dialog for PendingContract rental bookings across:
 * My Lead, LeadTrackerView, Central Lead, Project Map, and RentalManagementWorkspace.
 *
 * Enforces:
 * - Non-empty trimmed reason required (never substitutes "ยกเลิกโดย <user>")
 * - Actor displayed/recorded separately from reason
 * - Confirm button disabled while submitting or when reason is blank
 * - Preserves reason AND exact requestId across retries of the same request on failure
 * - Rejects Active/stale rental transitions cleanly and guides user to reload
 */
export default function CancelRentalBookingModal({
  isOpen,
  lead,
  actorId,
  actorRole,
  canManage = true,
  onClose,
  onCompleted,
  onReloadRequired,
}: CancelRentalBookingModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staleResult, setStaleResult] = useState<CancelRentalBookingResult | null>(null);

  const inFlightRef = useRef(false);
  const retryRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const leadKey = String(lead?.leadId || lead?.id || '');

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setSubmitting(false);
    setErrorMessage(null);
    setStaleResult(null);
    inFlightRef.current = false;
    retryRequestRef.current = null;
  }, [isOpen, leadKey]);

  if (!isOpen || !lead) return null;

  const customerName = lead.customer_name || lead.name || lead.tenant_name || 'ลูกค้า';
  const plotDisplay =
    lead.interested_plot_name ||
    lead.plotName ||
    lead.plot_name ||
    lead.interested_plot_id ||
    lead.plot ||
    lead.plot_id ||
    '-';
  const projectDisplay = lead.project_name || lead.projectName || '';
  const trimmedReason = reason.trim();
  const deal = classifySalesDeal(lead);
  const isLocallyActive =
    lead.rental_status === 'Active' ||
    lead.rental_status === 'Renewed' ||
    lead.status === 'Rented' ||
    deal.isRentalActive;
  const isBlockedActiveOrStale = isLocallyActive || Boolean(staleResult);
  const canSubmit = !submitting && !isBlockedActiveOrStale && trimmedReason.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current || submitting) return;

    if (isLocallyActive) {
      const activeRes: CancelRentalBookingResult = {
        status: 'stale_state',
        message:
          'สัญญานี้มีผลบังคับใช้ (Active) แล้ว ไม่สามารถยกเลิกด้วยการยกเลิกจองเช่าได้ กรุณาโหลดข้อมูลใหม่และใช้เมนูจัดการสัญญาเช่า',
        shouldRefresh: true,
        errorCode: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL',
      };
      setStaleResult(activeRes);
      setErrorMessage(activeRes.message);
      await onReloadRequired?.(activeRes);
      return;
    }

    if (!trimmedReason) {
      setErrorMessage('กรุณาระบุเหตุผลในการยกเลิกการจองเช่า');
      return;
    }

    const attemptKey = `${leadKey}::${trimmedReason}`;
    if (!retryRequestRef.current || retryRequestRef.current.key !== attemptKey) {
      retryRequestRef.current = {
        key: attemptKey,
        requestId: createTxRequestId(),
      };
    }
    const txRequestId = retryRequestRef.current.requestId;

    inFlightRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await cancelRentalBooking({
        lead,
        actorId,
        actorRole,
        canManage,
        reason: trimmedReason,
        requestId: txRequestId,
        skipConfirm: true,
      });

      if (result.status === 'cancelled' || result.status === 'already_cancelled') {
        retryRequestRef.current = null;
        await onCompleted(result);
        onClose();
        return;
      }

      if (result.status === 'stale_state') {
        setStaleResult(result);
        setErrorMessage(
          result.message ||
            'สถานะรายการนี้มีการเปลี่ยนแปลงระหว่างเปิดหน้าจอ กรุณาโหลดข้อมูลใหม่'
        );
        await onReloadRequired?.(result);
        return;
      }

      // Transient or validation error: preserve entered reason AND retryRequestRef for idempotent retry!
      setErrorMessage(result.message || 'ไม่สามารถยกเลิกการจองเช่าได้ กรุณาลองใหม่อีกครั้ง');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการยกเลิกการจองเช่า กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SalesOverlay
      className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-rental-booking-title"
        data-testid="cancel-rental-booking-modal"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle size={20} className="text-rose-600 shrink-0" />
            <h3 id="cancel-rental-booking-title" className="font-bold text-base text-rose-900">
              ยกเลิกการจองเช่าและคืนแปลง
            </h3>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="ปิดหน้าต่างยกเลิกจองเช่า"
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs space-y-1.5">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">ลูกค้า:</span>
              <span className="font-bold text-slate-800 text-right">{customerName}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">โครงการ / แปลง:</span>
              <span className="font-bold text-slate-800 text-right">
                {projectDisplay ? `${projectDisplay} — แปลง ${plotDisplay}` : `แปลง ${plotDisplay}`}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">ผู้ทำรายการ:</span>
              <span className="font-semibold text-slate-700 text-right">{actorId}</span>
            </div>
          </div>

          {isLocallyActive && !staleResult && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium flex items-start gap-2"
            >
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <span>
                สัญญานี้มีผลบังคับใช้ (Active) แล้ว ไม่สามารถยกเลิกด้วยการยกเลิกจองเช่าได้ กรุณาโหลดข้อมูลใหม่และใช้เมนูจัดการสัญญาเช่า
              </span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="cancel-rental-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2"
            >
              <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="cancel-rental-reason-input"
              className="block text-xs font-bold text-slate-700 mb-1.5"
            >
              เหตุผลในการยกเลิกจองเช่า <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="cancel-rental-reason-input"
              aria-label="เหตุผลในการยกเลิกจองเช่า"
              value={reason}
              disabled={submitting || isBlockedActiveOrStale}
              onChange={e => {
                setReason(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="ระบุเหตุผลจริง เช่น ลูกค้าเปลี่ยนใจ / ขอเปลี่ยนแปลง / ไม่สะดวกเข้าอยู่..."
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200 min-h-[96px] disabled:bg-slate-100"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              ต้องกรอกเหตุผลจริง (ระบบจะบันทึกชื่อผู้ทำรายการแยกจากเหตุผลโดยอัตโนมัติ)
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              ยกเลิก
            </button>

            {isBlockedActiveOrStale ? (
              <button
                type="button"
                onClick={async () => {
                  if (staleResult) {
                    await onReloadRequired?.(staleResult);
                  } else {
                    await onReloadRequired?.({
                      status: 'stale_state',
                      message: 'กรุณาโหลดข้อมูลใหม่',
                      shouldRefresh: true,
                      errorCode: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL',
                    });
                  }
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={14} /> โหลดข้อมูลใหม่และปิด
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> กำลังยกเลิก...
                  </>
                ) : (
                  <>
                    <XCircle size={14} /> ยืนยันยกเลิกจองเช่า
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </SalesOverlay>
  );
}
