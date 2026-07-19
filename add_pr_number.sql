-- Migration: Add PR Number to Task Material Requests
ALTER TABLE task_material_requests ADD COLUMN IF NOT EXISTS pr_number TEXT;
