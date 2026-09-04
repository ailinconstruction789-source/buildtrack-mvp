-- Migration script: Add inspection dates and statuses to plots table
ALTER TABLE plots 
ADD COLUMN IF NOT EXISTS inspection_round1_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS inspection_round1_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS inspection_round2_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS inspection_round2_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS handover_notes TEXT;

COMMENT ON COLUMN plots.inspection_round1_date IS 'วันนัดหมายตรวจบ้านรอบที่ 1';
COMMENT ON COLUMN plots.inspection_round1_status IS 'สถานะการตรวจรอบ 1: pending, scheduled, passed, failed';
COMMENT ON COLUMN plots.inspection_round2_date IS 'วันนัดหมายตรวจบ้านรอบที่ 2';
COMMENT ON COLUMN plots.inspection_round2_status IS 'สถานะการตรวจรอบ 2: pending, scheduled, passed, failed';
