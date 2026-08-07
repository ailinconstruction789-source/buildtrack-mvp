import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { FileText, Home, CheckCircle2, RefreshCw } from 'lucide-react';
import { Plot } from '@/types/database.types';

interface AdminDocsManagerProps {
  plots: Plot[];
  onUpdate: () => void;
}

export default function AdminDocsManager({ plots, onUpdate }: AdminDocsManagerProps) {
  // เรียงลำดับแปลงตามชื่อ
  const activePlots = [...plots].sort((a, b) => {
    const aName = a.plot_name || a.id;
    const bName = b.plot_name || b.id;
    return aName.localeCompare(bName, 'th', { numeric: true });
  });
  
  const [savingId, setSavingId] = useState<string | null>(null);

  const docTypes = [
    { key: 'permit', label: 'ใบอนุญาตก่อสร้าง' },
    { key: 'registration', label: 'ทะเบียนบ้าน' },
    { key: 'water_meter', label: 'มิเตอร์น้ำ' },
    { key: 'electric_meter', label: 'มิเตอร์ไฟฟ้า' },
  ];

  const statusOptions = [
    { value: 'NotStarted', label: 'ยังไม่ได้ดำเนินการ', color: 'bg-slate-100 text-slate-500' },
    { value: 'Submitting', label: 'กำลังยื่นเอกสาร', color: 'bg-yellow-100 text-yellow-700' },
    { value: 'Waiting', label: 'กำลังรอผล', color: 'bg-orange-100 text-orange-700' },
    { value: 'Received', label: 'ได้รับเอกสารแล้ว', color: 'bg-emerald-100 text-emerald-700' },
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
      <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <div>
          <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2 mb-1">
            <FileText className="text-blue-600" />
            อัพเดท สถานะเอกสาร & สาธารณูปโภค (ธุรการ)
          </h3>
          <p className="text-sm text-slate-500">ติดตามสถานะและอัปเดตเอกสารสำคัญสำหรับการโอนกรรมสิทธิ์</p>
        </div>
        <span className="bg-blue-100 text-blue-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm">
          {activePlots.length} แปลงทั้งหมด
        </span>
      </div>
      
      <div className="overflow-x-auto flex-1 p-2">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 bg-slate-50/80 uppercase">
            <tr>
              <th className="px-6 py-4 font-bold rounded-tl-xl">แปลง / โครงการ</th>
              {docTypes.map(doc => (
                <th key={doc.key} className="px-6 py-4 font-bold">{doc.label}</th>
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
                  const currentStatus = (plot[statusKey] as string) || 'NotStarted';
                  const currentDate = plot[dateKey] as string | undefined;
                  const isSaving = savingId === `${plot.id}-${doc.key}`;

                  return (
                    <td key={doc.key} className="px-6 py-4 min-w-[220px] align-top">
                      <div className="flex flex-col gap-2.5 relative bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:border-blue-200 transition-colors">
                        {isSaving && (
                          <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center backdrop-blur-[1px] rounded-xl">
                            <RefreshCw size={16} className="text-blue-500 animate-spin" />
                          </div>
                        )}
                        <select
                          className={`w-full border rounded-lg px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-blue-500 transition-colors ${statusOptions.find(s => s.value === currentStatus)?.color || 'border-slate-200'}`}
                          value={currentStatus}
                          onChange={(e) => handleUpdate(plot.id, doc.key, 'status', e.target.value)}
                        >
                          {statusOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        
                        {currentStatus !== 'NotStarted' && (
                          <div className="flex items-center gap-2 animate-in slide-in-from-top-1 duration-200">
                            <input
                              type="date"
                              className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-all text-slate-600 bg-slate-50"
                              value={currentDate ? new Date(currentDate).toISOString().split('T')[0] : ''}
                              onChange={(e) => handleUpdate(plot.id, doc.key, 'date', e.target.value)}
                            />
                            {currentStatus === 'Received' && currentDate && (
                              <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
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
    </div>
  );
}
