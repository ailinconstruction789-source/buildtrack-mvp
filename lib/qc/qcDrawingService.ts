// ==============================================================================
// 📐 BUILDTRACK: QC DRAWING SERVICE (บริการคำนวณพิกัดและปักหมุดบนแบบอ้างอิง)
// ==============================================================================

import { QCDrawingAnnotation } from '@/types/qc.types';

export interface PinCoordinate {
  xRatio: number; // 0.0 to 1.0 (จากขอบซ้ายไปขวา)
  yRatio: number; // 0.0 to 1.0 (จากขอบบนลงล่าง)
}

/**
 * แปลงพิกัดจาก Click/Touch event บน container ของภาพ/เอกสาร ให้เป็น normalized ratio (0.0000 - 1.0000)
 */
export function calculateNormalizedRatio(
  clientX: number,
  clientY: number,
  containerRect: DOMRect
): PinCoordinate {
  if (containerRect.width <= 0 || containerRect.height <= 0) {
    return { xRatio: 0, yRatio: 0 };
  }

  const rawX = clientX - containerRect.left;
  const rawY = clientY - containerRect.top;

  // Clamp ระหว่าง 0 ถึง 1 เพื่อไม่ให้หลุดขอบ
  const xRatio = Math.max(0, Math.min(1, rawX / containerRect.width));
  const yRatio = Math.max(0, Math.min(1, rawY / containerRect.height));

  return {
    xRatio: Number(xRatio.toFixed(4)),
    yRatio: Number(yRatio.toFixed(4))
  };
}

/**
 * แปลง normalized ratio กลับมาเป็นพิกัด pixel บนหน้าจอตามขนาด container ปัจจุบัน
 */
export function calculatePixelPosition(
  pin: QCDrawingAnnotation,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number } {
  return {
    x: Math.round(pin.x_ratio * containerWidth),
    y: Math.round(pin.y_ratio * containerHeight)
  };
}

/**
 * สร้าง Label อัตโนมัติสำหรับหมุดถัดไป เช่น P01, P02, P03...
 */
export function generateNextPinLabel(existingPins: QCDrawingAnnotation[], pageNumber: number): string {
  const pagePins = existingPins.filter(p => p.page_number === pageNumber);
  const nextNum = pagePins.length + 1;
  return `P${String(nextNum).padStart(2, '0')}`;
}

/**
 * สีและสัญลักษณ์สำหรับแต่ละสถานะของหมุด
 */
export function getPinStatusStyle(status?: 'passed' | 'failed' | 'conditional' | 'na' | null): {
  bgColor: string;
  borderColor: string;
  textColor: string;
  badgeText: string;
} {
  switch (status) {
    case 'passed':
      return {
        bgColor: 'bg-emerald-600',
        borderColor: 'border-emerald-300',
        textColor: 'text-white',
        badgeText: 'ผ่าน'
      };
    case 'failed':
      return {
        bgColor: 'bg-rose-600',
        borderColor: 'border-rose-300',
        textColor: 'text-white',
        badgeText: 'ไม่ผ่าน'
      };
    case 'conditional':
      return {
        bgColor: 'bg-amber-600',
        borderColor: 'border-amber-300',
        textColor: 'text-white',
        badgeText: 'มีเงื่อนไข'
      };
    case 'na':
      return {
        bgColor: 'bg-slate-400',
        borderColor: 'border-slate-200',
        textColor: 'text-white',
        badgeText: 'N/A'
      };
    default:
      return {
        bgColor: 'bg-blue-600',
        borderColor: 'border-blue-300',
        textColor: 'text-white',
        badgeText: 'จุดวัด'
      };
  }
}

export interface PinEvaluationResult {
  status: 'passed' | 'failed' | 'uninspected';
  difference?: number | null;
  tolerance?: number | null;
  isWithinTolerance: boolean;
  message: string;
}

/**
 * คำนวณและประเมินค่าตัวเลขของหมุดจุดวัดเทียบกับเกณฑ์มาตรฐาน (Target vs Actual)
 * รองรับทั้ง:
 * 1. Target Value พร้อม Tolerance (เช่น Target = -0.29, Tolerance = 0.01 => [-0.30, -0.28])
 * 2. Min Value / Max Value (เช่น Min = 10, Max = 20)
 */
