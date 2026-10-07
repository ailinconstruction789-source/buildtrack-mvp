"use client";

import React, { useState } from 'react';
import { 
  Trash2, 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  Home, 
  FileText, 
  CreditCard, 
  User, 
  Loader2,
  ShieldAlert
} from 'lucide-react';
import { Lead } from '@/types/sales';
import { deleteCustomerWithCascade, DeleteCustomerResult } from '@/lib/customerDeletionHelper';

interface AdminDeleteCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  user?: any;
  onDeleted?: (result: DeleteCustomerResult) => void;
}

export default function AdminDeleteCustomerModal({
  isOpen,
  onClose,
  lead,
  user,
  onDeleted
}: AdminDeleteCustomerModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !lead) return null;

  const isAdmin = !user?.role || 
    user?.role?.toLowerCase() === 'admin' || 
    user?.role?.toLowerCase() === 'owner' || 
    user?.role?.toLowerCase() === 'superadmin';
  const plotDisplay = lead.interested_plot_name || lead.interested_plot_id;

  const handleDelete = async () => {
    if (!isAdmin) {
      setErrorMsg('คุณไม่มีสิทธิ์ในการลบข้อมูลลูกค้า (เฉพาะ Admin เท่านั้น)');
      return;
    }

    setIsDeleting(true);
    setErrorMsg(null);

    try {
      const result = await deleteCustomerWithCascade(lead.id, lead.interested_plot_id);
      if (!result.success) {
        throw new Error(result.error || 'ลบข้อมูลลูกค้าไม่สำเร็จ');
      }

      if (onDeleted) onDeleted(result);
      onClose();
    } catch (err: any) {
      console.error('Failed to delete customer:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการลบข้อมูล');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-rose-200 overflow-hidden my-auto">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-rose-900 via-red-800 to-rose-950 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-500/20 text-rose-200 rounded-xl border border-rose-400/30">
              <ShieldAlert size={20} className="animate-pulse" />
            </div>
            <div>
              <h3 className="font-black text-base text-white flex items-center gap-1.5">
                ยืนยันการลบข้อมูลลูกค้า (Admin)
              </h3>
              <p className="text-[11px] text-rose-200/80">
                สำหรับจัดการและทดสอบระบบ (Test Data Cleanup)
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            disabled={isDeleting}
            className="text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Customer Summary Card */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <User size={15} className="text-slate-600" /> {lead.customer_name}
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {lead.project_name || 'ไอลิน'}
              </span>
            </div>
            <div className="text-slate-500 flex items-center justify-between text-[11px]">
              <span>เบอร์โทร: <b className="text-slate-700 font-mono">{lead.phone || '-'}</b></span>
              <span>สถานะ: <b className="text-blue-700">{lead.crm_status || lead.status || 'ลูกค้ามุ่งหวัง'}</b></span>
            </div>
            {plotDisplay && (
              <div className="mt-1 pt-1.5 border-t border-slate-200 text-[11px] text-emerald-800 font-bold flex items-center gap-1">
                <Home size={13} className="text-emerald-600" /> ผูกกับแปลง: แปลง {plotDisplay}
              </div>
            )}
          </div>

          {/* Warning Checklist */}
          <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-2xl space-y-2">
            <div className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
              <AlertTriangle size={15} className="text-rose-600" /> ผลกระทบเมื่อยืนยันการลบ:
            </div>
            <ul className="space-y-1 text-slate-600 text-[11px]">
              {plotDisplay && (
                <li className="flex items-start gap-1.5 text-emerald-900 font-semibold">
                  <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                  <span>ปลดแปลง <b>{plotDisplay}</b> กลับเป็นสถานะ <b>"ว่าง (Available)"</b> และล้างชื่อผู้เช่า/ผู้จองทันที</span>
                </li>
              )}
              <li className="flex items-start gap-1.5">
                <CheckCircle2 size={13} className="text-rose-600 shrink-0 mt-0.5" />
                <span>ลบสัญญาเช่า, ตารางค่างวด และประวัติการจ่ายค่าเช่ารายเดือนที่ผูกไว้ทั้งหมด</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 size={13} className="text-rose-600 shrink-0 mt-0.5" />
                <span>ลบประวัติการขาย, กิจกรรมติดตาม, และแบบสอบถามของลูกค้ารายนี้</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 size={13} className="text-rose-600 shrink-0 mt-0.5" />
                <span>ลบแถวข้อมูลลูกค้าออกจากระบบ CRM</span>
              </li>
            </ul>
          </div>

          <p className="text-[11px] text-slate-400 text-center font-medium">
            ⚠️ ข้อมูลที่ถูกลบจะไม่สามารถกู้คืนกลับมาได้
          </p>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer text-xs"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex-1 py-2.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white font-bold rounded-xl shadow-md transition-all cursor-pointer text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> กำลังลบข้อมูล...
              </>
            ) : (
              <>
                <Trash2 size={14} /> ยืนยันลบลูกค้า
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
