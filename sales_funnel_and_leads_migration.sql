-- ==============================================================================
-- 🚀 BUILDTRACK: SALES FUNNEL, LEAD TRACKER & CUSTOMER VOICES MIGRATION
-- Based on ailin_funnel_sep2569_v3 schema
-- ==============================================================================

-- 1. Upgrade public.leads table with 22 Funnel & CRM columns
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS project_name VARCHAR,
ADD COLUMN IF NOT EXISTS channel VARCHAR DEFAULT 'Walk in',
ADD COLUMN IF NOT EXISTS lead_date TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS contacted_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS actual_visit_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS follow_up_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_follow_up_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS interested_plot_id VARCHAR,
ADD COLUMN IF NOT EXISTS interested_plot_name VARCHAR,
ADD COLUMN IF NOT EXISTS booking_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS booking_amount NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS loan_submission_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS loan_approved_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS transferred_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS lost_reason VARCHAR,
ADD COLUMN IF NOT EXISTS lost_reason_detail TEXT,
ADD COLUMN IF NOT EXISTS crm_status VARCHAR DEFAULT 'Follow-up — อยู่ระหว่างติดตาม',
ADD COLUMN IF NOT EXISTS auto_status VARCHAR DEFAULT 'Lead เข้า',
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS created_by_agent VARCHAR,
ADD COLUMN IF NOT EXISTS closing_agent VARCHAR;

-- 2. Create public.customer_voices table for 42-question deep customer surveys
CREATE TABLE IF NOT EXISTS public.customer_voices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    survey_date TIMESTAMPTZ DEFAULT NOW(),
    customer_name VARCHAR NOT NULL,
    nickname VARCHAR,
    age VARCHAR,
    gender VARCHAR,
    phone VARCHAR,
    line_id VARCHAR,
    project_name VARCHAR,
    agent_name VARCHAR,
    marital_status VARCHAR,
    education_level VARCHAR,
    occupation VARCHAR,
    monthly_income VARCHAR,
    family_members VARCHAR,
    previous_residence VARCHAR,
    monthly_rent NUMERIC(15, 2),
    
    -- Purpose of buying
    purpose_relocate BOOLEAN DEFAULT FALSE,
    purpose_family_expansion BOOLEAN DEFAULT FALSE,
    purpose_independence BOOLEAN DEFAULT FALSE,
    purpose_rent_to_own BOOLEAN DEFAULT FALSE,
    purpose_debt_consolidation BOOLEAN DEFAULT FALSE,
    
    -- Reason for visit
    reason_price BOOLEAN DEFAULT FALSE,
    reason_location BOOLEAN DEFAULT FALSE,
    reason_promotion BOOLEAN DEFAULT FALSE,
    reason_design BOOLEAN DEFAULT FALSE,
    reason_house_type BOOLEAN DEFAULT FALSE,
    reason_other TEXT,
    
    -- Information source
    source_facebook BOOLEAN DEFAULT FALSE,
    source_tiktok BOOLEAN DEFAULT FALSE,
    source_youtube BOOLEAN DEFAULT FALSE,
    source_billboard BOOLEAN DEFAULT FALSE,
    source_other TEXT,
    
    -- Satisfaction Scores (1 to 5)
    score_knowledge INT,
    score_problem_solving INT,
    score_service_mind INT,
    score_appearance INT,
    score_cleanliness INT,
    score_house_design INT,
    score_price INT,
    score_location INT,
    score_average NUMERIC(4, 2),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Row Level Security (RLS)
ALTER TABLE public.customer_voices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to customer_voices" ON public.customer_voices;
CREATE POLICY "Allow read access to customer_voices" ON public.customer_voices FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to customer_voices" ON public.customer_voices;
CREATE POLICY "Allow write access to customer_voices" ON public.customer_voices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Auto updated_at Trigger for customer_voices
DROP TRIGGER IF EXISTS update_customer_voices_updated_at ON public.customer_voices;
CREATE TRIGGER update_customer_voices_updated_at
BEFORE UPDATE ON public.customer_voices
FOR EACH ROW EXECUTE FUNCTION update_sales_updated_at_column();
