-- =========================================================================
-- BUILDTRACK MIGRATION: HOUSE DIMENSIONS, PROJECT SCALE & PLOT PLACEMENT
-- Description:
--   1. Adds building_width and building_depth columns to house_types
--      to decouple building footprint from land parcel sizes.
--   2. Adds scale_meters_per_cell to projects table for real meter mapping.
--   3. Adds house_placement JSONB column to plots table for relational parity.
--
-- Note: Do NOT execute on production without authorization.
-- =========================================================================

-- 1. Add building dimensions to house_types
ALTER TABLE public.house_types 
ADD COLUMN IF NOT EXISTS building_width NUMERIC,
ADD COLUMN IF NOT EXISTS building_depth NUMERIC;

-- Check constraint for building dimensions (positive finite numbers <= 50m)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_house_types_building_dimensions'
    ) THEN
        ALTER TABLE public.house_types 
        ADD CONSTRAINT check_house_types_building_dimensions 
        CHECK (
            (building_width > 0 AND building_width <= 50 AND building_depth > 0 AND building_depth <= 50)
            OR (building_width IS NULL AND building_depth IS NULL)
        );
    END IF;
END $$;

COMMENT ON COLUMN public.house_types.building_width IS 'Nominal building width in meters (e.g. 5.6). Must be > 0.';
COMMENT ON COLUMN public.house_types.building_depth IS 'Nominal building depth in meters (e.g. 5.4). Must be > 0.';

-- 2. Add scale_meters_per_cell to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS scale_meters_per_cell NUMERIC;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_projects_scale_meters_per_cell'
    ) THEN
        ALTER TABLE public.projects 
        ADD CONSTRAINT check_projects_scale_meters_per_cell 
        CHECK (
            (scale_meters_per_cell > 0 AND scale_meters_per_cell <= 50)
            OR scale_meters_per_cell IS NULL
        );
    END IF;
END $$;

COMMENT ON COLUMN public.projects.scale_meters_per_cell IS 'Real world meters per grid cell (e.g. 3.5). NULL indicates simulated proportion.';

-- 3. Add house_placement JSONB to plots table
ALTER TABLE public.plots 
ADD COLUMN IF NOT EXISTS house_placement JSONB;

COMMENT ON COLUMN public.plots.house_placement IS 'House placement within parcel: { offsetX, offsetZ, rotation, facing }';

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
