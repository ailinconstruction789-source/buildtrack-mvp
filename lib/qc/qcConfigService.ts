// ==============================================================================
// 🛠️ BUILDTRACK: QC CONFIGURATION SERVICE (บริการจัดการและตรวจสอบสิทธิ์ฟอร์ม QC)
// ==============================================================================

import { supabase } from '@/lib/supabase';
import { 
  QCFormTemplate, 
  QCReferenceDrawing, 
  QCStandardSet, 
  QCPlotTaskConfig, 
  QCTaskConfigResolution, 
  QCResolutionState,
  QCPlotDrawingViewport,
  QCGarageOrientation
} from '@/types/qc.types';
import { getPlotDrawingViewport } from './qcDrawingService';

export interface ScopePreviewResult {
  plotId: string;
  plotName: string;
  houseTypeId: string;
  houseTypeName?: string;
  taskTemplateId: string;
  taskName: string;
  eligible: boolean;
  status: 'eligible' | 'already_started' | 'missing_plot_drawing' | 'already_assigned';
  reason: string;
  currentMethod: 'legacy' | 'form_v2';
  existingOverride: boolean;
}

/**
 * ตรวจสอบจากข้อมูลจริงว่างานนี้บนแปลงนี้ "เคยเริ่มตรวจแล้วหรือยัง"
 * รวมถึง draft, ประวัติการตรวจใน qc_inspections, task_updates, defects
 */
export async function hasInspectionStarted(plotId: string, taskTemplateId: string): Promise<{
  started: boolean;
  method?: 'legacy' | 'form_v2';
  roundCount?: number;
  latestStatus?: string;
}> {
  try {
    // 1 & 2. ตรวจสอบใน qc_inspections (ระบบใหม่) และ task_updates (ระบบเดิม) พร้อมกันเพื่อความรวดเร็ว
    const v2Promise = supabase
      .from('qc_inspections')
      .select('id, round_number, document_status, inspection_result, form_version, drawing_version')
      .eq('plot_id', plotId)
      .eq('task_template_id', taskTemplateId)
      .order('round_number', { ascending: false });

    const legTable: any = supabase.from('task_updates');
    const legPromise: Promise<{ data: Array<{ id: string; action?: string; role?: string; created_at?: string }> | null; error: any }> =
      typeof legTable?.select === 'function'
        ? legTable
            .select('id, action, role, created_at')
            .eq('plot_id', plotId)
            .eq('task_template_id', taskTemplateId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: null, error: null });

    const [{ data: v2Inspections, error: v2Error }, { data: legacyUpdates, error: legError }] = await Promise.all([
      v2Promise,
      legPromise
    ]);

    if (!v2Error && v2Inspections && v2Inspections.length > 0) {
      return {
        started: true,
        method: 'form_v2',
        roundCount: v2Inspections.length,
        latestStatus: v2Inspections[0].document_status
      };
    }

    if (!legError && legacyUpdates && legacyUpdates.length > 0) {
      // ตัดเฉพาะประวัติหลังจาก 'แอดมินย้อนสถานะงาน (Reset)' ล่าสุด (เรียงจากใหม่ไปเก่า จึงหยุดทันทีเมื่อเจอ Reset)
      const currentCycleUpdates: typeof legacyUpdates = [];
      for (const u of legacyUpdates) {
        const act = String(u.action || '');
        if (act.includes('Reset') || act.includes('ย้อนสถานะงาน')) {
          break;
        }
        currentCycleUpdates.push(u);
      }

      // คัดเฉพาะ Action ของตำแหน่ง QC หรือ PE เท่านั้น (ไม่นำ 'Site Engineer อนุมัติ' หรือ 'Site Engineer แจ้งแก้ไข' มาปนเด็ดขาด)
      const qcActions = currentCycleUpdates.filter(u => {
        const act = String(u.action || '');
        const r = String(u.role || '');
        if (r === 'Site Engineer' || act.startsWith('Site Engineer')) return false;
        return r === 'QC' || act.includes('QC') || act.includes('PE อนุมัติ') || act.includes('PE สั่งแก้');
      });

      if (qcActions.length > 0) {
        const latestQcAct = String(qcActions[0].action || '');
        const isApproved = latestQcAct.includes('QC อนุมัติ') || latestQcAct.includes('QC ผ่าน') || latestQcAct.includes('PE อนุมัติ');
        return {
          started: true,
          method: 'legacy',
          roundCount: qcActions.length,
          latestStatus: isApproved ? 'legacy_approved' : 'legacy_active'
        };
      }
    }

    return { started: false };
  } catch (err) {
    console.error('Error checking if inspection has started:', err);
    // กรณี error ในการอ่าน ให้ถือว่าปลอดภัยไว้ก่อน (fail-closed)
    throw new Error('ไม่สามารถตรวจสอบประวัติการตรวจได้ กรุณาลองใหม่อีกครั้ง');
  }
}

/**
 * ดึงแบบอ้างอิงตามลำดับ Precedence:
 * 1) แบบเฉพาะแปลงสำหรับงานนั้น (plot_id = plotId && task_template_id = taskTemplateId)
 * 2) แบบมาตรฐานของแบบบ้านสำหรับงานนั้น (house_type_id = houseTypeId && task_template_id = taskTemplateId)
 * 3) แบบกลางของงานที่อนุญาตให้ใช้ (task_template_id = taskTemplateId && plot_id IS NULL && house_type_id IS NULL)
 */
