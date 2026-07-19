import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { FileText, Loader2, CheckCircle, Clock, X, DollarSign, Activity, FileSpreadsheet, Search, Printer } from 'lucide-react';

interface BillingQueueViewProps {
  billingData: any[];
  setBillingData: (data: any[]) => void;
  loading: boolean;
  onRefresh: () => void;
  allUpdatesRecord: any[];
  showAlert?: (title: string, message: string) => void;
  showToast?: (message: string, type: 'success' | 'error') => void;
  currentUserRole: string;
  taskTemplates?: any[];
  onExportClick?: (item: any) => void;
}

const BillingQueueView = ({ billingData, setBillingData, loading, onRefresh, allUpdatesRecord, showAlert, showToast, currentUserRole, taskTemplates = [], onExportClick }: BillingQueueViewProps) => {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [billingRef, setBillingRef] = useState('');
  
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'billed'>('pending');
  const [searchPlotOrTask, setSearchPlotOrTask] = useState('');
  const [searchProject, setSearchProject] = useState('');
  const [searchContractor, setSearchContractor] = useState('');
  const [searchRef, setSearchRef] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // คัดกรองเฉพาะงานที่ผ่าน QC (หรือถ้าไม่ต้องตรวจ QC ก็ให้ถือว่าผ่านเมื่อ SE อนุมัติ)
  const filteredBillingData = billingData.filter(item => {
    const template = taskTemplates.find(t => t.id === item.task_template_id);
    const requireQC = template ? template.require_qc : true; // ถ้าไม่มีข้อมูลให้ถือว่าต้องมี QC ไปก่อน
    const action = item.latest_action || '';
    
    // เงื่อนไขการเข้าระบบ Billing Queue:
    if (requireQC) {
       return action.includes('QC อนุมัติ'); // เช่น QC อนุมัติ, QC อนุมัติผ่าน
    } else {
       return action.includes('Site Engineer อนุมัติ') || action.includes('QC อนุมัติ'); 
    }
  });

  // แยก Pending / Billed และตัดรอบวันที่ 4 ก.ค. 2026
  const CUTOFF_DATE = new Date('2026-07-04T00:00:00Z');

  const pendingItems = filteredBillingData.filter(item => {
    if (item.billing_status === 'billed') return false;
    const updateDate = new Date(item.latest_update_created_at);
    if (updateDate < CUTOFF_DATE) return false; // ถือว่าตั้งเบิกไปแล้ว
    return true;
  });

  const billedItems = filteredBillingData.filter(item => {
    if (item.billing_status === 'billed') return true;
    const updateDate = new Date(item.latest_update_created_at);
    if (updateDate < CUTOFF_DATE) return true; // วันที่เก่าให้ถือว่าเบิกแล้ว
    return false;
  });

  const totalPendingValue = pendingItems.reduce((sum, item) => sum + (Number(item.task_cost) || 0), 0);
  const totalBilledValue = billedItems.reduce((sum, item) => sum + (Number(item.task_cost) || 0), 0);

  const filteredPendingItems = pendingItems.filter(item => {
    const matchPlotOrTask = !searchPlotOrTask || (item.plot_id || '').toLowerCase().includes(searchPlotOrTask.toLowerCase()) || (item.task_name || '').toLowerCase().includes(searchPlotOrTask.toLowerCase());
    const matchProject = !searchProject || (item.project_name || '').toLowerCase().includes(searchProject.toLowerCase());
    const matchContractor = !searchContractor || (item.contractor_name || '').toLowerCase().includes(searchContractor.toLowerCase());
    return matchPlotOrTask && matchProject && matchContractor;
  });

  const filteredBilledItems = billedItems.filter(item => {
    const matchPlotOrTask = !searchPlotOrTask || (item.plot_id || '').toLowerCase().includes(searchPlotOrTask.toLowerCase()) || (item.task_name || '').toLowerCase().includes(searchPlotOrTask.toLowerCase());
    const matchProject = !searchProject || (item.project_name || '').toLowerCase().includes(searchProject.toLowerCase());
    const matchContractor = !searchContractor || (item.contractor_name || '').toLowerCase().includes(searchContractor.toLowerCase());
    const matchRef = !searchRef || (item.billing_ref || '').toLowerCase().includes(searchRef.toLowerCase());
    return matchPlotOrTask && matchProject && matchContractor && matchRef;
  });

  const totalPages = Math.ceil(filteredBilledItems.length / itemsPerPage);
  const currentBilledItems = filteredBilledItems.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleMarkAsBilled = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask || !billingRef.trim()) {
      showToast ? showToast('กรุณากรอกเลขที่เอกสาร', 'error') : alert('กรุณากรอกเลขที่เอกสาร');
      return;
    }

    setProcessingId(selectedTask.assignment_id);
    
    try {
      const { error } = await supabase
        .from('plot_task_assignments')
        .update({
          billing_status: 'billed',
          billed_at: new Date().toISOString(),
          billed_by: currentUserRole,
          billing_ref: billingRef.trim()
        })
        .eq('id', selectedTask.assignment_id);

      if (error) throw error;

      showToast ? showToast('บันทึกการตั้งเบิกเรียบร้อย', 'success') : alert('บันทึกสำเร็จ');
      setShowBillingModal(false);
      setBillingRef('');
      setSelectedTask(null);
      onRefresh(); // โหลดข้อมูลใหม่
    } catch (err: any) {
      console.error(err);
      showAlert ? showAlert('ข้อผิดพลาด', 'ไม่สามารถบันทึกได้: ' + err.message) : alert('Error: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-10">
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-[#1d1d1f] flex items-center gap-2">
            <FileSpreadsheet size={28} className="text-indigo-600" />
            คิวตั้งเบิก (Billing Queue)
          </h2>
          <p className="text-sm font-medium text-[#86868b] mt-1">
            รายการงานที่ตรวจสอบผ่าน 100% รอให้ Procurement นำไปตั้งเบิกจ่ายให้ผู้รับเหมา
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
         <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-[2rem] p-6 text-white shadow-lg relative overflow-hidden">
            <div className="relative z-10">
               <h3 className="text-indigo-100 font-bold mb-1">ยอดรอตั้งเบิก (Pending)</h3>
               <div className="text-4xl font-black">{totalPendingValue.toLocaleString('th-TH')} <span className="text-lg font-bold">บาท</span></div>
               <p className="text-indigo-200 text-sm mt-2 font-medium">{pendingItems.length} รายการที่รอการเบิกจ่าย</p>
            </div>
            <DollarSign size={100} className="absolute -right-6 -bottom-6 text-white opacity-10" />
         </div>
         <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-[2rem] p-6 text-white shadow-lg relative overflow-hidden">
            <div className="relative z-10">
               <h3 className="text-emerald-100 font-bold mb-1">ยอดตั้งเบิกแล้ว (Billed)</h3>
               <div className="text-4xl font-black">{totalBilledValue.toLocaleString('th-TH')} <span className="text-lg font-bold">บาท</span></div>
               <p className="text-emerald-200 text-sm mt-2 font-medium">{billedItems.length} รายการที่ตั้งเบิกไปแล้ว</p>
            </div>
            <CheckCircle size={100} className="absolute -right-6 -bottom-6 text-white opacity-10" />
         </div>
      </div>

      <div className="flex gap-6 mb-6 border-b border-black/10">
         <button 
           onClick={() => { setActiveTab('pending'); }}
           className={`font-bold pb-3 border-b-[3px] transition-colors flex items-center gap-2 ${activeTab === 'pending' ? 'text-indigo-600 border-indigo-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
         >
           รอตั้งเบิก <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-[10px]">{pendingItems.length}</span>
         </button>
         <button 
           onClick={() => { setActiveTab('billed'); setCurrentPage(1); }}
           className={`font-bold pb-3 border-b-[3px] transition-colors flex items-center gap-2 ${activeTab === 'billed' ? 'text-emerald-600 border-emerald-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
         >
           ประวัติการตั้งเบิก <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px]">{billedItems.length}</span>
         </button>
      </div>

      <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-black/5 overflow-hidden">
          <div className="p-4 border-b border-black/5 bg-slate-50 flex flex-wrap gap-4 items-end">
             <div className="flex-1 min-w-[150px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">แปลง / ชื่องาน</label>
                <input 
                  type="text"
                  placeholder="ค้นหา..."
                  value={searchPlotOrTask}
                  onChange={(e) => { setSearchPlotOrTask(e.target.value); setCurrentPage(1); }}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
             </div>
             <div className="flex-1 min-w-[150px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">โครงการ</label>
                <input 
                  type="text"
                  placeholder="ค้นหา..."
                  value={searchProject}
                  onChange={(e) => { setSearchProject(e.target.value); setCurrentPage(1); }}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
             </div>
             <div className="flex-1 min-w-[150px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">ผู้รับเหมา</label>
                <input 
                  type="text"
                  placeholder="ค้นหา..."
                  value={searchContractor}
                  onChange={(e) => { setSearchContractor(e.target.value); setCurrentPage(1); }}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
             </div>
             {activeTab === 'billed' && (
               <div className="flex-1 min-w-[150px]">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">เลขที่เอกสาร</label>
                  <input 
                    type="text"
                    placeholder="ค้นหา..."
                    value={searchRef}
                    onChange={(e) => { setSearchRef(e.target.value); setCurrentPage(1); }}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
               </div>
             )}
             <button 
                onClick={() => {
                  setSearchPlotOrTask('');
                  setSearchProject('');
                  setSearchContractor('');
                  setSearchRef('');
                  setCurrentPage(1);
                }}
                className="px-4 py-1.5 text-xs font-bold text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors"
             >
                ล้าง
             </button>
          </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-[#f5f5f7] border-b border-black/5 text-xs uppercase font-bold text-[#86868b]">
              <tr>
                <th className="p-4 pl-6">แปลง / ชื่องาน</th>
                <th className="p-4">ผู้รับเหมา</th>
                <th className="p-4 text-right">มูลค่างาน</th>
                <th className="p-4 text-center">สถานะการตรวจ</th>
                <th className="p-4 text-center">สถานะเบิก</th>
                <th className="p-4 text-center pr-6">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {loading ? (
                Array.from({length: 5}).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-4 pl-6"><div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div><div className="h-3 bg-slate-200 rounded w-1/2"></div></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-full"></div></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 rounded w-full"></div></td>
                    <td className="p-4"><div className="h-6 bg-slate-200 rounded-full w-24 mx-auto"></div></td>
                    <td className="p-4"><div className="h-6 bg-slate-200 rounded-full w-20 mx-auto"></div></td>
                    <td className="p-4"><div className="h-8 bg-slate-200 rounded-lg w-full"></div></td>
                  </tr>
                ))
              ) : activeTab === 'pending' ? (
                 filteredPendingItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-slate-400">
                      <Search size={48} className="mx-auto mb-3 opacity-20" />
                      <p className="font-bold text-lg">ไม่พบรายการที่ค้นหา</p>
                    </td>
                  </tr>
                 ) : (
                  <>
                    {filteredPendingItems.map((item) => (
                    <tr key={item.assignment_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 pl-6">
                        <div className="font-bold text-slate-800 text-sm">{item.plot_id} - {item.task_name}</div>
                        <div className="text-[10px] font-bold text-slate-500 mt-1">โครงการ: {item.project_name}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-blue-700 text-sm">{item.contractor_name || 'ไม่ระบุ'}</div>
                        {item.contractor_phone && <div className="text-[10px] text-slate-400 font-medium">📞 {item.contractor_phone}</div>}
                      </td>
                      <td className="p-4 text-right">
                        <div className="font-bold text-indigo-600 text-sm">{(Number(item.task_cost) || 0).toLocaleString('th-TH')} ฿</div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg text-[10px] font-bold">
                          ✅ {item.latest_action || 'อนุมัติแล้ว'}
                        </span>
                        <div className="text-[9px] text-slate-400 font-medium mt-1">
                          {item.latest_update_created_at ? new Date(item.latest_update_created_at).toLocaleDateString('th-TH') : ''}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-lg text-[10px] font-bold">
                          <Clock size={10} /> รอตั้งเบิก
                        </span>
                      </td>
                      <td className="p-4 pr-6">
                        <div className="flex gap-2 justify-center">
                          <button 
                            onClick={() => { setSelectedTask(item); setShowHistoryModal(true); }}
                            className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors font-bold text-xs flex items-center gap-1"
                            title="ดูประวัติการตรวจ"
                          >
                            <Activity size={14} /> ประวัติ
                          </button>
                          {onExportClick && (
                            <button 
                              onClick={() => onExportClick(item)}
                              className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors font-bold text-xs flex items-center gap-1"
                              title="ส่งออกรูปถ่ายตั้งเบิก"
                            >
                              <Printer size={14} /> พิมพ์
                            </button>
                          )}
                          <button 
                            onClick={() => { setSelectedTask(item); setShowBillingModal(true); }}
                            className="px-3 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm transition-colors font-bold text-xs flex items-center gap-1 active:scale-95"
                          >
                            <FileText size={14} /> ตั้งเบิกแล้ว
                          </button>
                        </div>
                      </td>
                    </tr>
                    ))}
                  </>
                 )
              ) : (
                 filteredBilledItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-slate-400">
                      <Search size={48} className="mx-auto mb-3 opacity-20" />
                      <p className="font-bold text-lg">ไม่พบประวัติการตั้งเบิกที่ค้นหา</p>
                    </td>
                  </tr>
                 ) : (
                  <>
                    {currentBilledItems.map((item) => (
                      <tr key={item.assignment_id} className="bg-slate-50/50 hover:bg-slate-100 transition-colors">
                        <td className="p-4 pl-6">
                          <div className="font-bold text-slate-800 text-sm line-through decoration-slate-300">{item.plot_id} - {item.task_name}</div>
                          <div className="text-[10px] font-bold text-slate-500 mt-1">โครงการ: {item.project_name}</div>
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-700 text-sm">{item.contractor_name || 'ไม่ระบุ'}</div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="font-bold text-slate-600 text-sm">{(Number(item.task_cost) || 0).toLocaleString('th-TH')} ฿</div>
                        </td>
                        <td className="p-4 text-center">
                          <span className="text-[10px] font-bold text-slate-400">✅ อนุมัติแล้ว</span>
                        </td>
                        <td className="p-4 text-center">
                          <span className="inline-flex flex-col items-center gap-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg text-[10px] font-bold w-full max-w-[120px] mx-auto">
                            <span className="flex items-center gap-1"><CheckCircle size={10} /> ตั้งเบิกแล้ว</span>
                            {item.billing_ref && <span className="text-[9px] bg-white/60 px-1 rounded truncate w-full">Ref: {item.billing_ref}</span>}
                          </span>
                        </td>
                        <td className="p-4 pr-6 text-center">
                           <span className="text-[9px] font-bold text-slate-400 block mb-1.5">
                             โดย: {item.billed_by}
                           </span>
                           <span className="text-[9px] font-bold text-slate-400 block mb-2">
                             {item.billed_at ? new Date(item.billed_at).toLocaleDateString('th-TH') : ''}
                           </span>
                           <button 
                             onClick={() => { setSelectedTask(item); setShowHistoryModal(true); }}
                             className="w-full py-1 mb-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded transition-colors font-bold text-[10px] flex items-center justify-center gap-1"
                             title="ดูประวัติการตรวจ"
                           >
                             <Activity size={10} /> ประวัติ
                           </button>
                           {onExportClick && (
                              <button 
                                onClick={() => onExportClick(item)}
                                className="w-full py-1 bg-slate-200 text-slate-600 hover:bg-blue-100 hover:text-blue-700 rounded transition-colors font-bold text-[10px] flex items-center justify-center gap-1"
                                title="พิมพ์ใบตั้งเบิกซ้ำ"
                              >
                                <Printer size={10} /> พิมพ์ซ้ำ
                              </button>
                           )}
                        </td>
                      </tr>
                    ))}
                  </>
                 )
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {activeTab === 'billed' && totalPages > 1 && (
          <div className="p-4 border-t border-black/5 bg-white flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              แสดง {(currentPage - 1) * itemsPerPage + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredBilledItems.length)} จากทั้งหมด {filteredBilledItems.length} รายการ
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-50 transition-colors"
              >
                ก่อนหน้า
              </button>
              
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = currentPage;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-bold flex items-center justify-center transition-colors ${currentPage === pageNum ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:bg-slate-50 hover:bg-slate-50 transition-colors"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal ยืนยันการตั้งเบิก */}
      {showBillingModal && selectedTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden flex flex-col scale-in-center">
            <div className="p-6">
               <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-black text-xl text-[#1d1d1f]">ยืนยันการตั้งเบิก</h3>
                    <p className="text-sm font-medium text-slate-500 mt-1">แปลง {selectedTask.plot_id} - {selectedTask.task_name}</p>
                  </div>
                  <button onClick={() => { setShowBillingModal(false); setBillingRef(''); }} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition-colors">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-5 flex justify-between items-center">
                  <span className="text-indigo-800 font-bold text-sm">มูลค่างาน:</span>
                  <span className="text-indigo-600 font-black text-lg">{(Number(selectedTask.task_cost) || 0).toLocaleString('th-TH')} บาท</span>
               </div>

               <form onSubmit={handleMarkAsBilled}>
                 <div className="mb-5">
                   <label className="block text-sm font-bold text-[#1d1d1f] mb-2">เลขที่เอกสาร (Invoice / PR / ฯลฯ) <span className="text-rose-500">*</span></label>
                   <input 
                     type="text" 
                     required
                     placeholder="กรอกเลขที่เอกสารอ้างอิง..."
                     value={billingRef}
                     onChange={(e) => setBillingRef(e.target.value)}
                     className="w-full px-4 py-3 bg-[#f5f5f7] border-none rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none font-medium"
                     autoFocus
                   />
                 </div>
                 
                 <div className="flex gap-3">
                   <button 
                     type="button" 
                     onClick={() => { setShowBillingModal(false); setBillingRef(''); }}
                     className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
                   >
                     ยกเลิก
                   </button>
                   <button 
                     type="submit" 
                     disabled={!billingRef.trim() || processingId === selectedTask.assignment_id}
                     className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-sm flex justify-center items-center gap-2 disabled:opacity-50"
                   >
                     {processingId === selectedTask.assignment_id ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                     บันทึกการตั้งเบิก
                   </button>
                 </div>
               </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal ประวัติการส่งงาน */}
      {showHistoryModal && selectedTask && (() => {
        const history = allUpdatesRecord.filter(u => String(u.plot_id) === String(selectedTask.plot_id) && String(u.task_template_id) === String(selectedTask.task_template_id))
                                        .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200" onClick={(e) => { if(e.target === e.currentTarget) setShowHistoryModal(false); }}>
            <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
              <div className="p-5 border-b border-black/5 flex justify-between items-center bg-slate-50">
                 <div>
                   <h3 className="font-black text-lg text-[#1d1d1f]">ประวัติการส่งงาน</h3>
                   <p className="text-xs font-bold text-slate-500 mt-0.5">แปลง {selectedTask.plot_id} - {selectedTask.task_name}</p>
                 </div>
                 <button onClick={() => setShowHistoryModal(false)} className="p-2 bg-white hover:bg-slate-200 text-slate-500 rounded-full transition-colors border shadow-sm">
                    <X size={20} />
                 </button>
              </div>
              
              <div className="p-5 overflow-y-auto bg-white flex-1">
                {history.length === 0 ? (
                   <div className="text-center py-10 text-slate-400">
                     <Activity size={40} className="mx-auto mb-3 opacity-20" />
                     <p className="font-bold">ไม่พบประวัติการอัปเดต</p>
                   </div>
                ) : (
                   <div className="space-y-4">
                     {history.map((upd, idx) => (
                       <div key={idx} className="flex gap-4 relative">
                          {idx !== history.length - 1 && <div className="absolute top-8 bottom-[-16px] left-[15px] w-0.5 bg-slate-200"></div>}
                          
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 shadow-sm border
                             ${upd.progress === 100 ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-blue-100 border-blue-200 text-blue-600'}
                          `}>
                             <span className="text-[10px] font-black">{upd.progress}%</span>
                          </div>
                          
                          <div className="flex-1 bg-slate-50 border border-slate-100 p-3 rounded-xl">
                             <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-sm text-[#1d1d1f]">{upd.action || 'อัปเดตความคืบหน้า'}</span>
                                <span className="text-[10px] font-bold text-slate-400">{new Date(upd.created_at).toLocaleDateString('th-TH', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span>
                             </div>
                             <div className="text-xs font-medium text-slate-600 mt-1">
                                ทำรายการโดย: <span className="font-bold">{upd.role}</span>
                             </div>
                             {upd.note && (
                                <div className="mt-2 text-xs text-slate-700 bg-white p-2 rounded border border-slate-100">
                                   <span className="font-bold text-slate-400 block mb-0.5">หมายเหตุ:</span>
                                   {upd.note}
                                </div>
                             )}
                          </div>
                       </div>
                     ))}
                   </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default BillingQueueView;
