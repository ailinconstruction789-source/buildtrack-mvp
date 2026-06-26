
import React from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Activity, Calendar, Camera, HardHat, Loader2, Monitor, Pickaxe, PlusCircle, UserCog, Users, ImageIcon, Truck, XCircle, Send, Clock, CheckCircle, ShieldAlert, Search
} from 'lucide-react';
import HouseHandoverView from './HouseHandoverView';

interface HouseDetailViewProps {
  view: string;
  setView: (v: string) => void;
  selectedPlot: any;
  selectedProject: any;
  isMobileLayout: boolean;
  plotPlanStart: number;
  plotPlanEnd: number;
  daysElapsed: number;
  totalPlannedDays: number;
  daysRemaining: number;
  isSummaryDelayed: boolean;
  isProjectPlanner: boolean;
  setCopyModalOpen: (b: boolean) => void;
  handleSaveAllSchedules: () => void;
  isSubmitting: boolean;
  houseTypes: any[];
  taskTemplates: any[];
  getTaskStatus: (planEnd: any, actualEnd: any, progress: number) => any;
  latestUpdatesMap: any;
  schedules: any;
  scheduleInputs: any;
  isUploadingLayer: boolean;
  setSelectedTask: (t: any) => void;
  setDefectModal: (o: any) => void;
  setTaskReturnView: (v: string) => void;
  setAssignModal: (o: any) => void;
  simulatedStatus: any;
  editingHouseType: any;
  currentUserRole: string;
  totalChartDays: number;
  timeMarkers: any[];
  todayTs: number;
  chartStart: number;
  chartEnd: number;
  getChartLeft: (ts: number) => number;
  getChartWidth: (s: number, e: number) => number;
  assignments: any[];
  taskDates: any;
  setUpdates: (u: any[]) => void;
  setProgressValue: (v: number) => void;
  isAdmin: boolean;
  isProcurement: boolean;
  setScheduleInputs: (v: any) => void;
  allUpdatesRecord: any[];
  handleTogglePlotCustomer: (plotId: any, currentStatus: boolean) => void;
  handleTogglePlotCompleted: (plotId: any, currentStatus: boolean, actualProgress: number, hasCustomer: boolean) => void;
  getPlotOverallStatus: (plotId: any) => any;
  handleUploadOverviewImage: (file: File) => Promise<void>;
  togglePlotSaleStatus: (plotId: any, currentStatus: string, pausedAt: string | null) => Promise<boolean>;
  loading?: boolean;
  materialRequests?: any[];
  fetchAllData?: () => void;
  resetHandoverCycle?: (plotId: string, currentCycle: number) => Promise<boolean>;
  updateInspectionRound?: (plotId: string, newRound: number) => Promise<boolean>;
  defects?: any[];
  setDefects?: (d: any[]) => void;
}