export async function resolveReferenceDrawing(params: {
  projectName: string;
  plotId: string;
  houseTypeId: string;
  taskTemplateId: string;
  requirePlotDrawing?: boolean;
  garageOrientation?: QCGarageOrientation;
}): Promise<{
  drawing: QCReferenceDrawing | null;
  sourceLabel: string;
  isSpecificPlot: boolean;
  viewport?: QCPlotDrawingViewport | null;
}> {
  const { projectName, plotId, houseTypeId, taskTemplateId, requirePlotDrawing, garageOrientation } = params;

  try {
    // 1) ค้นหาแบบเฉพาะแปลงก่อน
    if (plotId) {
      const { data: plotDrawings } = await supabase
        .from('qc_reference_drawings')
        .select('*, pages:qc_drawing_pages(*)')
        .eq('plot_id', plotId)
        .eq('task_template_id', taskTemplateId)
        .eq('status', 'active')
        .order('version', { ascending: false })
        .limit(1);

      if (plotDrawings && plotDrawings.length > 0) {
        const drawing = plotDrawings[0];
        const viewport = await getPlotDrawingViewport(plotId, drawing.id);
        return {
          drawing,
          sourceLabel: `เฉพาะแปลง (${plotId})`,
          isSpecificPlot: true,
          viewport
        };
      }
    }

    // ถ้างานนี้บังคับใช้แบบเฉพาะแปลง ห้าม fallback ไปแบบมาตรฐาน!
    if (requirePlotDrawing) {
      return {
        drawing: null,
        sourceLabel: `ขาดแบบเฉพาะแปลง (ห้ามใช้แบบมาตรฐาน)`,
        isSpecificPlot: false,
        viewport: null
      };
    }

    // 2) ค้นหาแบบมาตรฐานของแบบบ้าน (รองรับโรงจอดรถซ้าย/ขวา)
    if (houseTypeId) {
      // 2.1 ค้นหาแบบที่ตรงกับทิศทางโรงจอดรถของแปลงก่อน (ถ้าแปลงระบุซ้ายหรือขวา)
      if (garageOrientation === 'left' || garageOrientation === 'right') {
        const { data: orientedDrawings } = await supabase
          .from('qc_reference_drawings')
          .select('*, pages:qc_drawing_pages(*)')
          .eq('house_type_id', houseTypeId)
          .eq('task_template_id', taskTemplateId)
          .eq('garage_orientation', garageOrientation)
          .eq('status', 'active')
          .order('version', { ascending: false })
          .limit(1);

        if (orientedDrawings && orientedDrawings.length > 0) {
          const drawing = orientedDrawings[0];
          const viewport = plotId ? await getPlotDrawingViewport(plotId, drawing.id) : null;
          const orientationLabel = garageOrientation === 'left' ? 'โรงจอดรถซ้าย' : 'โรงจอดรถขวา';
          return {
            drawing,
            sourceLabel: `แบบบ้าน (${orientationLabel})`,
            isSpecificPlot: false,
            viewport
          };
        }
      }

      // 2.2 ค้นหาแบบมาตรฐานทั่วไปของแบบบ้าน (ใช้แบบ standard เท่านั้นเมื่อแปลงระบุซ้าย/ขวา เพื่อไม่ให้แสดงแบบผิดฝั่ง)
      let htQuery = supabase
        .from('qc_reference_drawings')
        .select('*, pages:qc_drawing_pages(*)')
        .eq('house_type_id', houseTypeId)
        .eq('task_template_id', taskTemplateId)
        .eq('status', 'active');

      if (garageOrientation === 'left' || garageOrientation === 'right') {
        htQuery = htQuery.or('garage_orientation.eq.standard,garage_orientation.is.null');
      }

      const { data: houseTypeDrawings } = await htQuery
        .order('version', { ascending: false })
        .limit(1);

      if (houseTypeDrawings && houseTypeDrawings.length > 0) {
        const drawing = houseTypeDrawings[0];
        const viewport = plotId ? await getPlotDrawingViewport(plotId, drawing.id) : null;
        return {
          drawing,
          sourceLabel: `มาตรฐานแบบบ้าน`,
          isSpecificPlot: false,
          viewport
        };
      }
    }

    // 3) ค้นหาแบบผังรวมเฉพาะโครงการ (Project Master Plan)
    if (projectName) {
      const { data: projectMasterDrawings } = await supabase
        .from('qc_reference_drawings')
        .select('*, pages:qc_drawing_pages(*)')
        .eq('project_name', projectName)
        .is('plot_id', null)
        .is('house_type_id', null)
        .eq('task_template_id', taskTemplateId)
        .eq('status', 'active')
        .order('version', { ascending: false })
        .limit(1);

      if (projectMasterDrawings && projectMasterDrawings.length > 0) {
        const drawing = projectMasterDrawings[0];
        const viewport = plotId ? await getPlotDrawingViewport(plotId, drawing.id) : null;
        return {
          drawing,
          sourceLabel: viewport ? `ผังรวมโครงการ (ล็อคมุมมองแปลง ${plotId})` : `ผังรวมโครงการ (${projectName})`,
          isSpecificPlot: false,
          viewport
        };
      }
    }

    // 4) ค้นหาแบบมาตรฐานกลางของงาน (Global Detail - ใช้ได้ทุกโครงการ)
    const { data: commonDrawings } = await supabase
      .from('qc_reference_drawings')
      .select('*, pages:qc_drawing_pages(*)')
      .is('project_name', null)
      .is('plot_id', null)
      .is('house_type_id', null)
      .eq('task_template_id', taskTemplateId)
      .eq('status', 'active')
      .order('version', { ascending: false })
      .limit(1);

    if (commonDrawings && commonDrawings.length > 0) {
      const drawing = commonDrawings[0];
      const viewport = plotId ? await getPlotDrawingViewport(plotId, drawing.id) : null;
      return {
        drawing,
        sourceLabel: viewport ? `แบบกลาง (ล็อคมุมมองแปลง ${plotId})` : `แบบมาตรฐานกลาง`,
        isSpecificPlot: false,
        viewport
      };
    }

    return {
      drawing: null,
      sourceLabel: `ไม่มีแบบอ้างอิง`,
      isSpecificPlot: false,
      viewport: null
    };
  } catch (err) {
    console.error('Error resolving reference drawing:', err);
    throw err;
  }
}

/**
 * ตัดสินวิธีการตรวจ (Resolution) สำหรับงานในแปลงหนึ่งๆ
 * กฎเหล็ก:
 * - ถ้าเริ่มตรวจแล้ว: ล็อกวิธีเดิมตลอดไป
 * - ถ้ายังไม่เริ่มตรวจ: เช็ค config เฉพาะแปลง -> standard set
 * - ถ้าเปิดใช้แต่ฟอร์ม/แบบไม่ครบ: return 'incomplete_config' และห้ามเริ่มตรวจ ห้าม fallback
 * - ถ้าโหลดไม่สำเร็จ: return 'load_error' ห้าม fallback
 */
