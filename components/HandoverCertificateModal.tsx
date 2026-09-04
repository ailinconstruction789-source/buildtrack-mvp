import React from 'react';
import { X, Printer, ShieldCheck, CheckCircle, Building2, Calendar, User, FileText, Award, Clock } from 'lucide-react';

interface HandoverCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPlot: any;
  defects: any[];
  taskTemplates: any[];
  contractors: any[];
  viewingRound: number;
  cycle: number;
}

export default function HandoverCertificateModal({
  isOpen,
  onClose,
  selectedPlot,
  defects,
  taskTemplates,
  contractors,
  viewingRound,
  cycle
}: HandoverCertificateModalProps) {
  if (!isOpen || !selectedPlot) return null;

  const roundDefects = defects.filter((d: any) => 
    d.plot_id === selectedPlot.id && 
    d.defect_stage === 'handover' &&
    d.handover_cycle === cycle &&
    d.inspection_round === viewingRound
  );

  const isCompleted = selectedPlot?.handover_status === 'completed';

  const completedDateStr = isCompleted && selectedPlot.handover_completed_at 
    ? new Date(selectedPlot.handover_completed_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[99999] flex justify-center items-center p-3 sm:p-6 overflow-y-auto">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-handover-cert, #printable-handover-cert * {
            visibility: visible;
          }
          #printable-handover-cert {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-3xl w-full max-w-3xl flex flex-col max-h-[92vh] overflow-hidden shadow-2xl border border-black/10 animate-fade-in relative">
        
        {/* Header Action Bar (No Print) */}
        <div className="no-print p-4 border-b flex justify-between items-center bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            <Award className="text-emerald-400" size={24} />
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white leading-tight">หนังสือส่งมอบและรับมอบบ้าน</h2>
              <p className="text-[11px] text-slate-400">แปลง {selectedPlot.id} • ตรวจรับรอบที่ {viewingRound}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePrint}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 text-xs sm:text-sm shadow-md transition-all active:scale-95"
            >
              <Printer size={16} /> ปริ้นท์ / PDF
            </button>
            <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Certificate Content Body (Printable Area) */}
        <div id="printable-handover-cert" className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-6 text-slate-800 bg-white">
          
          {/* Document Header */}
          <div className="border-b-2 border-slate-800 pb-6 flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 text-purple-700 mb-1">
                <Building2 size={24} />
                <span className="text-xs font-black tracking-widest uppercase">BuildTrack Construction Project</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">หนังสือส่งมอบ - ตรวจรับบ้าน</h1>
              <p className="text-xs text-slate-500 font-bold mt-1">Handover & Acceptance Certificate</p>
            </div>
            <div className="text-right">
              <div className={`border-2 rounded-2xl px-4 py-2 inline-block text-center ${isCompleted ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                <span className={`text-[10px] font-black uppercase tracking-widest block ${isCompleted ? 'text-emerald-600' : 'text-amber-600'}`}>สถานะการตรวจรับ</span>
                <span className={`text-sm font-black flex items-center gap-1 ${isCompleted ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isCompleted ? <><ShieldCheck size={16}/> ผ่านการตรวจรับเรียบร้อย</> : <>⏳ อยู่ระหว่างการตรวจรับ</>}
                </span>
              </div>
              <p className="text-[11px] font-bold text-slate-400 mt-2">{isCompleted ? 'วันที่อนุมัติ' : 'วันที่พิมพ์'}: {completedDateStr}</p>
            </div>
          </div>

          {/* Plot Information Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 block">แปลงบ้าน / Plot</span>
              <span className="text-base font-black text-slate-800">แปลง {selectedPlot.id}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 block">แบบบ้าน / Type</span>
              <span className="text-sm font-bold text-slate-800">{selectedPlot.house_types?.type_name || selectedPlot.house_type_id || '-'}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 block">รอบการขาย / Cycle</span>
              <span className="text-sm font-bold text-purple-700">Cycle {cycle}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 block">รอบการตรวจ / Round</span>
              <span className={`text-sm font-bold ${isCompleted ? 'text-emerald-700' : 'text-amber-700'}`}>
                Round {viewingRound} {isCompleted ? '(ผ่านครบ 100%)' : viewingRound === 0 ? '(ยังไม่เริ่ม)' : '(อยู่ระหว่างตรวจ)'}
              </span>
            </div>
          </div>

          {/* Defect Items Table */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <FileText size={16} className="text-purple-600"/> สรุปรายการแจ้งซ่อมและผลการแก้ไข (Defect Resolution Log)
            </h3>
            
            {roundDefects.length === 0 ? (
              <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-200 text-slate-500 font-bold text-xs">
                ไม่มีรายการแจ้งซ่อมในรอบนี้ (ตรวจผ่านสมบูรณ์)
              </div>
            ) : (
              <table className="w-full border-collapse border border-slate-200 text-left text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                    <th className="p-2.5 border-r border-slate-200 w-12 text-center">ลำดับ</th>
                    <th className="p-2.5 border-r border-slate-200">รายการแจ้งซ่อม</th>
                    <th className="p-2.5 border-r border-slate-200 w-36">ผู้รับเหมาแก้ไข</th>
                    <th className="p-2.5 w-24 text-center">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {roundDefects.map((defect: any, idx: number) => {
                    const taskTemp = taskTemplates?.find((t: any) => t.id === (defect.task_id || defect.task_template_id));
                    const contractor = contractors?.find((c: any) => c.id === defect.contractor_id);
                    const progress = defect.progress || 0;
                    const isDone = progress === 100;

                    return (
                      <tr key={defect.id} className="border-b border-slate-200">
                        <td className="p-2.5 text-center font-bold border-r border-slate-200 text-slate-400">#{idx + 1}</td>
                        <td className="p-2.5 font-bold border-r border-slate-200 text-slate-800">{taskTemp?.task_name || defect.description}</td>
                        <td className="p-2.5 border-r border-slate-200 font-semibold text-slate-600">{contractor?.name ? contractor.name.split(' ')[0] : 'ทีมช่างโครงการ'}</td>
                        <td className={`p-2.5 text-center font-bold ${isDone ? 'text-emerald-600 bg-emerald-50/50' : progress > 0 ? 'text-blue-600 bg-blue-50/50' : 'text-rose-500 bg-rose-50/50'}`}>
                          {isDone ? (
                            <span className="inline-flex items-center gap-1"><CheckCircle size={12}/> แก้ไขเสร็จ 100%</span>
                          ) : progress > 0 ? (
                            <span className="inline-flex items-center gap-1"><Clock size={12}/> กำลังซ่อม ({progress}%)</span>
                          ) : (
                            <span className="inline-flex items-center gap-1"><Clock size={12}/> รอซ่อม (0%)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Formal Acceptance Declaration Statement */}
          <div className="bg-purple-50/50 border border-purple-200 p-4 rounded-2xl text-xs leading-relaxed font-semibold text-slate-700">
            <p className="mb-1 font-bold text-purple-900">ข้อความรับรองการตรวจรับบ้าน:</p>
            <p>
              {isCompleted ? (
                <>ข้าพเจ้า (ผู้ซื้อ/ผู้รับมอบ) ได้ทำการตรวจรับบ้านแปลง <strong>{selectedPlot.id}</strong> ในรอบการตรวจที่ <strong>{viewingRound}</strong> เรียบร้อยแล้ว โดยเห็นพ้องว่าทางโครงการได้ดำเนินการแก้ไขรายการชำรุด/งานซ่อมแซมทั้งหมดตามที่ระบุข้างต้นถูกต้องสมบูรณ์ 100% แล้วทุกประการ และยินยอมรับมอบบ้านหลังนี้เพื่อดำเนินการขั้นตอนโอนกรรมสิทธิ์ต่อไป</>
              ) : (
                <>เอกสารนี้เป็นบันทึกสรุปรายการแจ้งซ่อม แปลง <strong>{selectedPlot.id}</strong> ในรอบการตรวจที่ <strong>{viewingRound}</strong> ซึ่งปัจจุบันอยู่ในระหว่างกระบวนการดำเนินการแก้ไขงานซ่อมแซมของทางโครงการ</>
              )}
            </p>
          </div>

          {/* Signature Blocks */}
          <div className="pt-6 grid grid-cols-2 gap-8 border-t border-slate-200 text-center">
            
            {/* Customer Signature */}
            <div className="space-y-12">
              <div className="border-b border-dashed border-slate-400 w-3/4 mx-auto pb-1 text-xs font-bold text-slate-400">
                (ลงชื่อ)...........................................................
              </div>
              <div>
                <p className="text-xs font-bold text-slate-800">ผู้รับมอบบ้าน (ลูกค้า)</p>
                <p className="text-[10px] text-slate-400">วันที่ .......... / .......... / ............</p>
              </div>
            </div>

            {/* Project Representative Signature */}
            <div className="space-y-12">
              <div className="border-b border-dashed border-slate-400 w-3/4 mx-auto pb-1 text-xs font-bold text-slate-400">
                (ลงชื่อ)...........................................................
              </div>
              <div>
                <p className="text-xs font-bold text-slate-800">ผู้ส่งมอบบ้าน (ตัวแทนโครงการ / QC)</p>
                <p className="text-[10px] text-slate-400">วันที่ .......... / .......... / ............</p>
              </div>
            </div>

          </div>

        </div>

        {/* Footer Bar (No Print) */}
        <div className="no-print p-4 border-t bg-slate-50 flex justify-between items-center shrink-0">
          <span className="text-xs font-bold text-slate-500">
             BuildTrack MVP — Handover Certificate System
          </span>
          <button 
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-5 py-2 rounded-xl text-xs"
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>
    </div>
  );
}
