-- ==============================================================================
-- Migration: Transfer Matrix Checklist Tracking Support
-- Documents tag convention in plots.handover_notes for manual matrix toggles:
--   [sandwash_coating:done] / [sandwash_coating:pending]
--   [close_construction:done] / [close_construction:pending]
--   [close_sales:done] / [close_sales:pending]
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' and column_name='handover_notes') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "handover_notes" TEXT;
    END IF;
END $$;
