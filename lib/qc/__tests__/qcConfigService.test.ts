// ==============================================================================
// 🧪 BUILDTRACK: TESTS FOR QC CONFIG & RESOLUTION SERVICE
// ==============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  hasInspectionStarted, 
  resolveReferenceDrawing, 
  resolveTaskInspectionConfig,
  resolveStandardSetPreviewConfig,
  previewScopeAssignment,
  confirmScopeAssignment 
} from '../qcConfigService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn()
  }
}));

describe('QC Config Service - Opt-in & Legacy Preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects inspection already started in legacy task_updates', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'upd-1', action: 'QC แจ้งแก้ไข', role: 'QC', created_at: '2026-11-01' }],
            error: null
          })
        } as any;
      }
      return {} as any;
    });

    const result = await hasInspectionStarted('PLOT-01', 'TASK-01');
    expect(result.started).toBe(true);
    expect(result.method).toBe('legacy');
  });

  it('does NOT falsely detect Site Engineer approval as a started QC inspection', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'upd-2', action: 'Site Engineer อนุมัติ', role: 'Site Engineer', created_at: '2026-11-10T10:00:00Z' },
              { id: 'upd-1', action: 'ส่งงาน 100%', role: 'Foreman', created_at: '2026-11-10T09:00:00Z' }
            ],
            error: null
          })
        } as any;
      }
      return {} as any;
    });

    const result = await hasInspectionStarted('PLOT-39', 'TASK-33');
    expect(result.started).toBe(false);
  });

  it('ignores legacy QC approvals that occurred BEFORE an Admin Reset (0%)', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'upd-4', action: 'Site Engineer อนุมัติ', role: 'Site Engineer', created_at: '2026-11-12T10:00:00Z' },
              { id: 'upd-3', action: 'ส่งงาน 100%', role: 'Foreman', created_at: '2026-11-12T09:00:00Z' },
              { id: 'upd-2', action: 'แอดมินย้อนสถานะงาน (Reset)', role: 'Admin', created_at: '2026-11-11T15:00:00Z' },
              { id: 'upd-1', action: 'QC อนุมัติ', role: 'QC', created_at: '2026-11-11T10:00:00Z' }
            ],
            error: null
          })
        } as any;
      }
      return {} as any;
    });

    const result = await hasInspectionStarted('PLOT-39', 'TASK-33');
    expect(result.started).toBe(false);
  });

  it('detects inspection already started in new qc_inspections', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'insp-1', round_number: 1, document_status: 'draft', form_version: 1, drawing_version: 1 }],
            error: null
          })
        } as any;
      }
      return {} as any;
    });

    const result = await hasInspectionStarted('PLOT-02', 'TASK-01');
    expect(result.started).toBe(true);
    expect(result.method).toBe('form_v2');
    expect(result.roundCount).toBe(1);
  });

  it('returns legacy state when task has already started with legacy method and locks it', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'upd-1', action: 'QC อนุมัติ', role: 'QC' }],
            error: null
          })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveTaskInspectionConfig({
      projectName: 'The Palm',
      plotId: 'PLOT-01',
      houseTypeId: 'HT-01',
      taskTemplateId: 'TASK-01',
      taskName: 'งานก่อผนัง'
    });

    expect(res.state).toBe('legacy');
    expect(res.inspectionMethod).toBe('legacy');
    expect(res.isLocked).toBe(true);
  });

  it('returns legacy state when plot is not opted into new QC system', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections' || table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'qc_plot_task_configs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        } as any;
      }
      if (table === 'qc_standard_sets') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveTaskInspectionConfig({
      projectName: 'The Palm',
      plotId: 'PLOT-NEW',
      houseTypeId: 'HT-01',
      taskTemplateId: 'TASK-01',
      taskName: 'งานก่อผนัง'
    });

    expect(res.state).toBe('legacy');
    expect(res.inspectionMethod).toBe('legacy');
  });

  it('returns incomplete_config and NEVER falls back to legacy when form is missing', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections' || table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'qc_plot_task_configs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'cfg-1',
              plot_id: 'PLOT-05',
              task_template_id: 'TASK-01',
              is_active: true,
              inspection_method: 'form_v2',
              form_template_id: null // Missing form!
            },
            error: null
          })
        } as any;
      }
      if (table === 'qc_reference_drawings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveTaskInspectionConfig({
      projectName: 'The Palm',
      plotId: 'PLOT-05',
      houseTypeId: 'HT-01',
      taskTemplateId: 'TASK-01',
      taskName: 'งานก่อผนัง'
    });

    expect(res.state).toBe('incomplete_config');
    expect(res.inspectionMethod).toBe('form_v2');
    expect(res.errorMessage).toContain('ยังไม่ได้เลือกแม่แบบฟอร์ม');
  });

  it('returns incomplete_config when require_plot_drawing is true but plot drawing is missing', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections' || table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'qc_plot_task_configs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'cfg-2',
              plot_id: 'PLOT-06',
              task_template_id: 'TASK-PIPE',
              is_active: true,
              inspection_method: 'form_v2',
              form_template_id: 'tmpl-1',
              form_template: { id: 'tmpl-1', title: 'ฟอร์มวางท่อ', version: 1 },
              require_plot_drawing: true,
              is_plot_override: false
            },
            error: null
          })
        } as any;
      }
      if (table === 'qc_reference_drawings') {
        // Return no plot-specific drawing
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveTaskInspectionConfig({
      projectName: 'The Palm',
      plotId: 'PLOT-06',
      houseTypeId: 'HT-01',
      taskTemplateId: 'TASK-PIPE',
      taskName: 'งานวางท่อ'
    });

    expect(res.state).toBe('incomplete_config');
    expect(res.errorMessage).toContain('ต้องใช้แบบแปลนเฉพาะแปลง');
  });

  it('returns load_error and DOES NOT fall back to legacy when database read fails', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_inspections' || table === 'task_updates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      if (table === 'qc_plot_task_configs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Network disconnected' } })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveTaskInspectionConfig({
      projectName: 'The Palm',
      plotId: 'PLOT-07',
      houseTypeId: 'HT-01',
      taskTemplateId: 'TASK-01',
      taskName: 'งานก่อผนัง'
    });

    expect(res.state).toBe('load_error');
    expect(res.inspectionMethod).toBe('form_v2');
    expect(res.errorMessage).toContain('เกิดข้อผิดพลาด');
  });
});