export async function resolveTaskInspectionConfig(params: {
  projectName: string;
  plotId: string;
  houseTypeId: string;
  taskTemplateId: string;
  taskName: string;
}): Promise<QCTaskConfigResolution> {
  const { projectName, plotId, houseTypeId, taskTemplateId, taskName } = params;

  try {
    // ดึงทิศทางโรงจอดรถของแปลงนี้ควบคู่กับการเช็คประวัติเริ่มตรวจ เพื่อลดเวลารอโหลด
    const orientationPromise = (async (): Promise<QCGarageOrientation> => {
      try {
        const plotsTable: any = supabase.from('plots');
        if (typeof plotsTable?.select !== 'function') return 'standard';
        const { data: pData } = await plotsTable
          .select('garage_orientation')
          .eq('id', plotId)
          .maybeSingle();
        if (pData?.garage_orientation === 'left' || pData?.garage_orientation === 'right') {
          return pData.garage_orientation;
        }
      } catch {
        // fallback
      }
      return 'standard';
    })();

    const plotConfigPromise = (async (): Promise<{ data: any; error: any }> => {
      try {
        const cfgTable: any = supabase.from('qc_plot_task_configs');
        if (typeof cfgTable?.select !== 'function') return { data: null, error: null };
        const res = await cfgTable
          .select('*, form_template:qc_form_templates(*, items:qc_form_items(*)), reference_drawing:qc_reference_drawings(*, pages:qc_drawing_pages(*))')
          .eq('plot_id', plotId)
          .eq('task_template_id', taskTemplateId)
          .maybeSingle();
        return res || { data: null, error: null };
      } catch (e: any) {
        return { data: null, error: e };
      }
    })();

    const [plotGarageOrientation, startedInfo, { data: plotConfig, error: configError }] = await Promise.all([
      orientationPromise,
      hasInspectionStarted(plotId, taskTemplateId),
      plotConfigPromise
    ]);

    if (startedInfo.started) {
      if (startedInfo.method === 'legacy') {
        // หากงานเคยผ่าน QC แบบเดิมไปแล้ว (legacy_approved) ให้ล็อกเป็น legacy ทันที
        // แต่ถ้ายังไม่ผ่าน QC (เช่น เคยถูกแจ้งแก้ไขในอดีต) แล้วแปลงนี้ถูกตั้งค่าเปิดใช้ form_v2 ให้ใช้ form_v2 ต่อได้
        const allowFormV2Override =
          startedInfo.latestStatus !== 'legacy_approved' &&
          Boolean(plotConfig && plotConfig.is_active && plotConfig.inspection_method === 'form_v2');

        if (!allowFormV2Override) {
          return {
            state: 'legacy',
            inspectionMethod: 'legacy',
            isLocked: true,
            lockedReason: 'งานนี้เริ่มตรวจด้วยระบบเดิมไปแล้ว ต้องตรวจด้วยระบบเดิมตลอดวงจรงาน',
            sourceLabel: 'ระบบตรวจเดิม (ล็อกตามประวัติ)'
          };
        }
      } else {
        // ดึงการตรวจล่าสุดของระบบใหม่
        const { data: latestInspections } = await supabase
          .from('qc_inspections')
          .select('*, answers:qc_inspection_answers(*), annotations:qc_drawing_annotations(*)')
          .eq('plot_id', plotId)
          .eq('task_template_id', taskTemplateId)
          .order('round_number', { ascending: false });

        const latest = latestInspections && latestInspections.length > 0 ? latestInspections[0] : null;

        // ดึง form template และ reference drawing ตาม version ที่เคยตรวจพร้อมกัน
        const [formTmpl, drawingResult] = await Promise.all([
          (async (): Promise<QCFormTemplate | undefined> => {
            if (!latest?.form_template_id) return undefined;
            const { data: tmplData } = await supabase
              .from('qc_form_templates')
              .select('*, items:qc_form_items(*)')
              .eq('id', latest.form_template_id)
              .single();
            return tmplData || undefined;
          })(),
          (async (): Promise<{ refDrawing?: QCReferenceDrawing; resolvedViewport: QCPlotDrawingViewport | null }> => {
            if (!latest?.drawing_id) return { resolvedViewport: null };
            const [{ data: drawData }, vp] = await Promise.all([
              supabase
                .from('qc_reference_drawings')
                .select('*, pages:qc_drawing_pages(*)')
                .eq('id', latest.drawing_id)
                .single(),
              getPlotDrawingViewport(plotId, latest.drawing_id)
            ]);
            return {
              refDrawing: drawData || undefined,
              resolvedViewport: drawData ? vp : null
            };
          })()
        ]);

        return {
          state: 'form_v2_ready',
          inspectionMethod: 'form_v2',
          isLocked: true,
          lockedReason: `งานนี้เริ่มตรวจด้วยฟอร์มใหม่ (รอบที่ ${latest?.round_number || 1}) ล็อกเวอร์ชันฟอร์มและแบบ`,
          sourceLabel: `ระบบฟอร์มใหม่ (รอบที่ ${latest?.round_number || 1})`,
          formTemplate: formTmpl,
          referenceDrawing: drawingResult.refDrawing,
          viewport: drawingResult.resolvedViewport,
          latestInspection: latest,
          totalRounds: latestInspections?.length || 1
        };
      }
    }

    // 2. งานยังไม่เคยเริ่มตรวจ: ตรวจสอบการตั้งค่าระดับแปลง (qc_plot_task_configs ที่ดึงมาพร้อมกันแล้ว)
    if (configError) {
      return {
        state: 'load_error',
        inspectionMethod: 'form_v2',
        isLocked: false,
        errorMessage: `เกิดข้อผิดพลาดในการโหลดการตั้งค่า QC: ${configError.message}`,
        sourceLabel: 'ข้อผิดพลาดการโหลด'
      };
    }

    // 3. ถ้ามีการตั้งค่าเฉพาะแปลงและเปิดใช้งาน
    if (plotConfig && plotConfig.is_active && plotConfig.inspection_method === 'form_v2') {
      // ตรวจสอบความพร้อมของฟอร์ม
      const formReady = Boolean(plotConfig.form_template_id && plotConfig.form_template);
      
      // ตรวจสอบแบบอ้างอิงตาม Precedence
      let drawingResolved = plotConfig.reference_drawing || null;
      let drawingSource = plotConfig.is_plot_override ? `เฉพาะแปลง (${plotId})` : 'มาตรฐานโครงการ';

      let resolvedViewport: QCPlotDrawingViewport | null = null;
      if (!plotConfig.is_plot_override) {
        const effective = await resolveEffectiveDrawing({
          projectName,
          plotId,
          houseTypeId,
          taskTemplateId,
          requirePlotDrawing: plotConfig.require_plot_drawing,
          garageOrientation: plotGarageOrientation,
          explicitDrawing: plotConfig.reference_drawing || null
        });
        drawingResolved = effective.drawing;
        drawingSource = effective.sourceLabel;
        resolvedViewport = effective.viewport;
      } else if (drawingResolved) {
        resolvedViewport = await getPlotDrawingViewport(plotId, drawingResolved.id);
      }

      // ถ้างานนี้บังคับใช้แบบเฉพาะแปลง แต่ไม่มีแบบเฉพาะแปลง -> incomplete
      if (plotConfig.require_plot_drawing && (!drawingResolved || drawingResolved.plot_id !== plotId)) {
        return {
          state: 'incomplete_config',
          inspectionMethod: 'form_v2',
          isLocked: false,
          errorMessage: 'งานนี้ถูกกำหนดให้ต้องใช้แบบแปลนเฉพาะแปลง แต่ยังไม่ได้อัปโหลดหรือผูกแบบสำหรับแปลงนี้',
          sourceLabel: 'ยังตั้งค่าไม่ครบ (ขาดแบบเฉพาะแปลง)',
          config: plotConfig,
          formTemplate: plotConfig.form_template
        };
      }

      if (!formReady) {
        return {
          state: 'incomplete_config',
          inspectionMethod: 'form_v2',
          isLocked: false,
          errorMessage: 'ยังไม่ได้เลือกแม่แบบฟอร์มตรวจสำหรับงานนี้',
          sourceLabel: 'ยังตั้งค่าไม่ครบ (ขาดแม่แบบฟอร์ม)',
          config: plotConfig
        };
      }

      return {
        state: 'form_v2_ready',
        inspectionMethod: 'form_v2',
        isLocked: false,
        sourceLabel: plotConfig.is_plot_override ? `ปรับเฉพาะแปลง (${drawingSource})` : `มาตรฐานโครงการ (${drawingSource})`,
        config: plotConfig,
        formTemplate: plotConfig.form_template,
        referenceDrawing: drawingResolved,
        viewport: resolvedViewport,
        garageOrientation: plotGarageOrientation,
        selectedPages: plotConfig.selected_pages || []
      };
    }

    // 4. ถ้าไม่มีการตั้งค่าระดับแปลง ให้ตรวจหาชุดมาตรฐานโครงการ (qc_standard_sets)
    const { data: stdSet, error: stdError } = await supabase
      .from('qc_standard_sets')
      .select('*, form_template:qc_form_templates(*, items:qc_form_items(*)), reference_drawing:qc_reference_drawings(*, pages:qc_drawing_pages(*))')
      .eq('project_name', projectName)
      .eq('house_type_id', houseTypeId)
      .eq('task_name', taskName)
      .eq('is_active', true)
      .maybeSingle();

    if (stdError) {
      return {
        state: 'load_error',
        inspectionMethod: 'form_v2',
        isLocked: false,
        errorMessage: `เกิดข้อผิดพลาดในการโหลดชุดตรวจมาตรฐาน: ${stdError.message}`,
        sourceLabel: 'ข้อผิดพลาดการโหลด'
      };
    }

    // 5. ถ้ามีชุดมาตรฐาน แต่ยังไม่ได้เปิดใช้กับแปลงนี้อย่างชัดเจน (Opt-in principle)
    // หรือถ้า plotConfig ระบุ inspection_method = 'legacy'
    if (!plotConfig || !plotConfig.is_active || plotConfig.inspection_method === 'legacy') {
      return {
        state: 'legacy',
        inspectionMethod: 'legacy',
        isLocked: false,
        sourceLabel: 'ระบบตรวจเดิม (ยังไม่ได้เปิดใช้ระบบฟอร์มใหม่)'
      };
    }

    return {
      state: 'legacy',
      inspectionMethod: 'legacy',
      isLocked: false,
      sourceLabel: 'ระบบตรวจเดิม'
    };
  } catch (err: any) {
    console.error('Fatal error resolving task inspection config:', err);
    return {
      state: 'load_error',
      inspectionMethod: 'form_v2',
      isLocked: false,
      errorMessage: err?.message || 'เกิดข้อผิดพลาดในการอ่านการตั้งค่า QC',
      sourceLabel: 'ข้อผิดพลาดการโหลด'
    };
  }
}

