-- ==============================================================================
-- Migration: Project Planner Schedule Scoring System (Option 2 - Ladder Step)
-- Initial lock: 100 points
-- Internal edits / Earlier completion: No penalty (remains 100)
-- 1st delay extension: 75 points (-25)
-- 2nd delay extension: 50 points (-25)
-- 3rd delay extension: 25 points (-25)
-- 4th+ delay extension: 0 points (min 0)
-- Force Majeure Exemption: Owner/Admin can exempt penalty (is_exempted = true)
-- ==============================================================================

DO $$
BEGIN
    -- 1. Add baseline and scoring columns to plots table
    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='baseline_planned_start') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "baseline_planned_start" DATE;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='baseline_planned_end') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "baseline_planned_end" DATE;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='baseline_locked_at') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "baseline_locked_at" TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='baseline_locked_by') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "baseline_locked_by" TEXT;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='schedule_delay_revisions') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "schedule_delay_revisions" INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='schedule_planning_score') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "schedule_planning_score" INTEGER DEFAULT 100;
    END IF;
END $$;

-- 2. Create plot_schedule_revisions table for detailed audit trail
CREATE TABLE IF NOT EXISTS "public"."plot_schedule_revisions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "plot_id" TEXT NOT NULL REFERENCES "public"."plots"("id") ON DELETE CASCADE,
    "revised_by" TEXT NOT NULL,
    "previous_planned_end" DATE NOT NULL,
    "new_planned_end" DATE NOT NULL,
    "diff_days" INTEGER NOT NULL,
    "previous_score" INTEGER NOT NULL,
    "new_score" INTEGER NOT NULL,
    "reason" TEXT,
    "is_exempted" BOOLEAN DEFAULT false,
    "exempted_by" TEXT,
    "exempted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by plot
CREATE INDEX IF NOT EXISTS "idx_plot_schedule_revisions_plot_id" 
ON "public"."plot_schedule_revisions" ("plot_id", "created_at" DESC);

-- Enable RLS
ALTER TABLE "public"."plot_schedule_revisions" ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view schedule revisions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'plot_schedule_revisions' AND policyname = 'Allow read plot_schedule_revisions'
    ) THEN
        CREATE POLICY "Allow read plot_schedule_revisions" 
        ON "public"."plot_schedule_revisions" 
        FOR SELECT 
        TO authenticated 
        USING (true);
    END IF;
END $$;

-- Allow authenticated users to insert revisions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'plot_schedule_revisions' AND policyname = 'Allow insert plot_schedule_revisions'
    ) THEN
        CREATE POLICY "Allow insert plot_schedule_revisions" 
        ON "public"."plot_schedule_revisions" 
        FOR INSERT 
        TO authenticated 
        WITH CHECK (true);
    END IF;
END $$;

-- Allow authenticated users to update revisions (for exemption updates by Owner/Admin)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'plot_schedule_revisions' AND policyname = 'Allow update plot_schedule_revisions'
    ) THEN
        CREATE POLICY "Allow update plot_schedule_revisions" 
        ON "public"."plot_schedule_revisions" 
        FOR UPDATE 
        TO authenticated 
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;
