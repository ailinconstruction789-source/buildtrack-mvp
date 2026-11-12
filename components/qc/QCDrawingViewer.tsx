// ==============================================================================
// 📐 BUILDTRACK: QC DRAWING VIEWER COMPONENT (แปลนอ้างอิงและจุดปักหมุด)
// ==============================================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  ZoomIn, ZoomOut, RotateCcw, MapPin, Eye, Plus, X, CheckCircle, AlertTriangle, 
  ChevronLeft, ChevronRight, Maximize2, Minimize2, Info 
} from 'lucide-react';
import { QCReferenceDrawing, QCDrawingPage, QCDrawingAnnotation, QCFormItem, QCPlotDrawingViewport } from '@/types/qc.types';
import { calculateNormalizedRatio, calculatePixelPosition, generateNextPinLabel, getPinStatusStyle } from '@/lib/qc/qcDrawingService';

interface QCDrawingViewerProps {
  drawing: QCReferenceDrawing;
  annotations: QCDrawingAnnotation[];
  onAddAnnotation?: (newPin: QCDrawingAnnotation) => void;
  onUpdateAnnotation?: (updatedPin: QCDrawingAnnotation) => void;
  onDeleteAnnotation?: (pinIndex: number) => void;
  selectedFormItems?: QCFormItem[];
  readOnly?: boolean;
  selectedPages?: number[];
  initialPage?: number;
  viewport?: QCPlotDrawingViewport | null;
}

const MIN_VIEWER_ZOOM = 0.5;
const MAX_VIEWER_ZOOM = 25.0;

