-- ==============================================================================
-- 🚀 BUILDTRACK: SIMCITY UTILITY MODE SCHEMA
-- ==============================================================================

-- 1. Add `is_infrastructure` flag to house_types table
-- This allows us to mark certain house types (e.g. "ถนนหลัก", "ท่อระบายน้ำ") as infrastructure/utilities.
ALTER TABLE public.house_types 
ADD COLUMN IF NOT EXISTS is_infrastructure BOOLEAN DEFAULT false;

-- 2. Update existing rows to false just to be safe
UPDATE public.house_types SET is_infrastructure = false WHERE is_infrastructure IS NULL;