/**
 * Shared drawing fallback helper used by both runtime task resolution and standard-set preview.
 */
async function resolveEffectiveDrawing(params: {
  projectName: string;
  plotId: string;
  houseTypeId: string;
  taskTemplateId: string;
  requirePlotDrawing?: boolean;
  garageOrientation?: QCGarageOrientation;
  explicitDrawingId?: string | null;
  explicitDrawing?: QCReferenceDrawing | null;
  fetchPagesIfMissing?: boolean;
}): Promise<{
  drawing: QCReferenceDrawing | null;
  sourceLabel: string;
  viewport: QCPlotDrawingViewport | null;
}> {
  const {
    projectName,
    plotId,
    houseTypeId,
    taskTemplateId,
    requirePlotDrawing = false,
    garageOrientation = 'standard',
    explicitDrawingId,
    explicitDrawing,
    fetchPagesIfMissing = false
  } = params;

  const resolved = await resolveReferenceDrawing({
    projectName,
    plotId,
    houseTypeId,
    taskTemplateId,
    requirePlotDrawing,
    garageOrientation
  });

  if (resolved.drawing) {
    return {
      drawing: resolved.drawing,
      sourceLabel: resolved.sourceLabel,
      viewport: resolved.viewport || null
    };
  }

  if (requirePlotDrawing) {
    return {
      drawing: null,
      sourceLabel: resolved.sourceLabel,
      viewport: null
    };
  }

  let fallbackDrawing = explicitDrawing || null;
  const targetDrawingId = explicitDrawingId || fallbackDrawing?.id;
  if ((!fallbackDrawing || (fetchPagesIfMissing && !fallbackDrawing.pages)) && targetDrawingId) {
    const { data: drawData } = await supabase
      .from('qc_reference_drawings')
      .select('*, pages:qc_drawing_pages(*)')
      .eq('id', targetDrawingId)
      .maybeSingle();
    const normalizedDraw = Array.isArray(drawData) ? drawData[0] : drawData;
    if (normalizedDraw) {
      fallbackDrawing = normalizedDraw;
    }
  }

  if (fallbackDrawing) {
    const viewport = plotId ? await getPlotDrawingViewport(plotId, fallbackDrawing.id) : null;
    const sourceLabel = fallbackDrawing.project_name
      ? (viewport
          ? `ผังรวมโครงการ (ล็อคมุมมองแปลง ${plotId})`
          : `ผังรวมโครงการ (${fallbackDrawing.project_name})`)
      : 'แบบมาตรฐานกลาง / ประจำชุดตรวจ';
    return { drawing: fallbackDrawing, sourceLabel, viewport };
  }

  return {
    drawing: null,
    sourceLabel: resolved.sourceLabel,
    viewport: null
  };
}

/**
 * จำลองการจับคู่ฟอร์ม + แบบแปลน + มุมมองแปลง สำหรับโหมดดูตัวอย่างในหน้าตั้งค่ามาตรฐาน (Admin Preview)
 * โดยไม่ต้องรอให้แปลงนั้นกดเปิดใช้งาน (Opt-in) หรือผ่านคิวงานจริง
 */
export async function resolveStandardSetPreviewConfig(params: {
  projectName: string;
  houseTypeId: string;
  taskTemplateId: string;
  taskName: string;
  plotId?: string;
  garageOrientation?: QCGarageOrientation;
  standardSet?: QCStandardSet | null;
}): Promise<QCTaskConfigResolution> {
  const {
    projectName,
    houseTypeId,
    taskTemplateId,
    plotId = '',
    garageOrientation = 'standard',
    standardSet
  } = params;

  try {
    let fullFormTmpl: QCFormTemplate | undefined = standardSet?.form_template || undefined;
    if (standardSet?.form_template_id) {
      const { data: tmplData } = await supabase
        .from('qc_form_templates')
        .select('*, items:qc_form_items(*)')
        .eq('id', standardSet.form_template_id)
        .maybeSingle();

      const rawTmpl = Array.isArray(tmplData) ? tmplData[0] : tmplData;
      if (rawTmpl) {
        fullFormTmpl = {
          ...rawTmpl,
          items: Array.isArray(rawTmpl.items)
            ? [...rawTmpl.items].sort((a: any, b: any) => (a.item_order || 0) - (b.item_order || 0))
            : []
        };
      }
    }

    const requirePlotDrawing = Boolean(standardSet?.require_plot_drawing);
    const effective = await resolveEffectiveDrawing({
      projectName,
      plotId,
      houseTypeId,
      taskTemplateId,
      requirePlotDrawing,
      garageOrientation,
      explicitDrawingId: standardSet?.drawing_id || null,
      explicitDrawing: standardSet?.reference_drawing || null,
      fetchPagesIfMissing: true
    });

    const missingPlotDrawing =
      requirePlotDrawing &&
      (!effective.drawing || (plotId ? effective.drawing.plot_id !== plotId : !effective.drawing.plot_id));

    if (missingPlotDrawing) {
      return {
        state: 'incomplete_config',
        inspectionMethod: 'form_v2',
        isLocked: false,
        errorMessage: plotId
          ? 'งานนี้บังคับใช้แบบเฉพาะแปลง แต่แปลงตัวอย่างนี้ยังไม่ได้อัปโหลดแบบเฉพาะแปลง'
          : 'งานนี้บังคับใช้แบบเฉพาะแปลง และยังไม่มีแปลงบ้านในโครงการสำหรับจำลองแบบเฉพาะแปลง',
        sourceLabel: `ตัวอย่างมาตรฐาน (${effective.sourceLabel})`,
        formTemplate: fullFormTmpl,
        referenceDrawing: undefined,
        viewport: null,
        garageOrientation,
        selectedPages: []
      };
    }

    return {
      state: fullFormTmpl ? 'form_v2_ready' : 'incomplete_config',
      inspectionMethod: 'form_v2',
      isLocked: false,
      sourceLabel: `ตัวอย่างมาตรฐาน (${effective.sourceLabel})`,
      formTemplate: fullFormTmpl,
      referenceDrawing: effective.drawing || undefined,
      viewport: effective.viewport,
      garageOrientation,
      selectedPages: []
    };
  } catch (err: any) {
    console.error('Error resolving standard set preview config:', err);
    return {
      state: 'load_error',
      inspectionMethod: 'form_v2',
      isLocked: false,
      errorMessage: err?.message || 'ไม่สามารถโหลดตัวอย่างฟอร์มได้',
      sourceLabel: 'ข้อผิดพลาดการโหลด',
      formTemplate: standardSet?.form_template || undefined
    };
  }
}

