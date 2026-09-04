import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Image as ImageIcon, Loader2, Calendar, HardHat, Pickaxe } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function DefectProgressModal({ 
    isOpen, 
    onClose, 
    defect,
    taskTemplate,
    contractors,
    currentUserRole,
    onDefectUpdated
}: any) {
    const [updates, setUpdates] = useState<any[]>([]);
    const [note, setNote] = useState('');
    const [progress, setProgress] = useState(defect?.progress || 0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [plannedStart, setPlannedStart] = useState(defect?.planned_start || '');
    const [plannedEnd, setPlannedEnd] = useState(defect?.planned_end || '');
    const [contractorId, setContractorId] = useState(defect?.contractor_id || '');
    const [isSavingPlan, setIsSavingPlan] = useState(false);

    useEffect(() => {
        if (isOpen && defect) {
            setProgress(defect.progress || 0);
            setPlannedStart(defect.planned_start || '');
            setPlannedEnd(defect.planned_end || '');
            setContractorId(defect.contractor_id || '');
            fetchUpdates();
        }
    }, [isOpen, defect]);

    const fetchUpdates = async () => {
        try {
            const { data } = await supabase
                .from('defect_updates')
                .select('*')
                .eq('defect_id', defect.id)
                .order('created_at', { ascending: true });
            if (data) setUpdates(data);
        } catch (e) {
            console.error(e);
        }
    };

    const handleSavePlan = async () => {
        setIsSavingPlan(true);
        try {
            const { error } = await supabase.from('defects').update({
                planned_start: plannedStart || null,
                planned_end: plannedEnd || null,
                contractor_id: contractorId || null
            }).eq('id', defect.id);
            if (error) throw error;
            alert('บันทึกแผนงานและช่างเรียบร้อยแล้ว');
            onDefectUpdated();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setIsSavingPlan(false);
        }
    };

    const handleSendUpdate = async () => {
        if (progress === defect.progress && !note.trim() && files.length === 0) return;
        setIsSubmitting(true);
        try {
            let imageUrls: string[] = [];
            if (files.length > 0) {
                for (const fileObj of files) {
                    const fileExt = fileObj.file.name.split('.').pop();
                    const fileName = `${Math.random()}.${fileExt}`;
                    const filePath = `defects/${defect.id}/${fileName}`;
                    const { error: uploadError } = await supabase.storage.from('defect_images').upload(filePath, fileObj.file);
                    if (!uploadError) {
                        const { data: publicUrlData } = supabase.storage.from('defect_images').getPublicUrl(filePath);
                        imageUrls.push(publicUrlData.publicUrl);
                    }
                }
            }

            const { error } = await supabase.from('defect_updates').insert([{
                defect_id: defect.id,
                progress: progress,
                note: note,
                image_urls: imageUrls.join(','),
                created_by: currentUserRole
            }]);
            if (error) throw error;

            // Update main defect record
            const { error: updateError } = await supabase.from('defects').update({
                progress: progress,
                status: progress === 100 ? 'resolved' : 'pending',
                resolved_at: progress === 100 ? new Date().toISOString() : null
            }).eq('id', defect.id);

            setNote('');
            setFiles([]);
            fetchUpdates();
            onDefectUpdated();
            if (progress === 100) {
                onClose();
            }
        } catch (e: any) {
            alert('Error updating: ' + e.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !defect) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[99999] flex justify-center items-center p-2 sm:p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col h-[90vh] shadow-2xl overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">อัปเดตงานแจ้งซ่อม</h2>
                        <p className="text-xs font-semibold text-slate-500">{taskTemplate?.task_name || defect.description}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-200 text-slate-600 rounded-full hover:bg-slate-300">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-100">
                    {/* Plan & Assign Box */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Calendar size={16}/> แผนงานและผู้รับเหมา</h3>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400">วันเริ่มงาน (Plan Start)</label>
                                <input type="date" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} className="w-full text-xs p-2 border rounded-lg bg-slate-50"/>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400">วันเสร็จสิ้น (Plan End)</label>
                                <input type="date" value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} className="w-full text-xs p-2 border rounded-lg bg-slate-50"/>
                            </div>
                        </div>
                        <div className="mb-3">
                            <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><HardHat size={12}/> ผู้รับเหมา / ช่างที่แก้ไข</label>
                            <select value={contractorId} onChange={e => setContractorId(e.target.value)} className="w-full text-xs p-2 border rounded-lg bg-slate-50">
                                <option value="">-- ไม่ระบุช่าง --</option>
                                {contractors?.map((c: any) => (
                                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                                ))}
                            </select>
                        </div>
                        <button onClick={handleSavePlan} disabled={isSavingPlan} className="w-full py-2 bg-slate-800 text-white text-xs font-bold rounded-lg hover:bg-slate-900 disabled:opacity-50">
                            {isSavingPlan ? 'Saving...' : 'บันทึกแผนงานและช่าง'}
                        </button>
                    </div>

                    {/* Chat History */}
                    <div className="space-y-3">
                        {updates.map(u => (
                            <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{u.created_by}</span>
                                    <span className="text-[10px] text-slate-400">{new Date(u.created_at).toLocaleString('th-TH')}</span>
                                </div>
                                <div className="text-sm text-slate-700 mb-2">{u.note || 'อัปเดตความคืบหน้า'}</div>
                                <div className="mb-2">
                                    <span className="text-xs font-bold text-slate-500">ความคืบหน้า: {u.progress}%</span>
                                    <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                                        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${u.progress}%` }}></div>
                                    </div>
                                </div>
                                {u.image_urls && (
                                    <div className="flex gap-2 overflow-x-auto mt-2">
                                        {u.image_urls.split(',').filter((x: string) => x).map((url: string, i: number) => (
                                            <img key={i} src={url} className="h-16 rounded object-cover border" alt="update" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-slate-200">
                    <div className="mb-4">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-slate-600 flex items-center gap-1"><Pickaxe size={14}/> ความคืบหน้างานแก้</label>
                            <span className="text-sm font-black text-purple-600">{progress}%</span>
                        </div>
                        <input type="range" min="0" max="100" step="10" value={progress} onChange={e => setProgress(parseInt(e.target.value))} className="w-full accent-purple-600" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <textarea 
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder="พิมพ์รายละเอียดการแก้ไข..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm resize-none h-20 focus:ring-2 focus:ring-purple-500 outline-none"
                        ></textarea>
                        
                        {files.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto">
                                {files.map((f, i) => (
                                    <div key={i} className="relative">
                                        <img src={f.previewUrl} className="w-12 h-12 object-cover rounded border" />
                                        <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"><X size={10}/></button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <label className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold py-3 rounded-xl flex justify-center items-center gap-1 cursor-pointer transition-colors">
                                <ImageIcon size={16} /> แนบรูปภาพ
                                <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => {
                                    const fs = Array.from(e.target.files || []).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
                                    setFiles([...files, ...fs]);
                                }} />
                            </label>
                            <button 
                                onClick={handleSendUpdate}
                                disabled={isSubmitting}
                                className="flex-[2] bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-sm disabled:opacity-50 transition-colors"
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : <><Send size={16} /> บันทึกการอัปเดต</>}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
