-- 1. Modify `defects` table
ALTER TABLE public.defects
ADD COLUMN IF NOT EXISTS task_template_id UUID REFERENCES public.task_templates(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS planned_start DATE,
ADD COLUMN IF NOT EXISTS planned_end DATE,
ADD COLUMN IF NOT EXISTS contractor_id BIGINT REFERENCES public.contractors(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;

-- 2. Create `defect_updates` table
CREATE TABLE IF NOT EXISTS public.defect_updates (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    defect_id UUID REFERENCES public.defects(id) ON DELETE CASCADE,
    progress INTEGER NOT NULL,
    note TEXT,
    image_urls TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT -- Role or user ID of the foreman/user who updated
);

-- Enable RLS for defect_updates
ALTER TABLE public.defect_updates ENABLE ROW LEVEL SECURITY;

-- Policies for defect_updates
CREATE POLICY "Allow read access to all users for defect_updates"
ON public.defect_updates FOR SELECT
USING (true);

CREATE POLICY "Allow insert access to authenticated users for defect_updates"
ON public.defect_updates FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow update access to authenticated users for defect_updates"
ON public.defect_updates FOR UPDATE
USING (true);

CREATE POLICY "Allow delete access to authenticated users for defect_updates"
ON public.defect_updates FOR DELETE
USING (true);
