-- ==============================================================================
-- Migration: Add is_external flag to projects
-- Date: 2026-11-20
-- Description:
-- Supports designating projects as "External / Custom-built sites" (งานนอกโครงการ / บ้านสั่งสร้างพิเศษ)
-- such as "บ้านคุณโอ", so they are excluded from commercial real-estate dashboard summaries
-- while fully preserving all operational, daily inspection, and foreman features.
-- ==============================================================================

-- 1. Add is_external column to projects table if not already present
ALTER TABLE IF EXISTS public.projects
ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false;

-- 2. Update existing "บ้านคุณโอ" to be an external project
UPDATE public.projects
SET is_external = true
WHERE name ILIKE '%คุณโอ%';

-- 3. Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
