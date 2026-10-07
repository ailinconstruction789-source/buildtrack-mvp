"use client";

import React, { useState } from 'react';
import { 
  Smartphone, 
  XCircle, 
  Share2, 
  Copy, 
  Home, 
  Sparkles, 
  PiggyBank, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  QrCode, 
  Wrench, 
  ArrowRight,
  TrendingUp,
  Percent,
  User,
  Building,
  ShieldCheck
} from 'lucide-react';
import { 
  RentalContract, 
  RentalPaymentRecord, 
  RENTAL_PROGRAM_DETAILS 
} from '@/types/sales';

interface TenantPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  contract: RentalContract | null;
  payments: RentalPaymentRecord[];
  onOpenMaintenance?: () => void;
}

export default function TenantPortalModal({
  isOpen,
  onClose,
  contract,
  payments,
  onOpenMaintenance
}: TenantPortalModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !contract) return null;

  const currentProgram = RENTAL_PROGRAM_DETAILS[contract.program_type];
  const paidCount = payments.filter(p => p.payment_status === 'Paid').length;
  const totalCount = contract.lease_duration_months || 12;
  const progressPct = Math.round((paidCount / totalCount) * 100);

  const nextUnpaid = payments.find(p => p.payment_status !== 'Paid');
  const monthlyRent = Number(contract.monthly_rent || 0);
  const promptPayId = '0812345678';
  const promptPayQrUrl = `https://promptpay.io/${promptPayId}/${nextUnpaid?.amount_due || monthlyRent}.png`;

  const handleShareLink = () => {
    const portalUrl = `${window.location.origin}/tenant-portal?contract_id=${contract.id}`;
    navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        
        {/* Top Bar */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/20 text-cyan-300 rounded-xl border border-cyan-400/30">
              <Smartphone size={18} />
            </div>
            <div>
              <h3 className="font-black text-sm text-white flex items-center gap-1.5">
                📱 หน้ามุมมองผู้เช่า (Tenant Portal Preview)
              </h3>
              <p className="text-[10px] text-blue-200/80">
                ตัวอย่างหน้าจอบนมือถือที่ผู้เช่าจะเห็นเมื่อเปิดลิงก์
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <XCircle size={20} />
          </button>
        </div>

        {/* Mobile Viewport Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 bg-slate-50 text-xs">
          
          {/* Welcome & Unit Card */}
          <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-blue-950 text-white p-4.5 rounded-2xl shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-400/20 text-cyan-200 border border-cyan-400/30">
                {contract.project_name}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${currentProgram.badgeColor}`}>
                แบบ {currentProgram.code}: {currentProgram.name}
              </span>
            </div>

            <div>
              <div className="text-[11px] text-blue-200">ยินดีต้อนรับผู้เช่า</div>
              <div className="text-base font-black text-white">{contract.tenant_name}</div>
              <div className="text-xs font-bold text-cyan-300 mt-0.5">
                🏡 บ้านแปลง {contract.plot_name || contract.plot_id}
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-blue-100">
              <span>ค่าเช่า: <b>฿{monthlyRent.toLocaleString()}</b> บ./ด.</span>
              <span>สัญญาถึง: <b>{contract.lease_end_date}</b></span>
            </div>
          </div>

          {/* 🌟 Program B: Downpayment Savings Tracker */}
          {contract.program_type === 'program_b' && (
            <div className="bg-white p-4 rounded-2xl border-2 border-amber-300 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                  <PiggyBank size={16} className="text-amber-600 animate-pulse" /> เงินสะสมซื้อบ้านของคุณ
                </span>
                <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                  Rent to Own
                </span>
              </div>

              <div className="text-2xl font-black text-amber-950 font-mono">
                ฿{Number(contract.accumulated_savings || 0).toLocaleString()} <span className="text-xs font-normal text-amber-800">บาท</span>
              </div>

              <p className="text-[11px] text-slate-600">
                สะสมเดือนละ <b>฿5,000 บาท</b> จากค่าเช่าทุกงวดที่จ่ายตรงเวลา เพื่อนำไปหักลดราคาตัวบ้านเมื่อตัดสินใจซื้อ!
              </p>
            </div>
          )}

          {/* 🌟 Program C: Discount Tier */}
          {contract.program_type === 'program_c' && (
            <div className="bg-white p-4 rounded-2xl border-2 border-purple-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-purple-900 flex items-center gap-1.5">
                  <Sparkles size={16} className="text-purple-600" /> สิทธิพิเศษส่วนลดซื้อบ้าน (แบบ C)
                </span>
                <span className="text-[10px] font-black text-purple-800 bg-purple-100 px-2 py-0.5 rounded-md">
                  Flexi-Invest
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center pt-1">
                <div className="p-2 bg-purple-50 rounded-xl border border-purple-100">
                  <div className="text-sm font-black text-purple-900 font-mono">ลด 10%</div>
                  <div className="text-[10px] text-purple-700">ภายในปีที่ 1 (12 ด.)</div>
                </div>
                <div className="p-2 bg-purple-50/60 rounded-xl border border-purple-100">
                  <div className="text-sm font-black text-purple-900 font-mono">ลด 5%</div>
                  <div className="text-[10px] text-purple-700">ภายในปีที่ 2 (24 ด.)</div>
                </div>
              </div>
            </div>
          )}

          {/* Payment Progress Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <Clock size={14} className="text-blue-600" /> ความคืบหน้าการชำระตามสัญญา
              </span>
              <span className="font-bold text-slate-700 font-mono">
                {paidCount} / {totalCount} งวด ({progressPct}%)
              </span>
            </div>

            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Next Due & QR Payment Box */}
          {nextUnpaid ? (
            <div className="bg-white p-4 rounded-2xl border border-blue-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs text-blue-900 flex items-center gap-1.5">
                  <QrCode size={16} className="text-blue-600" /> งวดถัดไปที่ต้องชำระ ({nextUnpaid.period_label})
                </div>
                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                  ครบกำหนด {nextUnpaid.due_date}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-blue-50/70 rounded-xl">
                <div>
                  <div className="text-[11px] text-slate-600">ยอดที่ต้องชำระ:</div>
                  <div className="text-lg font-black text-blue-900 font-mono">
                    ฿{Number(nextUnpaid.amount_due || monthlyRent).toLocaleString()} บาท
                  </div>
                </div>
                <img 
                  src={promptPayQrUrl} 
                  alt="PromptPay QR" 
                  className="w-16 h-16 object-contain bg-white p-1 rounded-lg border border-blue-200" 
                />
              </div>

              <div className="text-[10px] text-slate-500 text-center">
                สแกนผ่านแอปธนาคารทุกแห่ง หรือโอนเข้าพร้อมเพย์ <b>{promptPayId}</b>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-1">
              <CheckCircle2 size={22} className="text-emerald-600 mx-auto" />
              <div className="font-bold text-xs text-emerald-900">ชำระค่าเช่าครบทุกงวดแล้ว!</div>
              <div className="text-[10px] text-emerald-700">ขอบคุณที่ชำระตรงเวลาเสมอ</div>
            </div>
          )}

          {/* Quick Action: Maintenance Request */}
          <button
            type="button"
            onClick={() => {
              if (onOpenMaintenance) onOpenMaintenance();
              onClose();
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Wrench size={14} className="text-slate-500" /> แจ้งซ่อมบำรุงบ้าน / ปัญหาที่พบ
          </button>

        </div>

        {/* Footer: Copy Link Button */}
        <div className="p-4 bg-white border-t border-slate-200 flex gap-2">
          <button
            type="button"
            onClick={handleShareLink}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer text-xs"
          >
            {copied ? (
              <>
                <CheckCircle2 size={14} /> คัดลอกลิงก์สำเร็จแล้ว!
              </>
            ) : (
              <>
                <Share2 size={14} /> คัดลอกลิงก์ส่งให้ผู้เช่าทาง LINE
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
