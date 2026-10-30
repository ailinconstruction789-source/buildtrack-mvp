-- ==============================================================================
-- 🏗️ BUILDTRACK: ADD FLOOR COUNT TO HOUSE TYPES
-- ==============================================================================

-- 1. Add floor_count column to house_types table if it doesn't exist
-- Type: INTEGER, Default: NULL (Preserves null for existing rows without assuming 1 or 2)
ALTER TABLE public.house_types 
ADD COLUMN IF NOT EXISTS floor_count INTEGER DEFAULT NULL;

-- 2. Add CHECK constraint to enforce only 1, 2, or NULL
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_house_types_floor_count'
  ) THEN
    ALTER TABLE public.house_types 
    ADD CONSTRAINT check_house_types_floor_count 
    CHECK (floor_count IN (1, 2) OR floor_count IS NULL);
  END IF;
END $$;

-- 3. Add column comment documenting supported values
COMMENT ON COLUMN public.house_types.floor_count IS 'Number of floors: 1 = Single storey, 2 = Two storeys, NULL = Unspecified / Infrastructure';

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
