-- ==============================================================================
-- 🏗️ BUILDTRACK: NEW QC FORM SYSTEM MIGRATION (ระบบ QC แบบฟอร์มใหม่)
-- ==============================================================================
-- Additive and backward-compatible schema.
-- Preserves all legacy QC data and allows selective opt-in by project, plot, and task.
-- ==============================================================================

-- 1. QC Form Templates (แม่แบบฟอร์มตรวจ)
CREATE TABLE IF NOT EXISTS qc_form_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_form_template_code_version UNIQUE (code, version)
);

-- 2. QC Form Items (รายการคำถาม/ข้อตรวจในแม่แบบ)
CREATE TABLE IF NOT EXISTS qc_form_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_template_id UUID NOT NULL REFERENCES qc_form_templates(id) ON DELETE CASCADE,
    item_order INTEGER NOT NULL DEFAULT 0,
    section_title TEXT,
    item_code TEXT NOT NULL,
    item_text TEXT NOT NULL,
    description TEXT,
    item_type TEXT NOT NULL CHECK (item_type IN ('pass_fail_na', 'number', 'text', 'single_select', 'multi_select', 'photo', 'drawing_point')),
    is_required BOOLEAN NOT NULL DEFAULT true,
    is_critical BOOLEAN NOT NULL DEFAULT false,
    require_remark_on_fail BOOLEAN NOT NULL DEFAULT true,
    require_photo_on_fail BOOLEAN NOT NULL DEFAULT false,
    unit TEXT,
    target_value NUMERIC,
    min_value NUMERIC,
    max_value NUMERIC,
    options JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. QC Reference Drawings (คลังแบบอ้างอิง)
CREATE TABLE IF NOT EXISTS qc_reference_drawings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drawing_number TEXT NOT NULL,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'pdf' CHECK (file_type IN ('pdf', 'image')),
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    total_pages INTEGER NOT NULL DEFAULT 1,
    project_name TEXT,
    house_type_id TEXT,
    task_template_id TEXT,
    plot_id TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_drawing_number_version UNIQUE (drawing_number, version)
);

-- 4. QC Drawing Pages (รายละเอียดแต่ละหน้าของแบบอ้างอิง)
CREATE TABLE IF NOT EXISTS qc_drawing_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drawing_id UUID NOT NULL REFERENCES qc_reference_drawings(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 1,
    page_label TEXT NOT NULL,
    page_image_url TEXT,
    width INTEGER DEFAULT 1920,
    height INTEGER DEFAULT 1080,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_drawing_page UNIQUE (drawing_id, page_number)
);

-- 5. QC Standard Inspection Sets (ชุดตรวจมาตรฐานตาม โครงการ + งาน + แบบบ้าน)
CREATE TABLE IF NOT EXISTS qc_standard_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    house_type_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    form_template_id UUID NOT NULL REFERENCES qc_form_templates(id),
    form_version INTEGER NOT NULL,
    drawing_id UUID REFERENCES qc_reference_drawings(id),
    drawing_version INTEGER,
    selected_pages JSONB DEFAULT '[]'::jsonb,
    require_plot_drawing BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_standard_set UNIQUE (project_name, house_type_id, task_name)
);

-- 6. QC Plot Task Configurations (การผูกใช้งานจริงระดับแปลง + งาน)
CREATE TABLE IF NOT EXISTS qc_plot_task_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name TEXT NOT NULL,
    plot_id TEXT NOT NULL,
    task_template_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    inspection_method TEXT NOT NULL DEFAULT 'form_v2' CHECK (inspection_method IN ('legacy', 'form_v2')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    form_template_id UUID REFERENCES qc_form_templates(id),
    form_version INTEGER,
    drawing_id UUID REFERENCES qc_reference_drawings(id),
    drawing_version INTEGER,
    selected_pages JSONB DEFAULT '[]'::jsonb,
    is_plot_override BOOLEAN NOT NULL DEFAULT false,
    require_plot_drawing BOOLEAN NOT NULL DEFAULT false,
    override_notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_plot_task_config UNIQUE (plot_id, task_template_id)
);

