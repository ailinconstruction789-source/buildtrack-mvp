-- ==========================================
-- ADD FINANCIAL COLUMNS (Cost & Selling Price)
-- ==========================================

-- 1. Add 'cost' to task_templates for defining individual task values
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;

-- 2. Add 'selling_price' to plots for defining the plot's expected revenue
ALTER TABLE plots ADD COLUMN IF NOT EXISTS selling_price NUMERIC DEFAULT 0;

-- Optional: Update existing records to ensure they have default value 0 instead of NULL
UPDATE task_templates SET cost = 0 WHERE cost IS NULL;
UPDATE plots SET selling_price = 0 WHERE selling_price IS NULL;
