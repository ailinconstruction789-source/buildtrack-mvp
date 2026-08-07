-- Add status columns for Admin document updates
ALTER TABLE plots ADD COLUMN IF NOT EXISTS permit_status VARCHAR DEFAULT 'NotStarted';
ALTER TABLE plots ADD COLUMN IF NOT EXISTS registration_status VARCHAR DEFAULT 'NotStarted';
ALTER TABLE plots ADD COLUMN IF NOT EXISTS water_meter_status VARCHAR DEFAULT 'NotStarted';
ALTER TABLE plots ADD COLUMN IF NOT EXISTS electric_meter_status VARCHAR DEFAULT 'NotStarted';
