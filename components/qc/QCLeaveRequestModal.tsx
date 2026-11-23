'use client';
import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  UserX,
  FileText,
  ShieldAlert,
  Ban,
  Check,
} from 'lucide-react';
import {
  submitQCLeaveRequest,
  reviewQCLeaveRequest,
  cancelQCLeaveRequest,
  getQCLeaveRequests,
  canApproveQCLeave,
  type QCLeaveRequest,
  type LeaveType,
  type LeaveTimeScope,
} from '@/lib/qc/qcLeaveAndStandInService';

interface QCLeaveRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole: string;
  loggedInUsername: string;
  onLeaveChanged?: () => void;
}

export default function QCLeaveRequestModal({
  isOpen,
  onClose,
  currentUserRole,
  loggedInUsername,
  onLeaveChanged,
}: QCLeaveRequestModalProps) {
  const [activeTab, setActiveTab] = useState<'request' | 'list'>('request');
  const [leaveRequests, setLeaveRequests] = useState<QCLeaveRequest[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [leaveType, setLeaveType] = useState<LeaveType>('planned');
  const [timeScope, setTimeScope] = useState<LeaveTimeScope>('full_day');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('12:00');
  const [reason, setReason] = useState('');

  const isApprover = canApproveQCLeave(currentUserRole);

  const fetchRequests = async () => {
    const list = await getQCLeaveRequests();
    setLeaveRequests(list);
  };

  useEffect(() => {
    if (isOpen) {
      fetchRequests();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setFeedback({ type: 'error', text: 'กรุณาระบุเหตุผลการลา' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const res = await submitQCLeaveRequest({
      applicantUsername: loggedInUsername,
      applicantRole: currentUserRole,
      leaveType,
      timeScope,
      startDate,
      endDate,
      startTime: timeScope === 'partial_day' ? startTime : undefined,
      endTime: timeScope === 'partial_day' ? endTime : undefined,
      reason,
    });

    setIsSubmitting(false);
    if (res.success) {
      setFeedback({ type: 'success', text: 'ส่งคำขอลาเรียบร้อยแล้ว รอการอนุมัติ' });
      setReason('');
      fetchRequests();
      setActiveTab('list');
      onLeaveChanged?.();
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: 'error', text: res.error || 'เกิดข้อผิดพลาดในการส่งคำขอลา' });
    }
  };

  const handleReview = async (requestId: string, decision: 'approved' | 'rejected') => {
    setFeedback(null);
    const res = await reviewQCLeaveRequest({
      requestId,
      decision,
      actorUsername: loggedInUsername,
      actorRole: currentUserRole,
    });

    if (res.success) {
      setFeedback({
        type: 'success',
        text: decision === 'approved' ? 'อนุมัติการลาเรียบร้อยแล้ว' : 'ปฏิเสธคำขอลาเรียบร้อยแล้ว',
      });
      fetchRequests();
      onLeaveChanged?.();
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: 'error', text: res.error || 'ไม่สามารถดำเนินการได้' });
    }
  };

  const handleCancel = async (requestId: string) => {
    if (!window.confirm('คุณต้องการยกเลิกคำขอลานี้ใช่หรือไม่? (การยกเลิกจะไม่ย้อนการโอนงานตรวจแทนโดยอัตโนมัติ)')) {
      return;
    }

    const res = await cancelQCLeaveRequest({
      requestId,
      actorUsername: loggedInUsername,
      actorRole: currentUserRole,
    });

    if (res.success) {
      setFeedback({ type: 'success', text: 'ยกเลิกคำขอลาเรียบร้อยแล้ว' });
      fetchRequests();
      onLeaveChanged?.();
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: 'error', text: res.error || 'เกิดข้อผิดพลาดในการยกเลิก' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-xl sm:max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-black border border-blue-200">
              <UserX size={13} />
              <span>ระบบการลา QC (Leave & Stand-in Management)</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              จัดการคำขอลาและตรวจสอบภาระงาน
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              เมื่อลาได้รับอนุมัติ ระบบจะปรับกำลังรองรับและแจ้งเตือนให้จัดผู้ตรวจแทน
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 pt-3 pb-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('request')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'request'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            ยื่นคำขอลาใหม่
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'list'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            ประวัติการลา ({leaveRequests.length})
          </button>
        </div>

        {/* Feedback message */}
        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 my-2 shrink-0 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Tab 1: Submit Request */}
        {activeTab === 'request' && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4 pt-1">
            {/* Leave Type & Time Scope */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">ประเภทการลา</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLeaveType('planned')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      leaveType === 'planned'
                        ? 'bg-blue-50 border-blue-400 text-blue-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    ลาล่วงหน้า
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeaveType('emergency')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      leaveType === 'emergency'
                        ? 'bg-rose-50 border-rose-400 text-rose-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    ลาฉุกเฉิน
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">ช่วงเวลา</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTimeScope('full_day')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      timeScope === 'full_day'
                        ? 'bg-purple-50 border-purple-400 text-purple-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    เต็มวัน
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeScope('partial_day')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      timeScope === 'partial_day'
                        ? 'bg-purple-50 border-purple-400 text-purple-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    บางช่วงเวลา
                  </button>
                </div>
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">ตั้งแต่วันที่</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">ถึงวันที่</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            {/* Time range (if partial day) */}
            {timeScope === 'partial_day' && (
              <div className="grid grid-cols-2 gap-3 bg-purple-50/50 p-3 rounded-2xl border border-purple-100">
                <div>
                  <label className="text-xs font-bold text-purple-800 block mb-1 flex items-center gap-1">
                    <Clock size={12} />
                    <span>ตั้งแต่เวลา</span>
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-purple-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-purple-800 block mb-1 flex items-center gap-1">
                    <Clock size={12} />
                    <span>ถึงเวลา</span>
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-purple-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    required
                  />
                </div>
              </div>
            )}

            {/* Reason */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                เหตุผลการลา (บันทึกสำหรับจัดสรรงาน)
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="ระบุเหตุผล เช่น ติดภารกิจส่วนตัว, พบแพทย์ (ข้อมูลละเอียดอ่อนจะถูกจำกัดสิทธิ์)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 placeholder:text-slate-400"
                required
              />
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer"
              >
                <Send size={14} />
                <span>{isSubmitting ? 'กำลังส่งคำขอ...' : 'ส่งคำขอลา'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Leave Request List & Review */}
        {activeTab === 'list' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3 pt-1">
            {leaveRequests.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-400">
                ยังไม่มีรายการคำขอลาในระบบ
              </div>
            ) : (
              leaveRequests.map(req => {
                const isSelf = req.applicant_username.toLowerCase() === loggedInUsername.toLowerCase();
                const isPending = req.status === 'pending';

                return (
                  <div
                    key={req.id}
                    className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900">
                            {req.applicant_username}
                          </span>
                          <span className="text-[10px] text-slate-500 font-bold">
                            ({req.applicant_role})
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                              req.leave_type === 'emergency'
                                ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                : 'bg-blue-100 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {req.leave_type === 'emergency' ? 'ลาฉุกเฉิน' : 'ลาล่วงหน้า'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 font-medium">
                          📅 {req.start_date} ถึง {req.end_date}
                          {req.time_scope === 'partial_day' && ` (${req.start_time} - ${req.end_time} น.)`}
                        </p>
                      </div>

                      {/* Status Badge */}
                      <div>
                        {req.status === 'approved' && (
                          <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full text-[10px] font-black flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            <span>อนุมัติแล้ว</span>
                          </span>
                        )}
                        {req.status === 'pending' && (
                          <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-full text-[10px] font-black flex items-center gap-1">
                            <Clock size={12} />
                            <span>รออนุมัติ</span>
                          </span>
                        )}
                        {req.status === 'rejected' && (
                          <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-full text-[10px] font-black flex items-center gap-1">
                            <Ban size={12} />
                            <span>ไม่อนุมัติ</span>
                          </span>
                        )}
                        {req.status === 'cancelled' && (
                          <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 rounded-full text-[10px] font-black">
                            ยกเลิกแล้ว
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200/60">
                      <span className="font-bold text-slate-700">เหตุผล:</span> {req.reason}
                    </div>

                    {/* Action Bar for Approver or Self Cancel */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 flex-wrap gap-2 text-[11px]">
                      <div className="text-[10px] text-slate-400">
                        {req.approver_username && (
                          <span>ผู้อนุมัติ: {req.approver_username}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Approver Actions */}
                        {isApprover && isPending && (
                          <>
                            {isSelf ? (
                              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                ⚠️ ไม่อนุญาตให้อนุมัติลาของตนเอง
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleReview(req.id, 'approved')}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer"
                                >
                                  <Check size={12} />
                                  <span>อนุมัติ</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReview(req.id, 'rejected')}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer"
                                >
                                  <Ban size={12} />
                                  <span>ไม่อนุมัติ</span>
                                </button>
                              </>
                            )}
                          </>
                        )}

                        {/* Cancel Action */}
                        {(isSelf || isApprover) && req.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => handleCancel(req.id)}
                            className="px-2.5 py-1 text-slate-500 hover:text-slate-800 font-bold hover:bg-slate-200 rounded-lg transition-all cursor-pointer"
                          >
                            ยกเลิกคำขอ
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="text-[11px] text-slate-400">
            💡 วันที่ลาได้รับอนุมัติจะไม่ถูกคิดเป็น 0% หรือ 100% ในการประเมิน KPI
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
          >
            ปิด
          </button>
        </div>

      </div>
    </div>
  );
}
