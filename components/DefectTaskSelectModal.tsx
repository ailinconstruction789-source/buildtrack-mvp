import React, { useState } from 'react';
import { X, Search, CheckCircle, Plus } from 'lucide-react';

export default function DefectTaskSelectModal({ 
    isOpen, 
    onClose, 
    taskTemplates, 
    selectedPlot,
    onSelectTask,
    existingDefects = []
}: any) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTasks, setSelectedTasks] = useState<any[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const availableTasks = (taskTemplates || []).filter((t: any) => {
        if (t.house_type_id !== selectedPlot?.house_type_id) return false;
        if (searchQuery && !t.task_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const handleToggleTask = (task: any, isAlreadyAdded: boolean) => {
        if (isAlreadyAdded) return;
        if (selectedTasks.find(t => t.id === task.id)) {
            setSelectedTasks(selectedTasks.filter(t => t.id !== task.id));
        } else {
            setSelectedTasks([...selectedTasks, task]);
        }
    };

    const handleConfirm = async () => {
        if (selectedTasks.length > 0) {
            setIsSubmitting(true);
            try {
                await onSelectTask(selectedTasks);
                setSelectedTasks([]);
            } finally {
                setIsSubmitting(false);
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[99999] flex justify-center items-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col max-h-[80vh] overflow-hidden shadow-2xl">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">เลือกงานแจ้งซ่อม</h2>
                        <p className="text-xs font-semibold text-slate-500">เลือกหมวดงานที่พบปัญหาเพื่อผูกกับ Defect</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-200 text-slate-600 rounded-full hover:bg-slate-300">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 border-b border-slate-100 relative">
                    <Search size={18} className="absolute left-7 top-7 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="ค้นหางาน (เช่น งานสี, งานกระเบื้อง)..."
                        className="w-full bg-slate-100 rounded-xl py-3 pl-10 pr-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-purple-500"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {availableTasks.map((task: any) => {
                        const isAlreadyAdded = existingDefects.some((d: any) => (d.task_id === task.id || d.task_template_id === task.id));
                        const isSelected = selectedTasks.find(t => t.id === task.id);

                        return (
                            <div 
                                key={task.id} 
                                onClick={() => handleToggleTask(task, isAlreadyAdded)}
                                className={`p-3 rounded-xl border-2 flex justify-between items-center transition-all ${
                                    isAlreadyAdded 
                                        ? 'border-slate-200 bg-slate-100/70 opacity-60 cursor-not-allowed select-none' 
                                        : isSelected 
                                            ? 'border-purple-500 bg-purple-50 cursor-pointer' 
                                            : 'border-slate-100 hover:border-slate-300 bg-white cursor-pointer'
                                }`}
                            >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                                        isAlreadyAdded
                                            ? 'bg-slate-300 text-slate-500'
                                            : isSelected 
                                                ? 'bg-purple-500 text-white' 
                                                : 'bg-slate-100 text-slate-400'
                                    }`}>
                                        {isAlreadyAdded ? <CheckCircle size={14} /> : isSelected ? <CheckCircle size={14} /> : <div className="w-2 h-2 rounded-full bg-slate-300"></div>}
                                    </div>
                                    <span className={`text-sm font-bold truncate ${isAlreadyAdded ? 'text-slate-400 line-through' : isSelected ? 'text-purple-700' : 'text-slate-700'}`}>{task.task_name}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                    {isAlreadyAdded ? (
                                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">
                                            📌 มีในรอบนี้แล้ว
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">
                                            #{task.task_order}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-600">
                        เลือกแล้ว <span className="text-purple-600">{selectedTasks.length}</span> งาน
                    </span>
                    <button 
                        onClick={handleConfirm}
                        disabled={selectedTasks.length === 0 || isSubmitting}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm"
                    >
                        {isSubmitting ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> กำลังบันทึก...</span> : <span className="flex items-center gap-2"><Plus size={18} /> เพิ่มรายการเข้าสู่รอบตรวจ</span>}
                    </button>
                </div>
            </div>
        </div>
    );
}
