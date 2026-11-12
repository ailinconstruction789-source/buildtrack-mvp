// ==============================================================================
// 📑 BUILDTRACK: QC INSPECTION REPORT MODAL (รายงานการตรวจ QC แบบฟอร์มใหม่)
// ==============================================================================

import React, { useRef } from 'react';
import { 
  X, Printer, CheckCircle, XCircle, AlertTriangle, MapPin, 
  FileText, Calendar, User, ShieldCheck, Download 
} from 'lucide-react';
import { QCInspection, QCInspectionAnswer, QCDrawingAnnotation } from '@/types/qc.types';

interface QCInspectionReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  inspection: QCInspection;
  houseTypeName?: string;
}

export default function QCInspectionReportModal({
  isOpen,
  onClose,
  inspection,
  houseTypeName = ''
}: QCInspectionReportModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !inspection) return null;

  const handlePrint = () => {
    window.print();
  };

  const isApproved = inspection.document_status === 'approved';
  const isRejected = inspection.document_status === 'rejected';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 z-[999] animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-4xl w-full h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Header Action Bar (Not printed) */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-2 rounded-xl">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base">รายงานการตรวจคุณภาพ QC (Inspection Report)</h3>
              <p className="text-xs text-slate-400">เลขที่รอบ: #{inspection.round_number} • แปลง {inspection.plot_id} - {inspection.task_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md"
            >
              <Printer size={16} />
              <span>พิมพ์รายงาน (Print)</span>
            </button>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg"><X size={20} /></button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div ref={printRef} className="flex-1 overflow-y-auto p-6 sm:p-10 bg-white text-slate-800 space-y-6">
          {/* Document Header */}
          <div className="border-b-2 border-slate-900 pb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-purple-700 tracking-wider text-xs uppercase font-mono">BUILDTRACK MVP</span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500 font-bold">เอกสารตรวจสอบคุณภาพงานก่อสร้าง</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">รายงานผลการตรวจ QC (แบบฟอร์มใหม่)</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                แบบฟอร์ม: <span className="font-bold text-slate-800">{inspection.form_title} (v{inspection.form_version})</span>
              </p>
            </div>

            {/* Status Stamp */}
            <div className="text-right">
              <div className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-2xl font-bold text-sm border-2 ${
                isApproved ? 'bg-emerald-50 text-emerald-700 border-emerald-500' :
                isRejected ? 'bg-rose-50 text-rose-700 border-rose-500' :
                'bg-amber-50 text-amber-700 border-amber-500'
              }`}>
                {isApproved ? <CheckCircle size={18} /> : isRejected ? <XCircle size={18} /> : <AlertTriangle size={18} />}
                <span>{isApproved ? 'ผ่านการรับรอง (PASSED)' : isRejected ? 'ไม่ผ่าน (REJECTED)' : 'รอดำเนินการ'}</span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono mt-1">รอบที่ {inspection.round_number}</p>
            </div>
          </div>

          {/* Project & Inspection Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">โครงการ</p>
              <p className="font-bold text-slate-800 mt-0.5">{inspection.project_name}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">แปลง / แบบบ้าน</p>
              <p className="font-bold text-slate-800 mt-0.5">{inspection.plot_id} {houseTypeName ? `(${houseTypeName})` : ''}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">ประเภทงาน</p>
              <p className="font-bold text-purple-900 mt-0.5">{inspection.task_name}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">แบบอ้างอิง</p>
              <p className="font-bold text-slate-800 mt-0.5">
                {inspection.drawing_title ? `${inspection.drawing_title} (v${inspection.drawing_version || 1})` : 'ไม่มีแบบแปลน'}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">ผู้ตรวจสอบ</p>
              <p className="font-bold text-slate-800 mt-0.5">{inspection.inspector_name} ({inspection.inspector_role})</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">วันเวลาที่ตรวจ</p>
              <p className="font-bold text-slate-800 mt-0.5">
                {inspection.submitted_at || inspection.created_at ? new Date(inspection.submitted_at || inspection.created_at || '').toLocaleString('th-TH') : '-'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">ผู้รับรองผล</p>
              <p className="font-bold text-slate-800 mt-0.5">{inspection.approved_by || '-'}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">วันเวลาที่รับรอง</p>
              <p className="font-bold text-slate-800 mt-0.5">
                {inspection.approved_at ? new Date(inspection.approved_at).toLocaleString('th-TH') : '-'}
              </p>
            </div>
          </div>

          {/* Results Summary Box */}
          <div className="flex items-center gap-4 border p-4 rounded-2xl bg-white border-slate-200 text-xs">
            <span className="font-bold text-slate-600">ผลสรุปรายการตรวจ:</span>
            <span className="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
              ผ่าน: {inspection.passed_items} ข้อ
            </span>
            <span className="text-rose-700 font-bold bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
              ไม่ผ่าน: {inspection.failed_items} ข้อ
            </span>
            <span className="text-slate-600 font-bold bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
              N/A: {inspection.na_items} ข้อ
            </span>
            <span className="text-slate-400 ml-auto font-mono">ทั้งหมด {inspection.total_items} ข้อ</span>
          </div>

          {/* Detailed Answers Table */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <CheckCircle className="text-purple-600" size={16} />
              <span>รายละเอียดการตรวจรายข้อ (Checklist Results)</span>
            </h3>

            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                    <th className="py-2.5 px-4">รหัส</th>
                    <th className="py-2.5 px-4">รายการตรวจ</th>
                    <th className="py-2.5 px-4">ค่าที่วัด</th>
                    <th className="py-2.5 px-4 text-center">ผลการตรวจ</th>
                    <th className="py-2.5 px-4">หมายเหตุ / ข้อบกพร่อง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(inspection.answers || []).map((ans, aIdx) => (
                    <tr key={aIdx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono font-bold text-purple-700">{ans.item_code}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-800">
                        {ans.item_text}
                        {ans.is_critical && (
                          <span className="ml-2 text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                            ข้อสำคัญ
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-700">
                        {ans.numeric_value !== null && ans.numeric_value !== undefined 
                          ? `${ans.numeric_value} ${ans.unit || ''}` 
                          : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                          ans.status === 'passed' ? 'bg-emerald-100 text-emerald-700' :
                          ans.status === 'failed' ? 'bg-rose-100 text-rose-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {ans.status === 'passed' ? 'ผ่าน' : ans.status === 'failed' ? 'ไม่ผ่าน' : 'N/A'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {ans.remarks || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drawing Annotations Summary */}
          {inspection.annotations && inspection.annotations.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <MapPin className="text-purple-600" size={16} />
                <span>จุดวัดบนแบบแปลนอ้างอิง ({inspection.annotations.length} จุด)</span>
              </h3>
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                      <th className="py-2 px-3">จุด</th>
                      <th className="py-2 px-3">หน้า</th>
                      <th className="py-2 px-3">พิกัด (X, Y)</th>
                      <th className="py-2 px-3">ค่าที่วัด</th>
                      <th className="py-2 px-3">ผลประเมิน</th>
                      <th className="py-2 px-3">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspection.annotations.map((pin, pIdx) => (
                      <tr key={pIdx}>
                        <td className="py-2 px-3 font-mono font-bold text-purple-700">{pin.pin_label}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">หน้า {pin.page_number}</td>
                        <td className="py-2 px-3 font-mono text-slate-400">
                          ({(pin.x_ratio * 100).toFixed(1)}%, {(pin.y_ratio * 100).toFixed(1)}%)
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-700">
                          {pin.measured_value !== null ? `${pin.measured_value} ${pin.unit || ''}` : '-'}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            pin.status === 'passed' ? 'bg-emerald-100 text-emerald-700' :
                            pin.status === 'failed' ? 'bg-rose-100 text-rose-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {pin.status === 'passed' ? 'ผ่าน' : pin.status === 'failed' ? 'ไม่ผ่าน' : 'N/A'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600">{pin.remarks || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Photo Evidence Grid */}
          {inspection.photo_urls && inspection.photo_urls.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-bold text-sm text-slate-800">รูปภาพหลักฐานการตรวจ</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {inspection.photo_urls.map((url, uIdx) => (
                  <div key={uIdx} className="h-28 rounded-xl overflow-hidden border border-slate-200">
                    <img src={url} alt={`หลักฐาน ${uIdx + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Signature Block */}
          <div className="pt-8 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-xs">
            <div className="space-y-12">
              <p className="font-bold text-slate-600">ลงชื่อผู้ตรวจสอบ (Inspector)</p>
              <div>
                <p className="font-bold text-slate-800">{inspection.inspector_name}</p>
                <p className="text-[10px] text-slate-400">ตำแหน่ง: {inspection.inspector_role}</p>
              </div>
            </div>

            <div className="space-y-12">
              <p className="font-bold text-slate-600">ลงชื่อผู้รับรอง / อนุมัติ (Approver)</p>
              <div>
                <p className="font-bold text-slate-800">{inspection.approved_by || '...........................................'}</p>
                <p className="text-[10px] text-slate-400">ผู้รับผิดชอบงาน QC / Admin</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
