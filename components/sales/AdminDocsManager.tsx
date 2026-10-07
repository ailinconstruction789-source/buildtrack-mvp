import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  FileText, Home, CheckCircle2, RefreshCw, Search, Building2, 
  Camera, Eye, Droplets, Zap, AlertCircle, Clock, Image as ImageIcon, X
} from 'lucide-react';
import { Plot } from '@/types/database.types';
import MeterPhotoConfirmationModal from '../MeterPhotoConfirmationModal';

interface AdminDocsManagerProps {
  plots: Plot[];
  onUpdate: () => void;
  selectedProjectName?: string;
  currentUserRole?: string;
  currentUserName?: string;
}

export default function AdminDocsManager({ 
  plots, 
  onUpdate, 
  selectedProjectName,
  currentUserRole = 'admin',
  currentUserName = 'ธุรการ'
}: AdminDocsManagerProps) {
  const [projectFilter, setProjectFilter] = useState<string>(selectedProjectName || 'all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedMeterModal, setSelectedMeterModal] = useState<{
    isOpen: boolean;
    plot: Plot | null;
    meterType: 'water_meter' | 'electric_meter';
  }>({
    isOpen: false,
    plot: null,
    meterType: 'water_meter'
  });

  const [lightboxImageUrl, setLightboxImageUrl] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
    meterNo?: string;
    date?: string;
  } | null>(null);

  const projectNames = useMemo(() => {
    const names = Array.from(new Set(plots.map(p => p.project_name).filter(Boolean))) as string[];
    return names.sort((a, b) => a.localeCompare(b, 'th'));
  }, [plots]);

  // เรียงลำดับแปลงตามชื่อ และกรองตามโครงการ/คำค้นหา
  const activePlots = useMemo(() => {
    let filtered = [...plots];
    if (projectFilter !== 'all') {
      filtered = filtered.filter(p => p.project_name === projectFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      filtered = filtered.filter(p => 
        (p.plot_name && p.plot_name.toLowerCase().includes(q)) ||
        p.id.toLowerCase().includes(q) ||
        (p.project_name && p.project_name.toLowerCase().includes(q))
      );
    }
    return filtered.sort((a, b) => {
      const aName = a.plot_name || a.id;
      const bName = b.plot_name || b.id;
      return aName.localeCompare(bName, 'th', { numeric: true });
    });
  }, [plots, projectFilter, searchTerm]);
  
  const [savingId, setSavingId] = useState<string | null>(null);

  const docTypes = [
    { key: 'permit', label: 'ใบอนุญาตก่อสร้าง', isMeter: false },
    { key: 'registration', label: 'ทะเบียนบ้าน', isMeter: false },
    { key: 'water_meter', label: 'มิเตอร์น้ำ', isMeter: true },
    { key: 'electric_meter', label: 'มิเตอร์ไฟฟ้า', isMeter: true },
  ];

  const standardStatusOptions = [
    { value: 'NotStarted', label: 'ยังไม่ได้ดำเนินการ', color: 'bg-slate-100 text-slate-600 border-slate-200' },
    { value: 'Submitting', label: 'กำลังยื่นเอกสาร', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { value: 'Waiting', label: 'กำลังรอผล', color: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'Received', label: 'ได้รับเอกสารแล้ว', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ];

  const meterStatusOptions = [
    { value: 'NotStarted', label: 'ยังไม่ได้ดำเนินการ', color: 'bg-slate-100 text-slate-600 border-slate-200' },
    { value: 'Submitting', label: 'กำลังยื่นเรื่อง', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { value: 'Waiting', label: 'กำลังรอผล', color: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'Paid', label: '💳 จ่ายเงินแล้ว (รอติดตั้ง)', color: 'bg-amber-100 text-amber-900 border-amber-300 font-bold' },
    { value: 'Installed', label: '📸 ติดตั้งเสร็จแล้ว (มีรูป)', color: 'bg-blue-100 text-blue-900 border-blue-300 font-bold' },
    { value: 'Received', label: '✅ ได้รับเอกสารแล้ว', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ];

  const handleUpdate = async (plotId: string, docKey: string, field: 'status' | 'date', value: string) => {
    setSavingId(`${plotId}-${docKey}`);
    try {
      const updateData: any = {};
      if (field === 'status') {
        updateData[`${docKey}_status`] = value;
        // If status changed back to NotStarted, clear the date
        if (value === 'NotStarted') {
          updateData[`${docKey}_date`] = null;
        } else {
          // If moving to a status that needs a date and doesn't have one, default to today
          const plot = plots.find(p => p.id === plotId);
          if (plot && !plot[`${docKey}_date` as keyof Plot]) {
             updateData[`${docKey}_date`] = new Date().toISOString().split('T')[0];
          }
        }
      } else {
        updateData[`${docKey}_date`] = value;
      }

      const { error } = await supabase
        .from('plots')
        .update(updateData)
        .eq('id', plotId);

      if (error) throw error;
      onUpdate(); // refresh data
    } catch (err) {
      console.error('Error updating document status:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full animate-in fade-in duration-300">
      
      {/* Header Bar */}
      <div className="p-5 md:p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50">
        <div>
          <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2 mb-1">
            <FileText className="text-blue-600" />
            อัพเดท สถานะเอกสาร & สาธารณูปโภค (ธุรการ)
          </h3>
          <p className="text-xs sm:text-sm text-slate-500">
            ติดตามสถานะและอัปเดตเอกสารสำคัญสำหรับการโอนกรรมสิทธิ์ · บันทึกชำระค่ามิเตอร์ และตรวจรับรูปยืนยันจากโฟร์แมน
          </p>
        </div>
        
        {/* Controls: Project Filter & Search */}
        <div className="flex flex-wrap items-center gap-3">
          {projectNames.length > 1 && (
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
              <Building2 size={16} className="text-slate-400" />
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="text-xs font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
              >
                <option value="all">ทุกโครงการ (ทั้งหมด)</option>
                {projectNames.map(pName => (
                  <option key={pName} value={pName}>{pName}</option>
                ))}
              </select>
            </div>
          )}

          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาแปลง..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm w-44 md:w-56"
            />
          </div>

          <span className="bg-blue-100 text-blue-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm shrink-0">
            {activePlots.length} แปลง
          </span>
        </div>
      </div>
      
      {/* Table Content */}
      <div className="overflow-x-auto flex-1 p-2">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 bg-slate-50/80 uppercase">
            <tr>
              <th className="px-6 py-4 font-bold rounded-tl-xl">แปลง / โครงการ</th>
              {docTypes.map(doc => (
                <th key={doc.key} className="px-6 py-4 font-bold">
                  <div className="flex items-center gap-1.5">
                    {doc.key === 'water_meter' && <Droplets size={16} className="text-cyan-500" />}
                    {doc.key === 'electric_meter' && <Zap size={16} className="text-amber-500" />}
                    <span>{doc.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activePlots.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium">
                  ไม่พบแปลงที่อยู่ระหว่างดำเนินการ
                </td>
              </tr>
            ) : null}
            
            {activePlots.map((plot) => (
              <tr key={plot.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                      <Home size={18} className="text-blue-500" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-base whitespace-nowrap">
                        แปลง {plot.plot_name || plot.id} ({plot.project_name})
                      </p>
                    </div>
                  </div>
                </td>
                
                {docTypes.map(doc => {
                  const statusKey = `${doc.key}_status` as keyof Plot;
                  const dateKey = `${doc.key}_date` as keyof Plot;
                  const imageKey = `${doc.key}_image_url` as keyof Plot;
                  const meterNoKey = `${doc.key}_meter_no` as keyof Plot;
                  const installedDateKey = `${doc.key}_installed_date` as keyof Plot;

                  const currentStatus = (plot[statusKey] as string) || 'NotStarted';
                  const currentDate = plot[dateKey] as string | undefined;
                  const meterImage = plot[imageKey] as string | undefined;
                  const meterNo = plot[meterNoKey] as string | undefined;
                  const installedDate = plot[installedDateKey] as string | undefined;

                  const isSaving = savingId === `${plot.id}-${doc.key}`;
                  const isMeter = doc.isMeter;
                  const statusOpts = isMeter ? meterStatusOptions : standardStatusOptions;

                  return (
                    <td key={doc.key} className="px-5 py-4 min-w-[240px] align-top">
                      <div className="flex flex-col gap-2.5 relative bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:border-blue-200 transition-colors">
                        {isSaving && (
                          <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center backdrop-blur-[1px] rounded-2xl">
                            <RefreshCw size={16} className="text-blue-500 animate-spin" />
                          </div>
                        )}

                        {/* Status Select */}
                        <select
                          className={`w-full border rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer ${
                            statusOpts.find(s => s.value === currentStatus)?.color || 'border-slate-200 bg-white text-slate-700'
                          }`}
                          value={currentStatus}
                          onChange={(e) => handleUpdate(plot.id, doc.key, 'status', e.target.value)}
                        >
                          {statusOpts.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        
                        {/* Date Picker (Shown if started) */}
                        {currentStatus !== 'NotStarted' && (
                          <div className="flex items-center gap-2 animate-in slide-in-from-top-1 duration-200">
                            <input
                              type="date"
                              title="วันที่ดำเนินการ / ชำระเงิน"
                              className="w-full text-xs p-2 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 transition-all text-slate-600 bg-slate-50 font-medium"
                              value={currentDate ? new Date(currentDate).toISOString().split('T')[0] : ''}
                              onChange={(e) => handleUpdate(plot.id, doc.key, 'date', e.target.value)}
                            />
                            {currentStatus === 'Received' && currentDate && (
                              <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                            )}
                          </div>
                        )}

                        {/* ⚡️ Special Meter Actions: Paid status waiting banner & Photo confirmation */}
                        {isMeter && currentStatus === 'Paid' && (
                          <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 flex flex-col gap-1.5 animate-pulse">
                            <div className="flex items-center justify-between text-[11px] font-black text-amber-900">
                              <span className="flex items-center gap-1">
                                <Clock size={12} className="text-amber-600" /> รอช่างมาติดตั้งหน้างาน
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedMeterModal({
                                isOpen: true,
                                plot,
                                meterType: doc.key as 'water_meter' | 'electric_meter'
                              })}
                              className="w-full py-1.5 px-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] rounded-lg shadow-xs flex items-center justify-center gap-1 cursor-pointer transition-colors"
                            >
                              <Camera size={12} /> ถ่ายรูปยืนยันติดตั้ง
                            </button>
                          </div>
                        )}

                        {/* 📸 Display Meter Photo & Info if Installed/Available */}
                        {isMeter && (meterImage || currentStatus === 'Installed') && (
                          <div className="pt-2 border-t border-slate-100 flex flex-col gap-1.5">
                            {meterImage ? (
                              <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/80">
                                <div 
                                  onClick={() => setLightboxImageUrl({
                                    isOpen: true,
                                    url: meterImage,
                                    title: `${doc.label} · แปลง ${plot.plot_name || plot.id}`,
                                    meterNo: meterNo,
                                    date: installedDate
                                  })}
                                  className="w-11 h-11 rounded-lg overflow-hidden border border-slate-200 bg-slate-900 shrink-0 cursor-pointer relative group"
                                  title="คลิกเพื่อดูรูปขยาย"
                                >
                                  <img src={meterImage} alt={doc.label} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <Eye size={14} className="text-white" />
                                  </div>
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                      มีรูปยืนยันแล้ว
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedMeterModal({
                                        isOpen: true,
                                        plot,
                                        meterType: doc.key as 'water_meter' | 'electric_meter'
                                      })}
                                      className="text-[10px] text-slate-500 hover:text-blue-600 underline font-bold cursor-pointer"
                                    >
                                      แก้ไข
                                    </button>
                                  </div>
                                  {meterNo && (
                                    <p className="text-[10px] text-slate-600 font-bold truncate mt-0.5">
                                      เลข: {meterNo}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedMeterModal({
                                  isOpen: true,
                                  plot,
                                  meterType: doc.key as 'water_meter' | 'electric_meter'
                                })}
                                className="w-full py-1.5 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[10px] rounded-lg border border-blue-200 flex items-center justify-center gap-1 cursor-pointer transition-colors"
                              >
                                <Camera size={12} /> แนบรูปถ่ายมิเตอร์
                              </button>
                            )}
                          </div>
                        )}

                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Meter Photo Confirmation Modal */}
      {selectedMeterModal.isOpen && selectedMeterModal.plot && (
        <MeterPhotoConfirmationModal
          isOpen={selectedMeterModal.isOpen}
          onClose={() => setSelectedMeterModal({ isOpen: false, plot: null, meterType: 'water_meter' })}
          plot={selectedMeterModal.plot}
          meterType={selectedMeterModal.meterType}
          onSuccess={onUpdate}
          currentUserRole={currentUserRole}
          currentUserName={currentUserName}
        />
      )}

      {/* Image Lightbox Modal */}
      {lightboxImageUrl?.isOpen && (
        <div 
          onClick={() => setLightboxImageUrl(null)}
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h4 className="font-black text-sm">{lightboxImageUrl.title}</h4>
                {lightboxImageUrl.meterNo && (
                  <p className="text-xs text-slate-300">หมายเลขมิเตอร์: {lightboxImageUrl.meterNo}</p>
                )}
              </div>
              <button 
                onClick={() => setLightboxImageUrl(null)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <div className="bg-slate-950 p-2 flex items-center justify-center max-h-[70vh] overflow-hidden">
              <img 
                src={lightboxImageUrl.url} 
                alt={lightboxImageUrl.title} 
                className="max-h-[68vh] w-auto object-contain rounded-xl"
              />
            </div>
            {lightboxImageUrl.date && (
              <div className="p-3 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-500 font-bold">
                วันที่บันทึก/ติดตั้ง: {new Date(lightboxImageUrl.date).toLocaleDateString('th-TH')}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

