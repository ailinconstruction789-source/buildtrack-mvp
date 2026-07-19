-- ==============================================================================
-- 🚀 BUILDTRACK: UPDATE SALES SCHEMA FOR REAL DATA
-- ==============================================================================

-- 1. Add missing columns to leads
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS interest VARCHAR,
ADD COLUMN IF NOT EXISTS occupation VARCHAR;

-- 2. Add missing columns to sales
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS bank_name VARCHAR,
ADD COLUMN IF NOT EXISTS land_office_price NUMERIC(15, 2);

-- Note: The `agent_name` column already exists in the `leads` table from the previous migration.
-- Note: The `plot_id` (UUID) already exists in the `sales` table from the previous migration.
