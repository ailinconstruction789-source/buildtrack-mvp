import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Package, Truck, CheckCircle, Clock, 
  Search, Filter, AlertTriangle, Building, 
  Calendar, Check, User, Loader2, Camera, ImageIcon, XCircle
} from 'lucide-react';

interface MaterialStoreDashboardProps {
  view: string;
  materialRequests: any[];
  plots: any[];
  taskTemplates: any[];
  projects: any[];
  loggedInUser: any;
  setMaterialRequests?: any;
}

export default function MaterialStoreDashboard({
  view,
  materialRequests,
  plots,
  taskTemplates,
  projects,
  loggedInUser,
  setMaterialRequests
}: MaterialStoreDashboardProps) {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const [viewImageModalUrl, setViewImageModalUrl] = useState<string | null>(null);

  const handleUploadAndComplete = async (req: any, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(req.id);
    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const path = `${req.plot_id}/receipt-${req.id}-${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('task_images').upload(path, file);
      if (uploadError) throw uploadError;

      const imageUrl = supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl;

      const { error: dbError } = await supabase
        .from('task_material_requests')
        .update({
          status: 'received',
          image_url: imageUrl,
          updated_by: loggedInUser?.username || 'Store',
          updated_at: new Date().toISOString()
        })
        .eq('id', req.id);
        
      if (dbError) throw dbError;

      if (setMaterialRequests) {
        setMaterialRequests((prev: any) => 
          prev.map((r: any) => r.id === req.id ? { ...r, status: 'received', image_url: imageUrl, updated_by: loggedInUser?.username || 'Store', updated_at: new Date().toISOString() } : r)
        );
      } else {
        alert('ปรับสถานะและอัปโหลดรูปภาพสำเร็จ!');
      }

    } catch (error: any) {
      console.error('Error uploading material receipt:', error);
      alert('เกิดข้อผิดพลาดในการอัปโหลดรูป: ' + (error.message || JSON.stringify(error)));
    } finally {
      setUploadingImage(null);
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

  const handleUpdateStatus = async (reqId: string, newStatus: string) => {
    setIsProcessing(reqId);
    try {
      const { error } = await supabase
        .from('task_material_requests')
        .update({
          status: newStatus,
          updated_by: loggedInUser?.username || 'Store',
          updated_at: new Date().toISOString()
        })
        .eq('id', reqId);
        
      if (error) throw error;
      
      // Optimistic update
      if (setMaterialRequests) {
        setMaterialRequests((prev: any) => 
          prev.map((r: any) => r.id === reqId ? { ...r, status: newStatus, updated_by: loggedInUser?.username || 'Store', updated_at: new Date().toISOString() } : r)
        );
      } else {
        alert('ปรับสถานะสำเร็จ (โปรดรีเฟรชหากข้อมูลไม่เปลี่ยน)');
      }
    } catch (err: any) {
      console.error('Error updating material request:', err);
      alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(null);
    }
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
          {['all', 'requested', 'ordered', 'received'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`flex-1 sm:px-4 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                filterStatus === status 
                  ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {status === 'all' ? 'ทั้งหมด' : status === 'requested' ? 'รอสั่ง' : status === 'ordered' ? 'รอรับ' : 'รับแล้ว'}
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
                  <span className="flex items-center gap-1 text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-md uppercase tracking-wider">
                    <Calendar size={12}/> {new Date(req.requested_at).toLocaleDateString('th-TH')}
                  </span>
                </div>
                
                <div>
                  <h3 className="font-black text-lg sm:text-xl text-slate-800 mb-1">
                    งาน: {req.task?.task_name || 'ไม่ระบุงาน'}
                  </h3>
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
                {req.status === 'ordered' && (
                  <label className={`w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 px-4 rounded-xl shadow-sm text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer ${(isProcessing === req.id || uploadingImage === req.id) ? 'opacity-50 pointer-events-none' : ''}`}>
                    {(isProcessing === req.id || uploadingImage === req.id) ? <Loader2 className="animate-spin" size={18}/> : <Camera size={18}/>}
                    {uploadingImage === req.id ? 'อัปโหลด...' : 'ของเข้าแล้ว (ถ่ายรูป)'}
                    <input 
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => handleUploadAndComplete(req, e)}
                    />
                  </label>
                )}
                {req.status === 'received' && (
                  <div className="flex flex-col gap-2 w-full">
                    <div className="w-full bg-slate-100 text-slate-400 font-black py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 text-center">
                      <Check size={18}/> ดำเนินการเสร็จสิ้น
                    </div>
                    {req.image_url && (
                      <button onClick={() => setViewImageModalUrl(req.image_url)} className="w-full bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold py-2 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer">
                        <ImageIcon size={14}/> ดูรูปถ่ายของเข้า
                      </button>
                    )}
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
        <div onClick={() => setViewImageModalUrl(null)} className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center p-4 cursor-pointer">
          <button onClick={(e) => { e.stopPropagation(); setViewImageModalUrl(null); }} className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 p-2 rounded-full text-white backdrop-blur-sm transition-all cursor-pointer"><XCircle size={28}/></button>
          <img src={viewImageModalUrl} onClick={(e) => e.stopPropagation()} alt="Material View" className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-white/20 cursor-default"/>
        </div>
      )}
    </div>
  );
}
