-- Migration: Add meter installation photo and confirmation fields to plots table
-- Allows Office/Admin to mark meter as Paid, and Foreman to photograph & confirm installation

ALTER TABLE plots ADD COLUMN IF NOT EXISTS water_meter_image_url TEXT;
ALTER TABLE plots ADD COLUMN IF NOT EXISTS water_meter_installed_date TIMESTAMPTZ;
ALTER TABLE plots ADD COLUMN IF NOT EXISTS water_meter_meter_no TEXT;

ALTER TABLE plots ADD COLUMN IF NOT EXISTS electric_meter_image_url TEXT;
ALTER TABLE plots ADD COLUMN IF NOT EXISTS electric_meter_installed_date TIMESTAMPTZ;
ALTER TABLE plots ADD COLUMN IF NOT EXISTS electric_meter_meter_no TEXT;
