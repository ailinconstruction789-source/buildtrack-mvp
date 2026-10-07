"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  CreditCard, 
  XCircle, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  DollarSign, 
  PiggyBank, 
  Receipt, 
  FileText, 
  Sparkles, 
  Upload, 
  Check, 
  X, 
  User, 
  Home, 
  Eye, 
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  Printer,
  Smartphone,
  Wrench
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  RentalContract, 
  RentalPaymentRecord, 
  RENTAL_PROGRAM_DETAILS,
  RentalReceiptData
} from '@/types/sales';
import { 
  generateMonthlyPaymentSchedule, 
  calculateRentalPaymentSummary,
  generateReceiptNumber
} from '@/lib/rentalHelper';
import RentalReceiptModal from './RentalReceiptModal';
import TenantPortalModal from './TenantPortalModal';
import RentalMaintenanceModal from './RentalMaintenanceModal';

interface RentalPaymentLedgerModalProps {
  isOpen: boolean;
  onClose: () => void;
  contractId?: string | null;
  plotId?: string | null;
  projectName?: string;
  lead?: any | null;
  plot?: any | null;
  user?: any;
  onSaved?: () => void;
}

export default function RentalPaymentLedgerModal({
  isOpen,
  onClose,
  contractId,
  plotId,
  projectName = 'ไอลิน สันทราย 2',
  lead,
  plot,
  user,
  onSaved
}: RentalPaymentLedgerModalProps) {
  const [contract, setContract] = useState<RentalContract | null>(null);
  const [payments, setPayments] = useState<RentalPaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Advanced Feature Modals State
  const [receiptModalData, setReceiptModalData] = useState<RentalReceiptData | null>(null);
  const [showTenantPortal, setShowTenantPortal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);

  // Quick Payment Dialog State
  const [paymentDialog, setPaymentDialog] = useState<{
    isOpen: boolean;
    period: any | null;
  }>({ isOpen: false, period: null });

  const [payDate, setPayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<'transfer' | 'cash' | 'credit_card' | 'other'>('transfer');
  const [payNotes, setPayNotes] = useState<string>('');
  const [slipUrl, setSlipUrl] = useState<string>('');
  const [viewingSlipUrl, setViewingSlipUrl] = useState<string | null>(null);

  // Fetch active contract & payment history from Supabase
  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      let contractData: RentalContract | null = null;

      // 1. Fetch Contract
      if (contractId) {
        const { data, error } = await supabase
          .from('rental_contracts')
          .select('*')
          .eq('id', contractId)
          .maybeSingle();
        if (error) throw error;
        contractData = data;
      } else if (plotId) {
        const { data, error } = await supabase
          .from('rental_contracts')
          .select('*')
          .eq('plot_id', plotId)
          .eq('status', 'Active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) contractData = data;
      } else if (lead?.id) {
        const { data, error } = await supabase
          .from('rental_contracts')
          .select('*')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) contractData = data;
      }

      // Fallback synthetic contract if table doesn't have it yet
      if (!contractData) {
        const rentNum = plot?.monthly_rent || lead?.rental_monthly_rent || 15000;
        contractData = {
          id: contractId || 'temp-contract',
          project_name: projectName || plot?.project_name || lead?.project_name || 'ไอลิน สันทราย 2',
          plot_id: plotId || plot?.id || lead?.interested_plot_id || '32',
          plot_name: plot?.plot_name || plotId || '32',
          tenant_name: plot?.current_tenant_name || lead?.customer_name || 'ผู้เช่า',
          tenant_phone: plot?.current_tenant_phone || lead?.phone || '',
          agent_name: lead?.agent_name || user?.username || 'ทีมขาย',
          program_type: plot?.rental_program || lead?.rental_program || 'program_b',
          monthly_rent: rentNum,
          security_deposit: rentNum * 2,
          advance_rent: rentNum,
          savings_per_month: (plot?.rental_program === 'program_b' || lead?.rental_program === 'program_b') ? 5000 : 0,
          accumulated_savings: 0,
          base_price: 2990000,
          lease_duration_months: 12,
          lease_start_date: plot?.lease_start_date || lead?.rental_start_date || new Date().toISOString().split('T')[0],
          lease_end_date: plot?.lease_end_date || lead?.rental_end_date || new Date().toISOString().split('T')[0],
          status: 'Active',
          created_at: new Date().toISOString()
        };
      }

      setContract(contractData);

      // 2. Fetch Payments for this contract or plot
      let paymentsQuery = supabase.from('rental_payments').select('*');
      if (contractData.id && contractData.id !== 'temp-contract') {
        paymentsQuery = paymentsQuery.or(`contract_id.eq.${contractData.id},plot_id.eq.${contractData.plot_id}`);
      } else {
        paymentsQuery = paymentsQuery.eq('plot_id', contractData.plot_id);
      }

      const { data: paymentsData, error: paymentsErr } = await paymentsQuery.order('period_month', { ascending: true });

      if (paymentsErr) {
        console.warn('Could not fetch rental_payments:', paymentsErr);
      }

      const generated = generateMonthlyPaymentSchedule(contractData, paymentsData || []);
      setPayments(generated as any);
    } catch (err: any) {
      console.error('Error fetching rental payments ledger:', err);
      setErrorMsg(err.message || 'ไม่สามารถโหลดประวัติการชำระเงินได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, contractId, plotId, lead, plot]);

  // Financial summary
  const summary = useMemo(() => {
    return calculateRentalPaymentSummary(payments);
  }, [payments]);

  if (!isOpen) return null;

  const currentProgram = contract ? RENTAL_PROGRAM_DETAILS[contract.program_type] : null;

  // Open Payment Dialog for a specific installment
  const handleOpenPaymentDialog = (period: any) => {
    setPaymentDialog({ isOpen: true, period });
    setPayDate(period.paid_date ? period.paid_date.split('T')[0] : new Date().toISOString().split('T')[0]);
    setPayAmount((period.amount_paid > 0 ? period.amount_paid : period.amount_due).toString());
    setPayMethod(period.payment_method || 'transfer');
    setPayNotes(period.notes || '');
    setSlipUrl(period.slip_url || '');
  };

  // Save payment for an installment
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentDialog.period || !contract) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const period = paymentDialog.period;
      const parsedAmount = parseFloat(payAmount) || 0;
      const now = new Date().toISOString();
      const isPaid = parsedAmount >= period.amount_due;
      const savingsNum = contract.program_type === 'program_b' && isPaid ? (contract.savings_per_month || 5000) : 0;

      const todayStr = new Date().toISOString().split('T')[0];
      const isPastDue = period.due_date < todayStr;
      const statusValue: 'Paid' | 'Pending' | 'Overdue' = isPaid 
        ? 'Paid' 
        : (parsedAmount > 0 ? 'Pending' : (isPastDue ? 'Overdue' : 'Pending'));

      const payload = {
        contract_id: contract.id !== 'temp-contract' ? contract.id : null,
        lead_id: contract.lead_id || lead?.id || null,
        plot_id: contract.plot_id,
        plot_name: contract.plot_name || contract.plot_id,
        project_name: contract.project_name,
        tenant_name: contract.tenant_name,
        period_month: period.period_month,
        period_label: period.period_label,
        due_date: period.due_date,
        amount_due: period.amount_due,
        amount_paid: parsedAmount,
        savings_amount: savingsNum,
        paid_date: parsedAmount > 0 ? `${payDate}T12:00:00Z` : null,
        payment_status: statusValue,
        payment_method: payMethod,
        slip_url: slipUrl.trim() || null,
        notes: payNotes.trim() || null,
        recorded_by: user?.username || user?.email || 'ทีมงาน',
        updated_at: now
      };

      // 1. Upsert into rental_payments table
      if (period.id) {
        await supabase
          .from('rental_payments')
          .update(payload)
          .eq('id', period.id);
      } else {
        await supabase
          .from('rental_payments')
          .insert([{ ...payload, created_at: now }]);
      }

      // 2. If Program B, recalculate total accumulated savings and update contract & lead
      if (contract.program_type === 'program_b') {
        let savingsQuery = supabase
          .from('rental_payments')
          .select('savings_amount, payment_status')
          .eq('payment_status', 'Paid');

        if (contract.id && contract.id !== 'temp-contract') {
          savingsQuery = savingsQuery.or(`contract_id.eq.${contract.id},plot_id.eq.${contract.plot_id}`);
        } else {
          savingsQuery = savingsQuery.eq('plot_id', contract.plot_id);
        }

        const { data: allPayments } = await savingsQuery;

        const totalSavings = (allPayments || []).reduce((sum, p) => sum + Number(p.savings_amount || 0), 0);

        if (contract.id && contract.id !== 'temp-contract') {
          await supabase
            .from('rental_contracts')
            .update({ accumulated_savings: totalSavings })
            .eq('id', contract.id);
        }

        if (contract.lead_id) {
          await supabase
            .from('leads')
            .update({ rental_accumulated_savings: totalSavings })
            .eq('id', contract.lead_id);
        }
      }

      setPaymentDialog({ isOpen: false, period: null });
      await fetchData();
      if (onSaved) onSaved();
    } catch (err: any) {
      console.error('Error saving rental payment:', err);
      setErrorMsg(err.message || 'บันทึกการชำระเงินไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Receipt / Invoice Modal
  const handleOpenReceipt = (period: RentalPaymentRecord) => {
    if (!contract) return;
    const isPaid = period.payment_status === 'Paid';
    const rcNo = generateReceiptNumber(isPaid ? 'receipt' : 'invoice', period.period_month, contract.plot_name || contract.plot_id);
    const receiptData: RentalReceiptData = {
      receiptNo: rcNo,
      receiptType: isPaid ? 'receipt' : 'invoice',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: period.due_date,
      projectName: contract.project_name || projectName,
      plotName: contract.plot_name || contract.plot_id,
      tenantName: contract.tenant_name,
      tenantPhone: contract.tenant_phone || undefined,
      periodLabel: period.period_label,
      programName: currentProgram?.name || 'เช่าบ้าน',
      programCode: currentProgram?.code || 'A',
      rentAmount: period.amount_due,
      savingsAmount: period.savings_amount,
      totalAmount: period.amount_due,
      paidAmount: isPaid ? (period.amount_paid || period.amount_due) : undefined,
      paymentMethod: period.payment_method || 'transfer',
      paymentStatus: period.payment_status as any,
      companyName: 'ไอลิน พร็อพเพอร์ตี้ (AILIN GROUP)',
      promptPayId: '0812345678',
      agentName: user?.username || contract.agent_name || 'ตัวแทนโครงการ'
    };
    setReceiptModalData(receiptData);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 text-cyan-300 rounded-2xl border border-cyan-400/30">
              <CreditCard size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-lg text-white">
                  💳 ตารางติดตามการจ่ายค่าเช่ารายเดือน
                </h3>
                {currentProgram && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${currentProgram.badgeColor}`}>
                    {currentProgram.name}
                  </span>
                )}
                <span className="text-[10px] bg-cyan-400/20 text-cyan-200 font-bold px-2 py-0.5 rounded-full border border-cyan-400/30">
                  แปลง {contract?.plot_name || contract?.plot_id}
                </span>
              </div>
              <p className="text-xs text-blue-200/80 mt-0.5">
                ผู้เช่า: <b className="text-white">{contract?.tenant_name}</b> ({contract?.tenant_phone || 'ไม่มีเบอร์'}) • ค่าเช่า ฿{Number(contract?.monthly_rent || 0).toLocaleString()} บ./เดือน
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMaintenanceModal(true)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-cyan-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Wrench size={14} /> แจ้งซ่อม
            </button>
            <button
              type="button"
              onClick={() => setShowTenantPortal(true)}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Smartphone size={14} /> หน้าดูผู้เช่า
            </button>
            <button 
              type="button" 
              onClick={onClose} 
              className="text-white/70 hover:text-white transition-colors cursor-pointer p-1"
            >
              <XCircle size={22} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 📊 KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Paid Count */}
            <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-2xl">
              <div className="flex items-center justify-between text-[11px] font-bold text-emerald-800 mb-1">
                <span>ชำระแล้ว (Paid)</span>
                <CheckCircle2 size={15} className="text-emerald-600" />
              </div>
              <div className="text-xl font-black text-emerald-950 font-mono">
                {summary.paidPeriods} <span className="text-xs font-normal text-emerald-700">/ {summary.totalPeriods} งวด</span>
              </div>
              <div className="text-[10px] text-emerald-700 mt-0.5">
                ยอดรับแล้ว: ฿{summary.totalAmountPaid.toLocaleString()} บ.
              </div>
            </div>

            {/* Pending Count */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 mb-1">
                <span>รอชำระ (Pending)</span>
                <Clock size={15} className="text-slate-500" />
              </div>
              <div className="text-xl font-black text-slate-900 font-mono">
                {summary.pendingPeriods} <span className="text-xs font-normal text-slate-500">งวด</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                คงเหลือ: ฿{summary.totalRemaining.toLocaleString()} บ.
              </div>
            </div>

            {/* Overdue Count */}
            <div className={`p-3.5 rounded-2xl border ${
              summary.hasOverdue 
                ? 'bg-rose-50 border-rose-200 text-rose-900' 
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                <span className={summary.hasOverdue ? 'text-rose-700' : 'text-slate-700'}>
                  ค้างชำระ (Overdue)
                </span>
                <AlertTriangle size={15} className={summary.hasOverdue ? 'text-rose-600 animate-pulse' : 'text-slate-400'} />
              </div>
              <div className={`text-xl font-black font-mono ${summary.hasOverdue ? 'text-rose-700' : 'text-slate-900'}`}>
                {summary.overduePeriods} <span className="text-xs font-normal">งวด</span>
              </div>
              <div className={`text-[10px] mt-0.5 ${summary.hasOverdue ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                {summary.hasOverdue ? '⚠️ มีงวดเกินกำหนดชำระ' : 'สถานะปกติ ไม่มีค้าง'}
              </div>
            </div>

            {/* Program B Savings or Program C Discount */}
            <div className="p-3.5 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 mb-1">
                <span>เงินออมสะสม (แบบ B)</span>
                <PiggyBank size={15} className="text-amber-600" />
              </div>
              <div className="text-xl font-black text-amber-950 font-mono">
                ฿{summary.totalAccumulatedSavings.toLocaleString()}
              </div>
              <div className="text-[10px] text-amber-700 mt-0.5">
                {contract?.program_type === 'program_b' ? 'สะสม +5,000 บ./งวดที่จ่าย' : 'โปรแกรม A / C'}
              </div>
            </div>
          </div>

          {/* 📋 Monthly Installment Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
              <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                <Receipt size={14} className="text-blue-600" />
                รายการค่างวดสัญญาเช่า (ทั้งหมด {summary.totalPeriods} งวด)
              </h4>
              <span className="text-[11px] text-slate-500">
                กำหนดชำระทุกวันที่ {contract?.lease_start_date ? new Date(contract.lease_start_date).getDate() : 1} ของเดือน
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100/70 text-slate-600 font-bold border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="px-3.5 py-2.5">งวดที่ / เดือน</th>
                    <th className="px-3.5 py-2.5">วันครบกำหนด (Due Date)</th>
                    <th className="px-3.5 py-2.5">ยอดค่าเช่า</th>
                    {contract?.program_type === 'program_b' && (
                      <th className="px-3.5 py-2.5 text-amber-800">เงินสะสมดาวน์</th>
                    )}
                    <th className="px-3.5 py-2.5">วันที่ชำระจริง</th>
                    <th className="px-3.5 py-2.5">สถานะ</th>
                    <th className="px-3.5 py-2.5 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((period) => {
                    const isPaid = period.payment_status === 'Paid';
                    const isOverdue = period.payment_status === 'Overdue';

                    return (
                      <tr 
                        key={period.period_month} 
                        className={`hover:bg-slate-50/80 transition-colors ${
                          isOverdue ? 'bg-rose-50/40' : (isPaid ? 'bg-emerald-50/20' : '')
                        }`}
                      >
                        {/* Period Label */}
                        <td className="px-3.5 py-3 font-bold text-slate-900">
                          {period.period_label}
                        </td>

                        {/* Due Date */}
                        <td className="px-3.5 py-3 text-slate-600 font-mono">
                          {period.due_date}
                        </td>

                        {/* Amount Due */}
                        <td className="px-3.5 py-3 font-mono font-bold text-slate-800">
                          ฿{Number(period.amount_due).toLocaleString()}
                        </td>

                        {/* Program B Savings */}
                        {contract?.program_type === 'program_b' && (
                          <td className="px-3.5 py-3 font-mono font-bold text-amber-700">
                            {isPaid ? `+฿${Number(period.savings_amount || 5000).toLocaleString()}` : '-'}
                          </td>
                        )}

                        {/* Paid Date */}
                        <td className="px-3.5 py-3 text-slate-600">
                          {period.paid_date ? (
                            <span className="font-mono text-emerald-700 font-bold">
                              {new Date(period.paid_date).toLocaleDateString('th-TH')}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        {/* Payment Status Badge */}
                        <td className="px-3.5 py-3">
                          {isPaid ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 size={11} /> ชำระแล้ว
                            </span>
                          ) : isOverdue ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">
                              <AlertTriangle size={11} /> ค้างชำระ / เกินกำหนด
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              <Clock size={11} /> รอชำระ
                            </span>
                          )}
                        </td>

                        {/* Action Buttons */}
                        <td className="px-3.5 py-3 text-right space-x-1.5 whitespace-nowrap">
                          {period.slip_url && (
                            <button
                              type="button"
                              onClick={() => setViewingSlipUrl(period.slip_url || null)}
                              className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="ดูสลิปการโอน"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenReceipt(period)}
                            className="px-2.5 py-1 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-indigo-200 inline-flex items-center gap-1"
                            title={isPaid ? 'พิมพ์ใบเสร็จรับเงิน' : 'ออกใบแจ้งหนี้ค่าเช่า'}
                          >
                            <Printer size={12} /> {isPaid ? 'ใบเสร็จ' : 'ใบแจ้งหนี้'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenPaymentDialog(period)}
                            className={`px-3 py-1 rounded-xl font-bold text-xs shadow-2xs transition-all cursor-pointer ${
                              isPaid
                                ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                : isOverdue
                                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
                                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
                            }`}
                          >
                            {isPaid ? 'แก้ไข / สลิป' : '+ บันทึกรับเงิน'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            ระบบจะอัปเดตเงินออมสะสมและประวัติใน Supabase อัตโนมัติทุกครั้งที่บันทึก
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>

        {/* 💳 Quick Payment Record Dialog */}
        {paymentDialog.isOpen && paymentDialog.period && (
          <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
              <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                    <Receipt size={16} /> บันทึกรับเงินค่าเช่า: {paymentDialog.period.period_label}
                  </h4>
                  <p className="text-[11px] text-blue-200/80 mt-0.5">
                    แปลง {contract?.plot_name || contract?.plot_id} ({contract?.tenant_name})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentDialog({ isOpen: false, period: null })}
                  className="text-white/70 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePayment} className="p-5 space-y-3.5 text-xs">
                {/* Due Date & Expected Rent */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 block">วันครบกำหนด (Due Date)</span>
                    <span className="font-bold text-slate-800 font-mono">{paymentDialog.period.due_date}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">ค่าเช่าที่ต้องชำระ</span>
                    <span className="font-black text-blue-700 font-mono">฿{Number(paymentDialog.period.amount_due).toLocaleString()} บ.</span>
                  </div>
                </div>

                {/* Paid Date */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">วันที่รับชำระจริง *</label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Amount Paid */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">จำนวนเงินที่ได้รับ (บาท) *</label>
                  <input
                    type="number"
                    required
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="เช่น 15000"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-black text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                  />
                </div>

                {/* Payment Method */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ช่องทางการชำระเงิน *</label>
                  <select
                    value={payMethod}
                    onChange={e => setPayMethod(e.target.value as any)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="transfer">โอนเงินผ่านบัญชีธนาคาร (Transfer)</option>
                    <option value="cash">เงินสด (Cash)</option>
                    <option value="credit_card">บัตรเครดิต (Credit Card)</option>
                    <option value="other">อื่นๆ (Other)</option>
                  </select>
                </div>

                {/* Slip URL / Image link */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ลิงก์รูปภาพสลิปการโอน (Slip URL - ถ้ามี)</label>
                  <input
                    type="url"
                    value={slipUrl}
                    onChange={e => setSlipUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">หมายเหตุเพิ่มเติม</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={e => setPayNotes(e.target.value)}
                    placeholder="เช่น ชำระตรงเวลา, บัญชีกสิกรไทย"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Actions */}
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentDialog({ isOpen: false, period: null })}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? 'กำลังบันทึก...' : '✓ บันทึกรับเงิน'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* View Slip Modal */}
        {viewingSlipUrl && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 p-4 animate-fade-in" onClick={() => setViewingSlipUrl(null)}>
            <div className="relative max-w-lg w-full bg-white rounded-2xl overflow-hidden p-2" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center p-2">
                <span className="font-bold text-xs text-slate-800">สลิปการโอนเงิน</span>
                <button type="button" onClick={() => setViewingSlipUrl(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>
              <img src={viewingSlipUrl} alt="Slip" className="w-full max-h-[70vh] object-contain rounded-xl" />
            </div>
          </div>
        )}

      </div>

      {/* 📄 Rental Receipt & Invoice Modal */}
      {receiptModalData && (
        <RentalReceiptModal
          isOpen={!!receiptModalData}
          onClose={() => setReceiptModalData(null)}
          data={receiptModalData}
        />
      )}

      {/* 📱 Tenant Portal Modal */}
      {showTenantPortal && (
        <TenantPortalModal
          isOpen={showTenantPortal}
          onClose={() => setShowTenantPortal(false)}
          contract={contract}
          payments={payments}
          onOpenMaintenance={() => setShowMaintenanceModal(true)}
        />
      )}

      {/* 🔧 Rental Maintenance & Repair Modal */}
      {showMaintenanceModal && (
        <RentalMaintenanceModal
          isOpen={showMaintenanceModal}
          onClose={() => setShowMaintenanceModal(false)}
          plotId={contract?.plot_id}
          plotName={contract?.plot_name}
          projectName={contract?.project_name || projectName}
          lead={lead || (contract ? {
            id: contract.lead_id || '',
            customer_name: contract.tenant_name,
            phone: contract.tenant_phone || '',
            project_name: contract.project_name,
            interested_plot_id: contract.plot_id,
            interested_plot_name: contract.plot_name || contract.plot_id,
            created_at: contract.created_at || ''
          } : null)}
          user={user}
          onSaved={fetchData}
        />
      )}

    </div>
  );
}

