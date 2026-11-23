import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  MapPin,
  ChevronDown,
  ChevronUp,
  Printer,
  ShieldCheck,
  Clock,
  Ruler,
  MessageSquare,
  ArrowRight,
  Camera
} from 'lucide-react';
import { QCInspection, QCInspectionAnswer, QCDrawingAnnotation } from '@/types/qc.types';

const QC_INSP_REF_REGEX = /\[ref:qc_insp_([^\]]+)\]/;

export function extractQCInspectionRefId(text?: string | null): string | null {
  if (!text) return null;
  const match = String(text).match(QC_INSP_REF_REGEX);
  return match ? match[1] : null;
}

interface QCInspectionInlineCardProps {
  inspection: QCInspection;
  compact?: boolean;
  defaultExpanded?: boolean;
  onOpenFullReport?: (inspection: QCInspection) => void;
  onOpenReview?: (inspection: QCInspection) => void;
  onPreviewPhoto?: (url: string) => void;
}

export default function QCInspectionInlineCard({
  inspection,
  compact = false,
  defaultExpanded = true,
  onOpenFullReport,
  onOpenReview,
  onPreviewPhoto
}: QCInspectionInlineCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!inspection) return null;

  const answers: QCInspectionAnswer[] = Array.isArray(inspection.answers)
    ? [...inspection.answers].sort((a, b) =>
        String(a.item_code || '').localeCompare(String(b.item_code || ''), undefined, { numeric: true })
      )
    : [];

  const annotations: QCDrawingAnnotation[] = Array.isArray(inspection.annotations)
    ? inspection.annotations
    : [];

  const passedCount = answers.length > 0
    ? answers.filter(a => a.status === 'passed').length
    : (inspection.passed_items ?? 0);
  const failedCount = answers.length > 0
    ? answers.filter(a => a.status === 'failed').length
    : (inspection.failed_items ?? 0);
  const conditionalCount = answers.length > 0
    ? answers.filter(a => a.status === 'conditional').length
    : (inspection.conditional_items ?? 0);
  const naCount = answers.length > 0
    ? answers.filter(a => a.status === 'na').length
    : (inspection.na_items ?? 0);
  const totalCount = answers.length > 0 ? answers.length : (inspection.total_items ?? 0);

  const isPassed =
    (inspection.document_status === 'approved' || inspection.document_status === 'submitted') &&
    inspection.inspection_result === 'passed';
  const isConditionalApproved =
    inspection.document_status === 'approved' && inspection.inspection_result === 'conditional';
  const isPendingPE = inspection.document_status === 'pending_pe';
  const isFailed =
    inspection.document_status === 'rejected' || inspection.inspection_result === 'failed';

  const statusMeta = isPassed
    ? {
        label: 'ตรวจผ่านตามมาตรฐาน (PASSED)',
        badgeClass: 'bg-emerald-600 text-white',
        borderClass: 'border-emerald-200 bg-emerald-50/40',
        headerBg: 'bg-gradient-to-r from-emerald-900 via-slate-900 to-slate-900',
        icon: <CheckCircle size={14} className=" shrink-0" />
      }
    : isConditionalApproved
      ? {
          label: 'ผ่านแบบมีเงื่อนไข (PE อนุมัติ)',
          badgeClass: 'bg-amber-600 text-white',
          borderClass: 'border-amber-200 bg-amber-50/40',
          headerBg: 'bg-gradient-to-r from-amber-900 via-slate-900 to-slate-900',
          icon: <ShieldCheck size={14} className="shrink-0" />
        }
      : isPendingPE
        ? {
            label: 'รอวิศวกรโครงการ (PE) พิจารณาเงื่อนไข',
            badgeClass: 'bg-amber-500 text-white',
            borderClass: 'border-amber-200 bg-amber-50/40',
            headerBg: 'bg-gradient-to-r from-amber-900 via-slate-900 to-slate-900',
            icon: <Clock size={14} className="shrink-0" />
          }
        : isFailed
          ? {
              label: 'ไม่ผ่านการตรวจ (แจ้งแก้ไข)',
              badgeClass: 'bg-rose-600 text-white',
              borderClass: 'border-rose-200 bg-rose-50/40',
              headerBg: 'bg-gradient-to-r from-rose-950 via-slate-900 to-slate-900',
              icon: <XCircle size={14} className="shrink-0" />
            }
          : {
              label: 'ส่งผลการตรวจแล้ว',
              badgeClass: 'bg-purple-600 text-white',
              borderClass: 'border-purple-200 bg-purple-50/30',
              headerBg: 'bg-gradient-to-r from-purple-950 via-slate-900 to-slate-900',
              icon: <FileText size={14} className="shrink-0" />
            };

  return (
    <div
      className={`mt-2 mb-3 rounded-2xl border overflow-hidden shadow-sm transition-all ${statusMeta.borderClass}`}
      data-testid={`qc-inline-card-${inspection.id}`}
    >
      {/* ส่วนหัวการ์ดแบบฟอร์ม QC */}
      <div className={`${statusMeta.headerBg} text-white px-3.5 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="bg-purple-500/30 border border-purple-400/40 text-purple-100 text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 shrink-0">
            <FileText size={11} />
            <span>QC ฟอร์มใหม่ • รอบที่ {inspection.round_number || 1}</span>
          </span>
          <span className="font-bold text-xs sm:text-sm text-white truncate">
            {inspection.form_title || 'แบบฟอร์มตรวจสอบคุณภาพ'} {inspection.form_version ? `(v${inspection.form_version})` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className={`text-[10px] sm:text-xs font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-xs ${statusMeta.badgeClass}`}>
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
          </span>
        </div>
      </div>

      {/* แถบสรุปผลคะแนน + ปุ่มพับ/กาง และปุ่มเปิดรายงานเต็ม */}
      <div className="bg-white/90 px-3.5 sm:px-4 py-2.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap text-[10px] sm:text-xs font-bold">
          <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
            ทั้งหมด {totalCount} ข้อ
          </span>
          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 flex items-center gap-1">
            <CheckCircle size={11} /> ผ่าน: {passedCount}
          </span>
          {failedCount > 0 && (
            <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200 flex items-center gap-1">
              <XCircle size={11} /> ไม่ผ่าน: {failedCount}
            </span>
          )}
          {conditionalCount > 0 && (
            <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 flex items-center gap-1">
              <AlertTriangle size={11} /> มีเงื่อนไข: {conditionalCount}
            </span>
          )}
          {naCount > 0 && (
            <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
              N/A: {naCount}
            </span>
          )}
          {inspection.drawing_title && (
            <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200 hidden sm:inline-flex items-center gap-1">
              <MapPin size={11} /> {inspection.drawing_title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {isPendingPE && onOpenReview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenReview(inspection);
              }}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-lg text-[10px] sm:text-xs font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer animate-pulse"
              title="เปิดฟอร์มพิจารณาอนุมัติ/สั่งแก้ไขในฐานะวิศวกรโครงการ (PE)"
            >
              <ShieldCheck size={12} />
              <span>พิจารณาอนุมัติ (PE)</span>
            </button>
          )}
          {onOpenFullReport && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFullReport(inspection);
              }}
              className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white rounded-lg text-[10px] sm:text-xs font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer"
              title="เปิดดูใบรายงานแบบฟอร์ม QC ฉบับเต็ม / สั่งพิมพ์"
            >
              <Printer size={12} />
              <span>ดูใบตรวจเต็ม</span>
            </button>
          )}
          {answers.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(prev => !prev);
              }}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] sm:text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>{expanded ? 'ซ่อนรายการ' : `ดูผลรายข้อ (${answers.length})`}</span>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* รายการตรวจรายข้อ (Checklist Answers) ตามที่ QC บันทึกจริง */}
      {expanded && answers.length > 0 && (
        <div className="bg-white divide-y divide-slate-100">
          {answers.map((ans, idx) => {
            const isAnsPass = ans.status === 'passed';
            const isAnsFail = ans.status === 'failed';
            const isAnsCond = ans.status === 'conditional';
            const isAnsNA = ans.status === 'na';

            const hasNumeric = ans.numeric_value !== null && ans.numeric_value !== undefined;
            const hasText = Boolean(ans.text_value && String(ans.text_value).trim() !== '');
            const hasOptions = Array.isArray(ans.selected_options) && ans.selected_options.length > 0;
            const hasRemarks = Boolean(ans.remarks && String(ans.remarks).trim() !== '');
            const hasItemPhotos = Array.isArray(ans.photo_urls) && ans.photo_urls.length > 0;

            return (
              <div
                key={ans.id || `${ans.form_item_id}-${idx}`}
                className={`px-3.5 sm:px-4 py-2.5 flex flex-col gap-1.5 ${
                  isAnsFail ? 'bg-rose-50/40' : isAnsCond ? 'bg-amber-50/40' : 'hover:bg-slate-50/70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="font-mono text-[10px] sm:text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200/80 px-1.5 py-0.5 rounded-md shrink-0 mt-0.5">
                      {ans.item_code || `#${idx + 1}`}
                    </span>
                    <div className="min-w-0">
                      <span className={`font-bold text-slate-800 ${compact ? 'text-xs' : 'text-xs sm:text-sm'} leading-snug`}>
                        {ans.item_text}
                      </span>
                      {ans.is_critical && (
                        <span className="ml-1.5 inline-block text-[9px] font-bold text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded">
                          ข้อสำคัญ
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ป้ายผลการตรวจรายข้อ */}
                  <span
                    className={`shrink-0 px-2.5 py-0.5 rounded-full font-bold text-[10px] sm:text-xs flex items-center gap-1 border ${
                      isAnsPass
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : isAnsFail
                          ? 'bg-rose-100 text-rose-800 border-rose-200'
                          : isAnsCond
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : isAnsNA
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {isAnsPass ? (
                      <>
                        <CheckCircle size={11} /> ผ่าน
                      </>
                    ) : isAnsFail ? (
                      <>
                        <XCircle size={11} /> ไม่ผ่าน
                      </>
                    ) : isAnsCond ? (
                      <>
                        <AlertTriangle size={11} /> มีเงื่อนไข
                      </>
                    ) : isAnsNA ? (
                      'N/A'
                    ) : (
                      'รอตรวจ'
                    )}
                  </span>
                </div>

                {/* ค่าที่วัด / ข้อมูลที่กรอก / หมายเหตุ / ส่งต่องวดงาน */}
                {(hasNumeric || hasText || hasOptions || hasRemarks || ans.transferred_to_task_name || hasItemPhotos) && (
                  <div className="pl-7 flex flex-col gap-1 text-[11px] sm:text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {hasNumeric && (
                        <span className="inline-flex items-center gap-1 font-mono font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                          <Ruler size={11} /> ค่าที่วัดได้: {ans.numeric_value} {ans.unit || ''}
                        </span>
                      )}
                      {hasText && (
                        <span className="inline-flex items-center gap-1 font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                          บันทึก: {ans.text_value}
                        </span>
                      )}
                      {hasOptions && (
                        <span className="inline-flex items-center gap-1 font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                          ตัวเลือก: {ans.selected_options?.join(', ')}
                        </span>
                      )}
                      {ans.transferred_to_task_name && (
                        <span className="inline-flex items-center gap-1 font-bold text-amber-800 bg-amber-100/80 border border-amber-300 px-2 py-0.5 rounded-md">
                          <ArrowRight size={11} /> ส่งต่องวด: {ans.transferred_to_task_name}
                        </span>
                      )}
                    </div>

                    {hasRemarks && (
                      <p className="text-slate-600 font-medium bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1 flex items-start gap-1.5">
                        <MessageSquare size={12} className="text-slate-400 shrink-0 mt-0.5" />
                        <span>หมายเหตุ: {ans.remarks}</span>
                      </p>
                    )}

                    {hasItemPhotos && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                          <Camera size={11} /> รูปเฉพาะข้อนี้:
                        </span>
                        {ans.photo_urls!.map((url, pIdx) => (
                          <img
                            key={pIdx}
                            src={url}
                            alt={`${ans.item_code}-${pIdx + 1}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onPreviewPhoto) onPreviewPhoto(url);
                            }}
                            className="w-12 h-12 object-cover rounded-lg border border-slate-200 cursor-zoom-in hover:opacity-90"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* จุดปักหมุดวัดค่าบนแบบแปลน (ถ้ามี) */}
      {expanded && annotations.length > 0 && (
        <div className="bg-slate-50/90 px-3.5 sm:px-4 py-2.5 border-t border-slate-200">
          <p className="text-[11px] font-bold text-purple-900 mb-1.5 flex items-center gap-1">
            <MapPin size={12} className="text-purple-600" />
            <span>จุดวัดบนแบบแปลนอ้างอิง ({annotations.length} จุด)</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {annotations.map((pin, pIdx) => (
              <div
                key={pin.id || `${pin.pin_label}-${pIdx}`}
                className="bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
              >
                <div className="min-w-0">
                  <span className="font-mono font-bold text-purple-700 mr-1.5">{pin.pin_label}</span>
                  <span className="text-slate-500">หน้า {pin.page_number || 1}</span>
                  {pin.measured_value !== null && pin.measured_value !== undefined && (
                    <span className="ml-1.5 font-mono font-bold text-slate-800">
                      • วัดได้ {pin.measured_value} {pin.unit || ''}
                      {pin.target_value !== null && pin.target_value !== undefined ? ` (เป้า ${pin.target_value})` : ''}
                    </span>
                  )}
                  {pin.remarks && <p className="text-[10px] text-slate-500 truncate">หมายเหตุ: {pin.remarks}</p>}
                </div>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                    pin.status === 'passed'
                      ? 'bg-emerald-100 text-emerald-700'
                      : pin.status === 'failed'
                        ? 'bg-rose-100 text-rose-700'
                        : pin.status === 'conditional'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {pin.status === 'passed'
                    ? 'ผ่าน'
                    : pin.status === 'failed'
                      ? 'ไม่ผ่าน'
                      : pin.status === 'conditional'
                        ? 'มีเงื่อนไข'
                        : 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* หมายเหตุผู้ตรวจ / ผลการพิจารณาของวิศวกรโครงการ (PE) */}
      {(inspection.pe_review_notes || inspection.pe_reviewer_name || (inspection.notes && inspection.notes.trim() !== '')) && (
        <div className="bg-slate-50 px-3.5 sm:px-4 py-2 border-t border-slate-200/80 text-[11px] sm:text-xs space-y-1">
          {inspection.notes && inspection.notes.trim() !== '' && (
            <p className="text-slate-700 font-medium">
              <span className="font-bold text-slate-900">หมายเหตุผู้ตรวจ ({inspection.inspector_name}):</span> {inspection.notes}
            </p>
          )}
          {(inspection.pe_reviewer_name || inspection.pe_review_notes) && (
            <p className="text-amber-900 font-medium">
              <span className="font-bold">ความเห็นวิศวกรโครงการ (PE {inspection.pe_reviewer_name || ''}):</span>{' '}
              {inspection.pe_review_notes || (inspection.pe_review_decision === 'approved' ? 'อนุมัติผ่านแบบมีเงื่อนไข' : 'สั่งแก้ไข')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
