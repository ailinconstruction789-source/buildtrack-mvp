
import React, { useEffect } from 'react';
import { 
  AlertCircle, AlertTriangle, Camera, CheckCircle, Clock, Loader2, Printer, Send, ShieldAlert, Trash2, X
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface TaskProgressViewProps {
  view: string;
  setView: (v: string) => void;
  taskReturnView: string;
  isMobileLayout: boolean;
  selectedTask: any;
  selectedPlot: any;
  setProgressValue: (v: number) => void;
  progressValue: number;
  isSending: boolean;
  setFullImageUrl: (url: string) => void;
  handleDeleteUpdate: (updateId: string, taskId: string, plotId: string) => void;
  setExportModalOpen: (b: boolean) => void;
  isProjectPlanner: boolean;
  isAdmin: boolean;
  currentUserRole: string;
  updates: any[];
  setUpdates: (u: any[]) => void;
  inputText: string;
  setInputText: (t: string) => void;
  selectedFiles: any[];
  setSelectedFiles: (files: any[]) => void;
  isTaskCompleted: boolean;
  handleOpenExportModal: () => void;
  setDefectModal: (o: any) => void;
  defects: any[];
  loggedInUser: any;
  isLockedForForeman: boolean;
  isSiteEngineer: boolean;
  isPendingSE: boolean;
  handleReviewAction: (approved: boolean) => void;
  isQC: boolean;
  isPendingQC: boolean;
  isProcurement: boolean;
  isOwner: boolean;
  handleSendPost: () => void;
}

export default function TaskProgressView(props: TaskProgressViewProps) {
  const {
    view, setView, taskReturnView, isMobileLayout, selectedTask, selectedPlot,
    setProgressValue, progressValue, isSending, setFullImageUrl,
    handleDeleteUpdate, setExportModalOpen, 
    isProjectPlanner, isAdmin, currentUserRole,
    updates, setUpdates, inputText, setInputText, 
    selectedFiles, setSelectedFiles, 
    isTaskCompleted, handleOpenExportModal, setDefectModal, defects, loggedInUser,
    isLockedForForeman, isSiteEngineer, isPendingSE, handleReviewAction, isQC,
    isPendingQC, isProcurement, isOwner, handleSendPost
  } = props;

  useEffect(() => {
    if (view === 'task-progress' && selectedTask && selectedPlot) {
      supabase.from('task_updates').select('*')
        .eq('task_template_id', selectedTask.id)
        .eq('plot_id', selectedPlot.id)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          setUpdates(data || []);
          setProgressValue(data?.length ? data[data.length - 1].progress : 0);
        });
    }
  }, [view, selectedTask?.id, selectedPlot?.id, setUpdates, setProgressValue]);

  return (
    <>
{view === 'task-progress' && selectedTask && (
                   <div className="animate-in slide-in-from-right duration-300">
                       <button onClick={() => setView(taskReturnView)} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">← {isMobileLayout ? 'BACK' : (taskReturnView === 'dashboard' ? 'BACK TO DASHBOARD' : 'BACK TO PLOT')}</button>
                       <div className="bg-white rounded-2xl sm:rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[75vh] sm:h-[800px] relative border-b-8 border-b-blue-600">
                           <header className={`${isMobileLayout ? 'p-4' : 'p-6 sm:p-10'} bg-slate-800 text-white flex justify-between items-center shrink-0`}>
                               <div>
                                   <h1 className={`${isMobileLayout ? 'text-lg' : 'text-2xl sm:text-4xl'} font-black text-white leading-tight mb-1 sm:mb-2 italic uppercase tracking-tight`}>{selectedTask.task_name}</h1>
                                   <p className="text-[10px] sm:text-sm text-slate-400 font-bold uppercase tracking-widest">Plot {selectedPlot.id} / Task {selectedTask.task_order}</p>
                               </div>
                               
                               <div className="flex items-center gap-4">
                                 {isTaskCompleted && !isMobileLayout && (
                                    <button onClick={handleOpenExportModal} className="bg-white/20 hover:bg-white/30 text-white font-bold py-2 px-4 rounded-xl flex items-center gap-2 transition-colors text-sm border border-white/20">
                                      <Printer size={16}/> ส่งออกรูปตั้งเบิก
                                    </button>
                                 )}
                                 <div className={`${isMobileLayout ? 'text-3xl' : 'text-5xl sm:text-6xl'} font-black text-blue-400 italic tracking-tighter`}>{isTaskCompleted ? <CheckCircle size={isMobileLayout?32:48} className="text-green-400 inline-block"/> : `${progressValue}%`}</div>
                                 {/* 🌟 ปุ่ม Punch List / Defect แยกหน้าต่างแบบมีรูปภาพ */}
                                 {['QC', 'Foreman', 'Site Engineer', 'Admin', 'Owner'].includes(currentUserRole) && (
                                    <button 
                                       onClick={() => setDefectModal({ isOpen: true, task: selectedTask, plotId: selectedPlot.id })}
                                       className={`ml-3 sm:ml-6 bg-rose-600 hover:bg-rose-700 text-white font-black flex items-center gap-1.5 shadow-md border border-rose-500 transition-all ${isMobileLayout ? 'px-2.5 py-2 text-[10px] rounded-lg' : 'px-4 py-3 text-sm rounded-xl'}`}
                                    >
                                       <ShieldAlert size={isMobileLayout ? 14 : 18} />
                                       <span className="hidden sm:inline">แจ้งซ่อม (Defect)</span>
                                       <span className="inline sm:hidden">แจ้งซ่อม</span>
                                       {defects.filter(d => d.plot_id === selectedPlot.id && d.task_id === selectedTask.id && d.status === 'pending').length > 0 && (
                                          <span className="bg-white text-rose-600 text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse ml-1 shadow">
                                             {defects.filter(d => d.plot_id === selectedPlot.id && d.task_id === selectedTask.id && d.status === 'pending').length}
                                          </span>
                                       )}
                                    </button>
                                 )}
                               </div>
                           </header>

                           {isTaskCompleted && isMobileLayout && (
                              <div className="bg-slate-700 p-2 flex justify-center">
                                 <button onClick={handleOpenExportModal} className="bg-white/10 hover:bg-white/20 text-white font-bold py-1.5 px-4 rounded-lg flex items-center gap-2 transition-colors text-xs border border-white/20 w-full justify-center">
                                   <Printer size={14}/> ส่งออกรูปถ่ายตั้งเบิก
                                 </button>
                              </div>
                           )}

                           <main className={`flex-1 overflow-y-auto ${isMobileLayout ? 'p-3 pb-32 space-y-3' : 'p-4 sm:px-8 sm:pt-8 sm:pb-[280px] space-y-4 sm:space-y-6'} bg-slate-50/50`}>
                               {updates.map((update: any) => (
                               <div key={update.id} className={`flex ${isMobileLayout ? 'gap-2' : 'gap-3 sm:gap-5'} animate-in slide-in-from-bottom-4`}>
                                   <div className={`${isMobileLayout ? 'w-8 h-8 rounded-lg text-xs' : 'w-10 h-10 sm:w-14 sm:h-14 rounded-2xl text-sm sm:text-base'} flex items-center justify-center text-white font-black shrink-0 shadow-lg ${update.role === 'QC' ? 'bg-purple-600' : update.role === 'Site Engineer' ? 'bg-blue-600' : 'bg-slate-600'}`}>{update.user_name.charAt(0)}</div>
                                    {/* สังเกตตรงนี้: ผมแอบเติม pr-8 เข้าไปท้ายสุดของบรรทัดเพื่อไม่ให้ข้อความไปบังปุ่มลบครับ */}
                                   <div className={`flex-1 bg-white ${isMobileLayout ? 'p-3 rounded-2xl' : 'p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem]'} border border-slate-200 shadow-sm relative pr-8`}>
                                       
                                       {/* 🗑️ ปุ่มลบรายงาน (สิทธิ์: คนส่งรายงานชิ้นนี้เอง หรือ Admin) และงานนั้นต้องยังไม่จบ 100% */}
                                       {(update.user_name === loggedInUser?.username || isAdmin) && !isTaskCompleted && (
                                          <button
                                             onClick={() => handleDeleteUpdate(update.id, selectedTask.id, selectedPlot.id)}
                                             className="absolute top-3 right-3 text-slate-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-xl transition-all hover:scale-105"
                                             title="ลบรายงานความผิดพลาดชิ้นนี้"
                                          >
                                             <Trash2 size={15} />
                                          </button>
                                       )}

                                       <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2 sm:mb-4 gap-1 sm:gap-2">
                                         <p className={`text-[9px] sm:text-xs font-black uppercase italic tracking-widest leading-tight ${update.role === 'QC' ? 'text-purple-400' : update.role === 'Site Engineer' ? 'text-blue-400' : 'text-slate-400'}`}>{update.action} • {update.user_name} • {update.progress}%</p>
                                         <span className={`text-[8px] sm:text-xs text-slate-500 font-bold bg-slate-50 border border-slate-100 ${isMobileLayout ? 'px-2 py-0.5' : 'px-3 py-1.5'} rounded-lg shrink-0 w-fit`}>{new Date(update.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} • {new Date(update.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
                                         {/* 🌟 ป้ายสภาพอากาศ ณ เวลาที่รายงาน */}
                                          {update.weather_info && (
                                            <span className={`text-[8px] sm:text-xs text-sky-700 font-bold bg-sky-50 border border-sky-100 ${isMobileLayout ? 'px-2 py-0.5' : 'px-3 py-1.5'} rounded-lg shrink-0 w-fit flex items-center gap-1`} title="สภาพอากาศขณะรายงาน">
                                                {update.weather_info}
                                            </span>
                                          )}
                                       </div>
                                       <p className={`text-slate-700 ${isMobileLayout ? 'text-xs mb-2' : 'text-sm sm:text-base mb-4'} font-medium leading-relaxed`}>{update.text_content}</p>
                                       {update.image_url && (
                                            <div className={`grid gap-2 ${update.image_url.split(',').filter((u: string) => u.trim() !== '').length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                               {update.image_url.split(',').filter((u: string) => u.trim() !== '').map((url: any, i: any) => (
                                                  <img key={i} src={url.trim()} onClick={() => setFullImageUrl(url.trim())} className={`w-full aspect-video ${isMobileLayout ? 'h-24' : 'h-32 sm:h-48'} object-cover rounded-xl sm:rounded-2xl cursor-zoom-in border border-slate-100 shadow-sm hover:opacity-90 transition-opacity`} alt="Task Update" /> 
                                               ))}
                                           </div>
                                       )}
                                   </div>
                               </div>
                               ))}
                           </main>
                           
                           {/* 🏡 🌟 Chat Input 🌟 */}
                           <footer className={`absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 ${isMobileLayout ? 'p-3' : 'p-4 sm:p-6'} shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-20`}>
                               {selectedFiles.length > 0 && (
                                   <div className={`flex gap-2 sm:gap-3 mb-2 sm:mb-4 overflow-x-auto pb-1 sm:pb-2`}>
                                       {selectedFiles.map((file: any, idx: any) => (
                                       <div key={idx} className="relative shrink-0 animate-in fade-in zoom-in duration-300">
                                           <img src={file.previewUrl} className={`${isMobileLayout ? 'w-12 h-12 border-2' : 'w-16 h-16 sm:w-20 sm:h-20 border-4'} object-cover rounded-xl border-blue-500 shadow-sm`} />
                                           <button onClick={() => { const n = [...selectedFiles]; n.splice(idx, 1); setSelectedFiles(n); }} className={`absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full ${isMobileLayout ? 'p-0.5 border' : 'p-1 border-2'} border-white hover:bg-red-600`}><X size={10} /></button>
                                       </div>
                                       ))}
                                   </div>
                               )}

                               {isTaskCompleted ? (
                                  <div className={`bg-green-100 text-green-700 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-green-200 flex items-center justify-center gap-2 ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><CheckCircle size={isMobileLayout ? 16 : 20}/> ตรวจสอบและอนุมัติเสร็จสิ้น</div>
                               ) : isLockedForForeman ? (
                                  <div className={`bg-rose-50 text-rose-600 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center border border-rose-200 flex flex-col items-center justify-center gap-1`}><span className={`flex items-center gap-1.5 uppercase tracking-widest ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><AlertTriangle size={isMobileLayout ? 16 : 20}/> ยังไม่สามารถส่งงานได้</span><span className={`font-bold opacity-80 ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}>กรุณารอผู้จัดจ้างระบุชื่อช่างก่อนครับ</span></div>
                               ) : isSiteEngineer ? (
                                 isPendingSE ? (
                                   <div className={`flex flex-col ${isMobileLayout ? 'gap-2' : 'gap-3 sm:gap-4'}`}>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-3'} items-center`}>
                                         <label className={`text-slate-400 hover:text-blue-600 ${isMobileLayout ? 'p-2 rounded-lg' : 'p-2 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform`}><Camera size={isMobileLayout ? 18 : 24} /><input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setSelectedFiles([...selectedFiles, ...files].slice(0, 4)); }} /></label>
                                         <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="ระบุความคิดเห็น..." className={`flex-1 bg-slate-100 ${isMobileLayout ? 'rounded-lg px-3 py-2.5 text-[10px]' : 'rounded-xl sm:rounded-[1.5rem] px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm'} font-bold outline-none focus:border-blue-500`} />
                                     </div>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-4'}`}>
                                       <button onClick={() => handleReviewAction(false)} disabled={isSending} className={`flex-1 bg-red-50 text-red-600 ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black border border-red-200 uppercase tracking-widest hover:bg-red-100 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'ไม่อนุมัติ (แก้ 95%)'}</button>
                                       <button onClick={() => handleReviewAction(true)} disabled={isSending} className={`flex-1 bg-blue-600 text-white ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black uppercase tracking-widest hover:bg-blue-700 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'ตรวจสอบผ่าน'}</button>
                                     </div>
                                   </div>
                                 ) : ( <div className={`bg-slate-100 text-slate-400 py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-slate-200 ${isMobileLayout ? 'text-[9px]' : 'text-xs sm:text-sm'}`}>รอโฟร์แมน 100% หรือ รอ QC ตรวจ</div> )
                               ) : isQC ? (
                                 isPendingQC ? (
                                   <div className={`flex flex-col ${isMobileLayout ? 'gap-2' : 'gap-3 sm:gap-4'}`}>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-3'} items-center`}>
                                         <label className={`text-slate-400 hover:text-purple-600 ${isMobileLayout ? 'p-2 rounded-lg' : 'p-2 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform`}><Camera size={isMobileLayout ? 18 : 24} /><input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setSelectedFiles([...selectedFiles, ...files].slice(0, 4)); }} /></label>
                                         <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="ระบุความคิดเห็น..." className={`flex-1 bg-slate-100 ${isMobileLayout ? 'rounded-lg px-3 py-2.5 text-[10px]' : 'rounded-xl sm:rounded-[1.5rem] px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm'} font-bold outline-none focus:border-purple-500`} />
                                     </div>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-4'}`}>
                                       <button onClick={() => handleReviewAction(false)} disabled={isSending} className={`flex-1 bg-red-50 text-red-600 ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black border border-red-200 uppercase tracking-widest hover:bg-red-100 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'ไม่อนุมัติ (แก้ 95%)'}</button>
                                       <button onClick={() => handleReviewAction(true)} disabled={isSending} className={`flex-1 bg-purple-600 text-white ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black uppercase tracking-widest hover:bg-purple-700 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'QC ผ่าน (Complete)'}</button>
                                     </div>
                                   </div>
                                 ) : ( <div className={`bg-slate-100 text-slate-400 py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-slate-200 ${isMobileLayout ? 'text-[9px]' : 'text-xs sm:text-sm'}`}>รองานผ่าน Site Engineer ก่อน</div> )
                               ) : isProcurement || isProjectPlanner || isOwner ? (
                                   <div className={`bg-slate-100 text-slate-500 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-slate-200 flex items-center justify-center gap-2 ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><AlertCircle size={18}/> ใช้สิทธิ์อัปเดตงานไม่ได้</div>
                               ) : (
                                 isPendingSE || isPendingQC ? (
                                   <div className={`bg-orange-100 text-orange-600 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-orange-200 flex items-center justify-center gap-2 ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><Clock size={18}/> งานรอตรวจสอบ ({isPendingSE ? 'Site Engineer' : 'QC'})</div>
                                 ) : (
                                   <div className={`space-y-2 sm:space-y-4`}>
                                       <div className={`flex items-center gap-2 sm:gap-4 ${isMobileLayout ? 'px-1' : 'px-2'}`}>
                                           <span className={`font-black text-slate-500 uppercase italic tracking-widest ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}>Progress</span>
                                           <input type="range" min={updates.length > 0 ? updates[updates.length-1].progress : 0} max="100" step="5" value={progressValue} onChange={(e) => setProgressValue(Number(e.target.value))} className={`flex-1 accent-blue-600 ${isMobileLayout ? 'h-1.5' : 'h-2 sm:h-2.5'} bg-slate-200 rounded-lg appearance-none cursor-pointer`} />
                                           <span className={`font-black text-blue-600 text-right italic ${isMobileLayout ? 'text-sm w-10' : 'text-xl sm:text-2xl w-16 sm:w-20'}`}>{progressValue}%</span>
                                       </div>
                                       <div className={`flex items-center ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}>
                                           <label className={`text-slate-400 hover:text-blue-600 ${isMobileLayout ? 'p-2 rounded-lg' : 'p-3 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform`}><Camera size={isMobileLayout ? 18 : 24} /><input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setSelectedFiles([...selectedFiles, ...files].slice(0, 4)); }} /></label>
                                           <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendPost()} placeholder="อธิบายงาน..." className={`flex-1 bg-slate-100 ${isMobileLayout ? 'rounded-lg px-3 py-2 text-[10px]' : 'rounded-xl sm:rounded-[1.5rem] px-5 sm:px-6 py-3 sm:py-4 text-sm'} font-bold outline-none border-2 border-transparent focus:border-blue-500 shadow-inner`} />
                                           <button onClick={handleSendPost} disabled={isSending} className={`${isMobileLayout ? 'p-2 rounded-lg' : 'p-3 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} text-white shadow-md disabled:opacity-50 ${progressValue === 100 ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'}`}>{isSending ? <Loader2 className="animate-spin" size={isMobileLayout ? 18 : 24}/> : <Send size={isMobileLayout ? 18 : 24}/>}</button>
                                       </div>
                                   </div>
                                 )
                               )}
                           </footer>
                       </div>
                   </div>
               )}

               {/* 🌟 1. ADMIN / PROCUREMENT FORMS 🌟 */}
               
    </>
  );
}
