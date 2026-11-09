'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Compass,
  RotateCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  X,
  HardHat,
  Sparkles,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Eye,
  Radio,
  ArrowRight,
  ShieldCheck,
  Building,
  Hammer,
  Paintbrush,
  List,
  Target,
  Play,
  Pause,
  History,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon
} from 'lucide-react';
import {
  HousePlot,
  SiteCharacter,
  GraphicQuality,
  BuildingStageName,
  SiteDisplayMode,
  SiteActivityEvent,
  AttentionPoint,
  InspectionQueueItem
} from '@/lib/livingSite/types';

export interface LivingSiteUIProps {
  projectName: string;
  dateStr: string;
  scaleLabel?: string;
  isDemoMode: boolean;
  quality: GraphicQuality;
  displayMode?: SiteDisplayMode;
  viewMode: '3d' | 'list';
  roleFilter: string;
  searchQuery: string;
  totalPlotsCount?: number;
  activePlotsCount?: number;
  selectedHouse: HousePlot | null;
  selectedCharacter: SiteCharacter | null;
  selectedFacility?: any | null;
  followedCharacterId: string | null;
  events?: SiteActivityEvent[];
  attentionPoints?: AttentionPoint[];
  pendingInspections?: InspectionQueueItem[];
  currentAttentionIndex?: number;
  onNextAttention?: () => void;
  onPrevAttention?: () => void;
  onSelectAttentionPoint?: (point: AttentionPoint) => void;
  isReplayActive?: boolean;
  replayTime?: string;
  isReplayPlaying?: boolean;
  replaySpeed?: number;
  onToggleReplay?: () => void;
  onReplayTimeChange?: (time: string) => void;
  onToggleReplayPlay?: () => void;
  onChangeReplaySpeed?: (speed: number) => void;
  onSelectEvent?: (event: SiteActivityEvent) => void;
  onChangeDisplayMode?: (mode: SiteDisplayMode) => void;
  onToggleDemoMode: () => void;
  onChangeQuality: (q: GraphicQuality) => void;
  onChangeViewMode: (vm: '3d' | 'list') => void;
  onChangeRoleFilter: (role: string) => void;
  onChangeSearchQuery: (query: string) => void;
  onSelectHouse: (house: HousePlot | null) => void;
  onSelectCharacter: (char: SiteCharacter | null) => void;
  onSelectFacility?: (facility: any | null) => void;
  onRotateHouse?: (plotId: string, deltaAngle: number) => void;
  onNudgeHouse?: (plotId: string, dx: number, dz: number) => void;
  onSavePlacement?: (plotId: string) => void;
  onResetPlacement?: (plotId: string) => void;
  isSavingPlacement?: boolean;
  savePlacementStatus?: { type: 'success' | 'error'; message: string } | null;
  onFollowCharacter: (charId: string | null) => void;
  onResetCamera: () => void;
  onFitAll: () => void;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpenFullPlotDetail?: (plotId: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const LivingSiteUI: React.FC<LivingSiteUIProps> = ({
  projectName,
  dateStr,
  scaleLabel,
  isDemoMode,
  quality,
  displayMode = 'inspection',
  viewMode,
  roleFilter,
  searchQuery,
  totalPlotsCount = 0,
  activePlotsCount = 0,
  selectedHouse,
  selectedCharacter,
  selectedFacility,
  followedCharacterId,
  events = [],
  attentionPoints = [],
  pendingInspections = [],
  currentAttentionIndex = 0,
  onNextAttention,
  onPrevAttention,
  onSelectAttentionPoint,
  isReplayActive = false,
  replayTime = '12:00',
  isReplayPlaying = false,
  replaySpeed = 1,
  onToggleReplay,
  onReplayTimeChange,
  onToggleReplayPlay,
  onChangeReplaySpeed,
  onSelectEvent,
  onChangeDisplayMode,
  onToggleDemoMode,
  onChangeQuality,
  onChangeViewMode,
  onChangeRoleFilter,
  onChangeSearchQuery,
  onSelectHouse,
  onSelectCharacter,
  onSelectFacility,
  onRotateHouse,
  onNudgeHouse,
  onSavePlacement,
  onResetPlacement,
  isSavingPlacement,
  savePlacementStatus,
  onFollowCharacter,
  onResetCamera,
  onFitAll,
  onRotateCW,
  onRotateCCW,
  onZoomIn,
  onZoomOut,
  onOpenFullPlotDetail,
  isFullscreen = false,
  onToggleFullscreen
}) => {
  // Local state for Timeline slide-over drawer and photo modal
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(false);
  const [timelineScope, setTimelineScope] = useState<'today' | 'all'>('today');
  const [timelineFilterRole, setTimelineFilterRole] = useState<string>('all');
  const [modalPhotoUrl, setModalPhotoUrl] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  // Stage name in Thai
  const getStageLabel = (stage: BuildingStageName): string => {
    switch (stage) {
      case 'foundation': return 'งานฐานราก/ตอม่อ';
      case 'structure': return 'งานเสาคานโครงสร้าง';
      case 'masonry': return 'งานก่อฉาบผนัง';
      case 'roofing': return 'งานโครงสร้างหลังคา';
      case 'finishing': return 'งานสถาปัตย์และสี';
      case 'completed': return 'สร้างเสร็จสมบูรณ์';
      default: return stage;
    }
  };

  const activeAttention = attentionPoints[currentAttentionIndex] || attentionPoints[0];

  // Filter events that actually occurred on the selected date (not historical)
  const todayEvents = useMemo(() => {
    return events.filter(e => e.freshness !== 'historical' || e.dateLabel === dateStr);
  }, [events, dateStr]);

  const baseEvents = timelineScope === 'today' ? todayEvents : events;

  // Filtered timeline events
  const filteredEvents = useMemo(() => {
    if (timelineFilterRole === 'all') return baseEvents;
    return baseEvents.filter(e => {
      if (timelineFilterRole === 'defect') return e.sourceType === 'defect';
      if (timelineFilterRole === 'qc') return e.actorRole === 'qc';
      if (timelineFilterRole === 'engineer') return e.actorRole === 'engineer';
      if (timelineFilterRole === 'foreman') return e.actorRole === 'foreman';
      return e.actorRole === 'mason' || e.actorRole === 'carpenter' || e.actorRole === 'steel' || e.actorRole === 'mep';
    });
  }, [baseEvents, timelineFilterRole]);

  // Local state for Left Flank collapsible panel
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState<boolean>(true);

  // Keyboard Shortcuts (Space: Replay Play/Pause, I: Mode, R: Reset Camera, F: Fit All)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (isReplayActive) {
          onToggleReplayPlay?.();
        } else {
          onToggleReplay?.();
        }
      } else if (e.key === 'i' || e.key === 'I') {
        onChangeDisplayMode?.(displayMode === 'inspection' ? 'presentation' : 'inspection');
      } else if (e.key === 'r' || e.key === 'R') {
        onResetCamera();
      } else if (e.key === 'f' || e.key === 'F') {
        onFitAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReplayActive, onToggleReplayPlay, onToggleReplay, displayMode, onChangeDisplayMode, onResetCamera, onFitAll]);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4 z-10 overflow-hidden">
      {/* 🌟 Slim Top Floating Control Bar 🌟 */}
      <div
        className="pointer-events-auto flex items-center justify-between gap-2.5 max-w-full bg-slate-900/90 backdrop-blur-md px-3.5 py-2 sm:py-2.5 rounded-2xl border border-slate-700/60 shadow-xl text-white"
        onClick={e => e.stopPropagation()}
      >
        {/* Title & Colony Sim Badge */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
            <span className="text-base">🏗️</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black tracking-tight truncate">{projectName}</h2>
              <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider shrink-0">
                Colony Sim
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-medium">
                Living Construction Site • ประจำวันที่ {dateStr}
              </span>
              {scaleLabel && (
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[9px] font-bold">
                  {scaleLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Mode Switch (Inspection vs Presentation) */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onChangeDisplayMode?.(displayMode === 'inspection' ? 'presentation' : 'inspection')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all shadow-sm ${
              displayMode === 'inspection'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-slate-800 text-slate-300 border border-slate-700 hover:text-white'
            }`}
            title="สลับโหมดตรวจงาน (แสดงป้ายรอตรวจ ดีเฟกต์ หมุดกิจกรรม) และโหมดนำเสนอ (สวยงาม คลีนตา)"
          >
            <Target size={14} className={displayMode === 'inspection' ? 'text-amber-400' : 'text-slate-400'} />
            <span className="hidden sm:inline">
              {displayMode === 'inspection' ? 'โหมดตรวจงาน (Inspection)' : 'โหมดนำเสนอ (Presentation)'}
            </span>
            <span className="sm:hidden">
              {displayMode === 'inspection' ? 'ตรวจงาน' : 'นำเสนอ'}
            </span>
          </button>
        </div>

        {/* Right Tools: Data Mode, Quality Tier, View Switch & Fullscreen */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mode Switch: Demo vs Live Data */}
          <button
            onClick={onToggleDemoMode}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-black transition-all shadow-sm ${
              isDemoMode
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30'
            }`}
            title="สลับระหว่างข้อมูลจำลอง (Demo) และข้อมูลจริงจากฐานข้อมูล"
          >
            <Radio size={13} className={isDemoMode ? 'text-amber-400' : 'text-blue-400'} />
            <span className="hidden md:inline">{isDemoMode ? 'โหมดจำลอง (Demo Mode)' : 'ข้อมูลจริง (Live Data)'}</span>
            <span className="md:hidden">{isDemoMode ? 'Demo' : 'Live'}</span>
          </button>

          {/* Quality Tier Selector */}
          <div className="flex items-center bg-slate-800/80 p-0.5 sm:p-1 rounded-xl border border-slate-700/60 text-[10px] sm:text-[11px]">
            <span className="px-1.5 text-slate-400 font-bold hidden lg:inline">กราฟิก:</span>
            {(['low', 'medium', 'high'] as GraphicQuality[]).map(q => (
              <button
                key={q}
                onClick={() => onChangeQuality(q)}
                className={`px-1.5 sm:px-2 py-0.5 rounded-lg font-bold transition ${
                  quality === q ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                {q === 'low' ? 'ต่ำ' : q === 'medium' ? 'กลาง' : 'สูง'}
              </button>
            ))}
          </div>

          {/* View Mode Toggle: 3D vs List */}
          <button
            onClick={() => onChangeViewMode(viewMode === '3d' ? 'list' : '3d')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition"
            title="สลับมุมมองระหว่าง 3D และตารางรายการข้อความ"
          >
            <List size={14} />
            <span className="hidden sm:inline">{viewMode === '3d' ? 'ดูแบบตาราง' : 'ดูแบบ 3D'}</span>
          </button>

          {/* Fullscreen Toggle Button */}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-bold transition border ${
                isFullscreen
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-black'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
              title={isFullscreen ? 'ย่อกลับขนาดปกติ (หรือกดปุ่ม Esc)' : 'ขยายเต็มหน้าจอ (Fullscreen)'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span className="hidden md:inline ml-1">{isFullscreen ? 'ย่อจอ (Esc)' : 'เต็มจอ'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 🧭 Collapsible Left Flank (Search, Role Filters & Attention Points) 🧭 */}
      <div className="pointer-events-auto absolute left-3 sm:left-4 top-16 sm:top-18 z-20 flex flex-col gap-2 max-w-sm w-76 sm:w-84">
        {isLeftPanelOpen ? (
          <div
            className="bg-slate-900/90 backdrop-blur-md p-3 rounded-2xl border border-slate-700/70 shadow-2xl flex flex-col gap-2.5 text-white animate-in fade-in duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Header: Title & Collapse Button */}
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <div className="flex items-center gap-1.5">
                <Search size={14} className="text-indigo-400" />
                <span className="text-xs font-black text-slate-200">ค้นหา & ตัวกรองแปลง</span>
              </div>
              <button
                onClick={() => setIsLeftPanelOpen(false)}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
                title="ซ่อนแถบค้นหาและตัวกรอง"
              >
                <ChevronUp size={14} />
              </button>
            </div>

            {/* Search Box */}
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => onChangeSearchQuery(e.target.value)}
                placeholder="ค้นหาเลขแปลง, ชื่อช่าง หรือบทบาท..."
                className="w-full bg-slate-800/90 text-white text-xs pl-8 pr-7 py-1.5 rounded-xl border border-slate-700 outline-none focus:border-indigo-500 placeholder-slate-400"
              />
              {searchQuery && (
                <button
                  onClick={() => onChangeSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Quick Role Filters */}
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {[
                { id: 'all', label: `ทั้งหมด (${totalPlotsCount})` },
                { id: 'active', label: `มีงานทำ (${activePlotsCount})` },
                { id: 'mason', label: 'ช่างปูน/โครงสร้าง' },
                { id: 'mep', label: 'ช่างระบบ MEP' },
                { id: 'foreman', label: 'โฟร์แมน' },
                { id: 'engineer', label: 'วิศวกร' },
                { id: 'qc', label: 'QC' }
              ].map(r => (
                <button
                  key={r.id}
                  onClick={() => onChangeRoleFilter(r.id)}
                  className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                    roleFilter === r.id
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Embedded Attention Queue Widget */}
            {attentionPoints.length > 0 && activeAttention && (
              <div className="mt-1 pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      activeAttention.severity === 'critical'
                        ? 'bg-rose-500 animate-ping'
                        : activeAttention.severity === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                    }`} />
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                      จุดที่ต้องดู ({currentAttentionIndex + 1}/{attentionPoints.length})
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      • {activeAttention.waitDurationText}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={onPrevAttention}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition"
                      title="ก่อนหน้า"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={onNextAttention}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition"
                      title="ถัดไป"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
                <p className="text-xs font-bold text-slate-100 truncate">
                  {activeAttention.title}
                </p>
                <button
                  onClick={() => onSelectAttentionPoint?.(activeAttention)}
                  className="w-full py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-xl shadow transition"
                  title="บินกล้องไปดูจุดนี้ทันที"
                >
                  บินไปดูจุดนี้
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setIsLeftPanelOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 backdrop-blur-md text-slate-200 border border-slate-700/70 rounded-2xl shadow-xl text-xs font-bold hover:bg-slate-800 hover:text-white transition w-fit"
            title="เปิดแถบค้นหาและตัวกรองแปลง"
          >
            <Search size={14} className="text-indigo-400" />
            <span>ค้นหา & ตัวกรอง</span>
            {roleFilter !== 'all' && (
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
            )}
            {attentionPoints.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">
                {attentionPoints.length}
              </span>
            )}
            <ChevronDown size={14} className="text-slate-400" />
          </button>
        )}
      </div>

      {/* 🎯 Follow Character Active Pill */}
      {followedCharacterId && (
        <div
          className="pointer-events-auto self-center mt-2 bg-indigo-900/90 text-white px-4 py-2 rounded-2xl border border-indigo-400/50 shadow-xl backdrop-blur-md flex items-center gap-3 animate-bounce"
          onClick={e => e.stopPropagation()}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold">
            กำลังติดตามกล้อง: <span className="text-amber-300 font-black">{selectedCharacter?.name || followedCharacterId}</span>
          </span>
          <button
            onClick={() => onFollowCharacter(null)}
            className="p-1 hover:bg-indigo-800 rounded-lg transition text-slate-300 hover:text-white"
            title="ยกเลิกติดตามกล้อง"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ⏱️ Collapsible Recent Activities Timeline Drawer */}
      {isTimelineOpen && (
        <div
          className="pointer-events-auto absolute left-3 sm:left-4 top-24 bottom-20 w-80 sm:w-96 bg-slate-900/95 backdrop-blur-2xl p-4 rounded-3xl border border-slate-700/80 shadow-2xl flex flex-col gap-3 text-white z-20 animate-in slide-in-from-left duration-200"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-indigo-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                แถบเหตุการณ์ ({filteredEvents.length})
              </h3>
            </div>
            <button
              onClick={() => setIsTimelineOpen(false)}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scope Selector: เฉพาะวันนี้ vs ประวัติทั้งหมด */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950/70 rounded-xl border border-slate-800 text-[11px]">
            <button
              onClick={() => setTimelineScope('today')}
              className={`py-1 rounded-lg font-black transition text-center ${
                timelineScope === 'today'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              เฉพาะวันนี้ ({todayEvents.length})
            </button>
            <button
              onClick={() => setTimelineScope('all')}
              className={`py-1 rounded-lg font-black transition text-center ${
                timelineScope === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ประวัติทั้งหมด ({events.length})
            </button>
          </div>

          {/* Timeline Role Filters */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
            {[
              { id: 'all', label: 'ทั้งหมด' },
              { id: 'mason', label: 'ช่าง' },
              { id: 'foreman', label: 'โฟร์แมน' },
              { id: 'engineer', label: 'วิศวกร' },
              { id: 'qc', label: 'QC' },
              { id: 'defect', label: 'ดีเฟกต์' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setTimelineFilterRole(f.id)}
                className={`px-2 py-0.5 rounded-lg font-bold transition whitespace-nowrap ${
                  timelineFilterRole === f.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Events Scroll Area */}
          <div className="flex-1 overflow-y-auto overscroll-contain space-y-2.5 pr-1">
            {filteredEvents.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">ไม่มีรายงานกิจกรรมในตัวกรองนี้</p>
            ) : (
              filteredEvents.map(ev => (
                <div
                  key={ev.id}
                  onClick={() => onSelectEvent?.(ev)}
                  className="bg-slate-800/80 hover:bg-slate-800 p-3 rounded-2xl border border-slate-700/60 hover:border-indigo-500/50 cursor-pointer transition space-y-1.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-amber-400 font-bold">
                      {ev.timeLabel}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {ev.plotName}
                    </span>
                  </div>

                  <p className="text-xs font-bold text-white leading-tight">
                    {ev.actionTitle}
                  </p>

                  {/* Truthful Identity Separation */}
                  <div className="text-[11px] text-slate-300 space-y-0.5">
                    <p className="flex items-center gap-1">
                      <span className="text-slate-400">ผู้ปฏิบัติงาน:</span>
                      <span className="font-bold text-amber-300">{ev.actorName}</span>
                    </p>
                    {ev.isTeam && ev.reporterName && (
                      <p className="flex items-center gap-1 text-[10px] text-slate-400">
                        <span>รายงานโดย:</span>
                        <span className="text-slate-200">{ev.reporterName}</span>
                      </p>
                    )}
                    {ev.isUnknownTeam && (
                      <p className="text-[10px] text-amber-300/80 italic">
                        (รายงานโดย {ev.reporterName} — ไม่ระบุทีมผู้รับเหมา)
                      </p>
                    )}
                  </div>

                  {/* Photo Thumbnail */}
                  {ev.photoUrls.length > 0 && (
                    <div className="pt-1 flex items-center gap-1.5">
                      {ev.photoUrls.slice(0, 2).map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt="Evidence"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalPhotoUrl(img);
                          }}
                          className="w-12 h-9 object-cover rounded-lg border border-slate-600 hover:scale-105 transition"
                        />
                      ))}
                      {ev.photoUrls.length > 2 && (
                        <span className="text-[10px] text-slate-400 font-bold">
                          +{ev.photoUrls.length - 2} รูป
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 🧭 Bottom Section: Floating Camera & Exploration Dock 🧭 */}
      <div className="pointer-events-none absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 max-w-[calc(100vw-24px)]">
        {/* ⏪ Day Replay Scrubber Controller (floats directly above bottom dock) ⏪ */}
        {isReplayActive && (
          <div
            className="pointer-events-auto bg-slate-900/95 backdrop-blur-xl p-2.5 sm:px-4 sm:py-2.5 rounded-2xl sm:rounded-3xl border border-violet-500/60 shadow-2xl flex flex-wrap items-center gap-2.5 text-white max-w-xl w-full animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Play/Pause */}
            <button
              onClick={onToggleReplayPlay}
              className="w-8 h-8 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center shadow-lg transition shrink-0"
              title={isReplayPlaying ? 'หยุดชั่วคราว' : 'เล่นต่อ'}
            >
              {isReplayPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>

            {/* Current Replay Time Badge */}
            <div className="flex flex-col min-w-[75px] shrink-0">
              <span className="text-[9px] text-violet-300 uppercase font-black">จำลองเหตุการณ์</span>
              <span className="text-xs font-mono font-black text-amber-300">{replayTime} น.</span>
            </div>

            {/* Time Scrubber Slider */}
            <div className="flex-1 min-w-[120px]">
              <input
                type="range"
                min="480" // 08:00
                max="1080" // 18:00
                step="10"
                value={(() => {
                  const [h, m] = (replayTime || '12:00').split(':').map(Number);
                  return h * 60 + m;
                })()}
                onChange={e => {
                  const val = Number(e.target.value);
                  const h = Math.floor(val / 60);
                  const m = val % 60;
                  onReplayTimeChange?.(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                }}
                className="w-full accent-violet-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>08:00</span>
                <span>12:00</span>
                <span>18:00</span>
              </div>
            </div>

            {/* Speed Selector */}
            <div className="flex items-center gap-0.5 bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-[10px] font-bold shrink-0">
              {[1, 2, 5].map(s => (
                <button
                  key={s}
                  onClick={() => onChangeReplaySpeed?.(s)}
                  className={`px-1.5 py-0.5 rounded transition ${
                    replaySpeed === s ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Exit Replay Mode */}
            <button
              onClick={onToggleReplay}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition shrink-0"
              title="ออกจากโหมด Replay"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Camera & Exploration Dock */}
        <div
          className="pointer-events-auto flex items-center gap-1 sm:gap-1.5 bg-slate-900/90 backdrop-blur-md p-1.5 sm:p-2 rounded-2xl border border-slate-700/60 shadow-2xl text-white max-w-full overflow-x-auto"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onResetCamera}
            className="p-1.5 sm:px-2.5 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shrink-0"
            title="Snap กลับมามุมมองผังมาตรฐาน Isometric"
          >
            <Compass size={15} className="text-amber-400" />
            <span className="hidden md:inline">มุมมองมาตรฐาน</span>
          </button>

          <button
            onClick={onFitAll}
            className="p-1.5 sm:p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition shrink-0"
            title="แสดงทั้งโครงการ (Fit Overview)"
          >
            <Maximize2 size={15} />
          </button>

          <div className="w-px h-4 sm:h-5 bg-slate-700 mx-0.5 shrink-0" />

          <button
            onClick={onRotateCCW}
            className="p-1.5 sm:p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition shrink-0"
            title="หมุนทวนเข็ม 45°"
          >
            <RotateCcw size={15} />
          </button>

          <button
            onClick={onRotateCW}
            className="p-1.5 sm:p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition shrink-0"
            title="หมุนตามเข็ม 45°"
          >
            <RotateCw size={15} />
          </button>

          <div className="w-px h-4 sm:h-5 bg-slate-700 mx-0.5 shrink-0" />

          <button
            onClick={onZoomIn}
            className="p-1.5 sm:p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition shrink-0"
            title="ซูมเข้า (Zoom In)"
          >
            <ZoomIn size={15} />
          </button>

          <button
            onClick={onZoomOut}
            className="p-1.5 sm:p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition shrink-0"
            title="ซูมออก (Zoom Out)"
          >
            <ZoomOut size={15} />
          </button>

          <div className="w-px h-4 sm:h-5 bg-slate-700 mx-0.5 shrink-0" />

          {/* Timeline Events Button */}
          <button
            onClick={() => setIsTimelineOpen(!isTimelineOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 ${
              isTimelineOpen
                ? 'bg-indigo-600 text-white shadow'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
            }`}
            title="เปิดแถบเหตุการณ์รายงานล่าสุดของวันนี้"
          >
            <Clock size={15} className="text-indigo-400" />
            <span className="hidden sm:inline">เหตุการณ์วันนี้</span>
            <span className="text-[10px] font-mono px-1 rounded bg-slate-800 text-indigo-300">
              {todayEvents.length}
            </span>
          </button>

          {/* Day Replay Toggle Button */}
          <button
            onClick={onToggleReplay}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 ${
              isReplayActive
                ? 'bg-violet-600 text-white shadow'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
            }`}
            title="เล่นย้อนหลังการเข้าทำงานและรายงานระหว่างวัน"
          >
            <History size={15} className="text-violet-400" />
            <span className="hidden sm:inline">เล่นย้อนหลัง</span>
          </button>
        </div>
      </div>

      {/* 📋 Side Inspector Drawer (House, Character, or Facility) */}
      {(selectedHouse || selectedCharacter || selectedFacility) && (
        <div className="pointer-events-none fixed sm:absolute inset-x-3 sm:inset-x-auto sm:right-4 bottom-3 sm:bottom-4 top-auto sm:top-16 z-30 flex flex-col justify-end">
          <div
            className="pointer-events-auto w-full sm:w-96 max-h-[82vh] sm:max-h-[calc(100vh-80px)] flex flex-col bg-slate-900/95 backdrop-blur-2xl rounded-3xl border border-slate-700/80 shadow-2xl text-white overflow-hidden animate-in slide-in-from-bottom sm:slide-in-from-right duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Header with Close - PINNED AT TOP */}
            <div className="flex items-center justify-between p-4 pb-3 border-b border-slate-800 bg-slate-900/95 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-base">{selectedHouse ? '🏡' : selectedCharacter ? '👷' : '🏢'}</span>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {selectedHouse
                    ? 'ข้อมูลบ้านและแปลง'
                    : selectedCharacter
                    ? 'ข้อมูลช่างและบทบาท'
                    : 'ข้อมูลสิ่งปลูกสร้าง'}
                </span>
              </div>
              <button
                onClick={() => {
                  onSelectHouse(null);
                  onSelectCharacter(null);
                  onSelectFacility?.(null);
                }}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
                title="ปิด"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-4 overflow-y-auto overscroll-contain space-y-3.5 flex-1">

            {/* Selected House Details */}
            {selectedHouse && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-black text-amber-400 flex items-center gap-2">
                      <span>แปลง {selectedHouse.plotName}</span>
                    </h3>
                    <p className="text-xs text-slate-300 font-medium">{selectedHouse.houseType}</p>
                    {/* Floor count badge */}
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {selectedHouse.floorCount === 1 ? (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black">
                          🏠 บ้านชั้นเดียว (1 ชั้น)
                        </span>
                      ) : selectedHouse.floorCount === 2 ? (
                        <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px] font-black">
                          🏢 บ้านสองชั้น (2 ชั้น)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black">
                          ⚠️ ยังไม่ระบุจำนวนชั้น
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-emerald-400">{selectedHouse.overallProgress}%</span>
                    <span className="block text-[10px] text-slate-400">ความคืบหน้า</span>
                  </div>
                </div>

                {/* 🛡️ Pending Inspection Queue Section */}
                {selectedHouse.pendingInspections && selectedHouse.pendingInspections.length > 0 && (
                  <div className="bg-amber-950/40 border border-amber-500/60 p-2.5 rounded-2xl text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-amber-400 font-bold">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck size={14} />
                        <span>งานรอตรวจสอบ ({selectedHouse.pendingInspections.length} รายการ)</span>
                      </span>
                    </div>
                    {selectedHouse.pendingInspections.map(pi => (
                      <div key={pi.id} className="bg-slate-900/60 p-2 rounded-xl border border-amber-500/30 space-y-0.5 text-[11px]">
                        <div className="flex justify-between font-bold">
                          <span className={pi.statusFor === 'Rework' ? 'text-rose-400' : 'text-amber-300'}>
                            {pi.statusFor === 'Rework' ? '⚠️ ต้องแก้ไข (Rework)' : `รอตรวจโดย ${pi.statusFor}`}
                          </span>
                          <span className="text-slate-400 font-mono">{pi.waitDurationText}</span>
                        </div>
                        <p className="text-slate-200">{pi.taskName}</p>
                        {pi.contractorName && (
                          <p className="text-[10px] text-slate-400">ผู้รับเหมา: {pi.contractorName}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Notice for unspecified floor count */}
                {(selectedHouse.floorCount === null || selectedHouse.floorCount === undefined) && (
                  <div className="bg-amber-950/40 border border-amber-700/60 p-2.5 rounded-2xl text-xs text-amber-200 space-y-0.5">
                    <p className="font-bold flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle size={14} className="shrink-0" />
                      <span>ยังไม่ระบุจำนวนชั้นในแบบบ้าน</span>
                    </p>
                    <p className="text-[11px] text-amber-200/90 leading-tight">
                      ผัง 3D แสดงตัวจำลองหมุดแนวเขตที่ดินเป็นกลาง กรุณากำหนดจำนวนชั้นในหน้าจัดการแบบบ้านเพื่อแสดงผลรูปทรงอาคารที่ถูกต้อง
                    </p>
                  </div>
                )}

                {/* 📐 Parcel Land Area vs Building Dimensions */}
                <div className="bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700/60 text-xs space-y-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">ขนาดที่ดินแปลง:</span>
                    <span className="font-bold text-slate-200">
                      {selectedHouse.cells ? `${selectedHouse.cells.length} ช่อง` : ''}
                      {selectedHouse.parcelWidth && selectedHouse.parcelDepth
                        ? ` (~${selectedHouse.parcelWidth.toFixed(1)}m × ${selectedHouse.parcelDepth.toFixed(1)}m)`
                        : ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">ขนาดตัวบ้าน (สัดส่วนจริง):</span>
                    <span className="font-bold text-amber-300">
                      {selectedHouse.buildingDimensionLabel ||
                        (selectedHouse.buildingWidth && selectedHouse.buildingDepth
                          ? `${selectedHouse.buildingWidth.toFixed(1)}m × ${selectedHouse.buildingDepth.toFixed(1)}m`
                          : 'ตามแบบบ้าน')}
                    </span>
                  </div>
                  {selectedHouse.isFragmented && (
                    <div className="bg-amber-950/40 border border-amber-700/60 p-1.5 rounded-xl text-[10px] text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle size={12} className="shrink-0" />
                      <span>แปลงนี้มีช่องที่ไม่ติดกันเป็นผืนเดียว (ตรวจพบช่องแยก)</span>
                    </div>
                  )}
                </div>

                {/* 🧭 House Placement & Orientation Controls */}
                <div className="bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700/60 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-300 flex items-center gap-1.5 text-xs">
                      <Compass size={14} className="text-amber-400" />
                      <span>จัดวางตัวบ้านในแปลง</span>
                    </span>
                    <span className="text-[11px] text-indigo-300 font-bold">
                      {selectedHouse.facingDirection === 'north'
                        ? 'หันหน้าทิศเหนือ'
                        : selectedHouse.facingDirection === 'east'
                        ? 'หันหน้าทิศตะวันออก'
                        : selectedHouse.facingDirection === 'west'
                        ? 'หันหน้าทิศตะวันตก'
                        : 'หันหน้าทิศใต้'}
                    </span>
                  </div>

                  {/* Nudge & Rotate Buttons */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {/* Rotate Buttons */}
                    <div className="flex items-center gap-1 bg-slate-900/70 p-1 rounded-xl border border-slate-700/60">
                      <button
                        onClick={() => onRotateHouse?.(selectedHouse.id, -Math.PI / 2)}
                        className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition"
                        title="หมุนตัวบ้านทวนเข็ม 90°"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <span className="text-[10px] font-mono px-1 text-slate-400">
                        {Math.round(((selectedHouse.placementRotation || 0) * 180) / Math.PI) % 360}°
                      </span>
                      <button
                        onClick={() => onRotateHouse?.(selectedHouse.id, Math.PI / 2)}
                        className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition"
                        title="หมุนตัวบ้านตามเข็ม 90°"
                      >
                        <RotateCw size={14} />
                      </button>
                    </div>

                    {/* D-Pad Nudge Buttons */}
                    <div className="flex items-center gap-1 bg-slate-900/70 p-1 rounded-xl border border-slate-700/60 text-[10px]">
                      <button
                        onClick={() => onNudgeHouse?.(selectedHouse.id, -0.5, 0)}
                        className="px-1.5 py-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded font-bold"
                        title="เลื่อนไปทางทิศตะวันตก (ซ้าย 0.5m)"
                      >
                        ←
                      </button>
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => onNudgeHouse?.(selectedHouse.id, 0, -0.5)}
                          className="px-1.5 py-0.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded font-bold leading-none"
                          title="เลื่อนไปทางทิศเหนือ (บน 0.5m)"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => onNudgeHouse?.(selectedHouse.id, 0, 0.5)}
                          className="px-1.5 py-0.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded font-bold leading-none"
                          title="เลื่อนไปทางทิศใต้ (ล่าง 0.5m)"
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        onClick={() => onNudgeHouse?.(selectedHouse.id, 0.5, 0)}
                        className="px-1.5 py-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded font-bold"
                        title="เลื่อนไปทางทิศตะวันออก (ขวา 0.5m)"
                      >
                        →
                      </button>
                    </div>
                  </div>

                  {/* Placement Boundary Validation Status */}
                  <div
                    className={`p-2 rounded-xl border text-[11px] flex items-center gap-1.5 ${
                      selectedHouse.isPlacementValid !== false
                        ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                    }`}
                  >
                    {selectedHouse.isPlacementValid !== false ? (
                      <>
                        <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
                        <span>ตัวบ้านและชายคาอยู่ในแนวเขตแปลงที่ดิน</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={13} className="shrink-0 text-rose-400" />
                        <span>{selectedHouse.placementViolationText || 'ตัวบ้านหรือชายคาล้ำออกนอกแปลง'}</span>
                      </>
                    )}
                  </div>

                  {/* Save / Reset Placement Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => onSavePlacement?.(selectedHouse.id)}
                      disabled={selectedHouse.isPlacementValid === false || isSavingPlacement}
                      className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${
                        selectedHouse.isPlacementValid === false || isSavingPlacement
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow'
                      }`}
                    >
                      <span>{isSavingPlacement ? 'กำลังบันทึก...' : 'บันทึกตำแหน่ง'}</span>
                    </button>
                    <button
                      onClick={() => onResetPlacement?.(selectedHouse.id)}
                      className="py-1.5 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 transition"
                      title="รีเซ็ตกลับไปกึ่งกลางแปลงและทิศแนะนำ"
                    >
                      รีเซ็ต
                    </button>
                  </div>

                  {savePlacementStatus && (
                    <p
                      className={`text-[10px] font-bold ${
                        savePlacementStatus.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {savePlacementStatus.message}
                    </p>
                  )}
                </div>

                {/* Current Stage */}
                <div className="bg-slate-800/70 p-2.5 rounded-2xl border border-slate-700/50 space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400">ขั้นตอนปัจจุบัน:</span>
                    <span className="text-indigo-300">{getStageLabel(selectedHouse.currentStage)}</span>
                  </div>
                  {/* Modular Stage Progress Breakdown */}
                  <div className="space-y-1 pt-1 text-[11px]">
                    <div className="flex justify-between text-slate-400">
                      <span>ฐานราก:</span>
                      <span className="font-mono text-slate-200">{selectedHouse.stageProgress.foundation}%</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>เสาคาน:</span>
                      <span className="font-mono text-slate-200">{selectedHouse.stageProgress.structure}%</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>ก่อฉาบ:</span>
                      <span className="font-mono text-slate-200">{selectedHouse.stageProgress.masonry}%</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>หลังคา:</span>
                      <span className="font-mono text-slate-200">{selectedHouse.stageProgress.roofing}%</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>สถาปัตย์/สี:</span>
                      <span className="font-mono text-slate-200">{selectedHouse.stageProgress.finishing}%</span>
                    </div>
                  </div>
                  {/* Truthful Stage Limitation Notice */}
                  <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-700/50">
                    {selectedHouse.stageDetailsComplete
                      ? '✓ มีบันทึกรายละเอียดงานรายชั้น'
                      : 'ℹ️ ประเมินจากหมวดงานหลัก (ยังไม่มีข้อมูลแยกระดับชั้น)'}
                  </p>
                </div>

                {/* Daily Activity (Today) & Assigned Team */}
                <div className="text-xs bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/40 space-y-1.5">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-700/40">
                    <span className="text-slate-400 text-[10px]">กิจกรรมวันนี้ ({dateStr}):</span>
                    <span className={`font-bold text-[11px] ${
                      selectedHouse.todayHasActivity ? 'text-emerald-300' : 'text-slate-400'
                    }`}>
                      {selectedHouse.todayHasActivity
                        ? `${selectedHouse.todayIcon || '🟢'} ${selectedHouse.todayActionText}${selectedHouse.todayActorName ? ` (${selectedHouse.todayActorName})` : ''}`
                        : '⚪ ไม่มีรายงานใหม่'}
                    </span>
                  </div>
                  {selectedHouse.assignedTeamName && (
                    <div>
                      <span className="text-slate-400 block text-[10px]">ทีมช่างผู้รับผิดชอบ:</span>
                      <span className="font-bold text-amber-300">{selectedHouse.assignedTeamName}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-400 block text-[10px]">รายงานล่าสุด ({selectedHouse.lastUpdateTime}):</span>
                    <span className="font-bold text-slate-200">{selectedHouse.lastUpdateText}</span>
                  </div>
                </div>

                {/* Defect Alerts */}
                {selectedHouse.defectCount > 0 ? (
                  <div className="bg-rose-950/40 border border-rose-800/60 p-2.5 rounded-xl space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
                      <AlertTriangle size={14} />
                      <span>พบดีเฟกต์รอแก้ไข {selectedHouse.defectCount} รายการ</span>
                    </div>
                    {selectedHouse.defects.map(d => (
                      <p key={d.id} className="text-[11px] text-rose-200 leading-tight">
                        • {d.title} ({d.severity})
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/30 p-2 rounded-xl border border-emerald-800/40">
                    <CheckCircle2 size={14} />
                    <span>ไม่มีรายการดีเฟกต์ค้าง</span>
                  </div>
                )}

                {/* Recent Photo Preview */}
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-bold block">ภาพถ่ายล่าสุดจากไซต์:</span>
                  {selectedHouse.latestPhotoUrl && !failedImages[selectedHouse.latestPhotoUrl] ? (
                    <div
                      onClick={() => setModalPhotoUrl(selectedHouse.latestPhotoUrl || null)}
                      className="group relative w-full h-28 rounded-xl overflow-hidden border border-slate-700/80 shadow cursor-pointer bg-slate-900"
                      title="คลิกเพื่อดูรูปขยาย"
                    >
                      <img
                        src={selectedHouse.latestPhotoUrl}
                        alt={`ภาพถ่ายแปลง ${selectedHouse.plotName}`}
                        onError={() => {
                          if (selectedHouse.latestPhotoUrl) {
                            setFailedImages(prev => ({ ...prev, [selectedHouse.latestPhotoUrl!]: true }));
                          }
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold backdrop-blur-[2px]">
                        <ZoomIn size={14} className="text-amber-400" />
                        <span>คลิกเพื่อดูรูปขยาย</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed border-slate-700/80 bg-slate-800/40 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                      <ImageIcon size={15} className="text-slate-500 shrink-0" />
                      <span className="text-[11px] text-slate-400">ยังไม่มีภาพถ่ายหน้างานล่าสุด</span>
                    </div>
                  )}
                </div>

                {/* Open Plot View Button */}
                {onOpenFullPlotDetail && (
                  <button
                    onClick={() => onOpenFullPlotDetail(selectedHouse.id)}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-1.5"
                  >
                    <span>ดูรายละเอียดงวดงานเต็ม</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Selected Character Details */}
            {selectedCharacter && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <span>{selectedCharacter.name}</span>
                    </h3>
                    <p className="text-xs text-amber-300 font-bold">{selectedCharacter.roleLabel}</p>
                    <p className="text-[11px] text-slate-400">{selectedCharacter.teamName}</p>
                    {selectedCharacter.isTeam && selectedCharacter.reporterName && (
                      <p className="text-[10px] text-slate-400 pt-0.5">
                        รายงานโดย: <span className="text-slate-200">{selectedCharacter.reporterName}</span>
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      selectedCharacter.businessState === 'in_progress'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : selectedCharacter.businessState === 'resting'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : selectedCharacter.businessState === 'waiting_material'
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}
                  >
                    {selectedCharacter.businessState === 'in_progress'
                      ? 'กำลังทำงาน'
                      : selectedCharacter.businessState === 'resting'
                      ? 'กำลังพัก'
                      : selectedCharacter.businessState === 'waiting_material'
                      ? 'รอวัสดุ'
                      : 'ตรวจงาน'}
                  </span>
                </div>

                {/* Speech Bubble */}
                {selectedCharacter.speechText && (
                  <div className="bg-indigo-950/60 p-2.5 rounded-2xl border border-indigo-700/50 text-xs text-indigo-200">
                    <span className="font-bold text-amber-400">💬 ข้อความ: </span>
                    <span>"{selectedCharacter.speechText}"</span>
                  </div>
                )}

                {/* Action Detail */}
                <div className="bg-slate-800/70 p-2.5 rounded-xl border border-slate-700/40 text-xs space-y-1">
                  <span className="text-slate-400 text-[10px] block">งานที่กำลังทำ:</span>
                  <p className="font-bold text-slate-200">{selectedCharacter.taskName}</p>
                  <p className="text-[11px] text-slate-400">{selectedCharacter.actionDetail}</p>
                </div>

                {/* Honest GPS notice */}
                {selectedCharacter.isSimulated && (
                  <p className="text-[10px] text-slate-500 leading-tight">
                    ℹ️ ตำแหน่งการเดินเป็นการจำลองการเคลื่อนที่ตามงานที่ได้รับมอบหมายจริง (ไม่ได้ใช้ GPS พนักงาน)
                  </p>
                )}

                {/* Follow Button */}
                <button
                  onClick={() =>
                    onFollowCharacter(
                      followedCharacterId === selectedCharacter.id ? null : selectedCharacter.id
                    )
                  }
                  className={`w-full py-2 text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-1.5 ${
                    followedCharacterId === selectedCharacter.id
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <Eye size={14} />
                  <span>
                    {followedCharacterId === selectedCharacter.id
                      ? 'ยกเลิกติดตามกล้อง'
                      : 'ติดตามตัวละครนี้ (Follow Camera)'}
                  </span>
                </button>
              </div>
            )}

            {/* Selected Facility Details */}
            {selectedFacility && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-amber-400 flex items-center gap-2">
                      <span>{selectedFacility.name}</span>
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                          selectedFacility.source === 'demo_facility'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        }`}
                      >
                        {selectedFacility.source === 'demo_facility'
                          ? 'อาคารจำลอง (Demo Only)'
                          : 'สาธารณูปโภคโครงการ'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/70 p-2.5 rounded-2xl border border-slate-700/50 text-xs text-slate-300 space-y-1">
                  <span className="text-slate-400 text-[10px] block">คำอธิบายและวัตถุประสงค์:</span>
                  <p>{selectedFacility.description || 'สิ่งปลูกสร้างส่วนกลางในไซต์ก่อสร้าง'}</p>
                </div>

                {selectedFacility.source === 'demo_facility' && (
                  <div className="bg-amber-950/40 border border-amber-700/60 p-2.5 rounded-2xl text-xs text-amber-200 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle size={14} className="shrink-0" />
                      <span>ที่มาของสิ่งปลูกสร้างนี้</span>
                    </p>
                    <p className="text-[11px] text-amber-200/90 leading-tight">
                      อาคารนี้สร้างขึ้นสำหรับโหมดจำลองบรรยากาศ (Demo Mode) เช่น ศาลาพักคนงานหรือลานรวมวัสดุ เพื่อให้เห็นการเดินและการทำงานของตัวละคร โดยจะไม่ปรากฏในโหมดข้อมูลจริงของโครงการ เว้นแต่จะถูกกำหนดในผังงานโครงการ
                    </p>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* 🖼️ Fullscreen Photo Modal */}
      {modalPhotoUrl && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setModalPhotoUrl(null)}
        >
          <div className="relative max-w-3xl max-h-[85vh] bg-slate-900 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl">
            <button
              onClick={() => setModalPhotoUrl(null)}
              className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/90 text-white rounded-full transition z-10"
            >
              <X size={18} />
            </button>
            <img
              src={modalPhotoUrl}
              alt="Inspection Photo"
              onError={() => {
                setFailedImages(prev => ({ ...prev, [modalPhotoUrl]: true }));
                setModalPhotoUrl(null);
              }}
              className="w-full h-auto max-h-[80vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
