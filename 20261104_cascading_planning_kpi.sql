-- ==============================================================================
-- Migration: Cascading Planning KPI (Foreman -> Site Engineer -> Project Planner)
-- Date: 2026-11-04
-- ==============================================================================

DO $$
BEGIN
    -- 1. Add site_engineer and foreman assignment timestamp to plots table
    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='site_engineer') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "site_engineer" TEXT;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' AND column_name='foreman_assigned_at') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "foreman_assigned_at" TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- 2. Add revision categorization & exemption fields to plot_schedule_revisions
    IF EXISTS(SELECT * FROM information_schema.tables WHERE table_name='plot_schedule_revisions') THEN
        IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plot_schedule_revisions' AND column_name='foreman_name') THEN
            ALTER TABLE "public"."plot_schedule_revisions" ADD COLUMN "foreman_name" TEXT;
        END IF;

        IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plot_schedule_revisions' AND column_name='site_engineer_name') THEN
            ALTER TABLE "public"."plot_schedule_revisions" ADD COLUMN "site_engineer_name" TEXT;
        END IF;

        IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plot_schedule_revisions' AND column_name='revision_type') THEN
            ALTER TABLE "public"."plot_schedule_revisions" ADD COLUMN "revision_type" TEXT DEFAULT 'normal_delay';
        END IF;

        IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plot_schedule_revisions' AND column_name='exemption_reason') THEN
            ALTER TABLE "public"."plot_schedule_revisions" ADD COLUMN "exemption_reason" TEXT;
        END IF;
    END IF;
END $$;