/**
 * Preview ผลกระทบก่อนเปิดใช้งานหรือกำหนดชุดฟอร์มและแบบ (Scope Assignment Preview)
 * แสดง: จำนวนแปลงที่จะเปลี่ยน, แปลงที่เริ่มตรวจแล้ว (ข้าม), แปลงที่ขาดแบบเฉพาะ
 */
export async function previewScopeAssignment(params: {
  projectName: string;
  selectedPlotIds: string[];
  taskTemplateId: string;
  taskName: string;
  standardSetId?: string;
  customFormTemplateId?: string;
  customDrawingId?: string;
  requirePlotDrawing?: boolean;
}): Promise<{
  totalSelected: number;
  eligibleCount: number;
  skippedStartedCount: number;
  incompleteCount: number;
  items: ScopePreviewResult[];
}> {
  const { projectName, selectedPlotIds, taskTemplateId, taskName, requirePlotDrawing } = params;

  const items: ScopePreviewResult[] = [];
  let eligibleCount = 0;
  let skippedStartedCount = 0;
  let incompleteCount = 0;

  // ดึงข้อมูลแปลงทั้งหมดที่เลือก
  const { data: plots } = await supabase
    .from('plots')
    .select('id, plot_name, house_type_id, project_name')
    .in('id', selectedPlotIds);

  const plotMap = new Map((plots || []).map(p => [p.id, p]));

  // จับคู่ task_template_id จริงของแต่ละแบบบ้าน (กรณีกำหนดพร้อมกันหลายแบบบ้าน)
  const { data: taskTemplatesForName } = await supabase
    .from('task_templates')
    .select('id, house_type_id')
    .eq('task_name', taskName);
  const taskIdByHouseType = new Map((taskTemplatesForName || []).map(t => [t.house_type_id, t.id]));

  for (const plotId of selectedPlotIds) {
    const p = plotMap.get(plotId);
    const houseTypeId = p?.house_type_id || '';
    const plotName = p?.plot_name || plotId;
    const resolvedTaskTemplateId = taskIdByHouseType.get(houseTypeId) || taskTemplateId;

    // 1. ตรวจสอบว่าเริ่มตรวจแล้วหรือไม่
    const started = await hasInspectionStarted(plotId, resolvedTaskTemplateId);

    if (started.started) {
      skippedStartedCount++;
      items.push({
        plotId,
        plotName,
        houseTypeId,
        taskTemplateId: resolvedTaskTemplateId,
        taskName,
        eligible: false,
        status: 'already_started',
        reason: `เริ่มตรวจไปแล้ว (${started.method === 'form_v2' ? 'ระบบฟอร์มใหม่' : 'ระบบเดิม'}) ห้ามเปลี่ยนวิธีตรวจ`,
        currentMethod: started.method || 'legacy',
        existingOverride: false
      });
      continue;
    }

    // 2. ตรวจสอบแบบเฉพาะแปลงถ้าบังคับ
    if (requirePlotDrawing) {
      const { data: plotDrawing } = await supabase
        .from('qc_reference_drawings')
        .select('id')
        .eq('plot_id', plotId)
        .eq('task_template_id', resolvedTaskTemplateId)
        .eq('status', 'active')
        .limit(1);

      if (!plotDrawing || plotDrawing.length === 0) {
        incompleteCount++;
        items.push({
          plotId,
          plotName,
          houseTypeId,
          taskTemplateId: resolvedTaskTemplateId,
          taskName,
          eligible: false,
          status: 'missing_plot_drawing',
          reason: 'งานนี้บังคับใช้แบบเฉพาะแปลง แต่แปลงนี้ยังไม่มีการอัปโหลดแบบแปลนเฉพาะ',
          currentMethod: 'legacy',
          existingOverride: false
        });
        continue;
      }
    }

    // 3. ตรวจสอบว่ามี override เฉพาะแปลงอยู่เดิมหรือไม่
    const { data: existingConfig } = await supabase
      .from('qc_plot_task_configs')
      .select('id, is_plot_override, is_active, inspection_method')
      .eq('plot_id', plotId)
      .eq('task_template_id', resolvedTaskTemplateId)
      .maybeSingle();

    eligibleCount++;
    items.push({
      plotId,
      plotName,
      houseTypeId,
      taskTemplateId: resolvedTaskTemplateId,
      taskName,
      eligible: true,
      status: 'eligible',
      reason: 'พร้อมเปิดใช้ระบบฟอร์มใหม่',
      currentMethod: existingConfig?.inspection_method || 'legacy',
      existingOverride: Boolean(existingConfig?.is_plot_override)
    });
  }

  return {
    totalSelected: selectedPlotIds.length,
    eligibleCount,
    skippedStartedCount,
    incompleteCount,
    items
  };
}

/**
 * ยืนยันการกำหนดชุดฟอร์มและแบบ (Scope Assignment Confirm)
 * ตรวจ eligibility ซ้ำฝั่ง server ก่อนบันทึกจริงเพื่อป้องกัน race condition!
 */
