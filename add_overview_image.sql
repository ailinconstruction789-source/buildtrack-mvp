-- Run this in Supabase SQL Editor to add the overview_image_url column
ALTER TABLE plots ADD COLUMN IF NOT EXISTS overview_image_url TEXT;
