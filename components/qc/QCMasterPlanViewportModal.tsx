// ==============================================================================
// 📍 BUILDTRACK: QC MASTER PLAN VIEWPORT MODAL (ระบบล็อคมุมมองแปลงบนผังรวม)
// ==============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Check, ZoomIn, ZoomOut, RotateCcw, Smartphone, 
  MapPin, CheckCircle, AlertCircle, ArrowRight, Loader2, Save, Eye 
} from 'lucide-react';
import { QCReferenceDrawing, QCPlotDrawingViewport } from '@/types/qc.types';
import { 
  savePlotDrawingViewport, 
  getProjectPlotViewports, 
  deletePlotDrawingViewport 
} from '@/lib/qc/qcDrawingService';
import QCDrawingViewer from './QCDrawingViewer';

interface QCMasterPlanViewportModalProps {
  isOpen: boolean;
  onClose: () => void;
  drawing: QCReferenceDrawing | null;
  projectName: string;
  plots: any[];
  onSaved?: () => void;
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 25.0;
const ZOOM_PRESETS = [2, 5, 10, 15, 20, 25];

function getZoomStep(currentZoom: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    if (currentZoom >= 10) return 1.0;
    if (currentZoom >= 4) return 0.5;
    return 0.25;
  }
  if (currentZoom > 10) return 1.0;
  if (currentZoom > 4) return 0.5;
  return 0.25;
}

