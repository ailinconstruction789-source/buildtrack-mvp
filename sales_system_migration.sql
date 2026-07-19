-- ==============================================================================
-- 🚀 BUILDTRACK: SALES SYSTEM MIGRATION
-- ==============================================================================

-- 1. Create leads table
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    customer_name VARCHAR NOT NULL,
    phone VARCHAR,
    source VARCHAR DEFAULT 'Walk-in', -- Facebook, Referral, Walk-in, Billboard
    status VARCHAR DEFAULT 'New', -- New, Contacted, Visiting, Negotiation, Closed, Cancelled
    agent_name VARCHAR,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create sales table
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    plot_id UUID REFERENCES public.plots(id) ON DELETE SET NULL,
    sale_price NUMERIC(15, 2) DEFAULT 0,
    booking_amount NUMERIC(15, 2) DEFAULT 0,
    contract_status VARCHAR DEFAULT 'Reserved', -- Reserved, Contracted, Transferred, Cancelled
    bank_status VARCHAR DEFAULT 'Pending', -- Pending, Pre-approved, Rejected, Approved
    cancellation_reason VARCHAR,
    transferred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create status_history table for Cycle Time & Bottleneck Analysis
CREATE TABLE IF NOT EXISTS public.status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR NOT NULL, -- 'lead' or 'sale'
    entity_id UUID NOT NULL,
    old_status VARCHAR,
    new_status VARCHAR NOT NULL,
    changed_by VARCHAR,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 🛡️ Row Level Security (RLS)
-- ==========================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;

-- Owner and Sales can see all leads/sales for now (MVP level)
-- (In production, we can filter by auth.jwt() -> 'user_metadata' ->> 'role')
DROP POLICY IF EXISTS "Allow read access to leads" ON public.leads;
CREATE POLICY "Allow read access to leads" ON public.leads FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to leads" ON public.leads;
CREATE POLICY "Allow write access to leads" ON public.leads FOR ALL TO authenticated USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Sales')) WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Sales'));

DROP POLICY IF EXISTS "Allow read access to sales" ON public.sales;
CREATE POLICY "Allow read access to sales" ON public.sales FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to sales" ON public.sales;
CREATE POLICY "Allow write access to sales" ON public.sales FOR ALL TO authenticated USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Sales')) WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Sales'));

DROP POLICY IF EXISTS "Allow read access to status_history" ON public.status_history;
CREATE POLICY "Allow read access to status_history" ON public.status_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to status_history" ON public.status_history;
CREATE POLICY "Allow write access to status_history" ON public.status_history FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Sales'));

-- ==========================================
-- ⚡ Triggers for Auto-Updated At
-- ==========================================
CREATE OR REPLACE FUNCTION update_sales_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_leads_updated_at ON public.leads;
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION update_sales_updated_at_column();

DROP TRIGGER IF EXISTS update_sales_table_updated_at ON public.sales;
CREATE TRIGGER update_sales_table_updated_at
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION update_sales_updated_at_column();

-- ==========================================
-- 📊 Views for Analytics
-- ==========================================
-- Create a view to easily calculate cycle times
CREATE OR REPLACE VIEW vw_lead_cycle_times AS
SELECT 
    entity_id AS lead_id,
    MIN(CASE WHEN new_status = 'New' THEN created_at END) AS time_new,
    MIN(CASE WHEN new_status = 'Contacted' THEN created_at END) AS time_contacted,
    MIN(CASE WHEN new_status = 'Visiting' THEN created_at END) AS time_visiting,
    MIN(CASE WHEN new_status = 'Closed' THEN created_at END) AS time_closed,
    EXTRACT(EPOCH FROM (MIN(CASE WHEN new_status = 'Contacted' THEN created_at END) - MIN(CASE WHEN new_status = 'New' THEN created_at END))) / 3600 AS hours_to_contact,
    EXTRACT(EPOCH FROM (MIN(CASE WHEN new_status = 'Closed' THEN created_at END) - MIN(CASE WHEN new_status = 'Contacted' THEN created_at END))) / 86400 AS days_to_close
FROM public.status_history
WHERE entity_type = 'lead'
GROUP BY entity_id;

GRANT SELECT ON vw_lead_cycle_times TO authenticated;
