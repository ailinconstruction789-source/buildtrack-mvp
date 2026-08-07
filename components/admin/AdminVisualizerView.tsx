import React from 'react';
import { Monitor, Loader2, Save, ImageIcon, PieChart } from 'lucide-react';

interface AdminVisualizerViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  houseTypes: any[];
  taskTemplates: any[];
  editingHouseType: any;
  setEditingHouseType: (type: any) => void;
  visualConfig: any;
  setVisualConfig: (config: any) => void;
  simulatedStatus: any;
  setSimulatedStatus: (status: any) => void;
  isSubmitting: boolean;
  isUploadingLayer: boolean;
  handleSave25DConfig: () => void;
  handleUploadSlot: (taskId: string, slot: string, file: File | undefined) => void;
  activeView: string;
}

export default function AdminVisualizerView({
  setView,
  setSelectedProject,
  houseTypes,
  taskTemplates,
  editingHouseType,
  setEditingHouseType,
  visualConfig,
  setVisualConfig,
  simulatedStatus,
  setSimulatedStatus,
  isSubmitting,
  isUploadingLayer,
  handleSave25DConfig,
  handleUploadSlot,
  activeView
}: AdminVisualizerViewProps) {
  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-6xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
      <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← BACK TO DASHBOARD</button>

      <div className="bg-white p-4 sm:p-8 rounded-3xl border border-slate-200 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-4 mb-6 gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2"><Monitor className="text-rose-600" /> 2.5D Task-Linked Visualizer</h2>
            <p className="text-xs text-slate-400 font-bold mt-1">กางงวดงานทั้งหมดเพื่อผูกรูปภาพตามสถานะงานจริง</p>
          </div>

          {/* เมนูเลือกแบบบ้าน */}
          <div className="w-full sm:w-64">
            <select
              value={editingHouseType?.id || ''}
              onChange={(e) => {
                const type = houseTypes.find(t => t.id === e.target.value);
                setEditingHouseType(type);
                setVisualConfig(type?.visual_config || {});
                setSimulatedStatus({}); // รีเซ็ตกล่องลองเล่นพรีวิว
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-black text-xs sm:text-sm text-slate-700 outline-none focus:border-rose-500 shadow-sm"
            >
              <option value="">-- เลือกแบบบ้านเพื่อตั้งค่า --</option>
              {houseTypes.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
            </select>
          </div>
        </div>

        {editingHouseType ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

            {/* 🖥️ ฝั่งซ้าย (4 ส่วน): กล่อง Live Preview + แผงสวิตช์ลองเล่นจำลองสถานะ */}
            <div className="lg:col-span-4 space-y-4">
              <div className="sticky top-4 space-y-4">
                <div className="bg-slate-950 p-4 rounded-2xl aspect-square border-2 border-slate-800 shadow-2xl flex items-center justify-center relative overflow-hidden">
                  <span className="absolute top-2 left-2 text-[9px] font-bold text-slate-500 tracking-widest uppercase bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-800 z-30">Live 2.5D Preview</span>

                  {/* วนลูปรูปภาพมาซ้อนทับกันตาม Z-Index ที่ตั้งไว้ */}
                  <div className="relative w-full h-full flex items-center justify-center">
                    {taskTemplates
                      .filter(t => t.house_type_id === editingHouseType.id)
                      .flatMap(task => {
                        const config = visualConfig[task.id] || {};
                        const status = simulatedStatus[task.id] || 'none';
                        const layers = [];

                        if (status === 'progress' && config.progress_image) {
                          layers.push({ url: config.progress_image, z: Number(config.progress_z || 10) });
                        }
                        if (status === 'done' && config.done_image) {
                          layers.push({ url: config.done_image, z: Number(config.done_z || 10) });
                        }
                        return layers;
                      })
                      .sort((a, b) => a.z - b.z) // เรียงลำดับจากล่างขึ้นบนตาม Z-Index
                      .map((layer, index) => (
                        <img key={index} src={layer.url} className="absolute inset-0 w-full h-full object-contain transition-all duration-300" style={{ zIndex: layer.z }} alt="Preview layer" />
                      ))
                    }
                  </div>
                </div>

                {/* ปุ่มเซฟใหญ่ */}
                <button
                  onClick={handleSave25DConfig}
                  disabled={isSubmitting || isUploadingLayer}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 text-sm uppercase tracking-wider"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} บันทึกโครงสร้างเลเยอร์นี้
                </button>
              </div>
            </div>

            {/* 📋 ฝั่งขวา (8 ส่วน): รายการ Task งวดงานทั้งหมดที่ดึงขึ้นมาอัตโนมัติ */}
            <div className="lg:col-span-8 space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
              {taskTemplates.filter(t => t.house_type_id === editingHouseType.id).length === 0 ? (
                <p className="text-center text-slate-400 italic py-10 font-bold">ยังไม่มีงวดงานถูกผูกไว้กับแบบบ้านนี้ กรุณาไปเพิ่มงวดงานก่อนครับ</p>
              ) : (
                taskTemplates
                  .filter(t => t.house_type_id === editingHouseType.id)
                  .sort((a, b) => a.task_order - b.task_order)
                  .map((task: any) => {
                    const config = visualConfig[task.id] || {};
                    const currentSimStatus = simulatedStatus[task.id] || 'none';

                    return (
                      <div key={task.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:border-blue-300 transition-colors">
                        {/* ส่วนหัวของชื่องาน */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2 border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-slate-800 text-white font-black text-[10px] flex items-center justify-center">{task.task_order}</span>
                            <h4 className="font-black text-slate-700 text-sm">{task.task_name}</h4>
                          </div>
                          {/* 🎮 สวิตช์จำลองสถานะสำหรับช่อง Preview */}
                          <div className="flex bg-slate-200 p-0.5 rounded-lg text-[9px] font-bold w-fit self-end">
                            <button onClick={() => setSimulatedStatus({ ...simulatedStatus, [task.id]: 'none' })} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'none' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>ยังไม่เริ่ม</button>
                            <button onClick={() => setSimulatedStatus({ ...simulatedStatus, [task.id]: 'progress' })} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'progress' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500'}`}>กำลังทำ (0-99%)</button>
                            <button onClick={() => setSimulatedStatus({ ...simulatedStatus, [task.id]: 'done' })} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'done' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500'}`}>เสร็จสิ้น (100%)</button>
                          </div>
                        </div>

                        {/* ตารางแบ่ง 2 สล็อตสำหรับรูปภาพ */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                          {/* สล็อต 1: ช่วงกำลังดำเนินการ (0-99%) */}
                          <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase tracking-wider">🚧 ช่วงกำลังทำ (0-99%)</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-slate-400 font-bold">Z-Index:</span>
                                <input type="number" value={config.progress_z ?? 10} onChange={(e) => setVisualConfig({ ...visualConfig, [task.id]: { ...config, progress_z: Number(e.target.value) } })} className="w-12 text-center border rounded p-0.5 text-xs font-black bg-slate-50" title="ลำดับการวางซ้อนภาพ เลขมากจะทับเลขน้อย" />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-14 h-14 bg-slate-100 border rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                {config.progress_image ? <img src={config.progress_image} className="w-full h-full object-contain" /> : <ImageIcon className="text-slate-300" size={20} />}
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="block text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-2 rounded-md text-center cursor-pointer border transition-colors">
                                  <input type="file" accept="image/png" className="hidden" onChange={(e) => handleUploadSlot(task.id, 'progress', e.target.files?.[0])} disabled={isUploadingLayer} />
                                  {isUploadingLayer ? 'อัปโหลด...' : 'เลือกไฟล์ PNG'}
                                </label>
                                {config.progress_image && (
                                  <button onClick={() => setVisualConfig({ ...visualConfig, [task.id]: { ...config, progress_image: '' } })} className="w-full text-[9px] text-rose-500 font-bold text-center block hover:underline">ลบรูปออก</button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* สล็อต 2: ช่วงเสร็จสมบูรณ์ (100%) */}
                          <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase tracking-wider">✅ เสร็จสิ้น (100%)</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-slate-400 font-bold">Z-Index:</span>
                                <input type="number" value={config.done_z ?? 10} onChange={(e) => setVisualConfig({ ...visualConfig, [task.id]: { ...config, done_z: Number(e.target.value) } })} className="w-12 text-center border rounded p-0.5 text-xs font-black bg-slate-50" title="ลำดับการวางซ้อนภาพ เลขมากจะทับเลขน้อย" />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-14 h-14 bg-slate-100 border rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                {config.done_image ? <img src={config.done_image} className="w-full h-full object-contain" /> : <ImageIcon className="text-slate-300" size={20} />}
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="block text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-2 rounded-md text-center cursor-pointer border transition-colors">
                                  <input type="file" accept="image/png" className="hidden" onChange={(e) => handleUploadSlot(task.id, 'done', e.target.files?.[0])} disabled={isUploadingLayer} />
                                  {isUploadingLayer ? 'อัปโหลด...' : 'เลือกไฟล์ PNG'}
                                </label>
                                {config.done_image && (
                                  <button onClick={() => setVisualConfig({ ...visualConfig, [task.id]: { ...config, done_image: '' } })} className="w-full text-[9px] text-rose-500 font-bold text-center block hover:underline">ลบรูปออก</button>
                                )}
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })
              )}
            </div>

          </div>
        ) : (
          <div className="text-center text-slate-400 font-bold py-20 border border-dashed rounded-2xl bg-slate-50">
            <button onClick={() => setView('reports')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'reports' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
              <PieChart size={20} className={activeView === 'reports' ? 'fill-blue-100' : ''} />
              <span className="text-[10px] font-bold mt-1">Reports</span>
            </button>
            ← กรุณาเลือกแบบบ้านที่ด้านบน เพื่อเริ่มต้นกางงวดงานจัดเลเยอร์ภาพครับ
          </div>
        )}
      </div>
    </div>
  );
}