export async function confirmScopeAssignment(params: {
  projectName: string;
  selectedPlotIds: string[];
  taskTemplateId: string;
  taskName: string;
  formTemplateId: string;
  formVersion: number;
  drawingId?: string | null;
  drawingVersion?: number | null;
  selectedPages?: number[];
  requirePlotDrawing?: boolean;
  replaceOverrides?: boolean;
  actorUsername: string;
  actorRole: string;
}): Promise<{
  success: boolean;
  assignedCount: number;
  skippedCount: number;
  details: { plotId: string; outcome: 'assigned' | 'skipped_started' | 'skipped_override' | 'error'; message: string }[];
}> {
  const {
    projectName,
    selectedPlotIds,
    taskTemplateId,
    taskName,
    formTemplateId,
    formVersion,
    drawingId,
    drawingVersion,
    selectedPages = [],
    requirePlotDrawing = false,
    replaceOverrides = false,
    actorUsername,
    actorRole
  } = params;

  let assignedCount = 0;
  let skippedCount = 0;
  const details: { plotId: string; outcome: 'assigned' | 'skipped_started' | 'skipped_override' | 'error'; message: string }[] = [];

  // ดึงข้อมูลแปลง, task_template ของแต่ละแบบบ้าน, และ standard sets ของโครงการ
  const { data: plots } = await supabase
    .from('plots')
    .select('id, house_type_id')
    .in('id', selectedPlotIds);
  const plotHouseMap = new Map((plots || []).map(p => [p.id, p.house_type_id || '']));

  const { data: taskTemplatesForName } = await supabase
    .from('task_templates')
    .select('id, house_type_id')
    .eq('task_name', taskName);
  const taskIdByHouseType = new Map((taskTemplatesForName || []).map(t => [t.house_type_id, t.id]));

  const { data: stdSets } = await supabase
    .from('qc_standard_sets')
    .select('house_type_id, form_template_id, form_version, drawing_id, drawing_version, selected_pages, require_plot_drawing')
    .eq('project_name', projectName)
    .eq('task_name', taskName)
    .eq('is_active', true);
  const stdSetByHouseType = new Map((stdSets || []).map(s => [s.house_type_id, s]));

  for (const plotId of selectedPlotIds) {
    try {
      const houseTypeId = plotHouseMap.get(plotId) || '';
      const resolvedTaskTemplateId = taskIdByHouseType.get(houseTypeId) || taskTemplateId;
      const houseStdSet = stdSetByHouseType.get(houseTypeId);

      // 1. Re-verify eligibility on server!
      const started = await hasInspectionStarted(plotId, resolvedTaskTemplateId);
      if (started.started) {
        skippedCount++;
        details.push({
          plotId,
          outcome: 'skipped_started',
          message: 'งานเริ่มตรวจไประหว่างดำเนินการ ข้ามแปลงนี้เพื่อรักษาประวัติเดิม'
        });
        continue;
      }

      // 2. ตรวจสอบ override เดิม
      const { data: existing } = await supabase
        .from('qc_plot_task_configs')
        .select('id, is_plot_override')
        .eq('plot_id', plotId)
        .eq('task_template_id', resolvedTaskTemplateId)
        .maybeSingle();

      if (existing?.is_plot_override && !replaceOverrides) {
        skippedCount++;
        details.push({
          plotId,
          outcome: 'skipped_override',
          message: 'แปลงนี้มีการปรับแต่งเฉพาะแปลงไว้ จึงข้ามตามค่าเริ่มต้น'
        });
        continue;
      }

      // 3. Upsert configuration (ใช้ชุดมาตรฐานของแบบบ้านนั้นถ้ามี หรือ fallback ตามชุดที่เลือก)
      const payload: Partial<QCPlotTaskConfig> = {
        project_name: projectName,
        plot_id: plotId,
        task_template_id: resolvedTaskTemplateId,
        task_name: taskName,
        inspection_method: 'form_v2',
        is_active: true,
        form_template_id: houseStdSet?.form_template_id || formTemplateId,
        form_version: houseStdSet?.form_version || formVersion,
        drawing_id: (houseStdSet?.drawing_id !== undefined ? houseStdSet.drawing_id : drawingId) || null,
        drawing_version: (houseStdSet?.drawing_version !== undefined ? houseStdSet.drawing_version : drawingVersion) || null,
        selected_pages: houseStdSet?.selected_pages || selectedPages,
        is_plot_override: false,
        require_plot_drawing: houseStdSet?.require_plot_drawing ?? requirePlotDrawing,
        created_by: actorUsername,
        updated_at: new Date().toISOString()
      };

      const { error: upsertErr } = await supabase
        .from('qc_plot_task_configs')
        .upsert(payload, { onConflict: 'plot_id,task_template_id' });

      if (upsertErr) throw upsertErr;

      assignedCount++;
      details.push({
        plotId,
        outcome: 'assigned',
        message: 'เปิดใช้งานฟอร์ม QC เรียบร้อยแล้ว'
      });
    } catch (err: any) {
      skippedCount++;
      details.push({
        plotId,
        outcome: 'error',
        message: err?.message || 'เกิดข้อผิดพลาดในการบันทึก'
      });
    }
  }

  // 4. บันทึก Audit Log
  try {
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'scope_assign',
      entity_type: 'qc_plot_task_configs',
      entity_id: `${projectName}:${taskTemplateId}`,
      actor_username: actorUsername,
      actor_role: actorRole,
      details: {
        totalSelected: selectedPlotIds.length,
        assignedCount,
        skippedCount,
        taskName,
        formTemplateId,
        drawingId
      }
    }]);
  } catch (auditErr) {
    console.warn('Could not record QC audit log:', auditErr);
  }

  return {
    success: details.every(d => d.outcome !== 'error'),
    assignedCount,
    skippedCount,
    details
  };
}

export interface SmartPlotQCPreview {
  plotId: string;
  plotName: string;
  houseTypeId: string;
  houseTypeName: string;
  totalTasks: number;
  completedTasksCount: number;
  activeTasksCount: number;
  completedTaskNames: string[];
  activeTaskNames: string[];
  overallProgress: number;
}

/**
 * คำนวณภาพรวมงานของแปลงในโครงการ (Smart Plot QC Preview)
 * - คำนวณงานที่เคยทำเสร็จไปแล้ว (completed/passed) vs งานที่ยังต้องตรวจด้วยฟอร์มใหม่
 */
