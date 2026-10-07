-- ==============================================================================
-- Migration: Ailin Rental Programs - Monthly Payment Ledger & Tracking
-- Date: 2026-10-05
-- Description:
-- Creates table rental_payments to track monthly rent installments,
-- due dates, payment status (Paid, Pending, Overdue), and accumulated savings (Program B).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.rental_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    plot_id TEXT NOT NULL,
    plot_name TEXT,
    project_name TEXT NOT NULL,
    tenant_name TEXT NOT NULL,
    period_month INTEGER NOT NULL,
    period_label TEXT NOT NULL,
    due_date DATE NOT NULL,
    amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    savings_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    paid_date TIMESTAMPTZ,
    payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Pending', 'Paid', 'Overdue', 'Waived')),
    payment_method TEXT CHECK (payment_method IN ('transfer', 'cash', 'credit_card', 'other')),
    slip_url TEXT,
    notes TEXT,
    recorded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_rental_payments_contract_id ON public.rental_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_plot_id ON public.rental_payments(plot_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_lead_id ON public.rental_payments(lead_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_due_date ON public.rental_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_rental_payments_status ON public.rental_payments(payment_status);

-- Enable RLS
ALTER TABLE public.rental_payments ENABLE ROW LEVEL SECURITY;

-- Permissive RLS Policies for MVP
DROP POLICY IF EXISTS "Allow read rental_payments" ON public.rental_payments;
CREATE POLICY "Allow read rental_payments" ON public.rental_payments
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert rental_payments" ON public.rental_payments;
CREATE POLICY "Allow insert rental_payments" ON public.rental_payments
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update rental_payments" ON public.rental_payments;
CREATE POLICY "Allow update rental_payments" ON public.rental_payments
    FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete rental_payments" ON public.rental_payments;
CREATE POLICY "Allow delete rental_payments" ON public.rental_payments
    FOR DELETE USING (true);
