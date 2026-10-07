"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Key, 
  XCircle, 
  Home, 
  Sparkles, 
  Calendar, 
  DollarSign, 
  Percent, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight,
  LogOut,
  ShoppingBag,
  RefreshCw,
  PiggyBank,
  FileCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  Lead, 
  RentalContract, 
  RentalProgramType, 
  RENTAL_PROGRAM_DETAILS 
} from '@/types/sales';
import { calculateConversionCredit } from '@/lib/rentalHelper';

interface RentalActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead?: Lead | null;
  plot?: any | null;
  user?: any;
  onSaved?: () => void;
}

export default function RentalActionModal({
  isOpen,
  onClose,
  lead,
  plot,
  user,
  onSaved
}: RentalActionModalProps) {
  const [activeTab, setActiveTab] = useState<'convert_to_buy' | 'move_out' | 'renew'>('convert_to_buy');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active Contract Data
  const [activeContract, setActiveContract] = useState<RentalContract | null>(null);

  // --- Form 1: Convert to Purchase State ---
  const [purchaseDate, setPurchaseDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [customPurchasePrice, setCustomPurchasePrice] = useState<string>('');
  const [appliedBookingCredit, setAppliedBookingCredit] = useState<string>('');
  const [closingAgent, setClosingAgent] = useState<string>(user?.username || lead?.agent_name || 'ทีมขาย');

  // --- Form 2: Move Out State ---
  const [moveOutDate, setMoveOutDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [utilityDeduction, setUtilityDeduction] = useState<string>('0');
  const [damageDeduction, setDamageDeduction] = useState<string>('0');
  const [cleaningDeduction, setCleaningDeduction] = useState<string>('0');
  const [moveOutNotes, setMoveOutNotes] = useState<string>('');

  // --- Form 3: Renew Lease State ---
  const [renewalMonths, setRenewalMonths] = useState<number>(12);
  const [newMonthlyRent, setNewMonthlyRent] = useState<string>('');
  const [renewalNotes, setRenewalNotes] = useState<string>('');

  // Fetch latest active rental contract for this lead / plot
  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    const fetchContract = async () => {
      setLoading(true);
      try {
        let query = supabase.from('rental_contracts').select('*').eq('status', 'Active');
        if (lead?.id) {
          query = query.eq('lead_id', lead.id);
        } else if (plot?.id) {
          query = query.eq('plot_id', plot.id);
        }

        const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
        if (error) throw error;
        
        if (!isCancelled && data && data.length > 0) {
          const c = data[0] as RentalContract;
          setActiveContract(c);
          setNewMonthlyRent(c.monthly_rent?.toString() || '15000');
        } else if (!isCancelled) {
          // Fallback constructed contract from Lead/Plot if direct row not found
          const fallbackProgram = (lead?.rental_program || plot?.rental_program || 'program_a') as RentalProgramType;
          const fallbackContract: RentalContract = {
            id: lead?.active_rental_contract_id || 'virtual-contract',
            lead_id: lead?.id || null,
            project_name: lead?.project_name || plot?.project_name || 'ไอลิน สันทราย 2',
            plot_id: lead?.interested_plot_id || plot?.id || '',
            plot_name: lead?.interested_plot_name || plot?.plot_name || plot?.id || '',
            tenant_name: lead?.customer_name || plot?.current_tenant_name || 'ผู้เช่า',
            tenant_phone: lead?.phone || plot?.current_tenant_phone || null,
            agent_name: lead?.agent_name || user?.username || 'ทีมขาย',
            program_type: fallbackProgram,
            monthly_rent: lead?.rental_monthly_rent || plot?.monthly_rent || 15000,
            security_deposit: lead?.rental_deposit || plot?.security_deposit || 30000,
            advance_rent: lead?.rental_monthly_rent || plot?.monthly_rent || 15000,
            savings_per_month: lead?.rental_savings_per_month || (fallbackProgram === 'program_b' ? 5000 : 0),
            accumulated_savings: lead?.rental_accumulated_savings || 0,
            base_price: lead?.rental_base_price || plot?.base_price || plot?.price || 2990000,
            lease_duration_months: 12,
            lease_start_date: lead?.rental_start_date || plot?.lease_start_date || new Date().toISOString().split('T')[0],
            lease_end_date: lead?.rental_end_date || plot?.lease_end_date || new Date().toISOString().split('T')[0],
            status: 'Active',
            created_at: new Date().toISOString()
          };
          setActiveContract(fallbackContract);
          setNewMonthlyRent(fallbackContract.monthly_rent.toString());
        }
      } catch (err) {
        console.error('Error fetching rental contract for action modal:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };
    fetchContract();
    return () => { isCancelled = true; };
  }, [isOpen, lead, plot]);

  // Conversion Credit Calculations
  const conversionInfo = useMemo(() => {
    if (!activeContract) return null;
    return calculateConversionCredit(activeContract, purchaseDate);
  }, [activeContract, purchaseDate]);

  useEffect(() => {
    if (conversionInfo) {
      setCustomPurchasePrice(conversionInfo.finalPurchasePrice.toString());
      setAppliedBookingCredit(conversionInfo.suggestedBookingCredit.toString());
    }
  }, [conversionInfo]);

  // Move-Out Refund Calculations
  const moveOutRefund = useMemo(() => {
    if (!activeContract) return 0;
    const initialDeposit = Number(activeContract.security_deposit || 0);
    const util = parseFloat(utilityDeduction) || 0;
    const dmg = parseFloat(damageDeduction) || 0;
    const clean = parseFloat(cleaningDeduction) || 0;
    const totalDeductions = util + dmg + clean;
    return Math.max(0, initialDeposit - totalDeductions);
  }, [activeContract, utilityDeduction, damageDeduction, cleaningDeduction]);

  if (!isOpen) return null;

  const programMeta = activeContract?.program_type 
    ? RENTAL_PROGRAM_DETAILS[activeContract.program_type] 
    : RENTAL_PROGRAM_DETAILS.program_a;

  // --- Handlers ---

  // 1. Convert to Buy
  const handleConvertToBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (!activeContract) throw new Error('ไม่พบข้อมูลสัญญาเช่า');
      const now = new Date().toISOString();
      const plotId = activeContract.plot_id;
      const finalPrice = parseFloat(customPurchasePrice) || conversionInfo?.finalPurchasePrice || 0;
      const bookingCredit = parseFloat(appliedBookingCredit) || 0;

      // 1. Update Rental Contract to ConvertedToBuy
      if (activeContract.id && activeContract.id !== 'virtual-contract') {
        await supabase
          .from('rental_contracts')
          .update({
            status: 'ConvertedToBuy',
            conversion_date: purchaseDate,
            notes: `เปลี่ยนจากเช่าเป็นซื้อเมื่อ ${purchaseDate} (หักเครดิต/เงินสะสม ${bookingCredit.toLocaleString()} บาท)`
          })
          .eq('id', activeContract.id);
      }

      // 2. Update Plot to Reserved
      await supabase
        .from('plots')
        .update({
          sale_status: 'Reserved',
          has_customer: true,
          current_tenant_name: null,
          rental_program: null,
          highlight_note: `จองซื้อ (เปลี่ยนจากเช่า ${programMeta.name})`
        })
        .eq('id', plotId);

      // 3. Update or Insert into Sales / Leads
      const leadId = activeContract.lead_id || lead?.id;
      if (leadId) {
        await supabase
          .from('leads')
          .update({
            deal_type: 'buy',
            crm_status: 'Booked — จองแล้ว',
            booking_date: purchaseDate,
            booking_amount: bookingCredit,
            notes: `${lead?.notes || ''}\n[เปลี่ยนจากเช่าเป็นซื้อ ${purchaseDate}]: ยอดหักสะสม ${bookingCredit.toLocaleString()} บ. ราคาขายสุทธิ ${finalPrice.toLocaleString()} บ.`.trim(),
            rental_status: 'ConvertedToBuy'
          })
          .eq('id', leadId);

        // Also create/update Sales record for CRM pipeline & commission reporting
        try {
          await supabase.from('sales').insert([{
            lead_id: leadId,
            plot_id: plotId,
            contract_status: 'Reserved',
            crm_stage: 'booked',
            sale_price: finalPrice,
            booked_at: `${purchaseDate}T12:00:00Z`,
            created_at: now
          }]);
        } catch (salesErr) {
          console.warn('Could not insert to sales table (optional fallback):', salesErr);
        }
      }

      if (onSaved) onSaved();
      onClose();
      alert(`🎉 เปลี่ยนสถานะสำเร็จ! คุณ ${activeContract.tenant_name} เปลี่ยนเป็นผู้จองซื้อแปลง ${activeContract.plot_name || activeContract.plot_id} เรียบร้อยแล้ว`);
    } catch (err: any) {
      console.error('Error converting rental to buy:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการเปลี่ยนเป็นซื้อ');
    } finally {
      setSubmitting(false);
    }
  };

  // 2. Move Out
  const handleMoveOut = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (!activeContract) throw new Error('ไม่พบข้อมูลสัญญาเช่า');
      const plotId = activeContract.plot_id;

      // 1. Update Contract to MovedOut
      if (activeContract.id && activeContract.id !== 'virtual-contract') {
        await supabase
          .from('rental_contracts')
          .update({
            status: 'MovedOut',
            move_out_date: moveOutDate,
            deposit_refunded: moveOutRefund,
            notes: `ย้ายออกเมื่อ ${moveOutDate} (คืนเงินประกันสุทธิ ${moveOutRefund.toLocaleString()} บาท) ${moveOutNotes}`.trim()
          })
          .eq('id', activeContract.id);
      }

      // 2. Release Plot back to Available
      await supabase
        .from('plots')
        .update({
          sale_status: 'Available',
          has_customer: false,
          current_tenant_name: null,
          current_tenant_phone: null,
          rental_program: null,
          monthly_rent: null,
          security_deposit: null,
          lease_start_date: null,
          lease_end_date: null,
          highlight_note: null
        })
        .eq('id', plotId);

      // 3. Update Lead CRM Status
      const leadId = activeContract.lead_id || lead?.id;
      if (leadId) {
        await supabase
          .from('leads')
          .update({
            crm_status: 'Lease Ended / Moved Out — สิ้นสุดสัญญาเช่า (ย้ายออก)',
            rental_status: 'MovedOut',
            notes: `${lead?.notes || ''}\n[สิ้นสุดสัญญาเช่า ย้ายออก ${moveOutDate}]: คืนเงินประกัน ${moveOutRefund.toLocaleString()} บ.`.trim()
          })
          .eq('id', leadId);
      }

      if (onSaved) onSaved();
      onClose();
      alert(`📦 สิ้นสุดสัญญาเรียบร้อย! ปลดแปลง ${activeContract.plot_name || activeContract.plot_id} กลับมาเป็นแปลงว่างพร้อมขาย/เช่าแล้ว`);
    } catch (err: any) {
      console.error('Error processing move-out:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการบันทึกย้ายออก');
    } finally {
      setSubmitting(false);
    }
  };

  // 3. Renew Lease
  const handleRenewLease = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (!activeContract) throw new Error('ไม่พบข้อมูลสัญญาเช่า');
      const currentEnd = new Date(activeContract.lease_end_date || new Date());
      currentEnd.setMonth(currentEnd.getMonth() + renewalMonths);
      const newEndDate = currentEnd.toISOString().split('T')[0];
      const rentNum = parseFloat(newMonthlyRent) || activeContract.monthly_rent;

      // 1. Update Contract
      if (activeContract.id && activeContract.id !== 'virtual-contract') {
        await supabase
          .from('rental_contracts')
          .update({
            status: 'Renewed',
            lease_duration_months: (activeContract.lease_duration_months || 12) + renewalMonths,
            lease_end_date: newEndDate,
            monthly_rent: rentNum,
            notes: `${activeContract.notes || ''}\n[ต่อสัญญาเช่า +${renewalMonths} เดือน]: สิ้นสุดใหม่ ${newEndDate}`.trim()
          })
          .eq('id', activeContract.id);
      }

      // 2. Update Plot
      await supabase
        .from('plots')
        .update({
          monthly_rent: rentNum,
          lease_end_date: newEndDate
        })
        .eq('id', activeContract.plot_id);

      // 3. Update Lead
      const leadId = activeContract.lead_id || lead?.id;
      if (leadId) {
        await supabase
          .from('leads')
          .update({
            rental_end_date: newEndDate,
            rental_monthly_rent: rentNum,
            notes: `${lead?.notes || ''}\n[ต่อสัญญาเช่า +${renewalMonths} เดือน]: สิ้นสุดใหม่ ${newEndDate}`.trim()
          })
          .eq('id', leadId);
      }

      if (onSaved) onSaved();
      onClose();
      alert(`📝 ต่อสัญญาเช่าสำเร็จ! ขยายเวลาสัญญาถึงวันที่ ${newEndDate}`);
    } catch (err: any) {
      console.error('Error renewing lease:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการต่อสัญญา');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-blue-950 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 text-cyan-300 rounded-2xl border border-cyan-400/30">
              <Key size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-white">
                  🔑 จัดการสัญญาเช่า (Manage Lease Lifecycle)
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${programMeta.badgeColor}`}>
                  แบบ {programMeta.code}: {programMeta.name}
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">
                ผู้เช่า: <span className="text-white font-bold">{activeContract?.tenant_name || 'ลูกค้า'}</span> | แปลง: <span className="text-white font-bold">{activeContract?.plot_name || activeContract?.plot_id}</span>
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <XCircle size={22} />
          </button>
        </div>

        {/* Action Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('convert_to_buy')}
            className={`pb-3 px-3 font-bold text-xs flex items-center gap-1.5 transition-all border-b-2 cursor-pointer ${
              activeTab === 'convert_to_buy'
                ? 'border-emerald-600 text-emerald-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <ShoppingBag size={15} /> 🏡 1. เปลี่ยนเป็นซื้อ (Convert to Buy)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('renew')}
            className={`pb-3 px-3 font-bold text-xs flex items-center gap-1.5 transition-all border-b-2 cursor-pointer ${
              activeTab === 'renew'
                ? 'border-blue-600 text-blue-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <RefreshCw size={15} /> 📝 2. ต่อสัญญาเช่า (Renew)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('move_out')}
            className={`pb-3 px-3 font-bold text-xs flex items-center gap-1.5 transition-all border-b-2 cursor-pointer ${
              activeTab === 'move_out'
                ? 'border-rose-600 text-rose-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <LogOut size={15} /> 📦 3. สิ้นสุดสัญญา / ย้ายออก
          </button>
        </div>

        <div className="p-5 sm:p-6 text-xs overflow-y-auto flex-1 dark-scrollbar">
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 🌟 Tab 1: Convert to Buy 🌟 */}
          {activeTab === 'convert_to_buy' && (
            <form onSubmit={handleConvertToBuy} className="space-y-4">
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-emerald-950 text-xs flex items-center gap-1.5">
                    <Sparkles size={16} className="text-emerald-600" /> สิทธิประโยชน์ตามโปรแกรม {programMeta.name}
                  </div>
                  <span className="text-[11px] bg-emerald-200/70 text-emerald-900 font-bold px-2 py-0.5 rounded-full">
                    อยู่มาแล้ว {conversionInfo?.monthsRented || 1} เดือน
                  </span>
                </div>

                {activeContract?.program_type === 'program_b' && (
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-1">
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>เงินสะสมซื้อบ้าน 5,000 บ. × {conversionInfo?.monthsRented} เดือน:</span>
                      <span className="font-bold text-amber-700 text-xs">
                        {conversionInfo?.accumulatedSavings.toLocaleString()} บาท
                      </span>
                    </div>
                    <div className="text-[10px] text-emerald-700 font-semibold">
                      ✨ นำยอดเงินสะสมนี้ไปหักลบออกจากราคาขายบ้านทันทีเมื่อโอนกรรมสิทธิ์
                    </div>
                  </div>
                )}

                {activeContract?.program_type === 'program_c' && (
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-1">
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>สิทธิ์ส่วนลดราคาฐาน (โอนภายใน {conversionInfo?.monthsRented && conversionInfo.monthsRented <= 12 ? '1 ปี (-10%)' : '2 ปี (-5%)'}):</span>
                      <span className="font-bold text-emerald-700 text-xs">
                        - {conversionInfo?.applicableDiscountAmount.toLocaleString()} บาท ({conversionInfo?.applicableDiscountPct}%)
                      </span>
                    </div>
                    <div className="text-[10px] text-emerald-700 font-semibold">
                      ✨ ราคาฐาน {conversionInfo?.basePrice.toLocaleString()} บ. ลดเหลือ {conversionInfo?.finalPurchasePrice.toLocaleString()} บ.
                    </div>
                  </div>
                )}

                {activeContract?.program_type === 'program_a' && (
                  <div className="p-3 bg-white rounded-xl border border-blue-200 text-slate-600 text-[11px]">
                    สามารถนำเงินประกันสัญญาเช่า ({Number(activeContract.security_deposit || 0).toLocaleString()} บ.) มาเปลี่ยนเป็นเงินจองซื้อบ้านได้
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">วันที่ตัดสินใจซื้อ *</label>
                  <input
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={e => setPurchaseDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">เซลส์ผู้ปิดการขาย (Closing Agent)</label>
                  <input
                    type="text"
                    value={closingAgent}
                    onChange={e => setClosingAgent(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ยอดเงินจอง/เงินสะสมที่นำมาหัก (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    value={appliedBookingCredit}
                    onChange={e => setAppliedBookingCredit(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ราคาขายสุทธิหลังหักส่วนลด (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    value={customPurchasePrice}
                    onChange={e => setCustomPurchasePrice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-black text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-600/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <FileCheck size={15} />
                  {submitting ? 'กำลังเปลี่ยนเป็นซื้อ...' : 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้'}
                </button>
              </div>
            </form>
          )}

          {/* 🌟 Tab 2: Renew Lease 🌟 */}
          {activeTab === 'renew' && (
            <form onSubmit={handleRenewLease} className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-200/80 space-y-2">
                <div className="font-bold text-blue-900 text-xs">
                  ต่อสัญญาเช่าเดิม (Lease Renewal)
                </div>
                <div className="text-[11px] text-blue-700">
                  สัญญาปัจจุบันจะสิ้นสุดในวันที่: <b>{activeContract?.lease_end_date || '-'}</b>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ขยายระยะเวลาสัญญา (เดือน)</label>
                  <select
                    value={renewalMonths}
                    onChange={e => setRenewalMonths(parseInt(e.target.value) || 12)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value={6}>+ 6 เดือน</option>
                    <option value={12}>+ 12 เดือน (1 ปี)</option>
                    <option value={24}>+ 24 เดือน (2 ปี)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ค่าเช่าต่อเดือนใหม่ (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={newMonthlyRent}
                    onChange={e => setNewMonthlyRent(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">หมายเหตุการต่อสัญญา</label>
                <textarea
                  rows={2}
                  value={renewalNotes}
                  onChange={e => setRenewalNotes(e.target.value)}
                  placeholder="เช่น ปรับค่าเช่าตามเงื่อนไขปีที่ 2, ตรวจสอบสภาพบ้านแล้วเรียบร้อย..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-600/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={15} />
                  {submitting ? 'กำลังต่อสัญญา...' : 'ยืนยันต่อสัญญาเช่า'}
                </button>
              </div>
            </form>
          )}

          {/* 🌟 Tab 3: Move Out 🌟 */}
          {activeTab === 'move_out' && (
            <form onSubmit={handleMoveOut} className="space-y-4">
              <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200/80 space-y-2">
                <div className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
                  <LogOut size={16} className="text-rose-600" /> สิ้นสุดสัญญาเช่า & คืนเงินประกัน
                </div>
                <div className="text-[11px] text-rose-700">
                  เงินประกันตั้งต้นที่ลูกค้าเคยวางไว้: <b>{Number(activeContract?.security_deposit || 0).toLocaleString()} บาท</b>
                </div>
                <div className="text-[10px] text-slate-500">
                  เมื่อกดยืนยัน แปลง {activeContract?.plot_name || activeContract?.plot_id} จะถูกปลดล็อกกลับมาเป็น <b>สถานะว่าง</b> ให้เปิดขายหรือปล่อยเช่าต่อได้ทันที
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">วันที่ย้ายออก *</label>
                  <input
                    type="date"
                    required
                    value={moveOutDate}
                    onChange={e => setMoveOutDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">หักค่าน้ำ / ค่าไฟค้างชำระ (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    value={utilityDeduction}
                    onChange={e => setUtilityDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">หักค่าความเสียหาย/ซ่อมแซม (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    value={damageDeduction}
                    onChange={e => setDamageDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">หักค่าทำความสะอาด (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    value={cleaningDeduction}
                    onChange={e => setCleaningDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Net Deposit Refund Box */}
              <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-xs">ยอดเงินประกันสุทธิที่ต้องคืนลูกค้า:</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">เงินประกันตั้งต้น - รายการหักทั้งหมด</p>
                </div>
                <div className="text-sm font-black text-rose-700 bg-white px-3 py-1.5 rounded-xl border border-slate-300 shadow-sm">
                  {moveOutRefund.toLocaleString()} บาท
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">หมายเหตุการย้ายออก / ตรวจรับบ้าน</label>
                <textarea
                  rows={2}
                  value={moveOutNotes}
                  onChange={e => setMoveOutNotes(e.target.value)}
                  placeholder="เช่น ตรวจมิเตอร์น้ำไฟแล้วเรียบร้อย, คืนกุญแจครบ 3 ดอก..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-md shadow-rose-600/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <LogOut size={15} />
                  {submitting ? 'กำลังบันทึกย้ายออก...' : 'ยืนยันการย้ายออก & ปลดแปลงว่าง'}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