export async function previewSmartPlotsQC(params: {
  projectName: string;
  plotIds: string[];
}): Promise<SmartPlotQCPreview[]> {
  const { projectName, plotIds } = params;
  if (!plotIds || plotIds.length === 0) return [];

  // 1. ดึงข้อมูลแปลง
  const { data: plots, error: pErr } = await supabase
    .from('plots')
    .select('id, plot_name, house_type_id, project_name')
    .in('id', plotIds)
    .limit(5000);
  if (pErr) throw pErr;

  // 2. ดึงข้อมูลแบบบ้าน
  const houseTypeIds = Array.from(new Set((plots || []).map(p => p.house_type_id).filter(Boolean)));
  const { data: houseTypes } = await supabase
    .from('house_types')
    .select('id, type_name')
    .in('id', houseTypeIds)
    .limit(5000);
  const htNameMap = new Map((houseTypes || []).map(h => [h.id, h.type_name]));

  // 3. ดึง task_templates ทั้งหมดของแบบบ้านเหล่านี้
  const { data: taskTemplates } = await supabase
    .from('task_templates')
    .select('id, house_type_id, task_name, task_order')
    .in('house_type_id', houseTypeIds)
    .order('task_order', { ascending: true })
    .limit(5000);

  const tasksByHouseType = new Map<string, any[]>();
  for (const t of taskTemplates || []) {
    if (!tasksByHouseType.has(t.house_type_id)) tasksByHouseType.set(t.house_type_id, []);
    tasksByHouseType.get(t.house_type_id)!.push(t);
  }

  // 4. ดึงสถานะงานที่ QC อนุมัติผ่านแล้วจริงๆ จาก task_updates (แบ่ง chunk ละ 30 แปลงเพื่อป้องกัน URL limit และ query row limit)
  const completedSet = new Set<string>();
  const chunkSize = 30;
  for (let i = 0; i < plotIds.length; i += chunkSize) {
    const chunk = plotIds.slice(i, i + chunkSize);
    const { data: updates } = await supabase
      .from('task_updates')
      .select('plot_id, task_template_id, action, created_at')
      .in('plot_id', chunk)
      .or('action.ilike.%QC%,action.ilike.%PE%')
      .order('created_at', { ascending: true })
      .limit(10000);

    for (const u of updates || []) {
      const key = `${u.plot_id}_${u.task_template_id}`;
      const action = u.action || '';
      if (action.includes('QC อนุมัติ') || action.includes('QC ผ่าน') || action.includes('PE อนุมัติ')) {
        completedSet.add(key);
      } else if (action.includes('แจ้งแก้ไข') || action.includes('ไม่อนุมัติ') || action.includes('ตีกลับ')) {
        completedSet.delete(key);
      }
    }
  }

  // 5. สรุปผลรายแปลง
  const previews: SmartPlotQCPreview[] = [];
  for (const plot of plots || []) {
    const tasks = tasksByHouseType.get(plot.house_type_id) || [];
    const completedTaskNames: string[] = [];
    const activeTaskNames: string[] = [];

    for (const t of tasks) {
      if (completedSet.has(`${plot.id}_${t.id}`)) {
        completedTaskNames.push(t.task_name);
      } else {
        activeTaskNames.push(t.task_name);
      }
    }

    const total = tasks.length;
    const completedCount = completedTaskNames.length;
    const activeCount = activeTaskNames.length;
    const overallProgress = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    previews.push({
      plotId: plot.id,
      plotName: plot.plot_name || `แปลง ${plot.id}`,
      houseTypeId: plot.house_type_id,
      houseTypeName: htNameMap.get(plot.house_type_id) || 'ไม่ระบุแบบบ้าน',
      totalTasks: total,
      completedTasksCount: completedCount,
      activeTasksCount: activeCount,
      completedTaskNames,
      activeTaskNames,
      overallProgress
    });
  }

  return previews;
}

/**
 * ดำเนินการเปิดใช้งานฟอร์มตรวจอัจฉริยะ (Smart Forward QC Activation)
 * - งานที่ผ่านแล้ว: ล็อกเป็น legacy เพื่อไม่ให้มีภาระตรวจย้อนหลัง
 * - งานที่ยังไม่ผ่าน: เปิดใช้งานแบบฟอร์ม QC V2 โดยผูกกับ standard set อัตโนมัติ
 */
export async function executeSmartActivatePlotsQC(params: {
  projectName: string;
  selectedPlotIds: string[];
  exemptCompletedTasks?: boolean;
  actorUsername: string;
  actorRole: string;
}): Promise<{
  success: boolean;
  totalPlotsProcessed: number;
  totalExemptedCompletedTasks: number;
  totalActivatedTasks: number;
}> {
  const { projectName, selectedPlotIds, exemptCompletedTasks = true, actorUsername, actorRole } = params;

  if (!selectedPlotIds || selectedPlotIds.length === 0) {
    return { success: true, totalPlotsProcessed: 0, totalExemptedCompletedTasks: 0, totalActivatedTasks: 0 };
  }

  // 1. ดึงข้อมูลแปลง
  const { data: plots } = await supabase
    .from('plots')
    .select('id, plot_name, house_type_id')
    .in('id', selectedPlotIds)
    .limit(5000);

  const houseTypeIds = Array.from(new Set((plots || []).map(p => p.house_type_id).filter(Boolean)));

  // 2. ดึง task_templates
  const { data: taskTemplates } = await supabase
    .from('task_templates')
    .select('id, house_type_id, task_name, task_order')
    .in('house_type_id', houseTypeIds)
    .limit(5000);

  const tasksByHouseType = new Map<string, any[]>();
  for (const t of taskTemplates || []) {
    if (!tasksByHouseType.has(t.house_type_id)) tasksByHouseType.set(t.house_type_id, []);
    tasksByHouseType.get(t.house_type_id)!.push(t);
  }

  // 3. ดึง qc_standard_sets ของโครงการ
  const { data: stdSets } = await supabase
    .from('qc_standard_sets')
    .select('*')
    .eq('project_name', projectName)
    .eq('is_active', true)
    .limit(5000);

  const stdSetMap = new Map<string, any>();
  for (const s of stdSets || []) {
    stdSetMap.set(`${s.house_type_id}_${s.task_name.trim()}`, s);
  }

  // 4. ดึงสถานะงานที่ QC อนุมัติผ่านแล้วจริงๆ จาก task_updates (แบ่ง chunk ละ 30 แปลงเพื่อป้องกัน URL limit และ query row limit)
  const completedSet = new Set<string>();
  const chunkSize = 30;
  for (let i = 0; i < selectedPlotIds.length; i += chunkSize) {
    const chunk = selectedPlotIds.slice(i, i + chunkSize);
    const { data: updates } = await supabase
      .from('task_updates')
      .select('plot_id, task_template_id, action, created_at')
      .in('plot_id', chunk)
      .or('action.ilike.%QC%,action.ilike.%PE%')
      .order('created_at', { ascending: true })
      .limit(10000);

    for (const u of updates || []) {
      const key = `${u.plot_id}_${u.task_template_id}`;
      const action = u.action || '';
      if (action.includes('QC อนุมัติ') || action.includes('QC ผ่าน') || action.includes('PE อนุมัติ')) {
        completedSet.add(key);
      } else if (action.includes('แจ้งแก้ไข') || action.includes('ไม่อนุมัติ') || action.includes('ตีกลับ')) {
        completedSet.delete(key);
      }
    }
  }

  let totalExempted = 0;
  let totalActivated = 0;

  // 5. บันทึกลง qc_plot_task_configs
  for (const plot of plots || []) {
    const tasks = tasksByHouseType.get(plot.house_type_id) || [];
    const configsToUpsert: any[] = [];

    for (const task of tasks) {
      const isCompleted = completedSet.has(`${plot.id}_${task.id}`);
      const stdSet = stdSetMap.get(`${plot.house_type_id}_${task.task_name.trim()}`);

      if (isCompleted && exemptCompletedTasks) {
        // งานที่ทำเสร็จแล้ว: กำหนดเป็น legacy เพื่อไม่ให้รบกวนหน้างาน
        configsToUpsert.push({
          project_name: projectName,
          plot_id: plot.id,
          task_template_id: task.id,
          task_name: task.task_name,
          inspection_method: 'legacy',
          is_active: false,
          form_template_id: null,
          form_version: null,
          drawing_id: null,
          drawing_version: null,
          selected_pages: [],
          require_plot_drawing: false,
          is_plot_override: false,
          created_by: actorUsername,
          updated_at: new Date().toISOString()
        });
        totalExempted++;
      } else if (stdSet) {
        // งานที่ยังไม่เสร็จ: เปิดใช้งานฟอร์มตรวจ QC V2 ทันที
        configsToUpsert.push({
          project_name: projectName,
          plot_id: plot.id,
          task_template_id: task.id,
          task_name: task.task_name,
          inspection_method: 'form_v2',
          is_active: true,
          form_template_id: stdSet.form_template_id,
          form_version: stdSet.form_version,
          drawing_id: stdSet.drawing_id || null,
          drawing_version: stdSet.drawing_version || null,
          selected_pages: stdSet.selected_pages || [],
          require_plot_drawing: stdSet.require_plot_drawing || false,
          is_plot_override: false,
          created_by: actorUsername,
          updated_at: new Date().toISOString()
        });
        totalActivated++;
      }
    }

    if (configsToUpsert.length > 0) {
      await supabase
        .from('qc_plot_task_configs')
        .upsert(configsToUpsert, { onConflict: 'plot_id,task_template_id' });
    }
  }

  // Audit Log
  try {
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'smart_scope_activate',
      entity_type: 'qc_plot_task_configs',
      entity_id: `${projectName}:smart_activate`,
      actor_username: actorUsername,
      actor_role: actorRole,
      details: {
        totalPlots: plots?.length || 0,
        totalExempted,
        totalActivated,
        exemptCompletedTasks
      }
    }]);
  } catch (err) {
    console.warn('Could not record QC audit log:', err);
  }

  return {
    success: true,
    totalPlotsProcessed: plots?.length || 0,
    totalExemptedCompletedTasks: totalExempted,
    totalActivatedTasks: totalActivated
  };
}

