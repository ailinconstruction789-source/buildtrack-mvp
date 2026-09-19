-- ==============================================================================
-- 🏡 BUILDTRACK: SALES & HOUSE VISIT CHECKLIST MIGRATION
-- SOP: Stage A (Pre-Visit) ➡️ Stage B (In-Visit) ➡️ Stage C (Post-Visit)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.house_visit_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    customer_name VARCHAR,
    project_name VARCHAR NOT NULL,
    house_or_plot_name VARCHAR,
    agent_name VARCHAR NOT NULL,
    stage VARCHAR DEFAULT 'stage_a', -- 'stage_a', 'stage_b', 'stage_c', 'completed'
    
    -- Stage A: Checklist ก่อนลูกค้าเข้าชม (16 items)
    stage_a_checklist JSONB DEFAULT '{}'::jsonb,
    stage_a_completed_at TIMESTAMPTZ,
    
    -- Stage B: ระหว่างรับลูกค้า
    stage_b_started_at TIMESTAMPTZ,
    stage_b_visit_notes TEXT,
    
    -- Stage C: หลังลูกค้ากลับ (7 shutdown items + Sales Recap)
    stage_c_checklist JSONB DEFAULT '{}'::jsonb,
    customer_feedback TEXT,
    interested_plot_name VARCHAR,
    objections TEXT,
    lead_crm_status VARCHAR,
    next_action TEXT,
    next_follow_up_date TIMESTAMPTZ,
    stage_c_completed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.house_visit_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to house_visit_checklists" ON public.house_visit_checklists;
CREATE POLICY "Allow read access to house_visit_checklists" ON public.house_visit_checklists FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to house_visit_checklists" ON public.house_visit_checklists;
CREATE POLICY "Allow write access to house_visit_checklists" ON public.house_visit_checklists FOR ALL TO authenticated USING (true) WITH CHECK (true);
