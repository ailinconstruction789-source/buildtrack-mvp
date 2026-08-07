import React from 'react';
import { ClipboardList, Loader2, Copy, Settings, Calculator, Ban, Trash2 } from 'lucide-react';

interface AdminTasksViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  editingTaskHouseId: string;
  setEditingTaskHouseId: (id: string) => void;
  houseTypes: any[];
  taskTemplates: any[];
  taskForm: { id: string; task_name: string; task_order: string; cost: string };
  setTaskForm: (form: any) => void;
  isEditingTask: boolean;
  setIsEditingTask: (isEditing: boolean) => void;
  isSubmitting: boolean;
  handleSaveTask: () => void;
  handleDeleteTask: (task: any) => void;
  handleToggleProgressCounted: (task: any) => void;
  handleOpenExclusionModal: (task: any) => void;
  copySourceHouseId: string;
  setCopySourceHouseId: (id: string) => void;
  handleCopyTasks: () => void;
}

export default function AdminTasksView({
  setView,
  setSelectedProject,
  editingTaskHouseId,
  setEditingTaskHouseId,
  houseTypes,
  taskTemplates,
  taskForm,
  setTaskForm,
  isEditingTask,
  setIsEditingTask,
  isSubmitting,
  handleSaveTask,
  handleDeleteTask,
  handleToggleProgressCounted,
  handleOpenExclusionModal,
  copySourceHouseId,
  setCopySourceHouseId,
  handleCopyTasks
}: AdminTasksViewProps) {
  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-5xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
      <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← BACK TO DASHBOARD</button>

      <div className="bg-white p-6 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 flex items-center gap-2"><ClipboardList className="text-rose-600" /> Manage Tasks</h2>

        {/* Dropdown เลือกแบบบ้าน */}
        <div className="mb-8">
          <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest">เลือกแบบบ้านที่ต้องการตั้งค่างวดงาน</label>
          <select
            value={editingTaskHouseId}
            onChange={(e) => {
              setEditingTaskHouseId(e.target.value);
              setTaskForm({ id: '', task_name: '', task_order: '', cost: '' });
              setIsEditingTask(false);
            }}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-rose-500"
          >
            <option value="">-- กรุณาเลือกแบบบ้าน --</option>
            {houseTypes.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
          </select>
        </div>

        {editingTaskHouseId && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 border-t border-slate-100 pt-8">

            {/* ฝั่งซ้าย: ฟอร์มเพิ่ม/แก้ไขงวดงาน */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 h-fit">
              <h3 className="font-black text-slate-800 text-base mb-4 uppercase italic tracking-tight flex items-center gap-1.5 text-rose-600">
                {isEditingTask ? '📝 แก้ไขงวดงาน' : '➕ เพิ่มงวดงานใหม่'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ลำดับงาน (ตัวเลข)</label>
                  <input type="number" placeholder="เช่น 1, 2, 3..." value={taskForm.task_order} onChange={(e) => setTaskForm({ ...taskForm, task_order: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่องวดงาน</label>
                  <textarea placeholder="เช่น งานเทฐานราก, งานก่อผนัง..." value={taskForm.task_name} onChange={(e) => setTaskForm({ ...taskForm, task_name: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">มูลค่างาน / ต้นทุน (บาท)</label>
                  <input type="number" placeholder="เช่น 50000" value={taskForm.cost} onChange={(e) => setTaskForm({ ...taskForm, cost: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                </div>
                <div className="flex gap-2 pt-2">
                  {isEditingTask && (
                    <button onClick={() => { setTaskForm({ id: '', task_name: '', task_order: '', cost: '' }); setIsEditingTask(false); }} className="bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-300">ยกเลิก</button>
                  )}
                  <button onClick={handleSaveTask} disabled={isSubmitting} className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5">
                    {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : (isEditingTask ? 'บันทึกการแก้ไข' : 'เพิ่มงาน')}
                  </button>
                </div>
              </div>

              {!isEditingTask && (
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <h3 className="font-black text-slate-700 text-[11px] mb-3 uppercase tracking-widest flex items-center gap-1.5">
                    <Copy size={14} className="text-slate-400" /> คัดลอกงวดงานจากแบบบ้านอื่น
                  </h3>
                  <div className="space-y-3">
                    <select
                      value={copySourceHouseId}
                      onChange={(e) => setCopySourceHouseId(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:border-rose-500 text-slate-600"
                    >
                      <option value="">-- เลือกแบบบ้านต้นฉบับ --</option>
                      {houseTypes.filter((t:any) => t.id !== editingTaskHouseId).map((t:any) => (
                        <option key={t.id} value={t.id}>{t.type_name}</option>
                      ))}
                    </select>
                    <button 
                      onClick={handleCopyTasks} 
                      disabled={isSubmitting || !copySourceHouseId} 
                      className={`w-full py-2.5 rounded-xl text-xs font-black shadow-sm transition-colors ${!copySourceHouseId ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-800 text-white hover:bg-slate-900'}`}
                    >
                      {isSubmitting ? <Loader2 className="animate-spin mx-auto" size={14} /> : 'คัดลอกข้อมูล'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ฝั่งขวา: รายการงวดงานทั้งหมด */}
            <div className="lg:col-span-2 space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {taskTemplates.filter(t => t.house_type_id === editingTaskHouseId).length === 0 ? (
                <p className="text-center text-slate-400 italic py-10 font-bold">ยังไม่มีงวดงานในแบบบ้านนี้</p>
              ) : (
                taskTemplates
                  .filter(t => t.house_type_id === editingTaskHouseId)
                  .sort((a, b) => a.task_order - b.task_order)
                  .map(task => (
                    <div key={task.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-4 group hover:border-blue-300 transition-colors shadow-sm">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-black text-slate-500 shrink-0 text-xs">
                          {task.task_order}
                        </div>
                        <div className="truncate">
                          <h4 className={`font-bold text-sm truncate ${task.is_progress_counted !== false ? 'text-slate-700' : 'text-slate-400'}`}>{task.task_name}</h4>
                          <p className={`text-[10px] font-bold mt-0.5 ${task.is_progress_counted !== false ? 'text-slate-500' : 'text-slate-300 line-through'}`}>ต้นทุน: {Number(task.cost || 0).toLocaleString()} ฿</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setTaskForm({ id: String(task.id), task_name: task.task_name, task_order: String(task.task_order), cost: String(task.cost || '') }); setIsEditingTask(true); }} className="p-2 bg-slate-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"><Settings size={16} /></button>
                        <button onClick={() => handleToggleProgressCounted(task)} className={`p-2 rounded-lg transition-colors ${task.is_progress_counted !== false ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`} title={task.is_progress_counted !== false ? 'นำมาคำนวณในแผนงาน (กำลังเปิดใช้งาน)' : 'ไม่นำมาคำนวณในแผนงาน (กำลังปิดใช้งาน)'}><Calculator size={16} /></button>
                        <button onClick={() => handleOpenExclusionModal(task)} className="p-2 bg-slate-50 text-orange-500 rounded-lg hover:bg-orange-100 transition-colors" title="ตั้งค่าแปลงข้อยกเว้น (N/A)"><Ban size={16} /></button>
                        <button onClick={() => handleDeleteTask(task)} className="p-2 bg-slate-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