const HouseDetailView = function HouseDetailView(props: HouseDetailViewProps) {
  const {
    view, setView, selectedPlot, selectedProject, isMobileLayout,
    plotPlanStart, plotPlanEnd, daysElapsed, totalPlannedDays, daysRemaining,
    isSummaryDelayed, isProjectPlanner, setCopyModalOpen, handleSaveAllSchedules,
    isSubmitting, houseTypes, taskTemplates, getTaskStatus, latestUpdatesMap,
    schedules, scheduleInputs, 
    isUploadingLayer, setSelectedTask, setDefectModal,
    setTaskReturnView, setAssignModal,
    simulatedStatus, editingHouseType, currentUserRole,
    totalChartDays, timeMarkers, todayTs, chartStart, chartEnd,
    getChartLeft, getChartWidth, assignments, taskDates,
    setUpdates, setProgressValue, isAdmin, isProcurement,
    setScheduleInputs, allUpdatesRecord,
    handleTogglePlotCustomer, handleTogglePlotCompleted, getPlotOverallStatus,
    handleUploadOverviewImage, togglePlotSaleStatus,
    materialRequests, fetchAllData,
    resetHandoverCycle, updateInspectionRound,
    defects, setDefects
  } = props;

  const currentPlotStatus = selectedPlot ? getPlotOverallStatus(selectedPlot.id) : null;

  const [requestMaterialNote, setRequestMaterialNote] = React.useState('');
  const [requestMaterialTask, setRequestMaterialTask] = React.useState<any>(null);
  const [isSubmittingMaterial, setIsSubmittingMaterial] = React.useState(false);
  const [viewImageModalUrl, setViewImageModalUrl] = React.useState<string | null>(null);
  const [activeHouseTab, setActiveHouseTab] = React.useState('construction');
  const [taskSearchQuery, setTaskSearchQuery] = React.useState('');

  // 🌟 Scroll Position Memory for Task Table 🌟
  const tableScrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (selectedPlot?.id && tableScrollRef.current) {
      const savedScroll = sessionStorage.getItem(`houseTableScroll-${selectedPlot.id}`);
      if (savedScroll) {
        tableScrollRef.current.scrollTop = parseInt(savedScroll, 10);
      }
    }
  }, [selectedPlot?.id]);

  const handleTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (selectedPlot?.id) {
      sessionStorage.setItem(`houseTableScroll-${selectedPlot.id}`, e.currentTarget.scrollTop.toString());
    }
  };

  const handleRequestMaterial = async () => {
    if (!requestMaterialTask || !selectedPlot) return;
    setIsSubmittingMaterial(true);
    try {
      const { error } = await supabase.from('task_material_requests').insert([{
        plot_id: selectedPlot.id,
        task_template_id: requestMaterialTask.id,
        notes: requestMaterialNote,
        requested_by: currentUserRole,
        status: 'requested'
      }]);
      if (error) throw error;
      if (fetchAllData) await fetchAllData();
      setRequestMaterialTask(null);
      setRequestMaterialNote('');
      alert('บันทึกคำขอเบิกวัสดุเรียบร้อยแล้ว');
    } catch (e: any) {
      alert('เกิดข้อผิดพลาด: ' + e.message);
    } finally {
      setIsSubmittingMaterial(false);
    }
  };

  return (
    <>
      {/* 🛑 Material Request Modal */}
      {requestMaterialTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg">เบิกวัสดุสำหรับงาน</h3>
                <p className="text-xs text-slate-300">{requestMaterialTask.task_name}</p>
              </div>
              <button onClick={() => setRequestMaterialTask(null)} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto">
              <label className="block text-sm font-bold text-slate-700 mb-2">รายละเอียดเพิ่มเติม (Optional)</label>
              <textarea 
                value={requestMaterialNote}
                onChange={(e) => setRequestMaterialNote(e.target.value)}
                placeholder="ระบุชื่อวัสดุ จำนวน หรือหมายเหตุอื่นๆ ที่สโตร์ควรรู้..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:border-blue-500 outline-none h-32 resize-none"
              ></textarea>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setRequestMaterialTask(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">ยกเลิก</button>
              <button 
                onClick={handleRequestMaterial} 
                disabled={isSubmittingMaterial}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors flex justify-center items-center gap-2"
              >
                {isSubmittingMaterial ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} ส่งคำขอเบิก
              </button>
            </div>
          </div>
        </div>
      )}

{/* 📋 LEVEL 3: House Detail */}
               {view === 'house-detail' && selectedPlot && (
                 <div className="animate-in slide-in-from-right duration-300">
                   {/* 📸 Overview Image Section */}
                   
                   {/* 📸 Overview Image Section */}
                   {selectedPlot.overview_image_url ? (
                     <div className="mb-6 relative w-full h-48 sm:h-72 rounded-xl overflow-hidden shadow-lg group border border-slate-200">
                       <img src={selectedPlot.overview_image_url} alt="Overview" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                       <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                       <label className="absolute bottom-3 right-3 bg-white/90 hover:bg-white text-slate-800 p-2 sm:px-4 sm:py-2 rounded-full sm:rounded-lg cursor-pointer backdrop-blur-sm transition-all shadow-[0_4px_15px_rgba(0,0,0,0.2)] flex items-center gap-2 text-xs font-bold hover:scale-105">
                          <Camera size={16}/> <span className="hidden sm:inline">เปลี่ยนภาพหน้างาน</span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { if(e.target.files?.[0]) handleUploadOverviewImage(e.target.files[0]) }} />
                       </label>
                     </div>
                   ) : (
                     <div className="mb-6 w-full h-32 sm:h-48 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-slate-500 hover:bg-blue-50 hover:border-blue-400 transition-all shadow-inner group">
                       <ImageIcon size={32} className="mb-2 opacity-40 group-hover:opacity-60 transition-opacity group-hover:text-blue-500" />
                       <p className="text-xs sm:text-sm font-bold mb-3">ยังไม่มีภาพรวมหน้างาน</p>
                       <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg cursor-pointer transition-all shadow-md text-xs font-bold flex items-center gap-2 hover:shadow-lg hover:-translate-y-0.5">
                          <Camera size={16}/> อัปโหลดภาพ
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { if(e.target.files?.[0]) handleUploadOverviewImage(e.target.files[0]) }} />
                       </label>
                     </div>
                   )}

               {/* 💬 LEVEL 4: Task Progress (ฉบับปรับปรุงฟอนต์ขนาดเท่าชื่องาน) */}
                <div className="bg-slate-800 rounded-xl border-b-4 border-b-rose-600 shadow-lg p-3 text-white">
                  
                  {/* ส่วน Header รวม: ชื่อแปลง + ข้อมูล (บรรทัดเดียว) */}
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    
                    {/* ส่วนซ้าย: ชื่อแปลง (ปรับให้ฟอนต์ชื่อแปลงเด่นกว่าข้อมูลเล็กน้อยตามหลัก Hierarchy) */}
                    <div className="flex-shrink-0 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                           <h2 className="text-xl font-bold italic tracking-tighter">{selectedPlot.id}</h2>
                           {/* 🌟 ป้ายสถานะสำหรับบ้านเสร็จ และมีลูกค้า 🌟 */}
                           {selectedPlot.is_completed && currentPlotStatus?.actual === 100 && <span className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm" title="สร้างเสร็จพร้อมโอน">🔑</span>}
                           {selectedPlot.is_completed && currentPlotStatus?.actual < 100 && <span className="bg-purple-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm" title="โอนแล้วแต่ยังเก็บงานไม่เสร็จ">🔑 โอนแล้ว-รอเก็บงาน</span>}
                           {selectedPlot.has_customer && <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm" title="มีลูกค้าจองแล้ว">👤</span>}
                        </div>
                        <p className="text-slate-400 font-bold uppercase text-[9px] italic">{selectedPlot.foreman || 'ไม่ระบุ'}</p>
                    </div>

                    {/* ส่วนกลาง: ข้อมูล 4 ตัว (ปรับฟอนต์ให้เท่าขนาดชื่องานคือ text-xs) */}
                    <div className="flex items-center gap-5 border-l border-slate-600 pl-5">
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">เวลา</span>
                          <span className="font-bold">{plotPlanStart !== Infinity ? `${new Date(plotPlanStart).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}-${new Date(plotPlanEnd).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}` : '-'}</span>
                          <span className="text-rose-400 block font-bold text-[9px]">รวม {plotPlanStart !== Infinity ? Math.max(0, Math.ceil((plotPlanEnd - plotPlanStart) / (1000 * 60 * 60 * 24)) + 1) : 0} วัน</span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">ผ่าน</span>
                          <span className="text-blue-300 font-bold">{plotPlanStart !== Infinity ? Math.min(daysElapsed, totalPlannedDays) : '-'} <span className="font-bold text-[10px]">วัน</span></span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">เหลือ</span>
                          <span className="text-emerald-300 font-bold">{plotPlanEnd !== -Infinity ? Math.max(0, daysRemaining) : '-'} <span className="font-bold text-[10px]">วัน</span></span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">สถานะ</span>
                          {plotPlanStart === Infinity ? <span className="text-slate-400">รอแผน</span> :
                            isSummaryDelayed ? <span className="text-rose-500 font-bold">ล่าช้า</span> : 
                            selectedPlot?.progress === 100 ? <span className="text-emerald-500 font-bold">เสร็จ</span> :
                            <span className="text-blue-500 font-bold">กำลังทำ</span>}
                        </div>
                    </div>

                    {/* ส่วนขวา: ปุ่มจัดการ */}
                    <div className="flex flex-col sm:flex-row gap-2 ml-auto items-end sm:items-center">
                      {(isAdmin || isProjectPlanner) && (
                        <div className="flex gap-1.5">
                          <button 
                            onClick={() => handleTogglePlotCustomer(selectedPlot.id, selectedPlot.has_customer)} 
                            className={`px-2.5 py-1.5 rounded text-[10px] sm:text-xs font-bold border transition-all flex items-center gap-1 shadow-sm ${selectedPlot.has_customer ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                          >
                            <UserCog size={14} /> {selectedPlot.has_customer ? 'จองแล้ว' : 'ระบุลูกค้า'}
                          </button>
                          <button 
                            onClick={() => {
                              handleTogglePlotCompleted(selectedPlot.id, selectedPlot.is_completed, currentPlotStatus.actual, selectedPlot.has_customer);
                            }} 
                            disabled={!selectedPlot.has_customer && !selectedPlot.is_completed}
                            title={!selectedPlot.has_customer && !selectedPlot.is_completed ? "ต้องระบุลูกค้าก่อนถึงจะโอนได้" : ""}
                            className={`px-2.5 py-1.5 rounded text-[10px] sm:text-xs font-bold border transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${selectedPlot.is_completed ? 'bg-emerald-600 border-emerald-500 text-white shadow-[0_0_10px_rgba(5,150,105,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-emerald-900/50 hover:text-emerald-400 hover:border-emerald-700'}`}
                          >
                            🔑 {selectedPlot.is_completed ? (currentPlotStatus?.actual < 100 ? 'โอนแล้ว-รอเก็บงาน' : 'เสร็จสมบูรณ์') : 'พร้อมโอน'}
                          </button>
                          
                          {/* 🌟 New Button for "Ready for Sale" Toggle 🌟 */}
                          <button 
                            onClick={() => togglePlotSaleStatus(selectedPlot.id, selectedPlot.sale_status, selectedPlot.paused_for_sale_at)} 
                            disabled={selectedPlot.sale_status !== 'ready_for_sale' && currentPlotStatus?.actual < 85}
                            title={selectedPlot.sale_status !== 'ready_for_sale' && currentPlotStatus?.actual < 85 ? "ความคืบหน้าต้องถึง 85% ถึงจะตั้งเป็นบ้านพร้อมขายได้" : ""}
                            className={`px-2.5 py-1.5 rounded text-[10px] sm:text-xs font-bold border transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${selectedPlot.sale_status === 'ready_for_sale' ? 'bg-amber-500 border-amber-400 text-white shadow-[0_0_10px_rgba(245,158,11,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-amber-900/50 hover:text-amber-400 hover:border-amber-700'}`}
                          >
                            {selectedPlot.sale_status === 'ready_for_sale' ? '✨ เริ่มงานตกแต่ง (ลูกค้ายืนยัน)' : '🏠 บ้านพร้อมขาย (หยุดเวลา)'}
                          </button>
                        </div>
                      )}
                      
                      {(isProjectPlanner || currentUserRole === 'Site Engineer') && (
                        <div className="flex gap-1">
                          {isProjectPlanner && <button onClick={() => setCopyModalOpen(true)} className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-[10px] hover:bg-slate-600 border border-slate-600 font-bold">คัดลอก</button>}
                          <button onClick={handleSaveAllSchedules} disabled={isSubmitting} className="bg-rose-600 text-white px-2 py-1 rounded text-[10px] hover:bg-rose-700 font-bold flex items-center justify-center gap-1 min-w-[50px] disabled:opacity-70 disabled:cursor-not-allowed">
                             {isSubmitting ? <Loader2 className="animate-spin" size={12}/> : null}
                             {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกแผน'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                     {/* 🌟 โซน 2.5D Task-Linked Visual Progress (แสดงผลตามสถานะงานจริง) 🌟 */}
                     {houseTypes.find(t => t.id === selectedPlot?.house_type_id)?.visual_config && (
                         <div className="bg-slate-900 border-b-8 border-slate-950 p-6 sm:p-10 flex flex-col lg:flex-row items-center gap-8 relative overflow-hidden">
                            <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-64 h-64 bg-blue-500/20 blur-[100px] rounded-full pointer-events-none"></div>

                            {/* 🏗️ ฝั่งซ้าย: รูปภาพซ้อนเลเยอร์ตามค่าความคืบหน้าจริงของงานย่อย */}
                            <div className="relative w-full lg:w-1/2 aspect-[4/3] sm:aspect-[16/9] lg:aspect-square max-w-[500px] flex items-center justify-center bg-slate-950/40 p-2 rounded-2xl border border-slate-800">
                               {(() => {
                                  // 🧠 แกะลอจิกตรวจสอบสถานะเรียงตาม Z-Index
                                  const config = houseTypes.find(t => t.id === selectedPlot?.house_type_id).visual_config || {};
                                  const activeLayers: any[] = [];

                                  taskTemplates
                                     .filter(t => t.house_type_id === selectedPlot?.house_type_id)
                                     .forEach(task => {
                                        const taskConfig = config[task.id];
                                        if (!taskConfig) return; // งานนี้ไม่มีรูปข้ามไปเลย

                                        // ดึงเปอร์เซ็นต์ความคืบหน้าจริงของงานนี้จากแอป
                                        const actualProgress = latestUpdatesMap[`${selectedPlot.id}-${task.id}`]?.progress || 0;

                                        if (actualProgress === 100 && taskConfig.done_image) {
                                           activeLayers.push({ url: taskConfig.done_image, z: Number(taskConfig.done_z || 10), name: task.task_name });
                                        } else if (actualProgress > 0 && actualProgress < 100 && taskConfig.progress_image) {
                                           activeLayers.push({ url: taskConfig.progress_image, z: Number(taskConfig.progress_z || 10), name: task.task_name });
                                        }
                                     });

                                  // จัดลำดับเลเยอร์ภาพเพื่อป้องกันรูปเพี้ยน
                                  return activeLayers
                                     .sort((a, b) => a.z - b.z)
                                     .map((layer, idx) => (
                                        <img 
                                           key={idx}
                                           src={layer.url} 
                                           className="absolute inset-0 w-full h-full object-contain drop-shadow-2xl animate-fade-in" 
                                           style={{ zIndex: layer.z }}
                                           alt={layer.name} 
                                        />
                                     ));
                               })()}
                            </div>

                            {/* 📊 ฝั่งขวา: สรุปรายงานการประกอบร่างดิจิทัล */}
                            <div className="w-full lg:w-1/2 text-white space-y-4 relative z-10">
                               <div>
                                  <h3 className="text-2xl sm:text-3xl font-bold italic tracking-tighter mb-1 flex items-center gap-2">
                                     <Monitor className="text-blue-500" size={24}/> 2.5D DIGITAL TWIN
                                  </h3>
                                  <p className="text-slate-400 font-bold text-xs tracking-widest uppercase">แบบบ้าน: {selectedPlot?.type} (ประมวลผลรายงวดงานจริง)</p>
                               </div>

                               <div className="text-xs bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-slate-400 font-medium leading-relaxed">
                                  <p>💡 ระบบจะคำนวณการแสดงผลภาพแบบแยกตามงวดงานจริงหน้าไซต์:</p>
                                  <ul className="list-disc list-inside mt-2 space-y-1 text-slate-300">
                                     <li>งวดงานสถานะ <span className="text-amber-400 font-bold">กำลังดำเนินการ (1-99%)</span> จะดึงภาพเลเยอร์โครงสร้างชั่วคราว</li>
                                     <li>งวดงานสถานะ <span className="text-emerald-400 font-bold">เสร็จสมบูรณ์ (100%)</span> จะดึงภาพสำเร็จมาประกอบร่างทับซ้อนตามลำดับเลเยอร์</li>
                                  </ul>
                               </div>
                            </div>
                         </div>
                     )}            
                     {/* Tabs for Construction vs Handover */}
                     <div className="flex bg-white border-b border-slate-200 mt-4 rounded-t-xl overflow-hidden">
                       <button 
                         onClick={() => setActiveHouseTab('construction')} 
                         className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeHouseTab === 'construction' ? 'text-blue-600 border-b-4 border-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50 border-b-4 border-transparent'}`}
                       >
                         <HardHat size={18} /> งานก่อสร้าง (Construction)
                       </button>
                       <button 
                         onClick={() => setActiveHouseTab('handover')} 
                         className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeHouseTab === 'handover' ? 'text-purple-600 border-b-4 border-purple-600 bg-purple-50' : 'text-slate-500 hover:bg-slate-50 border-b-4 border-transparent'}`}
                       >
                         <ShieldAlert size={18} /> ตรวจรับบ้าน (Handover)
                       </button>
                     </div>

                     {activeHouseTab === 'construction' && (
                     <div className="bg-[#f5f5f7] w-full border-t border-black/5 flex flex-col">
                       {/* 🔍 Search Bar */}
                       <div className="p-3 border-b border-black/5 bg-white shrink-0">
                         <div className="relative">
                           <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                             <Search size={16} className="text-slate-400" />
                           </div>
                           <input
                             type="text"
                             className="block w-full pl-10 pr-3 py-2 sm:py-2.5 border border-slate-200 rounded-xl leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
                             placeholder="ค้นหางานก่อสร้าง (เช่น โครงสร้าง, หลังคา, กระเบื้อง)..."
                             value={taskSearchQuery}
                             onChange={(e) => setTaskSearchQuery(e.target.value)}
                           />
                         </div>
                       </div>
                       
                       <div 
                         ref={tableScrollRef}
                         onScroll={handleTableScroll}
                         className="overflow-x-auto custom-scrollbar flex-1" 
                         style={{ maxHeight: '800px', overflowY: 'auto' }}
                       >
                       {isMobileLayout && <div className="text-center text-[10px] text-slate-400 font-bold py-2 bg-[#f5f5f7] border-b border-black/5">↔️ ปัดซ้าย-ขวา เพื่อดูตาราง ↔️</div>}
                         <table className={`text-left border-collapse w-full relative ${isMobileLayout ? 'block' : 'min-w-[1200px]'}`}>
                         {!isMobileLayout && (
                         <thead className="sticky top-0 z-[60] bg-[#f5f5f7] shadow-sm text-[10px] sm:text-xs font-bold uppercase text-[#86868b] tracking-widest">
                           <tr>
                             <th className={`sticky left-0 bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 ${isMobileLayout ? 'w-[220px] min-w-[220px] max-w-[220px]' : 'w-[280px] min-w-[280px] max-w-[280px]'} shadow-[4px_0_15px_-5px_rgba(0,0,0,0.1)]`}>Task Name</th>
                             <th className="sticky left-[220px] sm:left-[280px] bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)]">Start</th>
                             <th className="sticky left-[335px] sm:left-[420px] bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[70px] sm:w-[100px] min-w-[70px] sm:min-w-[100px] max-w-[70px] sm:max-w-[100px] text-pink-600">Duration</th>
                             <th className="sticky left-[405px] sm:left-[520px] bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)]">Finish</th>
                                 {/* 🌟 2. ปรับหัวตารางวันที่ให้เรียงต่อเนื่อง และล็อกขนาดช่องละ 36px 🌟 */}
                                 <th className="bg-[#f5f5f7] border-b border-black/5 p-0 relative w-full z-[60]" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '40px' : '56px' }}>
                                    {todayTs >= chartStart && todayTs <= chartEnd && (
                                       <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500 z-[10] flex flex-col items-center pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}>
                                          <span className="bg-rose-500 text-white text-[7px] sm:text-[11px] font-bold px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-b-md sm:rounded-b-lg shadow-md mt-0 sm:mt-1">ปัจจุบัน</span>
                                       </div>
                                    )}
                                              
                                    <div className="absolute inset-0 flex pointer-events-none">
                                       {timeMarkers.map((m: any, i: any) => (
                                          <div key={i} className={`border-l h-full relative ${m.isMonth ? 'border-black/10 bg-slate-200/20' : 'border-black/5'}`} style={{position: 'absolute', left: `${m.left}%`, width: `${(1 / totalChartDays) * 100}%`}}>
                                                        
                                             {m.monthLabel && (
                                                <div className="absolute top-1.5 sm:top-2 left-1 bg-slate-800 text-white font-bold px-2 py-0.5 rounded shadow-sm text-[8px] sm:text-[10px] whitespace-nowrap z-30 border border-slate-700">
                                                   {m.monthLabel}
                                                </div>
                                             )}
                                                        
                                             {/* 🎯 บังคับจัดเลขวันที่ให้อยู่ตรงกลางช่องพอดีเป๊ะ (เติม 0 ข้างหน้าถ้าเป็นเลขหลักเดียว) */}
                                             <div className="absolute bottom-1 sm:bottom-2 w-full flex justify-center">
                                                <span className="text-[8px] sm:text-xs font-bold text-slate-400">{String(m.dayLabel).padStart(2, '0')}</span>
                                             </div>
                                          </div>
                                       ))}
                                    </div>
                                 </th>
                           </tr>
                         </thead>
                         )}
                         <tbody className={isMobileLayout ? 'block p-3 sm:p-0 bg-[#f5f5f7]' : ''}>
                          {props.loading ? (
                            Array.from({length: 6}).map((_, i) => (
                               <React.Fragment key={`skel-${i}`}>
                                  {/* Mobile Skeleton */}
                                  {isMobileLayout && (
                                  <tr className="bg-white border-b border-black/5 animate-pulse mb-3 rounded-xl overflow-hidden block shadow-sm table-row block">
                                     <td className="p-4 block w-full">
                                        <div className="flex justify-between mb-4"><div className="h-4 bg-slate-200 rounded w-1/2"></div><div className="h-4 bg-slate-200 rounded w-1/4"></div></div>
                                        <div className="h-3 bg-slate-200 rounded w-full mb-2"></div>
                                        <div className="h-8 bg-slate-200 rounded w-full mt-4"></div>
                                     </td>
                                  </tr>
                                  )}
                                  {/* PC Skeleton */}
                                  {!isMobileLayout && (
                                  <tr className="bg-white border-b border-black/5 animate-pulse table-row">
                                    <td className="p-3 h-[120px] w-[280px] bg-white sticky left-0 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] z-20"><div className="h-4 bg-slate-200 rounded w-3/4 mb-2 mt-2"></div><div className="h-3 bg-slate-200 rounded w-1/2"></div></td>
                                    <td className="p-3 w-[140px] sticky left-[280px] bg-white z-20"><div className="h-6 bg-slate-200 rounded w-full mt-2"></div></td>
                                    <td className="p-3 w-[100px] sticky left-[420px] bg-white z-20"><div className="h-6 bg-slate-200 rounded w-full mt-2"></div></td>
                                    <td className="p-3 w-[140px] sticky left-[520px] bg-white z-20 shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)]"><div className="h-6 bg-slate-200 rounded w-full mt-2"></div></td>
                                    <td className="p-3"><div className="h-8 bg-slate-200 rounded-full w-[40%] mt-2"></div></td>
                                  </tr>
                                  )}
                               </React.Fragment>
                            ))
                          ) : taskTemplates.filter(t => t.house_type_id === selectedPlot.house_type_id && (!taskSearchQuery || t.task_name.toLowerCase().includes(taskSearchQuery.toLowerCase()))).map((task) => {
                            const key             = `${selectedPlot.id}-${task.id}`;
                                    const isUpdatedToday = latestUpdatesMap[key]?.updated_at && new Date(latestUpdatesMap[key].updated_at).toDateString() === new Date().toDateString();
                                    const assignment      = assignments.find(a => a.task_template_id === task.id && a.plot_id === selectedPlot.id);

                            // ✅ Fixed: was schedulePlan[task.id] / actualDates[task.id]
                            const plan  = schedules[key]  || {};
                            const dates = taskDates[key]  || {};
                            const tProgress = latestUpdatesMap[key]?.progress || 0;
                            const tAction = latestUpdatesMap[key]?.action;
                            const tRole = latestUpdatesMap[key]?.role;
                            
                            // Find the first time it reached 100% in the current streak
                            let first100DateInStreak = null;
                            const tUpdates = allUpdatesRecord
                                .filter((u: any) => u.plot_id === selectedPlot.id && u.task_template_id === task.id)
                                .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                            
                            for (let i = tUpdates.length - 1; i >= 0; i--) {
                                if (tUpdates[i].progress < 100) break;
                                first100DateInStreak = tUpdates[i].created_at || tUpdates[i].updated_at;
                            }

                            const isTaskCompleted = tProgress === 100;
                            let rawDateToUse = first100DateInStreak || dates?.end;
                            
                            const actualEndRaw = rawDateToUse ? new Date(rawDateToUse).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-';
                            let actualEndUI = <div className="w-full text-[9px] sm:text-[11px] font-bold text-green-600 text-center">{actualEndRaw}</div>;
                            
                            if (tProgress === 100 && actualEndRaw !== '-') {
                                if (tAction === 'QC อนุมัติ' || tAction === 'QC อนุมัติผ่าน' || (!task.require_qc && tAction === 'Site Engineer อนุมัติ')) {
                                  actualEndUI = <div className="flex items-center justify-center gap-1 w-full text-[9px] sm:text-[11px] font-bold text-emerald-600 text-center"><span>{actualEndRaw}</span><span className="text-[7px] bg-emerald-100 text-emerald-800 px-1 rounded-sm whitespace-nowrap">✅ สำเร็จ</span></div>;
                                } else if (tAction === 'Site Engineer อนุมัติ' && task.require_qc) {
                                  actualEndUI = <div className="flex items-center justify-center gap-1 w-full text-[9px] sm:text-[11px] font-bold text-orange-600 text-center"><span>{actualEndRaw}</span><span className="text-[7px] bg-orange-100 text-orange-800 px-1 rounded-sm whitespace-nowrap">🔍 รอ QC</span></div>;
                                } else if (tAction === 'ส่งงาน 100%' || tRole === 'Foreman') {
                                  actualEndUI = <div className="flex items-center justify-center gap-1 w-full text-[9px] sm:text-[11px] font-bold text-yellow-600 text-center"><span>{actualEndRaw}</span><span className="text-[7px] bg-yellow-100 text-yellow-800 px-1 rounded-sm whitespace-nowrap">⏳ รอ SE</span></div>;
                                }
                            } else if (actualEndRaw !== '-') {
                                actualEndUI = <div className="w-full text-[9px] sm:text-[11px] font-bold text-blue-600 text-center">-</div>;
                            }

                            // Timestamps for Gantt bars
                            const aStartTs = dates?.start ? new Date(dates.start).getTime() : null;
                            const aEndTs   = dates?.end   ? new Date(dates.end).getTime()   : (aStartTs ? Date.now() : null);

                            // ✅ Added: pStartTs / pEndTs / statusObj were missing — used by Gantt chart at line 2950–2955
                            const pStartTs  = plan.planned_start ? new Date(plan.planned_start).getTime() : null;
                            const pEndTs    = plan.planned_end   ? new Date(plan.planned_end).getTime()   : null;
                            const statusObj = getTaskStatus(plan.planned_end, dates?.end, tProgress);

                            // Realtime Pickaxe Logic
                            const hasUpdateToday = allUpdatesRecord.some((u: any) => u.plot_id === selectedPlot.id && u.task_template_id === task.id && new Date(u.created_at).toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA'));

                            // Material Request Logic
                            const matReq = materialRequests?.find(m => m.plot_id === selectedPlot.id && m.task_template_id === task.id);

                            // Card view helpers
                            const contractorName  = assignment ? assignment.contractor_name  : '';
                            const contractorPhone = assignment ? assignment.contractor_phone : '';
                            let durationText = '-';
                            if (plan.planned_start && plan.planned_end) {
                              const diff = new Date(plan.planned_end).getTime() - new Date(plan.planned_start).getTime();
                              durationText = `${Math.max(0, Math.ceil(diff / 86400000)) + 1} วัน`;
                            }
                            let actualDurationText = '-';
                            if (dates?.start) {
                              const aEnd = dates.end ? new Date(dates.end).getTime() : Date.now();
                              actualDurationText = `${Math.max(0, Math.ceil((aEnd - new Date(dates.start).getTime()) / 86400000)) + 1} วัน`;
                            }

                            const openTaskProgress = () => {
                              setSelectedTask(task);
                              setTaskReturnView('house-detail');
                              setView('task-progress');
                            };

                            return (
                                <React.Fragment key={task.id}>
                                  {/* 📱 1. โซนมือถือ: แบบการ์ด (Mobile Card View) */}
                                  {isMobileLayout && (
                                      <tr className="block mb-4">
                                        <td className="block bg-white rounded-[1.5rem] shadow-[0_8px_30px_-10px_rgba(0,0,0,0.1)] p-5 border border-black/5 relative overflow-hidden">
                                            {/* แถบสีด้านบนการ์ด บอกสถานะ 100% */}
                                            {tProgress === 100 && <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-400"></div>}

                                            {/* หัวการ์ด: ชื่องาน & ป้าย % */}
                                            <div className="flex items-start justify-between mb-4 border-b border-slate-100 pb-3 mt-1">
                                              <div className="flex items-start gap-2.5 pr-2">
                                                  <span className="text-[10px] font-bold text-slate-400 bg-[#f5f5f7] px-2 py-0.5 rounded border mt-0.5 shrink-0">#{task.task_order}</span>
                                                  <div>
                                                    <h4 className="font-bold text-[#1d1d1f] text-sm leading-tight mb-1">{task.task_name}</h4>
                                                    {contractorName ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100"><HardHat size={12} /> {contractorName ? `${String(contractorName).split(' ')[0]} ${contractorPhone ? `(${contractorPhone})` : ''}` : 'ยังไม่ระบุ'}</span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-[#f5f5f7] px-2 py-0.5 rounded-md"><Users size={12} /> ยังไม่ระบุช่าง</span>
                                                    )}
                                                  </div>
                                              </div>
                                              <div className="flex flex-col items-end gap-1 shrink-0">
                                                <div className={`px-2.5 py-1 rounded-xl text-xs font-bold ${tProgress === 100 ? 'bg-emerald-100 text-emerald-700' : tProgress > 0 ? 'bg-blue-100 text-blue-700' : 'bg-[#f5f5f7] text-[#86868b]'}`}>
                                                    {tProgress}%
                                                </div>
                                                <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${statusObj.color}`}>
                                                    {statusObj.label}
                                                </div>
                                              </div>
                                            </div>

                                            {/* ข้อมูลวันที่: แผนงาน vs ทำจริง */}
                                            <div className="grid grid-cols-2 gap-3 mb-5">
                                              <div className="bg-[#f5f5f7] rounded-xl p-3 border border-slate-100 relative overflow-hidden">
                                                  <div className="absolute top-0 left-0 w-1 h-full bg-slate-300"></div>
                                                  <span className="text-[9px] font-bold uppercase text-[#86868b] block mb-1.5 flex items-center gap-1"><Calendar size={10}/> แผนงาน</span>
                                                  <div className="text-[10px] font-bold text-[#1d1d1f] space-y-0.5">
                                                    <p>เริ่ม: <span className="text-slate-900">{plan.planned_start ? new Date(plan.planned_start).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</span></p>
                                                    <p>จบ: <span className="text-slate-900">{plan.planned_end ? new Date(plan.planned_end).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</span></p>
                                                  </div>
                                                  <div className="text-[10px] font-bold text-pink-500 mt-2 bg-pink-50 inline-block px-1.5 py-0.5 rounded">{durationText}</div>
                                              </div>
                                              <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100/50 relative overflow-hidden">
                                                  <div className="absolute top-0 left-0 w-1 h-full bg-blue-400"></div>
                                                  <span className="text-[9px] font-bold uppercase text-blue-500 block mb-1.5 flex items-center gap-1"><Activity size={10}/> ทำจริง</span>
                                                  <div className="text-[10px] font-bold text-blue-800 space-y-0.5">
                                                    <p>เริ่ม: <span className="text-blue-900">{dates?.start ? new Date(dates.start).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</span></p>
                                                    <p>จบ: <span className="text-blue-900">{dates?.end ? new Date(dates.end).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</span></p>
                                                  </div>
                                                  <div className="text-[10px] font-bold text-blue-600 mt-2 bg-blue-100/50 inline-block px-1.5 py-0.5 rounded">{actualDurationText}</div>
                                              </div>
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="mb-5">
                                              <div className="flex justify-between items-end mb-1.5">
                                              <span className="text-[10px] font-bold text-[#86868b]">ความคืบหน้างวดงาน</span>
                                              {hasUpdateToday && (
                                             <div className="absolute top-1.5 right-1.5 bg-orange-100 text-orange-600 p-1 rounded-full shadow-sm" title="มีการอัปเดตใหม่วันนี้!">
                                                <Pickaxe size={12} className="animate-bounce" />
                                             </div>
                                              )}
                                              </div>
                                              <div className="w-full bg-[#f5f5f7] rounded-full h-3 overflow-hidden border border-black/5">
                                                  <div className={`h-full rounded-full transition-all duration-1000 ${tProgress === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`} style={{ width: `${tProgress}%` }}></div>
                                              </div>
                                            </div>

                                            {/* 📦 ปุ่มสั่งวัสดุ / สถานะ (Mobile) */}
                                            {(currentUserRole === 'Foreman' || currentUserRole === 'Site Engineer' || currentUserRole === 'Project Planner' || currentUserRole === 'Admin' || currentUserRole === 'Owner') && (() => {
                                              const currentRequest = materialRequests?.find((r: any) => String(r.plot_id) === String(selectedPlot.id) && String(r.task_template_id) === String(task.id));
                                              if (!currentRequest) {
                                                return (
                                                  <button onClick={(e) => { e.stopPropagation(); setRequestMaterialTask(task); }} className="w-full mb-3 py-3 bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 text-[11px] sm:text-xs font-bold rounded-xl active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm">
                                                    <Truck size={16}/> เบิกวัสดุ
                                                  </button>
                                                );
                                              }
                                              
                                              if (currentRequest.status === 'requested') {
                                                return <div className="w-full mb-3 py-3 bg-amber-50 border border-amber-200 text-amber-600 text-[11px] sm:text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm"><Clock size={16}/> รอสโตร์</div>;
                                              } else if (currentRequest.status === 'ordered') {
                                                return <div className="w-full mb-3 py-3 bg-orange-50 border border-orange-200 text-orange-600 text-[11px] sm:text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm"><Truck size={16}/> รอของเข้า</div>;
                                              } else if (currentRequest.status === 'received') {
                                                return (
                                                  <div className="flex gap-2 mb-3">
                                                    <div className="flex-[2] py-3 bg-emerald-50 border border-emerald-200 text-emerald-600 text-[11px] sm:text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm">
                                                      <CheckCircle size={16}/> ของครบแล้ว
                                                    </div>
                                                    {currentRequest.image_url && (
                                                      <button onClick={(e) => { e.stopPropagation(); setViewImageModalUrl(currentRequest.image_url); }} className="flex-[1] py-3 bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 text-[11px] sm:text-xs font-bold rounded-xl active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm">
                                                        <ImageIcon size={16}/> รูป
                                                      </button>
                                                    )}
                                                  </div>
                                                );
                                              }
                                              return null;
                                            })()}

                                            {/* ปุ่มกด Action */}
                                            <div className="flex gap-2">
                                              {(currentUserRole === 'Project Planner' || currentUserRole === 'Admin' || currentUserRole === 'Owner' || currentUserRole === 'Procurement') && (
                                                  <button onClick={(e) => { e.stopPropagation(); setAssignModal({ isOpen: true, task: task, name: contractorName, phone: contractorPhone }); }} className="flex-[1] py-3 bg-white border-2 border-black/5 text-[#86868b] text-[11px] font-bold rounded-xl hover:bg-[#f5f5f7] hover:border-black/10 active:scale-95 transition-all flex flex-col items-center justify-center gap-1 shadow-sm">
                                                    <UserCog size={16} className={contractorName ? 'text-amber-500' : 'text-slate-400'} /> {contractorName ? 'เปลี่ยนช่าง' : 'เลือกช่าง'}
                                                  </button>
                                              )}
                                              <button onClick={(e) => { e.stopPropagation(); openTaskProgress(); }} className={`flex-[2] py-3 ${tProgress === 100 ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-700' : 'bg-slate-800 hover:bg-slate-700 border-slate-900'} text-white text-[11px] sm:text-xs font-bold rounded-xl active:scale-95 transition-all flex flex-col items-center justify-center gap-1 shadow-md border-b-4 active:border-b-0 active:translate-y-[4px]`}>
                                                  <Camera size={16} className={tProgress === 100 ? 'text-emerald-100' : 'text-blue-300'} /> {tProgress === 100 ? 'ดูประวัติ / แจ้งซ่อม' : 'อัปเดตความคืบหน้า'}
                                              </button>

                                            </div>
                                        </td>
                                      </tr>
                                  )}

                                  {/* 💻 2. โซน PC: ตาราง Gantt Chart (ซ่อนในมือถือ โชว์เฉพาะใน PC) */}
                                  {!isMobileLayout && (
                                  <tr className="group hover:bg-slate-50/80 transition-colors bg-white cursor-pointer table-row" onClick={(e: any) => { 
                                      const target = e.target as HTMLElement; 
                                      if (target) { 
                                        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON') return; 
                                        if (typeof target.closest === 'function' && (target.closest('button') || target.closest('select') || target.closest('input'))) return; 
                                      } 
                                      openTaskProgress(); 
                                  }}>
                                {/* 🌟 2. [ฉบับแก้ไข] บีบความสูงแถวฝั่งซ้าย ล็อก Task Name 2 บรรทัด และล็อกคอลัมน์ให้อยู่กับที่ 🌟 */}
                                {/* 🌟 ปรับขยายความสูงแถว เพื่อไม่ให้เบอร์โทรโดนทับ (มือถือ 90px / คอม 100px) */}
                                 <td className={`p-2 sm:p-3 border-b border-black/5 ${isMobileLayout ? 'h-[110px] w-[220px] min-w-[220px] max-w-[220px] z-[45]' : 'h-[120px] w-[280px] min-w-[280px] max-w-[280px] z-20'} flex flex-col justify-between bg-white sticky left-0 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]`}>
                                    <div className="min-w-0">
                                        <div className="flex items-start gap-1.5">
                                          <span className="text-[10px] sm:text-xs font-bold text-slate-400 shrink-0 bg-[#f5f5f7] px-1.5 py-0.5 rounded border mt-0.5">#{task.task_order}</span>
                                          {/* 🎯 บังคับชื่องานให้แสดงสูงสุด 2 บรรทัดเท่ากันหมด */}
                                          <h4 className="font-bold text-[#1d1d1f] text-xs sm:text-sm leading-tight text-ellipsis overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]" title={task.task_name}>
                                             {task.task_name}
                                             
                                             {/* ⛏️ ไอคอนคนทำงาน จะโชว์เฉพาะงานที่มีการอัปเดต "วันนี้" (รวมถึงงานที่เสร็จ 100% วันนี้ด้วย) */}
                                             {hasUpdateToday && (
                                                <span title="มีการอัปเดตงานในวันนี้" className="inline-flex items-center justify-center bg-orange-100 text-orange-600 p-[2px] rounded shadow-sm animate-pulse ml-1.5 align-text-bottom">
                                                   <Pickaxe size={12} />
                                                </span>
                                             )}
                                          </h4>
                                       </div>
                                    </div>

                                    {/* 🔄 ปุ่มสัญลักษณ์จัดช่าง (เปิดสิทธิ์ให้ Project Planner และ Procurement กดได้) */}
                                    <div className="flex flex-col gap-1 mt-1 border-t border-slate-100 pt-1">
                                       <div className="flex items-center justify-between gap-1">
                                         {assignment ? (
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                               <div className="w-5 h-5 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                                                  <HardHat size={11} className="text-blue-600"/>
                                               </div>
                                               <div className="flex flex-col min-w-0 flex-1">
                                                  <span className="text-[10px] sm:text-xs font-bold text-blue-700 truncate">{assignment.contractor_name.split(' ')[0]}</span>
                                                  {assignment.contractor_phone && <span className="text-[9px] sm:text-[10px] font-medium text-slate-400 truncate">📞 {assignment.contractor_phone}</span>}
                                               </div>
                                               {/* ✅ แก้ไขปุ่มเปลี่ยนช่าง (รูปเฟือง UserCog) ให้เรียก Modal ถูกต้อง */}
                                               {(isAdmin || isProjectPlanner || isProcurement) && (
                                                  <button onClick={(e) => { e.stopPropagation(); setAssignModal({ isOpen: true, task: task, name: assignment.contractor_name || '', phone: assignment.contractor_phone || '' }); }} className="w-5 h-5 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-slate-400 hover:text-blue-600 shrink-0 transition-colors" title="เปลี่ยนช่าง">
                                                     <UserCog size={12} />
                                                  </button>
                                               )}
                                            </div>
                                         ) : (
                                            <div className="w-full">
                                               {/* ✅ แก้ไขปุ่มระบุช่าง ให้เรียก Modal ถูกต้อง */}
                                               {(isAdmin || isProjectPlanner || isProcurement) ? (
                                                  <button 
                                                     onClick={(e) => { e.stopPropagation(); setAssignModal({ isOpen: true, task: task, name: '', phone: '' }); }}
                                                     className="flex items-center gap-1 text-[10px] sm:text-xs font-bold text-rose-500 hover:text-rose-600 bg-rose-50/50 hover:bg-rose-50 border border-rose-200/60 border-dashed px-2 py-0.5 rounded-md transition-colors w-full justify-center"
                                                  >
                                                     <PlusCircle size={12}/> ระบุช่าง
                                                  </button>
                                               ) : (
                                                  <span className="text-[10px] sm:text-xs font-bold text-slate-400 italic">ยังไม่ระบุช่าง</span>
                                               )}
                                            </div>
                                         )}
                                       </div>
                                       
                                       {/* 🌟 แสดงเปอร์เซ็นต์งาน + สถานะล่าช้า/เร็วกว่าแผน */}
                                       <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-1.5 flex-1 pr-2">
                                             <div className="w-full bg-[#f5f5f7] rounded-full h-1.5 max-w-[80px]">
                                                <div className={`h-full rounded-full transition-all duration-1000 ${tProgress === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`} style={{ width: `${tProgress}%` }}></div>
                                             </div>
                                             <span className="text-[9px] sm:text-[10px] font-bold text-[#86868b]">{tProgress}%</span>
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0">
                                            {/* 📦 ปุ่มสั่งวัสดุ / สถานะการเบิก (แสดงเฉพาะคนที่สั่งได้) */}
                                            {(currentUserRole === 'Foreman' || currentUserRole === 'Site Engineer' || currentUserRole === 'Project Planner' || currentUserRole === 'Admin' || currentUserRole === 'Owner') && (() => {
                                              const currentRequest = materialRequests?.find((r: any) => String(r.plot_id) === String(selectedPlot.id) && String(r.task_template_id) === String(task.id));
                                              if (!currentRequest) {
                                                return (
                                                  <button onClick={(e) => { e.stopPropagation(); setRequestMaterialTask(task); }} className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1 transition-colors whitespace-nowrap"><Truck size={10}/> เบิกวัสดุ</button>
                                                );
                                              }
                                              
                                              if (currentRequest.status === 'requested') {
                                                return <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-600 flex items-center gap-1 whitespace-nowrap"><Clock size={10}/> รอสโตร์</span>;
                                              } else if (currentRequest.status === 'ordered') {
                                                return <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded border border-orange-200 bg-orange-50 text-orange-600 flex items-center gap-1 whitespace-nowrap"><Truck size={10}/> รอของเข้า</span>;
                                              } else if (currentRequest.status === 'received') {
                                                return (
                                                  <div className="flex items-center gap-1">
                                                    <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-600 flex items-center gap-1 whitespace-nowrap"><CheckCircle size={10}/> ของครบแล้ว</span>
                                                    {currentRequest.image_url && (
                                                      <button onClick={(e) => { e.stopPropagation(); setViewImageModalUrl(currentRequest.image_url); }} className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1 transition-colors whitespace-nowrap">
                                                        <ImageIcon size={10}/> รูป
                                                      </button>
                                                    )}
                                                  </div>
                                                );
                                              }
                                              return null;
                                            })()}
                                            <span className={`text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${statusObj.color}`}>
                                               {statusObj.label}
                                            </span>
                                          </div>
                                       </div>
                                    </div>
                                 </td>

                                   {(currentUserRole === 'Project Planner' || currentUserRole === 'Site Engineer') && (() => {
                                    const currentStart = scheduleInputs[task.id]?.start !== undefined ? scheduleInputs[task.id].start : (plan.planned_start || '');
                                    const currentEnd = scheduleInputs[task.id]?.end !== undefined ? scheduleInputs[task.id].end : (plan.planned_end || '');
                                    
                                    let initialDuration = '';
                                    if (currentStart && currentEnd) {
                                       const diffTime = new Date(currentEnd).getTime() - new Date(currentStart).getTime();
                                       initialDuration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
                                    }
                                    const currentDuration = scheduleInputs[task.id]?.duration !== undefined ? scheduleInputs[task.id].duration : initialDuration;

                                    let actualDurationText = '-';
                                    if (dates?.start) {
                                       const aEnd = dates.end ? new Date(dates.end).getTime() : Date.now();
                                       const aDiff = aEnd - new Date(dates.start).getTime();
                                       actualDurationText = `${Math.max(0, Math.ceil(aDiff / 86400000)) + 1} วัน`;
                                    }

                                    return (
                                       <>
                                          {/* Start Column (Planner) - ล็อกแน่นบนมือถือ */}
                                          <td className="sticky left-[220px] sm:left-[280px] bg-pink-50/20 sm:bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)]">
                                             <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-pink-300">
                                                <span className="text-[8px] font-bold uppercase text-pink-500 w-8 shrink-0 text-left">Plan:</span>
                                                <input type="date" value={currentStart} 
                                                   onChange={(e) => {
                                                      const newStart = e.target.value;
                                                      let newEnd = currentEnd;
                                                      if (newStart && currentDuration && Number(currentDuration) > 0) {
                                                         const d = new Date(newStart);
                                                         d.setDate(d.getDate() + (Number(currentDuration) - 1));
                                                         newEnd = d.toISOString().split('T')[0];
                                                      }
                                                      setScheduleInputs((prev: any) => ({...prev, [task.id]: { ...prev[task.id], start: newStart, end: newEnd, duration: currentDuration }}));
                                                   }} 
                                                   className="flex-1 w-full border border-pink-200 rounded px-1 py-1 text-[9px] font-bold text-[#1d1d1f] outline-none focus:border-pink-500 bg-white shadow-sm" 
                                                />
                                             </div>
                                             <div className="flex items-center gap-1">
                                                <span className="text-[8px] font-bold uppercase text-blue-500 w-8 shrink-0 text-left">Actual:</span>
                                                <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-blue-600 text-center">
                                                  {dates?.start ? new Date(dates.start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                                </div>
                                             </div>
                                          </td>
                                            
                                          {/* Duration Column (Planner) - ล็อกแน่นบนมือถือ */}
                                          <td className="sticky left-[335px] sm:left-[420px] bg-pink-50/20 sm:bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[70px] sm:w-[100px] min-w-[70px] sm:min-w-[100px] max-w-[70px] sm:max-w-[100px]">
                                             <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-pink-300">
                                                <input type="number" min="1" placeholder="วัน" value={currentDuration} 
                                                   onChange={(e) => {
                                                      const newDuration = e.target.value;
                                                      let newEnd = currentEnd;
                                                      if (currentStart && newDuration && Number(newDuration) > 0) {
                                                         const d = new Date(currentStart);
                                                         d.setDate(d.getDate() + (Number(newDuration) - 1));
                                                         newEnd = d.toISOString().split('T')[0];
                                                      }
                                                      setScheduleInputs((prev: any) => ({...prev, [task.id]: { ...prev[task.id], duration: newDuration, end: newEnd, start: currentStart }}));
                                                   }}
                                                   className="w-full border border-pink-200 rounded px-1 py-1 text-[9px] font-bold text-center text-pink-600 outline-none focus:border-pink-500 bg-white shadow-sm" 
                                                />
                                             </div>
                                             <div className="flex items-center justify-center">
                                                <div className="w-full text-[9px] sm:text-xs font-bold text-blue-500 text-center">
                                                  {actualDurationText}
                                                </div>
                                             </div>
                                          </td>

                                          {/* Finish Column (Planner) - ล็อกแน่นบนมือถือ */}
                                          <td className="sticky left-[405px] sm:left-[520px] bg-pink-50/20 sm:bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)]">
                                             <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-pink-300">
                                                <input type="date" value={currentEnd} 
                                                   onChange={(e) => {
                                                      const newEnd = e.target.value;
                                                      let newDuration = currentDuration;
                                                      if (currentStart && newEnd) {
                                                         const diffTime = new Date(newEnd).getTime() - new Date(currentStart).getTime();
                                                         newDuration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
                                                      }
                                                      setScheduleInputs((prev: any) => ({...prev, [task.id]: { ...prev[task.id], end: newEnd, duration: newDuration, start: currentStart }}));
                                                   }} 
                                                   className="w-full border border-pink-200 rounded px-1 py-1 text-[9px] font-bold text-[#1d1d1f] outline-none focus:border-pink-500 bg-white shadow-sm text-center" 
                                                />
                                             </div>
                                             <div className="flex items-center justify-center">
                                                {actualEndUI}
                                             </div>
                                          </td>
                                       </>
                                    );
                                 })()}

                                  {(currentUserRole !== 'Project Planner' && currentUserRole !== 'Site Engineer') && (() => {
                                    let durationText = '-';
                                    if (plan.planned_start && plan.planned_end) {
                                       const diff = new Date(plan.planned_end).getTime() - new Date(plan.planned_start).getTime();
                                       durationText = `${Math.max(0, Math.ceil(diff / (86400000))) + 1} วัน`;
                                    }

                                    let actualDurationText = '-';
                                    if (dates?.start) {
                                       const aEnd = dates.end ? new Date(dates.end).getTime() : Date.now();
                                       const aDiff = aEnd - new Date(dates.start).getTime();
                                       actualDurationText = `${Math.max(0, Math.ceil(aDiff / 86400000)) + 1} วัน`;
                                    }

                                    return (
                                       <>
                                          {/* Start Column (ดูทั่วไป) - ล็อกแน่นบนมือถือ */}
                                          <td className="sticky left-[220px] sm:left-[280px] bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)]">
                                            <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-black/5">
                                              <span className="text-[8px] font-bold uppercase text-slate-400 w-8 shrink-0 text-left">Plan:</span>
                                              <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-[#1d1d1f] text-center">
                                                 {plan.planned_start ? new Date(plan.planned_start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <span className="text-[8px] font-bold uppercase text-blue-400 w-8 shrink-0 text-left">Actual:</span>
                                              <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-blue-600 text-center">
                                                {dates?.start ? new Date(dates.start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                          </td>

                                          {/* Duration Column (ดูทั่วไป) - ล็อกแน่นบนมือถือ */}
                                          <td className="sticky left-[335px] sm:left-[420px] bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[70px] sm:w-[100px] min-w-[70px] sm:min-w-[100px] max-w-[70px] sm:max-w-[100px]">
                                            <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-black/5">
                                              <div className="w-full text-[9px] sm:text-xs font-bold text-[#86868b] text-center">
                                                 {durationText}
                                              </div>
                                            </div>
                                            <div className="flex items-center justify-center">
                                              <div className="w-full text-[9px] sm:text-xs font-bold text-blue-500 text-center">
                                                 {actualDurationText}
                                              </div>
                                            </div>
                                         </td>

                                         {/* Finish Column (ดูทั่วไป) - ล็อกแน่นบนมือถือ */}
                                         <td className="sticky left-[405px] sm:left-[520px] bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)]">
                                            <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-black/5">
                                              <div className="w-full text-[9px] sm:text-[11px] font-bold text-[#1d1d1f] text-center">
                                                 {plan.planned_end ? new Date(plan.planned_end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                            <div className="flex items-center justify-center">
                                              {actualEndUI}
                                            </div>
                                         </td>
                                       </>
                                    );
                                 })()}

                                    {/* 🌟 3. บีบความสูงช่องกราฟฝั่งขวาลงให้เท่าฝั่งซ้าย และจัดตำแหน่งแท่งกราฟใหม่ 🌟 */}
                                    {/* 🌟 ปรับขยายความสูงช่องกราฟ ให้เท่ากับฝั่งซ้ายเป๊ะๆ */}
                                     <td className="border-b border-black/5 p-0 relative z-10 w-full" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '90px' : '100px' }}>
                                       <div className="absolute inset-0 pointer-events-none z-0" style={{ 
                                            backgroundImage: `repeating-linear-gradient(to right, transparent, transparent calc(100% / ${totalChartDays} - 1px), #f1f5f9 calc(100% / ${totalChartDays} - 1px), #f1f5f9 calc(100% / ${totalChartDays}))`,
                                            backgroundSize: `calc(100% / ${totalChartDays}) 100%`
                                         }}>
                                          {todayTs >= chartStart && todayTs <= chartEnd && ( <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500/80 z-[15] pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}></div> )}
                                       </div>
                                       
                                       {/* 🌟 ปรับขนาดและตำแหน่งแท่งกราฟให้อยู่ตรงกลางช่องพอดี (ใช้ % แทน px) */}
                                       <div className="relative w-full h-full flex flex-col px-0">
                                          {pStartTs && pEndTs && ( 
                                             <div className="absolute h-2 bg-slate-800 rounded-sm z-[20] shadow-sm opacity-90" style={{ left: `${getChartLeft(pStartTs)}%`, width: `${getChartWidth(pStartTs, pEndTs)}%`, top: '25%' }} /> 
                                          )}
                                          
                                          {aStartTs && ( 
                                             <div className={`absolute h-4 rounded-sm z-[25] shadow-sm ${statusObj.barColor}`} style={{ left: `${getChartLeft(aStartTs)}%`, width: `${getChartWidth(aStartTs, aEndTs as number)}%`, top: '45%' }}>
                                                <span className="absolute -top-3.5 text-[8px] sm:text-[9px] font-bold text-[#86868b] bg-white/95 border border-black/5 px-1 py-0 rounded shadow-sm" style={{ left: '2px' }}>{tProgress}%</span>
                                             </div> 
                                          )}
                                       </div>
                                       

                                     </td>
                               </tr>
                               )}
                               </React.Fragment>
                             )
                           })}
                         </tbody>
                       </table>
                     </div>
                     </div>
                     )}

                     {activeHouseTab === 'handover' && (
                       <HouseHandoverView 
                         selectedPlot={selectedPlot} 
                         defects={defects || []} 
                         setDefects={setDefects || (() => {})} 
                         currentUserRole={currentUserRole}
                         resetHandoverCycle={resetHandoverCycle}
                         updateInspectionRound={updateInspectionRound}
                         fetchAllData={fetchAllData}
                       />
                     )}
                   </div>
                 
               )}

               {/* 💬 LEVEL 4: Task Progress */}

      {viewImageModalUrl && (
        <div onClick={() => setViewImageModalUrl(null)} className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center p-4 cursor-pointer">
          <button onClick={(e) => { e.stopPropagation(); setViewImageModalUrl(null); }} className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 p-2 rounded-full text-white backdrop-blur-sm transition-all cursor-pointer"><XCircle size={28}/></button>
          <img src={viewImageModalUrl} onClick={(e) => e.stopPropagation()} alt="Material View" className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-white/20 cursor-default"/>
        </div>
      )}

    </>
  );
}

export default React.memo(HouseDetailView);
