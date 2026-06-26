import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldAlert, CheckCircle, Camera, Send, Loader2, X, RefreshCw, ChevronRight, PlusCircle } from 'lucide-react';

export default function HouseHandoverView({ 
  selectedPlot, 
  defects, 
  setDefects, 
  currentUserRole,
  resetHandoverCycle,
  updateInspectionRound,
  fetchAllData
}: any) {
  const [newDefectText, setNewDefectText] = useState('');
  const [defectFiles, setDefectFiles] = useState<any[]>([]);
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  const cycle = selectedPlot.handover_cycle || 1;
  const round = selectedPlot.inspection_round || 0;

  const currentDefects = defects.filter((d: any) => 
    d.plot_id === selectedPlot.id && 
    d.defect_stage === 'handover' &&
    d.handover_cycle === cycle
  );

  const handleSendHandoverDefect = async () => {
    if (!newDefectText.trim() && defectFiles.length === 0) return;
    if (round === 0) {
      alert("กรุณากด 'เริ่มตรวจรอบที่ 1' ก่อนแจ้ง Defect");
      return;
    }

    setIsSubmittingDefect(true);
    try {
      let imageUrls: string[] = [];
      if (defectFiles.length > 0) {
        for (const fileObj of defectFiles) {
          const fileExt = fileObj.file.name.split('.').pop();
          const fileName = `${Math.random()}.${fileExt}`;
          const filePath = `${selectedPlot.id}/handover_${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('defect_images')
            .upload(filePath, fileObj.file);

          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase.storage
            .from('defect_images')
            .getPublicUrl(filePath);

          imageUrls.push(publicUrlData.publicUrl);
        }
      }

      const { error } = await supabase.from('defects').insert([{
        plot_id: selectedPlot.id,
        description: newDefectText,
        reported_by: currentUserRole,
        status: 'pending',
        image_url: imageUrls.join(','),
        defect_stage: 'handover',
        handover_cycle: cycle,
        inspection_round: round
      }]);

      if (error) throw error;

      setNewDefectText('');
      setDefectFiles([]);
      if (fetchAllData) fetchAllData();
    } catch (error: any) {
      console.error('Error saving handover defect:', error);
      alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
    } finally {
      setIsSubmittingDefect(false);
    }
  };

  const handleResolveDefect = async (id: string) => {
    try {
      const { error } = await supabase.from('defects').update({ status: 'resolved' }).eq('id', id);
      if (error) throw error;
      if (fetchAllData) fetchAllData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleNextRound = async () => {
    if (confirm(`ยืนยันเริ่มการตรวจรอบที่ ${round + 1} ใช่หรือไม่?`)) {
      await updateInspectionRound(selectedPlot.id, round + 1);
    }
  };

  const handleResetCycle = async () => {
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตการตรวจรับบ้าน? (ใช้กรณีลูกค้ายกเลิก/ทิ้งดาวน์) ข้อมูล Defect เดิมจะถูกเก็บเป็นประวัติรอบเก่า")) {
      await resetHandoverCycle(selectedPlot.id, cycle);
    }
  };

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 mt-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <ShieldAlert className="text-purple-600" /> ตรวจรับบ้าน (Handover)
          </h2>
          <p className="text-sm font-bold text-slate-500 mt-1">
            รอบการขาย: <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Cycle {cycle}</span> | 
            รอบการตรวจ: <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded ml-1">Round {round === 0 ? 'ยังไม่เริ่ม' : round}</span>
          </p>
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          {['Admin', 'Project Planner', 'Owner'].includes(currentUserRole) && (
            <button onClick={handleResetCycle} className="flex-1 sm:flex-none px-4 py-2 bg-rose-50 text-rose-600 font-bold rounded-xl text-xs flex items-center justify-center gap-1 hover:bg-rose-100 transition-colors border border-rose-100">
              <RefreshCw size={14} /> ลูกค้ายกเลิก
            </button>
          )}
          {round < 3 && (
             <button onClick={handleNextRound} className="flex-1 sm:flex-none px-4 py-2 bg-purple-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 hover:bg-purple-700 shadow-sm transition-transform active:scale-95">
               เริ่มตรวจรอบที่ {round + 1} <ChevronRight size={14} />
             </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Col: Add Defect Form */}
        <div className="lg:col-span-1 bg-slate-50 p-5 rounded-2xl border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <PlusCircle size={18} className="text-blue-500"/> เพิ่มรายการแจ้งซ่อม (ลูกค้า)
          </h3>
          
          <div className="space-y-4">
            <textarea
              value={newDefectText}
              onChange={(e) => setNewDefectText(e.target.value)}
              placeholder="ระบุจุดบกพร่องที่ลูกค้าพบ..."
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-bold focus:border-purple-500 outline-none resize-none h-24"
            />
            
            <div className="flex gap-2">
              <label className="flex-1 bg-white border border-slate-200 hover:border-purple-400 text-slate-500 hover:text-purple-600 py-2.5 rounded-xl cursor-pointer shadow-sm transition-colors flex items-center justify-center gap-2 font-bold text-xs">
                <Camera size={16} /> แนบรูปภาพ
                <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { 
                  const files = Array.from(e.target.files || []).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); 
                  setDefectFiles([...defectFiles, ...files].slice(0, 4)); 
                }} />
              </label>
            </div>

            {defectFiles.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {defectFiles.map((file, idx) => (
                  <div key={idx} className="relative shrink-0">
                    <img src={file.previewUrl} className="w-16 h-16 object-cover rounded-xl border border-slate-200" />
                    <button onClick={() => { const n = [...defectFiles]; n.splice(idx, 1); setDefectFiles(n); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 border-2 border-white"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleSendHandoverDefect} 
              disabled={isSubmittingDefect || (!newDefectText.trim() && defectFiles.length === 0) || round === 0}
              className="w-full bg-purple-600 text-white py-3 rounded-xl hover:bg-purple-700 shadow-md font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmittingDefect ? <Loader2 className="animate-spin" size={16} /> : <><Send size={16} /> บันทึก Defect ลงรอบที่ {round === 0 ? '-' : round}</>}
            </button>
            {round === 0 && <p className="text-[10px] text-center text-rose-500 font-bold mt-1">กรุณากดเริ่มตรวจรอบที่ 1 ก่อน</p>}
          </div>
        </div>

        {/* Right Col: Defect List */}
        <div className="lg:col-span-2">
           <div className="bg-white border border-slate-200 rounded-2xl h-[500px] flex flex-col overflow-hidden">
             <div className="bg-slate-100 p-3 border-b border-slate-200 flex justify-between items-center">
               <span className="font-bold text-slate-600 text-sm">รายการซ่อมสะสม (Cycle {cycle})</span>
               <span className="bg-purple-100 text-purple-700 text-xs font-black px-2 py-1 rounded-lg">
                 รวม {currentDefects.length} รายการ
               </span>
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                {currentDefects.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <CheckCircle size={48} className="mb-3 opacity-20" />
                    <p className="font-bold">ไม่มีรายการแจ้งซ่อม</p>
                  </div>
                ) : (
                  currentDefects.map((defect: any) => (
                    <div key={defect.id} className={`p-4 rounded-xl border ${defect.status === 'pending' ? 'bg-white border-rose-200 shadow-sm' : 'bg-emerald-50 border-emerald-100'}`}>
                       <div className="flex justify-between items-start mb-2">
                         <div>
                           <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md border border-slate-200 mr-2">รอบที่ {defect.inspection_round}</span>
                           <span className={`font-bold text-sm ${defect.status === 'pending' ? 'text-slate-800' : 'text-slate-500 line-through'}`}>{defect.description}</span>
                         </div>
                         <span className={`text-[10px] font-black px-2 py-1 rounded-md shrink-0 ${defect.status === 'pending' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                            {defect.status === 'pending' ? 'รอแก้ไข' : '✅ แก้แล้ว'}
                         </span>
                       </div>

                       {defect.image_url && (
                        <div className="flex gap-2 mt-3 mb-3 overflow-x-auto">
                          {defect.image_url.split(',').filter((u: string) => u.trim() !== '').map((url: any, i: any) => (
                            <img key={i} src={url.trim()} onClick={() => setFullImageUrl(url.trim())} className="h-20 w-auto rounded-lg object-cover cursor-zoom-in border border-slate-200" alt="Defect" />
                          ))}
                        </div>
                      )}

                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-100 text-xs">
                        <span className="text-slate-400 font-bold">แจ้งโดย: {defect.reported_by}</span>
                        {defect.status === 'pending' && ['QC', 'Foreman', 'Site Engineer', 'Admin', 'Owner'].includes(currentUserRole) && (
                          <button onClick={() => handleResolveDefect(defect.id)} className="bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-1 shadow-sm">
                            <CheckCircle size={14} /> ซ่อมเสร็จ
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
             </div>
           </div>
        </div>
      </div>

      {fullImageUrl && (
        <div className="fixed inset-0 z-[99999] bg-black/90 flex items-center justify-center p-4" onClick={() => setFullImageUrl(null)}>
          <img src={fullImageUrl} className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-4 right-4 text-white bg-white/20 hover:bg-white/40 rounded-full p-2"><X size={24} /></button>
        </div>
      )}
    </div>
  );
}