-- 7. QC Inspections (บันทึกการตรวจจริงและรอบการตรวจ)
CREATE TABLE IF NOT EXISTS qc_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name TEXT NOT NULL,
    plot_id TEXT NOT NULL,
    task_template_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    round_number INTEGER NOT NULL DEFAULT 1,
    previous_inspection_id UUID REFERENCES qc_inspections(id),
    inspection_method TEXT NOT NULL DEFAULT 'form_v2' CHECK (inspection_method IN ('legacy', 'form_v2')),
    form_template_id UUID REFERENCES qc_form_templates(id),
    form_version INTEGER NOT NULL,
    form_title TEXT NOT NULL,
    drawing_id UUID REFERENCES qc_reference_drawings(id),
    drawing_version INTEGER,
    drawing_title TEXT,
    inspector_id TEXT,
    inspector_name TEXT NOT NULL,
    inspector_role TEXT NOT NULL,
    document_status TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'submitted', 'approved', 'rejected')),
    inspection_result TEXT CHECK (inspection_result IN ('passed', 'failed', 'conditional')),
    total_items INTEGER NOT NULL DEFAULT 0,
    passed_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    na_items INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    photo_urls JSONB DEFAULT '[]'::jsonb,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    reopened_at TIMESTAMPTZ,
    reopened_by TEXT,
    reopened_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_inspection_round UNIQUE (plot_id, task_template_id, round_number)
);

-- 8. QC Inspection Answers (คำตอบและค่าที่วัดรายข้อ)
CREATE TABLE IF NOT EXISTS qc_inspection_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES qc_inspections(id) ON DELETE CASCADE,
    form_item_id UUID NOT NULL,
    item_code TEXT NOT NULL,
    item_text TEXT NOT NULL,
    item_type TEXT NOT NULL,
    is_critical BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'uninspected' CHECK (status IN ('uninspected', 'passed', 'failed', 'na')),
    numeric_value NUMERIC,
    unit TEXT,
    text_value TEXT,
    selected_options JSONB DEFAULT '[]'::jsonb,
    photo_urls JSONB DEFAULT '[]'::jsonb,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_inspection_answer UNIQUE (inspection_id, form_item_id)
);

-- 9. QC Drawing Annotations (จุดปักหมุด structured data บนแบบ)
CREATE TABLE IF NOT EXISTS qc_drawing_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES qc_inspections(id) ON DELETE CASCADE,
    form_item_id UUID,
    page_number INTEGER NOT NULL DEFAULT 1,
    pin_label TEXT NOT NULL,
    x_ratio NUMERIC(7, 4) NOT NULL, -- 0.0000 ถึง 1.0000
    y_ratio NUMERIC(7, 4) NOT NULL, -- 0.0000 ถึง 1.0000
    measured_value NUMERIC,
    unit TEXT,
    status TEXT CHECK (status IN ('passed', 'failed', 'na')),
    remarks TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. QC Audit Trail (เก็บบันทึกการเปลี่ยนแปลง Config, การ Approve, การ Reopen)
CREATE TABLE IF NOT EXISTS qc_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_qc_form_items_template ON qc_form_items(form_template_id);
CREATE INDEX IF NOT EXISTS idx_qc_drawing_pages_drawing ON qc_drawing_pages(drawing_id);
CREATE INDEX IF NOT EXISTS idx_qc_standard_sets_lookup ON qc_standard_sets(project_name, house_type_id, task_name);
CREATE INDEX IF NOT EXISTS idx_qc_plot_task_configs_lookup ON qc_plot_task_configs(plot_id, task_template_id);
CREATE INDEX IF NOT EXISTS idx_qc_plot_task_configs_project ON qc_plot_task_configs(project_name);
CREATE INDEX IF NOT EXISTS idx_qc_inspections_plot_task ON qc_inspections(plot_id, task_template_id);
CREATE INDEX IF NOT EXISTS idx_qc_inspection_answers_inspection ON qc_inspection_answers(inspection_id);
CREATE INDEX IF NOT EXISTS idx_qc_drawing_annotations_inspection ON qc_drawing_annotations(inspection_id);
CREATE INDEX IF NOT EXISTS idx_qc_audit_logs_entity ON qc_audit_logs(entity_type, entity_id);

-- Enable Row Level Security (RLS)
ALTER TABLE qc_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_form_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_reference_drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_drawing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_standard_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_plot_task_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_inspection_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_drawing_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_audit_logs ENABLE ROW LEVEL SECURITY;

