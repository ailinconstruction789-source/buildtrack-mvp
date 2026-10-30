-- ==============================================================================
-- Migration: Centralized Photo Watermark Audits Table
-- Stores AI-extracted watermark metadata, timestamps, and audit verification.
-- Keyed by image_url so any image is scanned at most once across the entire organization.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS photo_watermark_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT UNIQUE NOT NULL,
  plot_id TEXT,
  has_watermark BOOLEAN DEFAULT FALSE,
  raw_watermark_text TEXT,
  taken_at TIMESTAMPTZ,
  taken_date_str TEXT,
  taken_time_str TEXT,
  location TEXT,
  plot_tag TEXT,
  audit_status TEXT, -- 'on_time', 'delayed_same_day', 'delayed_late', 'cross_day', 'ahead_of_time', 'unknown'
  audit_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_audits_image_url ON photo_watermark_audits(image_url);
CREATE INDEX IF NOT EXISTS idx_photo_audits_plot_id ON photo_watermark_audits(plot_id);

ALTER TABLE photo_watermark_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select on photo_watermark_audits" ON photo_watermark_audits;
CREATE POLICY "Allow public select on photo_watermark_audits" ON photo_watermark_audits FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert on photo_watermark_audits" ON photo_watermark_audits;
CREATE POLICY "Allow public insert on photo_watermark_audits" ON photo_watermark_audits FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update on photo_watermark_audits" ON photo_watermark_audits;
CREATE POLICY "Allow public update on photo_watermark_audits" ON photo_watermark_audits FOR UPDATE USING (true);
