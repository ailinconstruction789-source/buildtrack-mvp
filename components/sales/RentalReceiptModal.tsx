"use client";

import React, { useRef } from 'react';
import { 
  Receipt, 
  Printer, 
  Share2, 
  Download, 
  X, 
  Building2, 
  CheckCircle2, 
  Calendar, 
  CreditCard, 
  QrCode, 
  Copy, 
  FileText,
  Clock,
  Home,
  User,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { RentalReceiptData, RENTAL_PROGRAM_DETAILS } from '@/types/sales';
import { formatThaiBahtText } from '@/lib/rentalHelper';

interface RentalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: RentalReceiptData | null;
}

export default function RentalReceiptModal({
  isOpen,
  onClose,
  data
}: RentalReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !data) return null;

  const isReceipt = data.receiptType === 'receipt';
  const thaiBaht = formatThaiBahtText(data.paidAmount ?? data.totalAmount);
  const promptPayNumber = data.promptPayId || '0812345678'; // Default developer PromptPay ID
  const promptPayQrUrl = `https://promptpay.io/${promptPayNumber}/${data.totalAmount}.png`;

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = () => {
    const text = `
📄 [${isReceipt ? 'ใบเสร็จรับเงินค่าเช่า' : 'ใบแจ้งหนี้ค่าเช่า'}] ${data.projectName}
━━━━━━━━━━━━━━━━━━
เลขที่: ${data.receiptNo}
ผู้เช่า: ${data.tenantName} (${data.tenantPhone || '-'})
แปลง/บ้าน: แปลง ${data.plotName}
งวด: ${data.periodLabel}
ยอดเงิน: ฿${(data.paidAmount ?? data.totalAmount).toLocaleString()} บาท (${thaiBaht})
สถานะ: ${data.paymentStatus === 'Paid' ? 'ชำระเรียบร้อยแล้ว ✅' : 'รอชำระเงิน ⏳'}
${!isReceipt ? `\n💳 สแกนจ่ายผ่าน PromptPay: ${promptPayNumber}` : ''}
━━━━━━━━━━━━━━━━━━
ไอลิน คอนสตรัคชั่น แอนด์ พร็อพเพอร์ตี้
    `.trim();

    navigator.clipboard.writeText(text);
    alert('📋 คัดลอกข้อความสรุปใบเสร็จ/ใบแจ้งหนี้แล้ว พร้อมวางส่งใน LINE!');
  };

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      {/* Print styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          #rental-printable-doc, #rental-printable-doc * {
            visibility: visible;
          }
          #rental-printable-doc {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 20px;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}} />

      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[95vh]">
        
        {/* Top Control Bar (Hidden on print) */}
        <div className="no-print bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/20 text-cyan-300 rounded-xl border border-cyan-400/30">
              <Receipt size={18} />
            </div>
            <div>
              <h3 className="font-black text-sm text-white flex items-center gap-1.5">
                {isReceipt ? 'ใบเสร็จรับเงินค่าเช่า (Official Receipt)' : 'ใบแจ้งหนี้ค่าเช่า (Rental Invoice)'}
              </h3>
              <p className="text-[10px] text-blue-200/80">
                เลขที่: <b className="font-mono text-white">{data.receiptNo}</b> • แปลง {data.plotName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-cyan-200 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
              title="คัดลอกข้อความส่งทาง LINE"
            >
              <Share2 size={13} /> แชร์ LINE
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
            >
              <Printer size={13} /> พิมพ์ / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-white/70 hover:text-white transition-colors cursor-pointer p-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 bg-slate-50/50">
          <div 
            id="rental-printable-doc"
            ref={printRef}
            className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6 text-slate-800 text-xs relative overflow-hidden"
          >
            {/* Watermark badge for Paid / Invoice */}
            <div className="absolute right-6 top-6 opacity-15 pointer-events-none select-none">
              {isReceipt ? (
                <div className="border-4 border-emerald-600 text-emerald-600 font-black text-3xl px-4 py-1.5 rounded-2xl uppercase rotate-[-12deg]">
                  PAID / ชำระแล้ว
                </div>
              ) : (
                <div className="border-4 border-blue-600 text-blue-600 font-black text-3xl px-4 py-1.5 rounded-2xl uppercase rotate-[-12deg]">
                  INVOICE / เรียกเก็บ
                </div>
              )}
            </div>

            {/* Header: Company & Document Info */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-5 border-b-2 border-slate-900">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-900 text-white flex items-center justify-center font-black text-sm">
                    BT
                  </div>
                  <div>
                    <h2 className="font-black text-base text-slate-900 leading-none">
                      {data.companyName || 'ไอลิน พร็อพเพอร์ตี้ (AILIN GROUP)'}
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      ระบบบริหารโครงการและการเช่า BuildTrack MVP
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  โครงการ: <b>{data.projectName}</b> | สำนักงานขาย & บริหารงานเช่า
                </p>
              </div>

              <div className="sm:text-right space-y-0.5">
                <div className="font-black text-lg text-blue-900 uppercase">
                  {isReceipt ? 'ใบเสร็จรับเงิน (RECEIPT)' : 'ใบแจ้งหนี้ (INVOICE)'}
                </div>
                <div className="font-mono text-xs text-slate-700">
                  เลขที่ / No: <b>{data.receiptNo}</b>
                </div>
                <div className="text-[11px] text-slate-500">
                  วันที่ออกเอกสาร: <b>{data.issueDate}</b>
                </div>
                {data.dueDate && (
                  <div className="text-[11px] text-rose-600 font-bold">
                    กำหนดชำระ / Due: <b>{data.dueDate}</b>
                  </div>
                )}
              </div>
            </div>

            {/* Bill To & Property Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50/80 rounded-2xl border border-slate-200">
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400">ข้อมูลผู้เช่า / Tenant:</div>
                <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <User size={14} className="text-blue-600" /> {data.tenantName}
                </div>
                <div className="text-slate-600 text-[11px]">
                  เบอร์โทรศัพท์: <span className="font-mono font-semibold">{data.tenantPhone || 'ไม่มีข้อมูล'}</span>
                </div>
              </div>

              <div className="space-y-1 sm:text-right">
                <div className="text-[10px] uppercase font-bold text-slate-400">รายละเอียดแปลง / Property:</div>
                <div className="font-bold text-slate-900 text-sm flex items-center sm:justify-end gap-1.5">
                  <Home size={14} className="text-emerald-600" /> แปลง {data.plotName} ({data.projectName})
                </div>
                <div className="text-[11px] text-slate-600">
                  โปรแกรม: <b className="text-indigo-900">{data.programName} ({data.programCode})</b>
                </div>
              </div>
            </div>

            {/* Itemized Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-white font-bold text-[11px]">
                  <tr>
                    <th className="p-3 w-12 text-center">ลำดับ</th>
                    <th className="p-3">รายการ (Description)</th>
                    <th className="p-3 text-right">งวดที่</th>
                    <th className="p-3 text-right w-32">จำนวนเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="p-3 text-center text-slate-400 font-mono">1</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-800">ค่าเช่าบ้านพักอาศัยประจำงวด</div>
                      <div className="text-[10px] text-slate-500">{data.periodLabel} (แปลง {data.plotName})</div>
                    </td>
                    <td className="p-3 text-right font-medium text-slate-600">{data.periodLabel}</td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">
                      ฿{data.rentAmount.toLocaleString()}
                    </td>
                  </tr>

                  {data.savingsAmount ? (
                    <tr className="bg-amber-50/50">
                      <td className="p-3 text-center text-amber-500 font-mono">2</td>
                      <td className="p-3">
                        <div className="font-bold text-amber-900 flex items-center gap-1">
                          <Sparkles size={13} className="text-amber-600" /> เงินสะสมซื้อบ้าน (Program B Rent-to-Own)
                        </div>
                        <div className="text-[10px] text-amber-700">สะสมหักลดราคาบ้านเมื่อเปลี่ยนเป็นซื้อ</div>
                      </td>
                      <td className="p-3 text-right font-medium text-amber-800">{data.periodLabel}</td>
                      <td className="p-3 text-right font-mono font-bold text-amber-900">
                        (฿{data.savingsAmount.toLocaleString()})
                      </td>
                    </tr>
                  ) : null}

                  {data.securityDeposit ? (
                    <tr>
                      <td className="p-3 text-center text-slate-400 font-mono">3</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">เงินประกันความเสียหาย (Security Deposit)</div>
                        <div className="text-[10px] text-slate-500">เงินประกันคืนเมื่อสิ้นสุดสัญญาเช่า</div>
                      </td>
                      <td className="p-3 text-right font-medium text-slate-600">แรกเข้า</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        ฿{data.securityDeposit.toLocaleString()}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot className="bg-slate-50/80 font-bold border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={3} className="p-3 text-right text-slate-700">
                      ยอดรวมสุทธิ / Total Amount:
                    </td>
                    <td className="p-3 text-right font-mono text-sm text-blue-900 font-black">
                      ฿{data.totalAmount.toLocaleString()}
                    </td>
                  </tr>
                  {isReceipt && data.paidAmount !== undefined && (
                    <tr className="bg-emerald-50 text-emerald-900">
                      <td colSpan={3} className="p-2.5 text-right text-xs">
                        จำนวนเงินที่ชำระแล้ว / Paid Amount:
                      </td>
                      <td className="p-2.5 text-right font-mono text-sm font-black text-emerald-700">
                        ฿{data.paidAmount.toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            {/* Thai Baht in Words */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-slate-500 text-[11px]">จำนวนเงินตัวอักษร:</span>
              <span className="font-bold text-slate-900 text-xs">({thaiBaht})</span>
            </div>

            {/* Payment PromptPay QR (If Invoice or Unpaid) */}
            {!isReceipt && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-bold text-blue-900 flex items-center gap-1.5 text-xs">
                    <QrCode size={16} className="text-blue-700" /> ชำระเงินผ่าน PromptPay QR Code
                  </div>
                  <p className="text-[11px] text-blue-700">
                    สแกน QR Code เพื่อชำระค่าเช่า ยอดเงินจะระบุอัตโนมัติ <b>฿{data.totalAmount.toLocaleString()} บาท</b>
                  </p>
                  <div className="text-[10px] text-slate-500 font-mono">
                    พร้อมเพย์: <b>{promptPayNumber}</b> (ไอลิน พร็อพเพอร์ตี้)
                  </div>
                </div>

                <div className="p-2 bg-white rounded-xl shadow-xs border border-blue-200 shrink-0 text-center">
                  <img 
                    src={promptPayQrUrl} 
                    alt="PromptPay QR Code" 
                    className="w-24 h-24 object-contain mx-auto"
                    onError={(e: any) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <div className="text-[9px] font-bold text-blue-800 mt-1">PromptPay QR</div>
                </div>
              </div>
            )}

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-center">
              <div className="space-y-12">
                <div className="text-[11px] text-slate-500">ผู้รับเงิน / ผู้มีอำนาจลงนาม</div>
                <div className="border-b border-slate-300 w-3/4 mx-auto"></div>
                <div className="text-[11px] font-bold text-slate-800">({data.agentName || 'ตัวแทนโครงการ'})</div>
              </div>

              <div className="space-y-12">
                <div className="text-[11px] text-slate-500">ผู้เช่า / ผู้ชำระเงิน</div>
                <div className="border-b border-slate-300 w-3/4 mx-auto"></div>
                <div className="text-[11px] font-bold text-slate-800">({data.tenantName})</div>
              </div>
            </div>

            {/* Footer Notice */}
            <div className="text-[10px] text-slate-400 text-center pt-2">
              เอกสารนี้ออกโดยระบบบริหารงานขายและสัญญาเช่า BuildTrack MVP • ติดต่อฝ่ายบริหารโครงการโทร 081-xxx-xxxx
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
