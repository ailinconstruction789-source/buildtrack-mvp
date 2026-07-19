import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Package, Truck, CheckCircle, Clock, 
  Search, Filter, AlertTriangle, Building, 
  Calendar, Check, User, Loader2, Camera, ImageIcon, XCircle
} from 'lucide-react';
import ReceiptUploadModal from './ReceiptUploadModal';

interface MaterialStoreDashboardProps {
  view: string;
  materialRequests: any[];
  plots: any[];
  taskTemplates: any[];
  projects: any[];
  loggedInUser: any;
  setMaterialRequests?: any;
  materialReceipts?: any[];
  setMaterialReceipts?: any;
}

export default function MaterialStoreDashboard({
  view,
  materialRequests,
  plots,
  taskTemplates,
  projects,
  loggedInUser,
  setMaterialRequests,
  materialReceipts,
  setMaterialReceipts
}: MaterialStoreDashboardProps) {
  const [filterStatus, setFilterStatus] = useState<string>('requested');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [viewImageModalUrl, setViewImageModalUrl] = useState<string | null>(null);

  const [receiptUploadTask, setReceiptUploadTask] = useState<any>(null);
  const [viewHistoryTask, setViewHistoryTask] = useState<any>(null);
  const [prPromptTask, setPrPromptTask] = useState<string | null>(null);
  const [prNumberInput, setPrNumberInput] = useState('');

  // handleUploadReceipt is now handled by ReceiptUploadModal

  const handleCompleteReceipt = async (req: any) => {
    if (!window.confirm('ยืนยันว่าได้รับของครบถ้วนแล้ว?')) return;
    setIsProcessing(req.id);
    try {
      const { error: dbError } = await supabase
        .from('task_material_requests')
        .update({
          status: 'received',
          updated_by: loggedInUser?.username || 'Store',
          updated_at: new Date().toISOString()
        })
        .eq('id', req.id);
        
      if (dbError) throw dbError;

      if (setMaterialRequests) {
        setMaterialRequests((prev: any) => 
          prev.map((r: any) => r.id === req.id ? { ...r, status: 'received', updated_by: loggedInUser?.username || 'Store', updated_at: new Date().toISOString() } : r)
        );
      }
      alert('ยืนยันการรับของครบถ้วนสำเร็จ!');
    } catch (error: any) {
      alert('เกิดข้อผิดพลาด: ' + (error.message || JSON.stringify(error)));
    } finally {
      setIsProcessing(null);
    }
  };

  // Group and format requests
  const enrichedRequests = useMemo(() => {
    return materialRequests.map(req => {
      const plot = plots.find(p => p.id === req.plot_id);
      const task = taskTemplates.find(t => t.id === req.task_template_id);
      const project = plot ? projects.find(p => p.name === plot.project_name) : null;
      
      return {
        ...req,
        plot,
        task,
        project
      };
    }).sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime());
  }, [materialRequests, plots, taskTemplates, projects]);

  const filteredRequests = useMemo(() => {
    return enrichedRequests.filter(req => {
      if (filterStatus !== 'all' && req.status !== filterStatus) return false;
      
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchPlot = req.plot?.id?.toLowerCase().includes(q) || false;
        const matchTask = req.task?.task_name?.toLowerCase().includes(q) || false;
        const matchProject = req.project?.name?.toLowerCase().includes(q) || false;
        if (!matchPlot && !matchTask && !matchProject) return false;
      }
      return true;
    });
  }, [enrichedRequests, filterStatus, searchQuery]);

  const stats = useMemo(() => {
    return {
      requested: enrichedRequests.filter(r => r.status === 'requested').length,
      ordered: enrichedRequests.filter(r => r.status === 'ordered').length,
      received: enrichedRequests.filter(r => r.status === 'received').length,
      total: enrichedRequests.length
    };
  }, [enrichedRequests]);

  const executeStatusUpdate = async (reqId: string, newStatus: string, prNumber: string | null = null) => {
    setIsProcessing(reqId);
    try {
      const updatePayload: any = {
        status: newStatus,
        updated_by: loggedInUser?.username || 'Store',
        updated_at: new Date().toISOString()
      };
      
      if (prNumber) {
        updatePayload.pr_number = prNumber;
      }

      const { error } = await supabase
        .from('task_material_requests')
        .update(updatePayload)
        .eq('id', reqId);
        
      if (error) throw error;
      
      // Optimistic update
      if (setMaterialRequests) {
        setMaterialRequests((prev: any) => 
          prev.map((r: any) => r.id === reqId ? { ...r, ...updatePayload } : r)
        );
      } else {
        alert('ปรับสถานะสำเร็จ');
      }
    } catch (err: any) {
      console.error('Error updating material request:', err);
      alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(null);
    }
  };

  const handleUpdateStatus = (reqId: string, newStatus: string) => {
    if (newStatus === 'ordered') {
      setPrPromptTask(reqId);
      setPrNumberInput('');
      return;
    }
    executeStatusUpdate(reqId, newStatus);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'requested':
        return <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 font-bold rounded-lg text-xs"><Clock size={14}/> รอดำเนินการสั่งซื้อ</span>;
      case 'ordered':
        return <span className="flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-700 font-bold rounded-lg text-xs"><Truck size={14}/> สั่งแล้ว (รอรับของ)</span>;
      case 'received':
        return <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-700 font-bold rounded-lg text-xs"><CheckCircle size={14}/> ของเข้าไซต์แล้ว</span>;
      default:
        return <span className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 font-bold rounded-lg text-xs">{status}</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 pb-20 sm:pb-0 animate-in fade-in zoom-in-95 duration-500">
      
      {/* 🚀 Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-black text-2xl sm:text-4xl text-slate-800 italic uppercase tracking-tighter flex items-center gap-3">
            <Package className="text-blue-600" size={36} /> Store Dashboard
          </h2>
          <p className="text-slate-500 text-xs sm:text-sm font-bold uppercase tracking-widest mt-1">
            ระบบจัดการใบขอซื้อและรับเข้าวัสดุ (ตามหน้างาน)
          </p>
        </div>
      </div>

      {/* 📊 Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] sm:text-xs font-black text-slate-400 uppercase tracking-wider mb-1">ทั้งหมด</p>
          <p className="text-2xl sm:text-3xl font-black text-slate-800">{stats.total}</p>
        </div>
        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] sm:text-xs font-black text-amber-600 uppercase tracking-wider mb-1">รอสั่งซื้อ</p>
          <p className="text-2xl sm:text-3xl font-black text-amber-700">{stats.requested}</p>
        </div>
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] sm:text-xs font-black text-blue-600 uppercase tracking-wider mb-1">รอรับของ</p>
          <p className="text-2xl sm:text-3xl font-black text-blue-700">{stats.ordered}</p>
        </div>
        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] sm:text-xs font-black text-emerald-600 uppercase tracking-wider mb-1">รับแล้ว</p>
          <p className="text-2xl sm:text-3xl font-black text-emerald-700">{stats.received}</p>
        </div>
      </div>

      {/* 🔎 Filters & Search */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative w-full sm:w-1/3">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
            placeholder="ค้นหาแปลง, งาน, โครงการ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          {['requested', 'ordered', 'partial', 'received', 'all'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`flex-1 sm:px-4 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                filterStatus === status 
                  ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {status === 'all' ? 'ทั้งหมด' : status === 'requested' ? 'รอสั่ง' : status === 'ordered' ? 'รอรับ' : status === 'partial' ? 'ทยอยเข้า' : 'รับแล้ว'}
            </button>
          ))}
        </div>
      </div>

      {/* 📋 Requests List */}
      <div className="space-y-4">
        {filteredRequests.length === 0 ? (
          <div className="bg-white p-10 rounded-3xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400">
            <Package size={48} className="mb-4 opacity-50" />
            <p className="font-bold text-lg">ไม่พบข้อมูลคำร้องขอวัสดุ</p>
            <p className="text-sm">ลองเปลี่ยนตัวกรองหรือคำค้นหา</p>
          </div>
        ) : (
          filteredRequests.map((req) => (
            <div key={req.id} className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-5 sm:p-6 flex flex-col sm:flex-row gap-5 transition-all hover:border-blue-300">
              
              {/* 🏠 Info Section */}
              <div className="flex-1 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(req.status)}
                  {req.material_type === 'extra' && (
                    <span className="flex items-center gap-1 text-[10px] font-black text-rose-700 bg-rose-100 px-2 py-1 rounded-md uppercase tracking-wider border border-rose-200">
                      นอก BOQ
                    </span>
                  )}
                  {req.delivery_mode === 'partial' && (
                    <span className="flex items-center gap-1 text-[10px] font-black text-blue-700 bg-blue-100 px-2 py-1 rounded-md uppercase tracking-wider border border-blue-200">
                      ทยอยส่ง
                    </span>
                  )}
                  {req.expected_date && (
                    <span className="flex items-center gap-1 text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-1 rounded-md uppercase tracking-wider border border-amber-200">
                      <Calendar size={12}/> ใช้: {new Date(req.expected_date).toLocaleDateString('th-TH')}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-md uppercase tracking-wider">
                    สั่งเมื่อ: {new Date(req.requested_at).toLocaleDateString('th-TH')}
                  </span>
                </div>
                
                <div>
                  <h3 className="font-black text-lg sm:text-xl text-slate-800 mb-1">
                    งาน: {req.task?.task_name || 'ไม่ระบุงาน'}
                  </h3>
                  {req.pr_number && (
                    <div className="mb-3">
                       <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 font-bold px-3 py-1 rounded-lg text-xs border border-indigo-200">
                          <Package size={14} /> PR: {req.pr_number}
                       </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-slate-500">
                    <span className="flex items-center gap-1.5 text-blue-600">
                      <Building size={16}/> {req.project?.name || 'ไม่ระบุโครงการ'}
                    </span>
                    <span className="flex items-center gap-1.5 text-purple-600">
                      📍 แปลง {req.plot?.id}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <User size={16}/> ผรม: {req.plot?.contractor_name || '-'}
                    </span>
                  </div>
                </div>

                {req.extra_reason && (
                  <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-sm text-rose-700">
                    <strong className="text-rose-800">เหตุผลสั่งนอก BOQ:</strong> {req.extra_reason}
                  </div>
                )}
                {req.notes && (
                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl text-sm text-slate-700">
                    <strong className="text-slate-800">หมายเหตุถึงจัดซื้อ/สโตร์:</strong> {req.notes}
                  </div>
                )}
                
                <div className="text-[10px] text-slate-400 font-bold flex items-center gap-2">
                  <span>ร้องขอโดย: {req.requested_by || 'Foreman'}</span>
                  {req.updated_by && <span>• อัปเดตล่าสุดโดย: {req.updated_by}</span>}
                </div>
              </div>

              {/* 🛠️ Action Section */}
              <div className="flex flex-col gap-2 sm:w-48 shrink-0 justify-center border-t sm:border-t-0 sm:border-l border-slate-100 pt-4 sm:pt-0 sm:pl-5">
                {req.status === 'requested' && (
                  <button 
                    onClick={() => handleUpdateStatus(req.id, 'ordered')}
                    disabled={isProcessing === req.id}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 px-4 rounded-xl shadow-sm text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Truck size={18}/> ทำ PR/สั่งของแล้ว
                  </button>
                )}
                {(req.status === 'ordered' || req.status === 'partial') && (
                  <div className="flex flex-col gap-2">
                    <button onClick={() => setViewHistoryTask(req)} className="w-full bg-white hover:bg-blue-50 text-blue-600 border-2 border-blue-100 font-black py-2 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors">
                      <Search size={14}/> ประวัติรับของ
                    </button>
                    <button onClick={() => setReceiptUploadTask(req)} className="w-full bg-blue-50 hover:bg-blue-100 text-blue-600 font-black py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
                      <Camera size={18}/> เพิ่มรูปรับของ
                    </button>
                    <button onClick={() => handleCompleteReceipt(req)} disabled={isProcessing === req.id} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 px-4 rounded-xl shadow-sm text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
                      {isProcessing === req.id ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>} ยืนยันว่าครบแล้ว
                    </button>
                  </div>
                )}
                {req.status === 'received' && (
                  <div className="flex flex-col gap-2 w-full">
                    <div className="w-full bg-slate-100 text-slate-400 font-black py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 text-center">
                      <Check size={18}/> ดำเนินการเสร็จสิ้น
                    </div>
                    <button onClick={() => setViewHistoryTask(req)} className="w-full bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold py-2 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer">
                      <Search size={14}/> ดูประวัติรับของ
                    </button>
                  </div>
                )}
                
                {(req.status === 'ordered' || req.status === 'received') && (
                  <button 
                    onClick={() => {
                      if(window.confirm('คุณต้องการย้อนสถานะกลับไปเป็น "รอดำเนินการสั่งซื้อ" หรือไม่?')) {
                        handleUpdateStatus(req.id, 'requested');
                      }
                    }}
                    disabled={isProcessing === req.id}
                    className="w-full text-xs font-bold text-slate-400 hover:text-rose-500 py-2 text-center transition-colors disabled:opacity-50"
                  >
                    ย้อนสถานะ (Undo)
                  </button>
                )}
              </div>

            </div>
          ))
        )}
      </div>
      {viewImageModalUrl && (
        <div onClick={() => setViewImageModalUrl(null)} className="fixed inset-0 bg-black/80 z-[999999] flex flex-col items-center justify-center p-4 cursor-pointer">
          <button onClick={(e) => { e.stopPropagation(); setViewImageModalUrl(null); }} className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 p-2 rounded-full text-white backdrop-blur-sm transition-all cursor-pointer"><XCircle size={28}/></button>
          <img src={viewImageModalUrl} onClick={(e) => e.stopPropagation()} alt="Material View" className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-white/20 cursor-default"/>
        </div>
      )}

      {/* 📸 Receipt Upload Modal */}
      {receiptUploadTask && (
        <ReceiptUploadModal
          isOpen={!!receiptUploadTask}
          onClose={() => setReceiptUploadTask(null)}
          onSuccess={(newReceipt) => {
            if (setMaterialReceipts) {
              setMaterialReceipts([newReceipt, ...(materialReceipts || [])]);
            }
            alert('บันทึกรูปรับของเรียบร้อยแล้ว');
          }}
          plotId={receiptUploadTask.plot?.id || ''}
          taskId={receiptUploadTask.task?.id || ''}
          taskName={receiptUploadTask.task?.task_name || ''}
          requestId={receiptUploadTask.id}
          requestStatus={receiptUploadTask.status}
          currentUserRole={loggedInUser?.role || 'Store'}
          currentUserName={loggedInUser?.username || 'Store'}
        />
      )}

      {/* 📜 Receipt History Modal */}
      {viewHistoryTask && (() => {
         const history = materialReceipts?.filter((r: any) => r.request_id === viewHistoryTask.id) || [];
         
         return (
           <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200" onClick={(e) => { if(e.target === e.currentTarget) setViewHistoryTask(null); }}>
             <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
               <div className="bg-slate-800 p-4 text-white flex justify-between items-center shrink-0">
                 <div>
                   <h3 className="font-bold text-lg">ประวัติการรับวัสดุ</h3>
                   <p className="text-xs text-slate-300">แปลง {viewHistoryTask.plot?.id} - {viewHistoryTask.task?.task_name}</p>
                 </div>
                 <button onClick={() => setViewHistoryTask(null)} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                   <XCircle size={20} />
                 </button>
               </div>
               <div className="p-5 flex-1 overflow-y-auto bg-slate-50/50">
                 {history.length === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                       <Clock size={40} className="mx-auto mb-3 opacity-50" />
                       <p className="font-bold">ยังไม่มีประวัติการรับของ</p>
                    </div>
                 ) : (
                    <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:ml-[1.25rem] md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-blue-500 before:via-blue-300 before:to-transparent">
                       {history.map((h: any, idx: number) => (
                          <div key={h.id} className="relative flex items-start justify-between gap-4">
                             <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 border-4 border-white shadow-sm shrink-0 z-10 text-blue-500">
                                <CheckCircle size={16} />
                             </div>
                             <div className="flex-1 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-2">
                                <div className="flex justify-between items-start mb-2">
                                   <span className="text-xs font-bold text-slate-500">{new Date(h.created_at).toLocaleString('th-TH')}</span>
                                   <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">โดย {h.received_by_role}</span>
                                </div>
                                {h.notes && <p className="text-sm text-slate-700 mb-3">{h.notes}</p>}
                                {h.image_url && (
                                   <div className="w-full h-32 rounded-lg overflow-hidden border border-slate-100 relative group cursor-pointer" onClick={() => setViewImageModalUrl(h.image_url)}>
                                      <img src={h.image_url} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                         <Search className="text-white opacity-0 group-hover:opacity-100" />
                                      </div>
                                   </div>
                                )}
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
               </div>
               <div className="p-4 bg-white border-t border-slate-100">
                 <button onClick={() => setViewHistoryTask(null)} className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors">ปิด</button>
               </div>
             </div>
           </div>
         );
      })()}

      {/* 🧾 PR Number Prompt Modal */}
      {prPromptTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-slate-100 flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 bg-indigo-50/50 flex items-center gap-3 text-indigo-700">
              <Package size={20} className="shrink-0" />
              <h2 className="font-black text-lg">ระบุหมายเลข PR</h2>
            </div>
            <div className="p-5">
              <label className="block text-sm font-bold text-slate-700 mb-2">
                หมายเลข Purchase Request (PR)
              </label>
              <input 
                type="text" 
                value={prNumberInput}
                onChange={(e) => setPrNumberInput(e.target.value)}
                autoFocus
                placeholder="เช่น PR-2023-001"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
              />
              <p className="text-xs text-slate-500 mt-2">
                * จำเป็นต้องระบุหมายเลข PR เพื่อยืนยันว่าได้ดำเนินการสั่งซื้อวัสดุแล้ว
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setPrPromptTask(null)}
                className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button 
                onClick={() => {
                  if (!prNumberInput.trim()) {
                    alert('กรุณาระบุหมายเลข PR');
                    return;
                  }
                  executeStatusUpdate(prPromptTask, 'ordered', prNumberInput.trim());
                  setPrPromptTask(null);
                }}
                className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-sm transition-all active:scale-95"
              >
                ยืนยันการสั่งซื้อ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
