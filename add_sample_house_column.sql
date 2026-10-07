-- ==============================================================================
-- 🏡 BUILDTRACK: SAMPLE HOUSE (บ้านตัวอย่าง) & DAILY INSPECTION SCHEMA MIGRATION
-- ==============================================================================

-- 1. Add is_sample_house column to plots table
ALTER TABLE public.plots 
ADD COLUMN IF NOT EXISTS is_sample_house BOOLEAN DEFAULT false;

-- 2. Add comment
COMMENT ON COLUMN public.plots.is_sample_house IS 'ระบุว่าแปลงนี้ถูกกำหนดให้เป็นบ้านตัวอย่าง (Sample House) หรือไม่';

-- 3. Update existing plots that are marked as sample houses
UPDATE public.plots
SET is_sample_house = true
WHERE sale_status IN ('sample', 'sample_house')
   OR plot_name ILIKE '%บ้านตัวอย่าง%'
   OR highlight_note ILIKE '%sample_house%';
