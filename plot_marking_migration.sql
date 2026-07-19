-- Add highlight_color and highlight_note columns to plots table
ALTER TABLE public.plots 
ADD COLUMN highlight_color TEXT,
ADD COLUMN highlight_note TEXT;
