-- Add sales pricing columns to plots table
ALTER TABLE public.plots 
ADD COLUMN IF NOT EXISTS land_size NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS house_model TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS land_appraisal_price NUMERIC DEFAULT 0;

-- Optional: Update existing rows to have default values if null
UPDATE public.plots SET land_size = 0 WHERE land_size IS NULL;
UPDATE public.plots SET house_model = '' WHERE house_model IS NULL;
UPDATE public.plots SET land_appraisal_price = 0 WHERE land_appraisal_price IS NULL;