export default function QCMasterPlanViewportModal({
  isOpen,
  onClose,
  drawing,
  projectName,
  plots = [],
  onSaved
}: QCMasterPlanViewportModalProps) {
  const [selectedPlotId, setSelectedPlotId] = useState<string>('');
  const [viewports, setViewports] = useState<QCPlotDrawingViewport[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Viewport coordinates (% of image width/height: 0 to 100)
  const [xPercent, setXPercent] = useState<number>(50);
  const [yPercent, setYPercent] = useState<number>(50);
  const [zoomLevel, setZoomLevel] = useState<number>(2.0);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const phoneImageRef = useRef<HTMLImageElement>(null);
  const phoneDragStartRef = useRef<{
    clientX: number;
    clientY: number;
    xPercent: number;
    yPercent: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPhoneDragging, setIsPhoneDragging] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);

  // Filter plots of this project
  const projectPlots = plots.filter(p => p.project_name === projectName || !p.project_name);

  // Fetch all existing viewports for this drawing in the project
  const loadViewports = async () => {
    if (!drawing?.id) return;
    setLoading(true);
    try {
      const data = await getProjectPlotViewports(projectName, drawing.id);
      setViewports(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && drawing) {
      loadViewports();
      if (projectPlots.length > 0 && !selectedPlotId) {
        setSelectedPlotId(projectPlots[0].id);
      }
    }
  }, [isOpen, drawing]);

  // When selected plot changes, load its existing viewport or reset coordinates while keeping zoomLevel
  useEffect(() => {
    if (!selectedPlotId) return;
    const existing = viewports.find(v => v.plot_id === selectedPlotId);
    if (existing) {
      setXPercent(Number(existing.x_percent));
      setYPercent(Number(existing.y_percent));
      setZoomLevel(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(existing.zoom_level) || 2.0)));
    } else {
      setXPercent(50);
      setYPercent(50);
    }
  }, [selectedPlotId, viewports]);

  if (!isOpen || !drawing) return null;

  const clampZoom = (val: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(val.toFixed(2))));

  // Handle clicking or dragging on master plan image to move viewport center
  const handleImageInteraction = (clientX: number, clientY: number) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;

    const clampX = Math.max(0, Math.min(100, (rawX / rect.width) * 100));
    const clampY = Math.max(0, Math.min(100, (rawY / rect.height) * 100));

    setXPercent(Number(clampX.toFixed(2)));
    setYPercent(Number(clampY.toFixed(2)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleImageInteraction(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleImageInteraction(e.clientX, e.clientY);
    } else if (isPhoneDragging && phoneDragStartRef.current && phoneImageRef.current) {
      const imgWidth = phoneImageRef.current.offsetWidth;
      const imgHeight = phoneImageRef.current.offsetHeight;
      if (imgWidth > 0 && imgHeight > 0) {
        const deltaX = e.clientX - phoneDragStartRef.current.clientX;
        const deltaY = e.clientY - phoneDragStartRef.current.clientY;
        const nextX = Math.max(
          0,
          Math.min(100, phoneDragStartRef.current.xPercent - (deltaX / imgWidth) * 100)
        );
        const nextY = Math.max(
          0,
          Math.min(100, phoneDragStartRef.current.yPercent - (deltaY / imgHeight) * 100)
        );
        setXPercent(Number(nextX.toFixed(2)));
        setYPercent(Number(nextY.toFixed(2)));
      }
    }
  };

  const handlePhoneMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    phoneDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      xPercent,
      yPercent
    };
    setIsPhoneDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsPhoneDragging(false);
    phoneDragStartRef.current = null;
  };

  // Save current plot viewport
  const handleSave = async (andNext: boolean = false) => {
    if (!selectedPlotId || !drawing?.id) return;
    setSaving(true);
    try {
      await savePlotDrawingViewport({
        project_name: projectName,
        plot_id: selectedPlotId,
        drawing_id: drawing.id,
        x_percent: xPercent,
        y_percent: yPercent,
        zoom_level: zoomLevel
      });

      await loadViewports();
      if (onSaved) onSaved();

      if (andNext) {
        // Find next plot in list
        const currentIndex = projectPlots.findIndex(p => p.id === selectedPlotId);
        if (currentIndex >= 0 && currentIndex < projectPlots.length - 1) {
          setSelectedPlotId(projectPlots[currentIndex + 1].id);
        }
      }
    } catch (err: any) {
      alert(err.message || 'บันทึกมุมมองไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const currentHasSaved = viewports.some(v => v.plot_id === selectedPlotId);
  const selectedPlotObj = projectPlots.find(p => p.id === selectedPlotId);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl max-w-6xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20">
              <MapPin size={20} />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-base sm:text-lg flex items-center gap-2">
                <span>📍 กำหนดมุมมองแปลงบนผังรวม (Master Plan Viewport)</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                แบบ: {drawing.drawing_number} - {drawing.title} • โครงการ: {projectName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Top Control Bar */}
        <div className="px-4 py-2.5 sm:py-3 border-b border-slate-100 bg-white flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-bold text-slate-600">เลือกแปลงที่ต้องการตั้งค่า:</label>
            <select
              value={selectedPlotId}
              onChange={(e) => setSelectedPlotId(e.target.value)}
              className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl font-bold text-xs text-slate-800 outline-none focus:border-purple-500 cursor-pointer min-w-[160px]"
            >
              {projectPlots.map(p => {
                const isMapped = viewports.some(v => v.plot_id === p.id);
                return (
                  <option key={p.id} value={p.id}>
                    {isMapped ? '✅ ' : '⚪ '} {p.plot_name || p.id} {p.house_type_id ? `(${p.house_type_id.slice(0, 8)})` : ''}
                  </option>
                );
              })}
            </select>

            {currentHasSaved ? (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center gap-1 border border-emerald-200">
                <CheckCircle size={12} />
                <span>ล็อคมุมมองแล้ว</span>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center gap-1 border border-amber-200">
                <AlertCircle size={12} />
                <span>ยังไม่ได้ล็อคมุมมอง</span>
              </span>
            )}
          </div>

          {/* Zoom Level & Reset Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setZoomLevel(prev => clampZoom(prev - getZoomStep(prev, 'out')))}
                disabled={zoomLevel <= MIN_ZOOM}
                className="p-1.5 rounded-lg bg-white shadow-sm hover:bg-slate-50 text-slate-700 disabled:opacity-40"
                title="ซูมออก"
              >
                <ZoomOut size={14} />
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.25}
                value={zoomLevel}
                onChange={(e) => setZoomLevel(clampZoom(Number(e.target.value)))}
                aria-label="ระดับการซูม"
                className="w-24 sm:w-28 accent-purple-600 cursor-pointer"
              />
              <span className="text-xs font-mono font-bold px-1.5 text-slate-700 min-w-[52px] text-center">
                {zoomLevel.toFixed(2)}x
              </span>
              <button
                type="button"
                onClick={() => setZoomLevel(prev => clampZoom(prev + getZoomStep(prev, 'in')))}
                disabled={zoomLevel >= MAX_ZOOM}
                className="p-1.5 rounded-lg bg-white shadow-sm hover:bg-slate-50 text-slate-700 disabled:opacity-40"
                title="ซูมเข้า"
              >
                <ZoomIn size={14} />
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              {ZOOM_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setZoomLevel(preset)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition ${
                    Math.abs(zoomLevel - preset) < 0.01
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  {preset}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setXPercent(50);
                setYPercent(50);
                setZoomLevel(2.0);
              }}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              title="รีเซ็ตตำแหน่งกึ่งกลาง"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        {/* Workspace Body: Master Canvas on Left, Live Mobile Preview on Right */}
        <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
          {/* Left Canvas: Full Master Plan (7 Cols) */}
          <div className="lg:col-span-7 bg-slate-900 p-3 sm:p-4 min-h-0 flex flex-col items-center overflow-auto relative select-none">
            <div className="my-auto flex flex-col items-center w-full">
              <p className="text-[11px] text-slate-400 mb-2 font-medium text-center">
                💡 คลิกหรือลากเป้าสีม่วงบนผัง เพื่อกำหนดจุดกึ่งกลางของแปลง <span className="font-bold text-white">{selectedPlotObj?.plot_name || selectedPlotId}</span>
              </p>

              <div 
                ref={imageContainerRef}
                onMouseDown={handleMouseDown}
                className="relative max-w-full max-h-[40vh] lg:max-h-[46vh] inline-block cursor-crosshair rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl"
              >
                <img
                  src={drawing.file_url}
                  alt={drawing.title}
                  className="max-h-[40vh] lg:max-h-[46vh] w-auto object-contain block pointer-events-none"
                  draggable={false}
                />

                {/* Marker dots of other already mapped plots */}
                {viewports.filter(v => v.plot_id !== selectedPlotId).map(v => (
                  <div
                    key={v.plot_id}
                    style={{ left: `${v.x_percent}%`, top: `${v.y_percent}%` }}
                    className="absolute w-2.5 h-2.5 -ml-1.5 -mt-1.5 rounded-full bg-emerald-500/80 border border-white shadow-sm pointer-events-none"
                    title={`แปลง ${v.plot_id}`}
                  />
                ))}

                {/* Active Target Focus Reticle for Current Plot */}
                <div
                  style={{
                    left: `${xPercent}%`,
                    top: `${yPercent}%`,
                    transform: 'translate(-50%, -50%)',
                    width: `${100 / zoomLevel}%`,
                    height: `${100 / zoomLevel}%`,
                    minWidth: '16px',
                    minHeight: '16px'
                  }}
                  className="absolute border-2 border-purple-500 bg-purple-500/20 rounded-lg shadow-xl pointer-events-none flex items-center justify-center"
                >
                  <div className="w-2 h-2 bg-purple-600 rounded-full border border-white shadow" />
                  <span className="absolute -top-6 bg-purple-600 text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md whitespace-nowrap">
                    {selectedPlotObj?.plot_name || selectedPlotId}
                  </span>
                </div>
              </div>

              <div className="mt-2.5 text-[11px] font-mono text-slate-400 flex items-center gap-4">
                <span>X: {xPercent}%</span>
                <span>Y: {yPercent}%</span>
                <span>Zoom: {zoomLevel}x</span>
              </div>
            </div>
          </div>

          {/* Right Preview: Live Phone Mockup (5 Cols) */}
          <div className="lg:col-span-5 bg-slate-50 p-3 sm:p-4 min-h-0 flex flex-col items-center overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-200">
            <div className="my-auto flex flex-col items-center w-full">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone size={16} className="text-purple-600" />
                <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider">
                  ภาพตัวอย่างมุมมองในมือถือของ QC
                </h4>
              </div>

              {/* Simulated Phone Frame */}
              <div className="w-[240px] sm:w-[255px] h-[270px] sm:h-[300px] lg:h-[min(330px,40vh)] bg-slate-900 rounded-[2.25rem] p-2.5 shadow-2xl border-4 border-slate-700 relative flex flex-col overflow-hidden shrink-0">
                {/* Screen Top Bar */}
                <div className="flex justify-between items-center text-[9px] text-white/70 px-4 py-1">
                  <span>09:41</span>
                  <span className="font-bold text-purple-400">QC Drawing View</span>
                  <span>100%</span>
                </div>

                {/* Simulated Screen Viewport with CSS Transform */}
                <div
                  onMouseDown={handlePhoneMouseDown}
                  className="flex-1 bg-slate-950 rounded-2xl overflow-hidden relative border border-slate-800 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
                  title="ลากบนจอมือถือเพื่อขยับตำแหน่งจุดกึ่งกลางอย่างละเอียด"
                >
                  <div 
                    className="w-full h-full relative"
                    style={{
                      overflow: 'hidden'
                    }}
                  >
                    <img
                      ref={phoneImageRef}
                      src={drawing.file_url}
                      alt="Preview"
                      draggable={false}
                      className={`absolute max-w-none pointer-events-none ${isPhoneDragging || isDragging ? '' : 'transition-all duration-75'}`}
                      style={{
                        width: `${zoomLevel * 100}%`,
                        height: 'auto',
                        left: '50%',
                        top: '50%',
                        transform: `translate(-${xPercent}%, -${yPercent}%)`,
                      }}
                    />
                    {/* Center Crosshair Marker */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-6 h-6 border-2 border-purple-500/80 rounded-full flex items-center justify-center shadow-lg bg-purple-500/10">
                        <div className="w-1.5 h-1.5 bg-purple-600 rounded-full" />
                      </div>
                    </div>
                  </div>

                  {/* Plot Badge Overlay inside Phone Screen */}
                  <div className="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-sm text-white px-2 py-0.5 rounded-md text-[9px] font-bold border border-slate-700 pointer-events-none">
                    แปลง: {selectedPlotObj?.plot_name || selectedPlotId}
                  </div>
                  <div className="absolute bottom-2 right-2 bg-purple-600 text-white px-2 py-0.5 rounded-md text-[9px] font-mono font-bold pointer-events-none">
                    {zoomLevel.toFixed(1)}x
                  </div>
                </div>

                {/* Home indicator bar */}
                <div className="w-24 h-1 bg-white/40 rounded-full mx-auto mt-1.5" />
              </div>

              <p className="text-[11px] text-slate-500 text-center mt-2 max-w-[280px] leading-snug">
                ลากบนจอมือถือเพื่อเลื่อนตำแหน่งอย่างละเอียด • เมื่อ QC เปิดตรวจแปลงนี้ แอปจะซูมเข้ามาที่มุมนี้ให้โดยอัตโนมัติ
              </p>

              <button
                type="button"
                onClick={() => setShowFullPreview(true)}
                className="mt-2 px-3.5 py-2 bg-white hover:bg-purple-50 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition shrink-0"
              >
                <Eye size={14} />
                <span>ทดลองดูหน้าตรวจ QC จริง (เช็กความชัด)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
          <div className="text-xs font-bold text-slate-500">
            ความคืบหน้าการตั้งค่า: <span className="text-purple-700 font-black">{viewports.length}</span> จาก <span className="text-slate-800 font-black">{projectPlots.length}</span> แปลง
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-200/50 transition"
            >
              ปิดหน้าต่าง
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md shadow-purple-500/20 flex items-center justify-center gap-1.5 transition"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>บันทึกมุมมอง</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md flex items-center justify-center gap-1.5 transition"
            >
              <span>บันทึก & แปลงถัดไป</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Full QC Viewer Preview Overlay */}
      {showFullPreview && (
        <div className="fixed inset-0 z-[1100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
          <div className="w-full max-w-5xl max-h-[95vh] bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl overflow-y-auto flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between text-white">
              <div>
                <h4 className="font-bold text-sm sm:text-base">
                  ตัวอย่างมุมมองจริงในหน้าตรวจ QC — แปลง {selectedPlotObj?.plot_name || selectedPlotId}
                </h4>
                <p className="text-[11px] text-slate-400">
                  ระดับซูม {zoomLevel.toFixed(2)}x • พิกัด ({xPercent}%, {yPercent}%) — สามารถลากเลื่อนหรือซูมเข้า/ออกเพื่อเช็กความชัดจริงได้
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFullPreview(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <X size={14} />
                <span>ปิดตัวอย่าง</span>
              </button>
            </div>
            <QCDrawingViewer
              drawing={drawing}
              annotations={[]}
              readOnly={true}
              viewport={{
                project_name: projectName,
                plot_id: selectedPlotId,
                drawing_id: drawing.id,
                x_percent: xPercent,
                y_percent: yPercent,
                zoom_level: zoomLevel
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
