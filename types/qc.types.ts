// ==============================================================================
// 📐 BUILDTRACK: TYPES FOR NEW QC FORM SYSTEM (ระบบ QC แบบฟอร์มใหม่)
// ==============================================================================

export type QCInspectionMethod = 'legacy' | 'form_v2';

export type QCFormTemplateStatus = 'draft' | 'published' | 'retired';

export type QCFormItemType = 
  | 'pass_fail_na' 
  | 'number' 
  | 'text' 
  | 'single_select' 
  | 'multi_select' 
  | 'photo' 
  | 'drawing_point';

export type QCAnswerStatus = 'uninspected' | 'passed' | 'failed' | 'conditional' | 'na';

export type QCDocumentStatus = 'draft' | 'submitted' | 'pending_pe' | 'approved' | 'rejected';

export type QCInspectionResult = 'passed' | 'failed' | 'conditional';

export interface QCFormItem {
  id: string;
  form_template_id: string;
  item_order: number;
  section_title?: string;
  item_code: string;
  item_text: string;
  description?: string;
  item_type: QCFormItemType;
  is_required: boolean;
  is_critical: boolean;
  require_remark_on_fail: boolean;
  require_photo_on_fail: boolean;
  unit?: string;
  target_value?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  options?: string[];
  created_at?: string;
}

export interface QCFormTemplate {
  id: string;
  code: string;
  title: string;
  description?: string;
  category: string;
  version: number;
  status: QCFormTemplateStatus;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  items?: QCFormItem[];
}

export interface QCDrawingPage {
  id: string;
  drawing_id: string;
  page_number: number;
  page_label: string;
  page_image_url?: string;
  width: number;
  height: number;
  created_at?: string;
}

export type QCGarageOrientation = 'left' | 'right' | 'standard';

export interface QCPlotDrawingViewport {
  id?: string;
  project_name: string;
  plot_id: string;
  drawing_id: string;
  x_percent: number; // 0 to 100 (% ของภาพ Master Plan)
  y_percent: number; // 0 to 100 (% ของภาพ Master Plan)
  zoom_level: number; // ระดับการซูม เช่น 1.5, 2.0, 3.0
  box_width_percent?: number;
  box_height_percent?: number;
  created_at?: string;
  updated_at?: string;
}

export interface QCReferenceDrawing {
  id: string;
  drawing_number: string;
  title: string;
  file_url: string;
  file_name: string;
  file_type: 'pdf' | 'image';
  version: number;
  status: 'active' | 'retired';
  total_pages: number;
  project_name?: string | null;
  house_type_id?: string | null;
  task_template_id?: string | null;
  plot_id?: string | null;
  garage_orientation?: QCGarageOrientation | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  pages?: QCDrawingPage[];
}

export interface QCStandardSet {
  id: string;
  set_name: string;
  project_name: string;
  house_type_id: string;
  task_name: string;
  form_template_id: string;
  form_version: number;
  drawing_id?: string | null;
  drawing_version?: number | null;
  selected_pages: number[];
  require_plot_drawing: boolean;
  is_active: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  // joined info
  form_template?: QCFormTemplate;
  reference_drawing?: QCReferenceDrawing;
}

export interface QCPlotTaskConfig {
  id: string;
  project_name: string;
  plot_id: string;
  task_template_id: string;
  task_name: string;
  inspection_method: QCInspectionMethod;
  is_active: boolean;
  form_template_id?: string | null;
  form_version?: number | null;
  drawing_id?: string | null;
  drawing_version?: number | null;
  selected_pages: number[];
  is_plot_override: boolean;
  require_plot_drawing: boolean;
  override_notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  // joined info
  form_template?: QCFormTemplate;
  reference_drawing?: QCReferenceDrawing;
}

