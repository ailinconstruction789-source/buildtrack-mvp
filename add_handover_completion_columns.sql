-- Add handover completion columns to plots table
DO $$
BEGIN
    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' and column_name='handover_status') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "handover_status" TEXT DEFAULT 'pending';
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' and column_name='handover_completed_at') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "handover_completed_at" TIMESTAMP WITH TIME ZONE;
    END IF;

    IF NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_name='plots' and column_name='handover_completed_by') THEN
        ALTER TABLE "public"."plots" ADD COLUMN "handover_completed_by" TEXT;
    END IF;
END $$;
