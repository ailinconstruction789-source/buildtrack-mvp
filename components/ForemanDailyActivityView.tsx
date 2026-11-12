'use client';

import React, { useState, useMemo } from 'react';
import {
  Activity,
  Calendar,
  Clock,
  User,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Search,
  Filter,
  Image as ImageIcon,
  MessageSquare,
  ArrowRight,
  X,
  ExternalLink,
  Sparkles,
  MapPin,
  Building2,
  Check,
  TrendingUp,
  Layers,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import {
  formatRoadblockActionLabel,
  parseRoadblockDisplay,
  stripInternalRefMarkers,
  type ForemanDailyActivityItem,
  type ForemanDailyActivitySummary,
} from '@/lib/foremanDuty';
import RoadblockReasonCallout from '@/components/RoadblockReasonCallout';

interface ForemanDailyActivityViewProps {
  activitySummary: ForemanDailyActivitySummary;
  selectedDate: string;
  selectedForeman: string;
  onNavigateToTaskChat: (plot: any, task: any) => void;
  onNavigateToDefectChat?: (plot: any, defect: any) => void;
  onSelectPlot?: (plot: any) => void;
  onSwitchToSchedule?: () => void;
}

export default function ForemanDailyActivityView({
  activitySummary,
  selectedDate,
  selectedForeman,
  onNavigateToTaskChat,
  onNavigateToDefectChat,
  onSelectPlot,
  onSwitchToSchedule,
}: ForemanDailyActivityViewProps) {
  // Category filter state: 'all' | 'in_plan' | 'out_of_plan' | 'defect' | 'roadblock'
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | 'in_plan' | 'out_of_plan' | 'defect' | 'roadblock'
  >('all');

  // Text search query
  const [searchQuery, setSearchQuery] = useState('');

  // Image preview modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Format date to Thai readable string
  const formattedDateTh = useMemo(() => {
    if (!selectedDate) return '';
    const [y, m, d] = selectedDate.split('-').map(Number);
    if (!y || !m || !d) return selectedDate;
    const monthNames = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
    ];
    return `${d} ${monthNames[m - 1]} ${y + 543}`;
  }, [selectedDate]);

  // Filtered activity items
  const filteredItems = useMemo(() => {
    return activitySummary.items.filter(item => {
      // Category filter
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPlot = item.plot_name?.toLowerCase().includes(q);
        const matchProject = item.project_name?.toLowerCase().includes(q);
        const matchTask = item.task_name?.toLowerCase().includes(q);
        const matchForeman = item.foreman_name?.toLowerCase().includes(q);
        const matchActor = item.actor_name?.toLowerCase().includes(q);
        const matchAction = item.action?.toLowerCase().includes(q);
        const matchText = stripInternalRefMarkers(item.text_content).toLowerCase().includes(q);
        if (
          !matchPlot &&
          !matchProject &&
          !matchTask &&
          !matchForeman &&
          !matchActor &&
          !matchAction &&
          !matchText
        ) {
          return false;
        }
      }

      return true;
    });
  }, [activitySummary.items, categoryFilter, searchQuery]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 🌟 Header Context Card & KPI Effort Overview */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-sm border border-slate-200/80 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-black border border-purple-200">
              <Activity size={14} className="stroke-[2.5]" />
              <span>บันทึกกิจกรรมจริงประจำวัน (Daily Activity Log)</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>ผลการปฏิบัติงานจริง ณ วันที่ {formattedDateTh}</span>
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm font-medium">
              รวบรวมทุกการเข้าตรวจไซต์ อัปเดตงาน ส่งงาน 100% แก้ไข Defect และการแจ้งปัญหาของโฟร์แมน
              {selectedForeman !== 'all' ? (
                <span className="font-bold text-slate-800"> (โฟร์แมน: {selectedForeman})</span>
              ) : (
                <span className="font-bold text-slate-800"> (โฟร์แมนทุกคน)</span>
              )}
            </p>
          </div>

          {onSwitchToSchedule && (
            <button
              onClick={onSwitchToSchedule}
              className="px-4 py-2 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-2xl text-xs font-black transition-all flex items-center gap-2 self-start md:self-center border border-slate-200 cursor-pointer active:scale-95 shrink-0"
            >
              <span>เปรียบเทียบกับงานตามแผน</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>

        {/* 📊 Effort Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* 1. Total activities */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-4 rounded-2xl shadow-sm border border-slate-700 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300">กิจกรรมทั้งหมด</span>
              <div className="p-1.5 bg-white/10 rounded-xl">
                <Activity size={15} className="text-white" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black tracking-tight">
                {activitySummary.totalActivities}
              </div>
              <p className="text-[10px] text-slate-300 mt-0.5 font-medium flex items-center gap-1">
                <MapPin size={11} /> เข้าตรวจ {activitySummary.plotsVisitedCount} แปลง
              </p>
            </div>
          </div>

          {/* 2. In-Plan updates */}
          <div className="bg-blue-50/80 p-4 rounded-2xl border border-blue-200 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-blue-900">งานตามแผนวันนี้</span>
              <div className="p-1.5 bg-blue-100 text-blue-700 rounded-xl">
                <CheckCircle2 size={15} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-blue-800 tracking-tight">
                {activitySummary.inPlanCount}
              </div>
              <p className="text-[10px] text-blue-600 mt-0.5 font-medium">ตรงตาม Master Plan</p>
            </div>
          </div>

          {/* 3. Out-of-Plan / Advance updates */}
          <div className="bg-purple-50/80 p-4 rounded-2xl border border-purple-200 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-purple-900">งานนอกแผน / ล่วงหน้า</span>
              <div className="p-1.5 bg-purple-100 text-purple-700 rounded-xl">
                <Sparkles size={15} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-purple-800 tracking-tight">
                {activitySummary.outOfPlanCount}
              </div>
              <p className="text-[10px] text-purple-600 mt-0.5 font-medium">ทำก่อนแผน / งานเสริม</p>
            </div>
          </div>

          {/* 4. Defect / QC */}
          <div className="bg-rose-50/80 p-4 rounded-2xl border border-rose-200 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-rose-900">ตรวจแก้ Defect</span>
              <div className="p-1.5 bg-rose-100 text-rose-700 rounded-xl">
                <Wrench size={15} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-rose-800 tracking-tight">
                {activitySummary.defectCount}
              </div>
              <p className="text-[10px] text-rose-600 mt-0.5 font-medium">งาน QC & ซ่อมแซม</p>
            </div>
          </div>

          {/* 5. Roadblock reports */}
          <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200 flex flex-col justify-between col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-amber-900">แจ้งติดปัญหา</span>
              <div className="p-1.5 bg-amber-100 text-amber-700 rounded-xl">
                <AlertTriangle size={15} />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-amber-800 tracking-tight">
                {activitySummary.roadblockCount}
              </div>
              <p className="text-[10px] text-amber-700 mt-0.5 font-medium">รอวัสดุ / ช่าง / สภาพอากาศ</p>
            </div>
          </div>
        </div>

        {/* ℹ️ Helpful context note for executives */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
          <span className="text-base leading-none">💡</span>
          <div className="leading-relaxed">
            <span className="font-bold text-slate-800">คำแนะนำสำหรับผู้บริหาร (Executive Tip):</span> หากวันใดโฟร์แมนมีเปอร์เซ็นต์ตามแผนต่ำ แต่มีตัวเลขในช่อง{' '}
            <span className="font-bold text-purple-700">"งานนอกแผน / ล่วงหน้า"</span> หรือ{' '}
            <span className="font-bold text-rose-700">"ตรวจแก้ Defect"</span> สูง แสดงว่าโฟร์แมนปฏิบัติหน้าที่จริงเต็มเวลา
            แต่อาจเป็นการเร่งงานแปลงส่งมอบ หรืองานด่วนที่ไม่ได้อยู่ในตารางแผนเดิม
          </div>
        </div>
      </div>

      {/* 🔍 Search & Category Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer ${
              categoryFilter === 'all'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            ทั้งหมด ({activitySummary.totalActivities})
          </button>

          <button
            onClick={() => setCategoryFilter('in_plan')}
            className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              categoryFilter === 'in_plan'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-blue-700 hover:bg-blue-50 border border-blue-200'
            }`}
          >
            <CheckCircle2 size={13} />
            <span>ตามแผนวันนี้ ({activitySummary.inPlanCount})</span>
          </button>

          <button
            onClick={() => setCategoryFilter('out_of_plan')}
            className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              categoryFilter === 'out_of_plan'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-white text-purple-700 hover:bg-purple-50 border border-purple-200'
            }`}
          >
            <Sparkles size={13} />
            <span>นอกแผน / ล่วงหน้า ({activitySummary.outOfPlanCount})</span>
          </button>

          <button
            onClick={() => setCategoryFilter('defect')}
            className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              categoryFilter === 'defect'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200'
            }`}
          >
            <Wrench size={13} />
            <span>ตรวจแก้ Defect ({activitySummary.defectCount})</span>
          </button>

          {activitySummary.roadblockCount > 0 && (
            <button
              onClick={() => setCategoryFilter('roadblock')}
              className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                categoryFilter === 'roadblock'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
              }`}
            >
              <AlertTriangle size={13} />
              <span>ติดปัญหา ({activitySummary.roadblockCount})</span>
            </button>
          )}
        </div>

        {/* Text Search Box */}
        <div className="relative min-w-[260px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ค้นหาแปลง, ชื่องาน, หรือข้อความ..."
            className="w-full pl-10 pr-4 py-2 bg-white rounded-2xl border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-2xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 📜 Activities Feed Timeline */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-12 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto">
            <Activity size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-slate-800">
              {searchQuery ? 'ไม่พบข้อมูลกิจกรรมที่ตรงกับคำค้นหา' : 'ยังไม่มีการบันทึกกิจกรรมในวันที่เลือก'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {searchQuery
                ? 'ลองเปลี่ยนคำค้นหา หรือรีเซ็ตตัวกรองหมวดหมู่'
                : `ไม่มีการอัปเดตงาน ส่งภาพ หรือรายงานปัญหาในวันที่ ${formattedDateTh} สำหรับเงื่อนไขที่เลือก`}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map(item => {
            // Category styles
            let categoryPillBg = 'bg-blue-50 text-blue-700 border-blue-200';
            if (item.category === 'out_of_plan') {
              categoryPillBg = 'bg-purple-50 text-purple-700 border-purple-200';
            } else if (item.category === 'defect') {
              categoryPillBg = 'bg-rose-50 text-rose-700 border-rose-200';
            } else if (item.category === 'roadblock') {
              categoryPillBg = 'bg-amber-50 text-amber-700 border-amber-200';
            }
            const cleanText = stripInternalRefMarkers(item.text_content);
            const roadblockDisplay = cleanText.startsWith('เหตุผล:')
              ? parseRoadblockDisplay(item.text_content, item.action)
              : null;
            const actionLabel = formatRoadblockActionLabel(item.action, item.text_content);

            return (
              <div
                key={item.id}
                className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 hover:border-slate-300 hover:shadow-md transition-all flex flex-col md:flex-row md:items-start justify-between gap-5 group"
              >
                {/* Left Section: Time, Category, Plot, Content */}
                <div className="space-y-3 flex-1 min-w-0">
                  {/* Top Metadata Row */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Timestamp */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-xl font-black">
                      <Clock size={12} className="text-slate-500" />
                      <span>{item.timeStr}</span>
                    </div>

                    {/* Category Badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl font-black border ${categoryPillBg}`}
                    >
                      {item.category === 'in_plan' && <CheckCircle2 size={12} />}
                      {item.category === 'out_of_plan' && <Sparkles size={12} />}
                      {item.category === 'defect' && <Wrench size={12} />}
                      {item.category === 'roadblock' && <AlertTriangle size={12} />}
                      <span>{item.categoryLabel}</span>
                    </span>

                    {/* Handover Type Badge */}
                    {item.is_handover && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-800 border border-purple-300 rounded-xl font-black text-[11px]">
                        🏠 ตรวจรับบ้าน
                      </span>
                    )}

                    {/* Plot Badge */}
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-700 rounded-xl font-bold border border-slate-200">
                      <Building2 size={12} className="text-slate-500" />
                      <span>
                        {item.plot_name} ({item.project_name})
                      </span>
                    </span>

                    {/* 100% completion badge */}
                    {item.is_100_percent && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500 text-white rounded-lg text-[10px] font-black shadow-2xs">
                        <Check size={11} className="stroke-[3]" />
                        <span>เสร็จ 100%</span>
                      </span>
                    )}
                  </div>

                  {/* Task Title & Action */}
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                      {item.task_name}
                    </h3>
                    <div className="text-xs sm:text-sm font-semibold text-slate-600 mt-0.5 flex items-center gap-2">
                      <span>{actionLabel}</span>
                      {typeof item.progress === 'number' && (
                        <span className="text-xs font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                          คืบหน้า {item.progress}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Additional text note */}
                  {roadblockDisplay ? (
                    <RoadblockReasonCallout roadblock={roadblockDisplay} compact />
                  ) : cleanText ? (
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                      {cleanText}
                    </div>
                  ) : null}

                  {/* Photo Thumbnails Gallery */}
                  {item.image_urls && item.image_urls.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                        <ImageIcon size={13} />
                        <span>ภาพถ่ายหน้างาน ({item.image_urls.length} รูป):</span>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {item.image_urls.map((imgUrl, idx) => (
                          <div
                            key={idx}
                            onClick={() => setPreviewImage(imgUrl)}
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-blue-500 transition-all relative group/img shadow-2xs"
                          >
                            <img
                              src={imgUrl}
                              alt={`ภาพงาน ${idx + 1}`}
                              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-200"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                              <ExternalLink size={14} className="text-white" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Author / Foreman identity */}
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 font-medium">
                    <User size={12} className="text-slate-400" />
                    <span>ผู้บันทึก: <strong className="text-slate-700">{item.actor_name}</strong></span>
                    {item.foreman_name && item.foreman_name !== item.actor_name && (
                      <span>(โฟร์แมนแปลง: <strong className="text-slate-700">{item.foreman_name}</strong>)</span>
                    )}
                  </div>
                </div>

                {/* Right Section: Quick Navigation Buttons */}
                <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                  {item.defectObj && onNavigateToDefectChat ? (
                    <button
                      onClick={() => onNavigateToDefectChat(item.plotObj, item.defectObj)}
                      className={`px-4 py-2 ${item.is_handover ? 'bg-purple-600 hover:bg-purple-700' : 'bg-rose-600 hover:bg-rose-700'} text-white rounded-xl text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95`}
                    >
                      <Wrench size={13} />
                      <span>{item.is_handover ? 'ห้องแชท / อัปเดต Defect' : 'ดูรายละเอียด Defect'}</span>
                    </button>
                  ) : item.taskObj && onNavigateToTaskChat ? (
                    <button
                      onClick={() => onNavigateToTaskChat(item.plotObj, item.taskObj)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <MessageSquare size={13} />
                      <span>เข้าห้องแชท / อัปเดต</span>
                    </button>
                  ) : null}

                  {item.plotObj && onSelectPlot && (
                    <button
                      onClick={() => onSelectPlot(item.plotObj)}
                      className="px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <span>ไปที่แปลง {item.plot_name}</span>
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 🖼️ Fullscreen Image Preview Lightbox */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 cursor-pointer"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl p-2"
          >
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-all cursor-pointer z-10"
            >
              <X size={18} />
            </button>
            <img
              src={previewImage}
              alt="ภาพขยายขนาดใหญ่"
              className="max-h-[85vh] w-auto max-w-full rounded-xl object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