export interface QCDrawingAnnotation {
  id?: string;
  inspection_id?: string;
  form_item_id?: string | null;
  page_number: number;
  pin_label: string;
  x_ratio: number; // 0.0 to 1.0
  y_ratio: number; // 0.0 to 1.0
  target_value?: number | null;
  tolerance?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  measured_value?: number | null;
  unit?: string | null;
  status?: 'passed' | 'failed' | 'conditional' | 'na' | null;
  remarks?: string | null;
  photo_url?: string | null;
  transferred_to_task_template_id?: string | null;
  transferred_to_task_name?: string | null;
  created_at?: string;
}

export interface QCInspectionAnswer {
  id?: string;
  inspection_id?: string;
  form_item_id: string;
  item_code: string;
  item_text: string;
  item_type: QCFormItemType;
  is_critical: boolean;
  status: QCAnswerStatus;
  numeric_value?: number | null;
  unit?: string | null;
  text_value?: string | null;
  selected_options?: string[];
  photo_urls?: string[];
  remarks?: string | null;
  transferred_to_task_template_id?: string | null;
  transferred_to_task_name?: string | null;
  pe_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  pe_approved_by?: string | null;
  pe_approved_at?: string | null;
  pe_remarks?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface QCInspection {
  id: string;
  project_name: string;
  plot_id: string;
  task_template_id: string;
  task_name: string;
  round_number: number;
  previous_inspection_id?: string | null;
  inspection_method: QCInspectionMethod;
  form_template_id?: string;
  form_version: number;
  form_title: string;
  drawing_id?: string | null;
  drawing_version?: number | null;
  drawing_title?: string | null;
  inspector_id?: string;
  inspector_name: string;
  inspector_role: string;
  document_status: QCDocumentStatus;
  inspection_result?: QCInspectionResult | null;
  total_items: number;
  passed_items: number;
  failed_items: number;
  conditional_items?: number;
  na_items: number;
  notes?: string;
  photo_urls?: string[];
  pe_reviewer_name?: string | null;
  pe_reviewed_at?: string | null;
  pe_review_decision?: 'approved' | 'rejected' | null;
  pe_review_notes?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  reopened_at?: string | null;
  reopened_by?: string | null;
  reopened_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  // joined data
  answers?: QCInspectionAnswer[];
  annotations?: QCDrawingAnnotation[];
}

export interface QCAuditLog {
  id: string;
  action_type: 
    | 'config_create' 
    | 'config_update' 
    | 'scope_assign' 
    | 'submit_inspection' 
    | 'approve_inspection' 
    | 'reopen_inspection' 
    | 'retest_created';
  entity_type: string;
  entity_id: string;
  actor_username: string;
  actor_role: string;
  details: Record<string, any>;
  created_at: string;
}

export type QCResolutionState = 
  | 'legacy'               // ใช้วิธีเดิม (ไม่ได้เปิดใช้ หรือเริ่มตรวจด้วยวิธีเดิมไปแล้ว)
  | 'form_v2_ready'        // เปิดใช้และตั้งค่าครบ พร้อมตรวจ
  | 'incomplete_config'    // เปิดใช้แต่ฟอร์มหรือแบบไม่ครบ (ห้ามเริ่มตรวจ และห้าม fallback)
  | 'load_error';          // โหลดการตั้งค่าไม่สำเร็จ (ห้าม fallback)

export interface QCTaskConfigResolution {
  state: QCResolutionState;
  inspectionMethod: QCInspectionMethod;
  isLocked: boolean; // ถ้าเริ่มตรวจแล้ว ไม่ว่าจะ legacy หรือ form_v2 จะล็อกวิธีตรวจ
  lockedReason?: string;
  errorMessage?: string;
  sourceLabel: string; // เช่น 'มาตรฐานแบบบ้าน' | 'ปรับแต่งเฉพาะแปลง' | 'แบบกลางของงาน' | 'ระบบเดิม'
  config?: QCPlotTaskConfig;
  standardSet?: QCStandardSet;
  formTemplate?: QCFormTemplate;
  referenceDrawing?: QCReferenceDrawing;
  viewport?: QCPlotDrawingViewport | null;
  garageOrientation?: QCGarageOrientation;
  selectedPages?: number[];
  latestInspection?: QCInspection | null;
  totalRounds?: number;
}
