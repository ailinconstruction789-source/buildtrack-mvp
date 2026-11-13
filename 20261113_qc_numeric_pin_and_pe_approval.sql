-- ==============================================================================
-- 📐 BUILDTRACK MIGRATION: QC NUMERIC PIN MEASUREMENT & PE CONDITIONAL APPROVAL
-- Date: 2026-11-13
-- Description:
-- 1. Updates check constraints to support 'conditional' status and 'pending_pe'
-- 2. Adds Target vs Actual numeric measurement fields to qc_drawing_annotations
-- 3. Adds PE review and downstream task transfer columns to qc_inspections and qc_inspection_answers
-- ==============================================================================

-- 1. Update qc_inspections
ALTER TABLE qc_inspections DROP CONSTRAINT IF EXISTS qc_inspections_document_status_check;
ALTER TABLE qc_inspections ADD CONSTRAINT qc_inspections_document_status_check 
  CHECK (document_status IN ('draft', 'submitted', 'pending_pe', 'approved', 'rejected'));

ALTER TABLE qc_inspections ADD COLUMN IF NOT EXISTS conditional_items INTEGER DEFAULT 0;
ALTER TABLE qc_inspections ADD COLUMN IF NOT EXISTS pe_reviewer_name TEXT;
ALTER TABLE qc_inspections ADD COLUMN IF NOT EXISTS pe_reviewed_at TIMESTAMPTZ;
ALTER TABLE qc_inspections ADD COLUMN IF NOT EXISTS pe_review_decision TEXT CHECK (pe_review_decision IN ('approved', 'rejected'));
ALTER TABLE qc_inspections ADD COLUMN IF NOT EXISTS pe_review_notes TEXT;

-- 2. Update qc_inspection_answers
ALTER TABLE qc_inspection_answers DROP CONSTRAINT IF EXISTS qc_inspection_answers_status_check;
ALTER TABLE qc_inspection_answers ADD CONSTRAINT qc_inspection_answers_status_check 
  CHECK (status IN ('uninspected', 'passed', 'failed', 'conditional', 'na'));

ALTER TABLE qc_inspection_answers ADD COLUMN IF NOT EXISTS transferred_to_task_template_id TEXT;
ALTER TABLE qc_inspection_answers ADD COLUMN IF NOT EXISTS transferred_to_task_name TEXT;
ALTER TABLE qc_inspection_answers ADD COLUMN IF NOT EXISTS pe_approval_status TEXT CHECK (pe_approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE qc_inspection_answers ADD COLUMN IF NOT EXISTS pe_approved_by TEXT;
ALTER TABLE qc_inspection_answers ADD COLUMN IF NOT EXISTS pe_approved_at TIMESTAMPTZ;
ALTER TABLE qc_inspection_answers ADD COLUMN IF NOT EXISTS pe_remarks TEXT;

-- 3. Update qc_drawing_annotations
ALTER TABLE qc_drawing_annotations DROP CONSTRAINT IF EXISTS qc_drawing_annotations_status_check;
ALTER TABLE qc_drawing_annotations ADD CONSTRAINT qc_drawing_annotations_status_check 
  CHECK (status IN ('passed', 'failed', 'conditional', 'na'));

ALTER TABLE qc_drawing_annotations ADD COLUMN IF NOT EXISTS target_value NUMERIC;
ALTER TABLE qc_drawing_annotations ADD COLUMN IF NOT EXISTS tolerance NUMERIC;
ALTER TABLE qc_drawing_annotations ADD COLUMN IF NOT EXISTS min_value NUMERIC;
ALTER TABLE qc_drawing_annotations ADD COLUMN IF NOT EXISTS max_value NUMERIC;
ALTER TABLE qc_drawing_annotations ADD COLUMN IF NOT EXISTS transferred_to_task_template_id TEXT;
ALTER TABLE qc_drawing_annotations ADD COLUMN IF NOT EXISTS transferred_to_task_name TEXT;

-- Indexes for transferred defects lookup
CREATE INDEX IF NOT EXISTS idx_qc_inspection_answers_transferred 
  ON qc_inspection_answers(transferred_to_task_template_id) 
  WHERE transferred_to_task_template_id IS NOT NULL;
