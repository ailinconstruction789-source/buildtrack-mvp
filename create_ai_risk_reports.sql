-- Table: ai_risk_reports
-- Description: Stores hourly AI generated risk analysis reports to serve as a cache.

CREATE TABLE IF NOT EXISTS ai_risk_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    report_data JSONB NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE ai_risk_reports ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all authenticated users to read
CREATE POLICY "Allow auth read" ON ai_risk_reports
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Create policy to allow all authenticated users to insert
CREATE POLICY "Allow auth insert" ON ai_risk_reports
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
