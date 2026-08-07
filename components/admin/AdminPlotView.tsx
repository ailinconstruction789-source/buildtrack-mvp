import React from 'react';
import { MapIcon, Download, Upload, X, Plus, Loader2, AlertTriangle } from 'lucide-react';

interface AdminPlotViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  selectedProject: any;
  batchPlots: any[];
  setBatchPlots: (plots: any[]) => void;
  houseTypes: any[];
  foremenList: any[];
  isSubmitting: boolean;
  handleDownloadTemplate: () => void;
  handleImportExcel: (e: any) => void;
  handleAddPlot: () => void;
}

export default function AdminPlotView({
  setView,
  setSelectedProject,
  selectedProject,
  batchPlots,
  setBatchPlots,
  houseTypes,
  foremenList,
  isSubmitting,
  handleDownloadTemplate,
  handleImportExcel,
  handleAddPlot
}: AdminPlotViewProps) {
  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
      <button onClick={() => setView(selectedProject ? 'project-detail' : 'dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← CANCEL</button>
      <div className="bg-white p-6 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
        {selectedProject ? (
          <>
            <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2"><MapIcon className="text-rose-600" /> Add Plot (Batch)</h2>
                <p className="text-sm font-bold text-slate-500 mt-2">To: {selectedProject.name}</p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={handleDownloadTemplate} className="text-xs sm:text-sm font-bold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-colors">
                  <Download size={16} /> โหลด Template
                </button>
                <label className="text-xs sm:text-sm font-bold text-emerald-600 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                  <Upload size={16} /> นำเข้า Excel
                  <input type="file" accept=".xlsx, .xls" onChange={handleImportExcel} className="hidden" />
                </label>
              </div>
            </div>
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
              {batchPlots.map((plot, index) => (
                <div key={index} className="relative bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm group">
                  <div className="absolute -top-3 -left-3 w-8 h-8 bg-blue-600 text-white font-bold rounded-full flex items-center justify-center border-4 border-white shadow-sm text-sm">
                    {index + 1}
                  </div>
                  {batchPlots.length > 1 && (
                    <button 
                      onClick={() => setBatchPlots(batchPlots.filter((_, i) => i !== index))}
                      className="absolute -top-3 -right-3 w-8 h-8 bg-white text-rose-500 border border-slate-200 rounded-full flex items-center justify-center shadow-sm hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="ลบแถวนี้"
                    >
                      <X size={16} className="font-bold" />
                    </button>
                  )}
                  
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 mt-2">
                    <div className="sm:col-span-3">
                      <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">รหัสแปลง</label>
                      <input type="text" value={plot.id} onChange={(e) => {
                          const newPlots = [...batchPlots];
                          newPlots[index].id = e.target.value.toUpperCase();
                          setBatchPlots(newPlots);
                        }} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 font-black text-rose-600 outline-none focus:border-rose-500 text-sm" placeholder="เช่น C-01" />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">แบบบ้าน</label>
                      <select value={plot.house_type_id} onChange={(e) => {
                          const newPlots = [...batchPlots];
                          newPlots[index].house_type_id = e.target.value;
                          setBatchPlots(newPlots);
                        }} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                        <option value="" disabled>-- เลือกแบบบ้าน --</option>
                        {houseTypes.map(type => <option key={type.id} value={type.id}>{type.type_name}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">โฟร์แมน</label>
                      <select value={plot.foreman_name} onChange={(e) => {
                          const newPlots = [...batchPlots];
                          newPlots[index].foreman_name = e.target.value;
                          setBatchPlots(newPlots);
                        }} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                        <option value="" disabled>-- ไม่ระบุ --</option>
                        {foremenList.map(f => <option key={f.id} value={f.username}>{f.username}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button 
                onClick={() => setBatchPlots([...batchPlots, { id: '', house_type_id: '', foreman_name: '' }])}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-xl border border-dashed border-slate-300 hover:bg-slate-200 hover:border-slate-400 transition-colors flex justify-center items-center gap-2 text-sm"
              >
                <Plus size={18} /> เพิ่มแปลงใหม่
              </button>
              
              <button onClick={handleAddPlot} disabled={isSubmitting || batchPlots.length === 0} className="flex-[2] bg-rose-600 text-white font-black py-3 rounded-xl shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2 text-sm sm:text-base">
                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : `ยืนยันเพิ่ม ${batchPlots.length} แปลง`}
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-10">
            <AlertTriangle className="mx-auto text-rose-500 mb-4" size={48} />
            <p className="text-slate-500 font-bold mb-6">กรุณาเลือกโครงการจากหน้า Dashboard ก่อน</p>
            <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className="px-6 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">กลับไปหน้าหลัก</button>
          </div>
        )}
      </div>
    </div>
  );
}