-- Permissive authenticated & public policies matching existing project migration pattern
CREATE POLICY "Allow read qc_form_templates" ON qc_form_templates FOR SELECT USING (true);
CREATE POLICY "Allow write qc_form_templates" ON qc_form_templates FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_form_items" ON qc_form_items FOR SELECT USING (true);
CREATE POLICY "Allow write qc_form_items" ON qc_form_items FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_reference_drawings" ON qc_reference_drawings FOR SELECT USING (true);
CREATE POLICY "Allow write qc_reference_drawings" ON qc_reference_drawings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_drawing_pages" ON qc_drawing_pages FOR SELECT USING (true);
CREATE POLICY "Allow write qc_drawing_pages" ON qc_drawing_pages FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_standard_sets" ON qc_standard_sets FOR SELECT USING (true);
CREATE POLICY "Allow write qc_standard_sets" ON qc_standard_sets FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_plot_task_configs" ON qc_plot_task_configs FOR SELECT USING (true);
CREATE POLICY "Allow write qc_plot_task_configs" ON qc_plot_task_configs FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_inspections" ON qc_inspections FOR SELECT USING (true);
CREATE POLICY "Allow write qc_inspections" ON qc_inspections FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_inspection_answers" ON qc_inspection_answers FOR SELECT USING (true);
CREATE POLICY "Allow write qc_inspection_answers" ON qc_inspection_answers FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_drawing_annotations" ON qc_drawing_annotations FOR SELECT USING (true);
CREATE POLICY "Allow write qc_drawing_annotations" ON qc_drawing_annotations FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read qc_audit_logs" ON qc_audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow write qc_audit_logs" ON qc_audit_logs FOR ALL USING (true) WITH CHECK (true);


-- ==============================================================================
-- 🚗 GARAGE ORIENTATION & MASTER PLAN PLOT VIEWPORTS
-- ==============================================================================

-- 1. เพิ่มฟิลด์ garage_orientation ในตาราง plots
ALTER TABLE public.plots ADD COLUMN IF NOT EXISTS garage_orientation TEXT DEFAULT 'standard';
COMMENT ON COLUMN public.plots.garage_orientation IS 'ทิศทางโรงจอดรถ: left (โรงจอดรถซ้าย), right (โรงจอดรถขวา), standard (มาตรฐาน/ไม่ระบุ)';

-- 2. เพิ่มฟิลด์ garage_orientation ในตาราง qc_reference_drawings
ALTER TABLE public.qc_reference_drawings ADD COLUMN IF NOT EXISTS garage_orientation TEXT DEFAULT 'standard';
COMMENT ON COLUMN public.qc_reference_drawings.garage_orientation IS 'ทิศทางแบบแปลน: left (โรงจอดรถซ้าย), right (โรงจอดรถขวา), standard (มาตรฐาน/ใช้ได้ทั้งสองฝั่ง)';

-- 3. ตารางบันทึกมุมมองซูมของ Master Plan ระดับแปลง (Plot Viewport)
CREATE TABLE IF NOT EXISTS public.qc_plot_drawing_viewports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name TEXT NOT NULL,
    plot_id TEXT NOT NULL,
    drawing_id UUID NOT NULL REFERENCES public.qc_reference_drawings(id) ON DELETE CASCADE,
    x_percent NUMERIC NOT NULL DEFAULT 50,
    y_percent NUMERIC NOT NULL DEFAULT 50,
    zoom_level NUMERIC NOT NULL DEFAULT 1,
    box_width_percent NUMERIC,
    box_height_percent NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(plot_id, drawing_id)
);

CREATE INDEX IF NOT EXISTS idx_qc_plot_viewports_lookup ON public.qc_plot_drawing_viewports(project_name, drawing_id);
CREATE INDEX IF NOT EXISTS idx_qc_plot_viewports_plot ON public.qc_plot_drawing_viewports(plot_id);

ALTER TABLE public.qc_plot_drawing_viewports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read qc_plot_drawing_viewports" ON public.qc_plot_drawing_viewports FOR SELECT USING (true);
CREATE POLICY "Allow write qc_plot_drawing_viewports" ON public.qc_plot_drawing_viewports FOR ALL USING (true) WITH CHECK (true);
