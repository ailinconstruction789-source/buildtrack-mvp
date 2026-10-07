-- ==============================================================================
-- Migration: Ailin Rental Maintenance & Tenant Support
-- Date: 2026-10-05
-- Description:
-- Creates rental_maintenance_tickets table to track house repairs, defect tickets,
-- maintenance costs, and deposit deductible flags during tenancy.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.rental_maintenance_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.rental_contracts(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    plot_id TEXT NOT NULL,
    plot_name TEXT,
    project_name TEXT NOT NULL,
    tenant_name TEXT NOT NULL,
    tenant_phone TEXT,
    category TEXT NOT NULL DEFAULT 'other', -- 'plumbing', 'air_conditioner', 'electrical', 'structure', 'appliance', 'other'
    title TEXT NOT NULL,
    description TEXT,
    reported_date DATE NOT NULL DEFAULT CURRENT_DATE,
    priority TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
    status TEXT NOT NULL DEFAULT 'Reported', -- 'Reported', 'Assigned', 'InProgress', 'Completed', 'Cancelled'
    assigned_to TEXT,
    estimated_cost NUMERIC(12, 2) DEFAULT 0.00,
    actual_cost NUMERIC(12, 2) DEFAULT 0.00,
    is_tenant_responsible BOOLEAN DEFAULT FALSE,
    resolved_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_rental_maintenance_plot ON public.rental_maintenance_tickets(plot_id);
CREATE INDEX IF NOT EXISTS idx_rental_maintenance_status ON public.rental_maintenance_tickets(status);
CREATE INDEX IF NOT EXISTS idx_rental_maintenance_contract ON public.rental_maintenance_tickets(contract_id);

-- RLS
ALTER TABLE public.rental_maintenance_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read rental_maintenance_tickets" ON public.rental_maintenance_tickets;
CREATE POLICY "Allow read rental_maintenance_tickets" ON public.rental_maintenance_tickets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert rental_maintenance_tickets" ON public.rental_maintenance_tickets;
CREATE POLICY "Allow insert rental_maintenance_tickets" ON public.rental_maintenance_tickets FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update rental_maintenance_tickets" ON public.rental_maintenance_tickets;
CREATE POLICY "Allow update rental_maintenance_tickets" ON public.rental_maintenance_tickets FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete rental_maintenance_tickets" ON public.rental_maintenance_tickets;
CREATE POLICY "Allow delete rental_maintenance_tickets" ON public.rental_maintenance_tickets FOR DELETE USING (true);
