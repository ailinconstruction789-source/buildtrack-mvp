-- Add expected_transfer_date to sales table
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS expected_transfer_date DATE;
