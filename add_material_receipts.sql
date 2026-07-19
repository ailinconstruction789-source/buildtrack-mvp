-- Migration: Add Task Material Receipts Table for Multi-Lot Delivery

-- 1. Modify existing constraint to allow 'partial'
ALTER TABLE task_material_requests DROP CONSTRAINT IF EXISTS task_material_requests_status_check;
ALTER TABLE task_material_requests ADD CONSTRAINT task_material_requests_status_check CHECK (status IN ('requested', 'ordered', 'partial', 'received'));

-- 2. Create task_material_receipts table
CREATE TABLE IF NOT EXISTS task_material_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES task_material_requests(id) ON DELETE CASCADE,
    image_url TEXT,
    notes TEXT,
    received_by_role TEXT,
    received_by_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE task_material_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public select on task_material_receipts" ON task_material_receipts FOR SELECT USING (true);
CREATE POLICY "Allow public insert on task_material_receipts" ON task_material_receipts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on task_material_receipts" ON task_material_receipts FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on task_material_receipts" ON task_material_receipts FOR DELETE USING (true);
