-- Create plot_promotions table for tracking plot-specific freebies and promotions
CREATE TABLE IF NOT EXISTS public.plot_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id TEXT NOT NULL REFERENCES public.plots(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'ทั่วไป',
    item_name TEXT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' (ยังไม่มา/รอส่ง), 'delivered' (ของมาส่งแล้ว), 'installed' (ติดตั้งเรียบร้อย)
    delivery_date TIMESTAMP WITH TIME ZONE,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by plot_id
CREATE INDEX IF NOT EXISTS idx_plot_promotions_plot_id ON public.plot_promotions(plot_id);

-- Enable RLS
ALTER TABLE public.plot_promotions ENABLE ROW LEVEL SECURITY;

-- Allow public / authenticated access
DROP POLICY IF EXISTS "Allow all for plot_promotions" ON public.plot_promotions;
CREATE POLICY "Allow all for plot_promotions" ON public.plot_promotions FOR ALL USING (true);