export default function QCDrawingViewer({
  drawing,
  annotations = [],
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  selectedFormItems = [],
  readOnly = false,
  selectedPages = [],
  initialPage = 1,
  viewport
}: QCDrawingViewerProps) {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [zoomLevel, setZoomLevel] = useState<number>(viewport?.zoom_level ? Number(viewport.zoom_level) : 1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedPinIndex, setSelectedPinIndex] = useState<number | null>(null);
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [temporaryPin, setTemporaryPin] = useState<QCDrawingAnnotation | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // กรองหน้าที่อนุญาตให้แสดง
  const availablePages = drawing.pages && drawing.pages.length > 0 
    ? drawing.pages.filter(p => selectedPages.length === 0 || selectedPages.includes(p.page_number))
    : [{ id: 'p1', drawing_id: drawing.id, page_number: 1, page_label: 'หน้า 1: แปลนหลัก', width: 1920, height: 1080 }];

  const activePageObj = availablePages.find(p => p.page_number === currentPage) || availablePages[0];
  const activeImageSrc = activePageObj?.page_image_url || drawing.file_url;

  useEffect(() => {
    setBaseSize(null);
  }, [activeImageSrc, isExpanded]);

  // หมุดในหน้าปัจจุบัน
  const currentPagePins = annotations.map((ann, idx) => ({ ...ann, originalIndex: idx }))
    .filter(a => a.page_number === currentPage);

  const applyViewportCenter = useCallback((w: number, h: number) => {
    if (viewport && viewport.zoom_level) {
      const targetZoom = Math.min(MAX_VIEWER_ZOOM, Math.max(MIN_VIEWER_ZOOM, Number(viewport.zoom_level)));
      setZoomLevel(targetZoom);
      if (w > 0 && h > 0) {
        const offsetX = (0.5 - Number(viewport.x_percent) / 100) * (w * targetZoom);
        const offsetY = (0.5 - Number(viewport.y_percent) / 100) * (h * targetZoom);
        setPanOffset({ x: Math.round(offsetX), y: Math.round(offsetY) });
      }
      return true;
    }
    return false;
  }, [viewport]);

  const centerOnViewport = useCallback(() => {
    const w = baseSize?.width || containerRef.current?.offsetWidth || 0;
    const h = baseSize?.height || containerRef.current?.offsetHeight || 0;
    return applyViewportCenter(w, h);
  }, [applyViewportCenter, baseSize]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (natW > 0 && natH > 0) {
      const canvasW = canvasRef.current?.clientWidth || 800;
      const canvasH = canvasRef.current?.clientHeight || 500;
      const maxFitW = Math.max(240, canvasW - 24);
      const maxFitH = isExpanded ? Math.max(300, canvasH - 24) : Math.min(500, Math.max(240, canvasH - 24));
      const fitScale = Math.min(maxFitW / natW, maxFitH / natH, 1);
      const nextBase = {
        width: Math.max(1, Math.round(natW * fitScale)),
        height: Math.max(1, Math.round(natH * fitScale))
      };
      setBaseSize(nextBase);
      applyViewportCenter(nextBase.width, nextBase.height);
    } else {
      centerOnViewport();
    }
  };

  // Zoom controls
  const applyZoomChange = (newZoom: number) => {
    setZoomLevel(prevZoom => {
      if (prevZoom > 0 && newZoom !== prevZoom) {
        const ratio = newZoom / prevZoom;
        setPanOffset(prevPan => ({
          x: Math.round(prevPan.x * ratio),
          y: Math.round(prevPan.y * ratio)
        }));
      }
      return newZoom;
    });
  };

  const handleZoomIn = () => {
    const step = zoomLevel >= 10 ? 1.0 : zoomLevel >= 4 ? 0.5 : 0.25;
    applyZoomChange(Math.min(Number((zoomLevel + step).toFixed(2)), MAX_VIEWER_ZOOM));
  };
  const handleZoomOut = () => {
    const step = zoomLevel > 10 ? 1.0 : zoomLevel > 4 ? 0.5 : 0.25;
    applyZoomChange(Math.max(Number((zoomLevel - step).toFixed(2)), MIN_VIEWER_ZOOM));
  };
  const handleResetZoom = () => {
    if (centerOnViewport()) return;
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Center on viewport if provided
  useEffect(() => {
    centerOnViewport();
  }, [centerOnViewport]);

  // Pan controls (Mouse drag)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isPlacingPin) return;
    if (e.button === 0) { // Left click
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  // Handle click on drawing to place a pin
  const handleDrawingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacingPin || readOnly || !onAddAnnotation || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const coord = calculateNormalizedRatio(e.clientX, e.clientY, rect);
    const label = generateNextPinLabel(annotations, currentPage);

    const newPin: QCDrawingAnnotation = {
      page_number: currentPage,
      pin_label: label,
      x_ratio: coord.xRatio,
      y_ratio: coord.yRatio,
      status: 'passed',
      measured_value: null,
      unit: '',
      remarks: '',
      form_item_id: selectedFormItems.length > 0 ? selectedFormItems[0].id : null
    };

    setTemporaryPin(newPin);
    setIsPlacingPin(false);
  };

  const confirmAddPin = () => {
    if (temporaryPin && onAddAnnotation) {
      onAddAnnotation(temporaryPin);
      setTemporaryPin(null);
    }
  };

  const cancelAddPin = () => {
    setTemporaryPin(null);
  };

  return (
    <div className={`flex flex-col bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 shadow-xl relative ${isExpanded ? 'fixed inset-4 z-[1000]' : 'h-[550px] sm:h-[620px]'}`}>
      {/* 🌟 Toolbar 🌟 */}
      <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 text-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-purple-600/30 p-1.5 rounded-lg text-purple-400">
            <Eye size={18} />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold tracking-wide truncate max-w-[200px] sm:max-w-xs">{drawing.title}</h4>
            <p className="text-[10px] text-slate-400 font-mono">แบบที่: {drawing.drawing_number} (v{drawing.version})</p>
          </div>
        </div>

        {/* Page selector */}
        {availablePages.length > 1 && (
          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-1 rounded-xl border border-slate-700">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage <= 1}
              className="p-1 text-slate-300 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[11px] font-bold px-1 font-mono text-purple-300">
              หน้า {currentPage} / {availablePages.length}
            </span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, availablePages.length))}
              disabled={currentPage >= availablePages.length}
              className="p-1 text-slate-300 hover:text-white disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* View / Pin controls */}
        <div className="flex items-center gap-2">
          {!readOnly && onAddAnnotation && (
            <button
              onClick={() => {
                setIsPlacingPin(!isPlacingPin);
                setTemporaryPin(null);
              }}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md ${
                isPlacingPin 
                  ? 'bg-amber-500 text-slate-900 animate-pulse' 
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
            >
              <MapPin size={14} />
              <span>{isPlacingPin ? 'แตะบนแบบเพื่อปักหมุด' : 'ปักหมุดจุดวัด (+)'}</span>
            </button>
          )}

          {/* Zoom buttons */}
          <div className="flex items-center bg-slate-900/80 rounded-xl p-1 border border-slate-700 gap-1">
            <button onClick={handleZoomOut} className="p-1.5 text-slate-300 hover:text-white" title="ย่อ"><ZoomOut size={14} /></button>
            <span className="text-[10px] font-bold font-mono px-1 min-w-[44px] text-center">{Math.round(zoomLevel * 100)}%</span>
            <button onClick={handleZoomIn} className="p-1.5 text-slate-300 hover:text-white" title="ขยาย"><ZoomIn size={14} /></button>
            <button onClick={handleResetZoom} className="p-1.5 text-slate-400 hover:text-white border-l border-slate-700 ml-1" title="คืนค่าเดิม"><RotateCcw size={12} /></button>
          </div>

          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-200"
            title={isExpanded ? 'ย่อหน้าต่าง' : 'ขยายเต็มจอ'}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* 🌟 Drawing Canvas / Viewport 🌟 */}
      <div 
        ref={canvasRef}
        className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing bg-slate-950 flex items-center justify-center select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <div
          ref={containerRef}
          onClick={handleDrawingClick}
          className={`relative origin-center ${isPanning ? '' : 'transition-transform duration-75'}`}
          style={
            baseSize
              ? {
                  width: `${Math.round(baseSize.width * zoomLevel)}px`,
                  height: `${Math.round(baseSize.height * zoomLevel)}px`,
                  flexShrink: 0,
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
                  cursor: isPlacingPin ? 'crosshair' : 'inherit'
                }
              : {
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                  cursor: isPlacingPin ? 'crosshair' : 'inherit'
                }
          }
        >
          {/* Background Plan (Image or Page preview) */}
          {activeImageSrc ? (
            <img 
              ref={imageRef}
              src={activeImageSrc} 
              alt={drawing.title}
              onLoad={handleImageLoad}
              className={
                baseSize
                  ? 'w-full h-full block rounded-lg shadow-2xl pointer-events-auto border border-slate-800'
                  : 'max-h-[500px] w-auto object-contain rounded-lg shadow-2xl pointer-events-auto border border-slate-800'
              }
              draggable={false}
            />
          ) : (
            <div className="w-[600px] h-[400px] bg-slate-900 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-slate-400">
              <MapPin size={40} className="text-slate-600 mb-2" />
              <p className="text-sm font-bold">ไม่มีไฟล์ภาพแบบแปลน</p>
              <p className="text-xs text-slate-500 mt-1">ไฟล์ PDF: {drawing.file_name}</p>
            </div>
          )}

          {/* 📍 Existing Pins on Current Page 📍 */}
          {currentPagePins.map((pin) => {
            const style = getPinStatusStyle(pin.status);
            const rawPinScale = selectedPinIndex === pin.originalIndex ? 1.2 : 1;
            const pinScale = baseSize ? rawPinScale : rawPinScale / zoomLevel;
            return (
              <div
                key={`pin-${pin.originalIndex}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPinIndex(pin.originalIndex);
                }}
                className={`absolute cursor-pointer group z-20 transition-transform ${
                  selectedPinIndex === pin.originalIndex ? 'ring-4 ring-yellow-400 rounded-full' : ''
                }`}
                style={{
                  left: `${pin.x_ratio * 100}%`,
                  top: `${pin.y_ratio * 100}%`,
                  transform: `translate(-50%, -50%) scale(${pinScale})`
                }}
              >
                <div className={`${style.bgColor} ${style.borderColor} border-2 text-white font-mono font-bold text-[10px] px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1`}>
                  <MapPin size={10} />
                  <span>{pin.pin_label}</span>
                  {pin.measured_value !== null && pin.measured_value !== undefined && (
                    <span className="bg-black/30 px-1 rounded text-[9px]">
                      {pin.measured_value}{pin.unit || ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Placing indicator banner */}
        {isPlacingPin && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-900 px-4 py-2 rounded-full font-bold text-xs shadow-2xl flex items-center gap-2 pointer-events-none z-30 animate-bounce">
            <MapPin size={14} />
            <span>คลิก/แตะตำแหน่งบนแบบที่ต้องการปักหมุด</span>
          </div>
        )}
      </div>

      {/* 🌟 Modal สำหรับกรอกรายละเอียดหมุดใหม่ (Temporary Pin Editor) 🌟 */}
      {temporaryPin && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-40">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 max-w-sm w-full text-white shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <MapPin className="text-purple-400" size={18} />
                <h4 className="font-bold text-sm">ระบุข้อมูลจุดวัด {temporaryPin.pin_label}</h4>
              </div>
              <button onClick={cancelAddPin} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>

            <div className="space-y-3">
              {/* ผูกกับรายการคำถาม */}
              {selectedFormItems.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">เชื่อมกับข้อตรวจ</label>
                  <select
                    value={temporaryPin.form_item_id || ''}
                    onChange={(e) => setTemporaryPin({ ...temporaryPin, form_item_id: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-xs text-white outline-none focus:border-purple-500"
                  >
                    {selectedFormItems.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.item_code} - {item.item_text}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* ค่าที่วัดได้และหน่วย */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">ค่าที่วัดได้</label>
                  <input
                    type="number"
                    step="any"
                    value={temporaryPin.measured_value ?? ''}
                    onChange={(e) => setTemporaryPin({
                      ...temporaryPin,
                      measured_value: e.target.value === '' ? null : Number(e.target.value)
                    })}
                    placeholder="เช่น 15.5"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-xs text-white outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">หน่วย</label>
                  <input
                    type="text"
                    value={temporaryPin.unit || ''}
                    onChange={(e) => setTemporaryPin({ ...temporaryPin, unit: e.target.value })}
                    placeholder="เช่น มม., ซม."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-xs text-white outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* ผลการประเมิน */}
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">ผลประเมินจุดนี้</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTemporaryPin({ ...temporaryPin, status: 'passed' })}
                    className={`py-1.5 rounded-xl font-bold text-xs ${temporaryPin.status === 'passed' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-300'}`}
                  >
                    ผ่าน
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemporaryPin({ ...temporaryPin, status: 'failed' })}
                    className={`py-1.5 rounded-xl font-bold text-xs ${temporaryPin.status === 'failed' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-slate-300'}`}
                  >
                    ไม่ผ่าน
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemporaryPin({ ...temporaryPin, status: 'na' })}
                    className={`py-1.5 rounded-xl font-bold text-xs ${temporaryPin.status === 'na' ? 'bg-slate-600 text-white' : 'bg-slate-900 text-slate-300'}`}
                  >
                    N/A
                  </button>
                </div>
              </div>

              {/* หมายเหตุ */}
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">หมายเหตุจุดวัด</label>
                <input
                  type="text"
                  value={temporaryPin.remarks || ''}
                  onChange={(e) => setTemporaryPin({ ...temporaryPin, remarks: e.target.value })}
                  placeholder="ระบุรายละเอียดเพิ่มเติม..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-xs text-white outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelAddPin}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-xl text-xs font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={confirmAddPin}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 py-2 rounded-xl text-xs font-bold"
                >
                  บันทึกจุดวัด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 Detail Sheet สำหรับดู/ลบหมุดที่คลิกเลือก 🌟 */}
      {selectedPinIndex !== null && annotations[selectedPinIndex] && (
        <div className="absolute bottom-3 left-3 right-3 bg-slate-800/95 backdrop-blur-md border border-slate-700 rounded-xl p-3 text-white z-30 shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded-lg text-xs font-mono font-bold ${getPinStatusStyle(annotations[selectedPinIndex].status).bgColor}`}>
              {annotations[selectedPinIndex].pin_label}
            </span>
            <div>
              <p className="text-xs font-bold">
                {annotations[selectedPinIndex].measured_value !== null ? `ค่าที่วัด: ${annotations[selectedPinIndex].measured_value} ${annotations[selectedPinIndex].unit || ''}` : 'จุดตรวจพิกัด'}
              </p>
              {annotations[selectedPinIndex].remarks && (
                <p className="text-[10px] text-slate-300 truncate max-w-xs">{annotations[selectedPinIndex].remarks}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && onDeleteAnnotation && (
              <button
                onClick={() => {
                  onDeleteAnnotation(selectedPinIndex);
                  setSelectedPinIndex(null);
                }}
                className="bg-rose-900/60 hover:bg-rose-800 text-rose-200 px-2.5 py-1 rounded-lg text-[10px] font-bold"
              >
                ลบจุดนี้
              </button>
            )}
            <button
              onClick={() => setSelectedPinIndex(null)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
