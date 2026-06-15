-- ==============================================================================
-- MIGRATION: Add Ready for Sale functionality
-- ==============================================================================

-- 1. Add new columns to 'plots' table
ALTER TABLE plots 
ADD COLUMN IF NOT EXISTS sale_status VARCHAR DEFAULT 'active',
ADD COLUMN IF NOT EXISTS paused_for_sale_at TIMESTAMPTZ;

-- Note: 
-- sale_status can be:
--   'active' : Normal construction
--   'ready_for_sale' : Construction paused waiting for customer to select specs
--   'sold' : Customer confirmed, construction resumed (same behavior as active, but allows tracking)

-- (Optional) Update existing plots to be 'active'
UPDATE plots SET sale_status = 'active' WHERE sale_status IS NULL;

-- ==============================================================================
-- END OF MIGRATION
-- ==============================================================================
