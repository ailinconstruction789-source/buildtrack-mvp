-- ==============================================================================
-- Migration: LINE Daily Summary Bot Dispatch Logs
-- Date: 2026-11-28
-- Description:
-- Stores audit logs and idempotency records for the 19:00 Asia/Bangkok
-- LINE daily executive summary pushed to the central LINE group.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.line_daily_summary_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date DATE NOT NULL,
    target_id TEXT NOT NULL,
    trigger_source TEXT NOT NULL DEFAULT 'cron' CHECK (trigger_source IN ('cron', 'manual', 'webhook')),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'dry_run')),
    message_text TEXT NOT NULL,
    metrics_snapshot JSONB,
    error_message TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup to prevent duplicate cron sends on the same Bangkok report_date
CREATE INDEX IF NOT EXISTS idx_line_daily_summary_logs_date_target
    ON public.line_daily_summary_logs (report_date, target_id, status);

CREATE INDEX IF NOT EXISTS idx_line_daily_summary_logs_sent_at
    ON public.line_daily_summary_logs (sent_at DESC);

ALTER TABLE public.line_daily_summary_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow Admin/Owner read line_daily_summary_logs" ON public.line_daily_summary_logs;
CREATE POLICY "Allow Admin/Owner read line_daily_summary_logs"
    ON public.line_daily_summary_logs
    FOR SELECT
    TO authenticated
    USING (
        COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') IN ('Admin', 'Owner')
    );

NOTIFY pgrst, 'reload schema';