/**
 * ซิงค์สถานะระบบฟอร์ม QC เมื่อแอดมินกด "ย้อนสถานะล่าสุด (Undo)"
 * 1. หากมีใบตรวจใน qc_inspections ที่ถูกส่ง/อนุมัติ/ตีกลับไปแล้ว ให้ปลดล็อกกลับเป็น 'draft' เพื่อให้ QC แก้ไขคำตอบเดิมแล้วส่งใหม่ได้ทันที
 * 2. หากงานเคยถูกตั้งเป็น legacy (เพราะเคยผ่านไปแล้ว) แต่ถูก Undo จนกลับมาเป็นสถานะยังไม่ผ่าน QC ให้สลับเปิดใช้ form_v2 ตามชุดมาตรฐานทันที
 */
export async function syncQCOnAdminUndo(params: {
  plotId: string;
  taskTemplateId: string;
  actorUsername: string;
}): Promise<void> {
  const { plotId, taskTemplateId, actorUsername } = params;
  try {
    // 1. ตรวจสอบใบตรวจรอบล่าสุดใน qc_inspections
    const { data: inspections } = await supabase
      .from('qc_inspections')
      .select('id, round_number, document_status')
      .eq('plot_id', plotId)
      .eq('task_template_id', taskTemplateId)
      .order('round_number', { ascending: false })
      .limit(1);

    if (inspections && inspections.length > 0) {
      const latest = inspections[0];
      if (latest.document_status !== 'draft') {
        await supabase
          .from('qc_inspections')
          .update({
            document_status: 'draft',
            reopened_at: new Date().toISOString(),
            reopened_by: actorUsername,
            reopened_reason: 'แอดมินกดย้อนสถานะล่าสุด (Undo)',
            updated_at: new Date().toISOString()
          })
          .eq('id', latest.id);
      }
    }

    // 2. ตรวจสอบว่ายังมีประวัติ QC อนุมัติค้างอยู่ในรอบปัจจุบันหรือไม่
    const startedInfo = await hasInspectionStarted(plotId, taskTemplateId);
    if (startedInfo.latestStatus === 'legacy_approved') {
      return;
    }

    // 3. หากงานไม่ได้อยู่ในสถานะผ่าน QC แล้ว และมีชุดมาตรฐาน (Standard Set) ให้เปิดใช้งาน form_v2 อัตโนมัติ
    await ensurePlotTaskFormV2Activated(plotId, taskTemplateId, actorUsername);
  } catch (err) {
    console.warn('Error syncing QC on Admin Undo:', err);
  }
}

/**
 * ซิงค์สถานะระบบฟอร์ม QC เมื่อแอดมินกด "รีเซ็ตงาน (0%)"
 * 1. ล้างใบตรวจเดิมของงวดงานนี้ใน qc_inspections เพื่อเริ่มนับรอบที่ 1 ใหม่เมื่อโฟร์แมนส่งงานกลับมาที่ 100%
 * 2. เปิดใช้งาน form_v2 ตามชุดมาตรฐานของแบบบ้านให้พร้อมสำหรับการตรวจรอบใหม่
 */
export async function syncQCOnAdminResetToZero(params: {
  plotId: string;
  taskTemplateId: string;
  actorUsername: string;
}): Promise<void> {
  const { plotId, taskTemplateId, actorUsername } = params;
  try {
    // 1. ค้นหาและลบใบตรวจเดิมของงวดงานนี้
    const { data: oldInspections } = await supabase
      .from('qc_inspections')
      .select('id')
      .eq('plot_id', plotId)
      .eq('task_template_id', taskTemplateId);

    if (oldInspections && oldInspections.length > 0) {
      const ids = oldInspections.map(i => i.id);
      await supabase.from('qc_drawing_annotations').delete().in('inspection_id', ids);
      await supabase.from('qc_inspection_answers').delete().in('inspection_id', ids);
      await supabase.from('qc_inspections').delete().in('id', ids);
    }

    // 2. เปิดใช้งาน form_v2 ตามชุดมาตรฐานของแบบบ้านให้พร้อมตรวจเมื่อส่งงาน 100% รอบใหม่
    await ensurePlotTaskFormV2Activated(plotId, taskTemplateId, actorUsername);
  } catch (err) {
    console.warn('Error syncing QC on Admin Reset to Zero:', err);
  }
}

async function ensurePlotTaskFormV2Activated(
  plotId: string,
  taskTemplateId: string,
  actorUsername: string
): Promise<void> {
  const [{ data: plot }, { data: task }] = await Promise.all([
    supabase.from('plots').select('id, project_name, house_type_id').eq('id', plotId).maybeSingle(),
    supabase.from('task_templates').select('id, task_name, house_type_id').eq('id', taskTemplateId).maybeSingle()
  ]);

  if (!plot || !task) return;
  const houseTypeId = plot.house_type_id || task.house_type_id;
  if (!houseTypeId) return;

  const { data: stdSet } = await supabase
    .from('qc_standard_sets')
    .select('*')
    .eq('house_type_id', houseTypeId)
    .eq('task_name', task.task_name.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (!stdSet) return;

  await supabase.from('qc_plot_task_configs').upsert({
    project_name: plot.project_name,
    plot_id: plot.id,
    task_template_id: task.id,
    task_name: task.task_name,
    inspection_method: 'form_v2',
    is_active: true,
    form_template_id: stdSet.form_template_id,
    form_version: stdSet.form_version,
    drawing_id: stdSet.drawing_id || null,
    drawing_version: stdSet.drawing_version || null,
    selected_pages: stdSet.selected_pages || [],
    require_plot_drawing: Boolean(stdSet.require_plot_drawing),
    is_plot_override: false,
    created_by: actorUsername,
    updated_at: new Date().toISOString()
  }, { onConflict: 'plot_id,task_template_id' });
}