export function evaluatePinMeasurement(params: {
  measuredValue?: number | null;
  targetValue?: number | null;
  tolerance?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  unit?: string | null;
}): PinEvaluationResult {
  const { measuredValue, targetValue, tolerance, minValue, maxValue, unit = '' } = params;

  if (measuredValue === undefined || measuredValue === null || Number.isNaN(measuredValue)) {
    return {
      status: 'uninspected',
      isWithinTolerance: false,
      message: 'ยังไม่ได้ระบุค่าที่วัดได้'
    };
  }

  // 1. ถ้ามี min/max ชัดเจน
  if (minValue !== undefined && minValue !== null && maxValue !== undefined && maxValue !== null) {
    const isPass = measuredValue >= minValue && measuredValue <= maxValue;
    return {
      status: isPass ? 'passed' : 'failed',
      isWithinTolerance: isPass,
      message: isPass 
        ? `ค่าที่วัดได้ ${measuredValue} ${unit} อยู่ในช่วงยอมรับได้ (${minValue} - ${maxValue} ${unit})`
        : `ค่าที่วัดได้ ${measuredValue} ${unit} หลุดช่วงมาตรฐาน (${minValue} - ${maxValue} ${unit})`
    };
  }

  // 2. ถ้ามี Target Value
  if (targetValue !== undefined && targetValue !== null) {
    const diff = Number((measuredValue - targetValue).toFixed(4));
    const absDiff = Math.abs(diff);
    const tol = (tolerance !== undefined && tolerance !== null && tolerance >= 0) ? tolerance : 0;

    const isPass = absDiff <= (tol + 0.00001); // ป้องกัน floating point precision
    const sign = diff > 0 ? `+${diff}` : `${diff}`;

    return {
      status: isPass ? 'passed' : 'failed',
      difference: diff,
      tolerance: tol,
      isWithinTolerance: isPass,
      message: isPass
        ? `ค่าที่วัดได้ ${measuredValue} ${unit} (คลาดเคลื่อน ${sign} ${unit} อยู่ในเกณฑ์ ±${tol} ${unit})`
        : `ค่าที่วัดได้ ${measuredValue} ${unit} (คลาดเคลื่อน ${sign} ${unit} เกินเกณฑ์ยอมรับ ±${tol} ${unit})`
    };
  }

  // 3. ถ้าไม่มีเกณฑ์ตัวเลขเปรียบเทียบเลย ถือว่าผ่าน
  return {
    status: 'passed',
    isWithinTolerance: true,
    message: `ค่าที่วัดได้ ${measuredValue} ${unit}`
  };
}


// ==============================================================================
// 📍 MASTER PLAN PLOT VIEWPORTS (การล็อคมุมมองซูมเฉพาะแปลงบนผังรวม)
// ==============================================================================

import { supabase } from '@/lib/supabase';
import { QCPlotDrawingViewport } from '@/types/qc.types';

/**
 * บันทึกหรืออัปเดตมุมมองเฉพาะแปลงบน Master Plan
 */
export async function savePlotDrawingViewport(viewport: {
  project_name: string;
  plot_id: string;
  drawing_id: string;
  x_percent: number;
  y_percent: number;
  zoom_level: number;
  box_width_percent?: number;
  box_height_percent?: number;
}): Promise<{ data: QCPlotDrawingViewport | null; error: any }> {
  try {
    const payload = {
      project_name: viewport.project_name,
      plot_id: viewport.plot_id,
      drawing_id: viewport.drawing_id,
      x_percent: Number(viewport.x_percent.toFixed(2)),
      y_percent: Number(viewport.y_percent.toFixed(2)),
      zoom_level: Number(viewport.zoom_level.toFixed(2)),
      box_width_percent: viewport.box_width_percent ? Number(viewport.box_width_percent.toFixed(2)) : null,
      box_height_percent: viewport.box_height_percent ? Number(viewport.box_height_percent.toFixed(2)) : null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('qc_plot_drawing_viewports')
      .upsert(payload, { onConflict: 'plot_id,drawing_id' })
      .select()
      .maybeSingle();

    if (error) {
      // Graceful fallback if table does not exist yet (PGRST205 / 42P01)
      if (error.code === 'PGRST205' || error.code === '42P01') {
        console.warn('qc_plot_drawing_viewports table not yet created in Supabase');
        return { data: payload as any, error: null };
      }
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * ดึงมุมมองเฉพาะแปลงบน Master Plan สำหรับแปลงและแบบที่ระบุ
 */
export async function getPlotDrawingViewport(
  plotId: string,
  drawingId: string
): Promise<QCPlotDrawingViewport | null> {
  try {
    const { data, error } = await supabase
      .from('qc_plot_drawing_viewports')
      .select('*')
      .eq('plot_id', plotId)
      .eq('drawing_id', drawingId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * ดึงรายการมุมมองทุกแปลงของแบบ Master Plan ในโครงการนั้น
 */
export async function getProjectPlotViewports(
  projectName: string,
  drawingId: string
): Promise<QCPlotDrawingViewport[]> {
  try {
    const { data, error } = await supabase
      .from('qc_plot_drawing_viewports')
      .select('*')
      .eq('project_name', projectName)
      .eq('drawing_id', drawingId);

    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * ลบมุมมองเฉพาะแปลง
 */
export async function deletePlotDrawingViewport(
  plotId: string,
  drawingId: string
): Promise<{ success: boolean }> {
  try {
    const { error } = await supabase
      .from('qc_plot_drawing_viewports')
      .delete()
      .eq('plot_id', plotId)
      .eq('drawing_id', drawingId);

    return { success: !error };
  } catch {
    return { success: false };
  }
}