describe('Reference Drawing Precedence', () => {
  it('selects plot-specific drawing over house-type standard drawing', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_reference_drawings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: any) => {
            if (col === 'plot_id' && val === 'PLOT-A1') {
              return {
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: 'draw-specific', title: 'แบบเฉพาะแปลง A1', version: 1, plot_id: 'PLOT-A1' }],
                  error: null
                })
              };
            }
            return {
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            };
          })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveReferenceDrawing({
      projectName: 'The Palm',
      plotId: 'PLOT-A1',
      houseTypeId: 'HT-A',
      taskTemplateId: 'TASK-01'
    });

    expect(res.drawing?.id).toBe('draw-specific');
    expect(res.isSpecificPlot).toBe(true);
    expect(res.sourceLabel).toContain('เฉพาะแปลง');
  });

  it('resolves sorted form items and standard set fallback drawing + viewport for Admin preview', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_form_templates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'tmpl-1',
              title: 'ฟอร์มตรวจท่อใยหิน',
              version: 1,
              items: [
                { id: 'i2', item_order: 2, item_code: 'Q02', item_text: 'ตรวจแนวระดับท่อ', item_type: 'pass_fail', is_critical: false, is_required: true },
                { id: 'i1', item_order: 1, item_code: 'Q01', item_text: 'ตรวจขนาดท่อและบ่อพัก', item_type: 'drawing_point', is_critical: true, is_required: true }
              ]
            },
            error: null
          })
        } as any;
      }
      if (table === 'qc_reference_drawings') {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'master-plan-1',
              drawing_number: 'AL6001',
              title: 'ผังท่อใยหินโครงการไอลิน 6',
              file_url: 'https://example.com/master.png',
              file_type: 'image',
              version: 1,
              project_name: 'ไอลิน6',
              pages: [{ id: 'p1', page_number: 1, page_image_url: 'https://example.com/master.png' }]
            },
            error: null
          })
        };
        return chain;
      }
      if (table === 'qc_plot_drawing_viewports') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              project_name: 'ไอลิน6',
              plot_id: 'PLOT-1',
              drawing_id: 'master-plan-1',
              x_percent: 25,
              y_percent: 60,
              zoom_level: 13
            },
            error: null
          })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveStandardSetPreviewConfig({
      projectName: 'ไอลิน6',
      houseTypeId: 'HT-1',
      taskTemplateId: 'TASK-10',
      taskName: 'งานท่อใยหินบ่อพัก',
      plotId: 'PLOT-1',
      standardSet: {
        id: 'set-10',
        project_name: 'ไอลิน6',
        house_type_id: 'HT-1',
        task_name: 'งานท่อใยหินบ่อพัก',
        set_name: 'ชุดตรวจมาตรฐาน - งานท่อใยหินบ่อพัก',
        form_template_id: 'tmpl-1',
        drawing_id: 'master-plan-1',
        form_version: 1,
        selected_pages: [],
        require_plot_drawing: false,
        is_active: true
      }
    });

    expect(res.state).toBe('form_v2_ready');
    expect(res.formTemplate?.items?.map(i => i.item_code)).toEqual(['Q01', 'Q02']);
    expect(res.referenceDrawing?.id).toBe('master-plan-1');
    expect(res.viewport?.zoom_level).toBe(13);
  });

  it('keeps formTemplate in preview with incomplete_config warning when require_plot_drawing is true but sample plot lacks drawing', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'qc_form_templates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'tmpl-1',
              title: 'ฟอร์มเฉพาะแปลง',
              version: 1,
              items: [
                { id: 'i1', item_order: 1, item_code: 'Q01', item_text: 'ตรวจบ่อพัก', item_type: 'pass_fail', is_critical: false, is_required: true }
              ]
            },
            error: null
          })
        } as any;
      }
      if (table === 'qc_reference_drawings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null })
        } as any;
      }
      return {} as any;
    });

    const res = await resolveStandardSetPreviewConfig({
      projectName: 'ไอลิน6',
      houseTypeId: 'HT-1',
      taskTemplateId: 'TASK-10',
      taskName: 'งานท่อใยหินบ่อพัก',
      plotId: 'PLOT-1',
      standardSet: {
        id: 'set-10',
        project_name: 'ไอลิน6',
        house_type_id: 'HT-1',
        task_name: 'งานท่อใยหินบ่อพัก',
        set_name: 'ชุดตรวจมาตรฐาน - งานท่อใยหินบ่อพัก',
        form_template_id: 'tmpl-1',
        form_version: 1,
        selected_pages: [],
        require_plot_drawing: true,
        is_active: true
      }
    });

    expect(res.state).toBe('incomplete_config');
    expect(res.formTemplate?.items?.length).toBe(1);
    expect(res.referenceDrawing).toBeUndefined();
    expect(res.errorMessage).toContain('บังคับใช้แบบเฉพาะแปลง');
  });
});
