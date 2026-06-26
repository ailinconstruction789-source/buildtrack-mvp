-- ==============================================================================
-- Add Handover Inspection and QC Analytics Schema
-- ==============================================================================

DO $$
BEGIN
    -- 1. Add columns to plots table
    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' and column_name='handover_cycle') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "handover_cycle" INTEGER DEFAULT 1;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' and column_name='inspection_round') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "inspection_round" INTEGER DEFAULT 0;
    END IF;

    -- 2. Modify defects table
    -- Drop NOT NULL constraint on task_id if it exists, so we can log defects at plot level
    ALTER TABLE "public"."defects" ALTER COLUMN "task_id" DROP NOT NULL;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='defects' and column_name='defect_stage') THEN
        ALTER TABLE "public"."defects" ADD COLUMN "defect_stage" TEXT DEFAULT 'construction';
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='defects' and column_name='handover_cycle') THEN
        ALTER TABLE "public"."defects" ADD COLUMN "handover_cycle" INTEGER;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='defects' and column_name='inspection_round') THEN
        ALTER TABLE "public"."defects" ADD COLUMN "inspection_round" INTEGER;
    END IF;

END $$;
