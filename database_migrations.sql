-- ==============================================================================
-- PHASE 1: DATABASE MIGRATIONS FOR PERFORMANCE OPTIMIZATION
-- ==============================================================================

-- 1. Add tracking columns to plot_task_assignments
ALTER TABLE plot_task_assignments 
ADD COLUMN IF NOT EXISTS current_progress INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_start_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS actual_end_date TIMESTAMPTZ;

-- Ensure uniqueness so we can perform UPSERT operations reliably.
-- First, clean up any exact duplicates if they exist
DELETE FROM plot_task_assignments a USING (
    SELECT MIN(ctid) as ctid, plot_id, task_template_id
    FROM plot_task_assignments 
    GROUP BY plot_id, task_template_id HAVING COUNT(*) > 1
) b
WHERE a.plot_id = b.plot_id 
  AND a.task_template_id = b.task_template_id 
  AND a.ctid <> b.ctid;

-- Add Unique Constraint
ALTER TABLE plot_task_assignments DROP CONSTRAINT IF EXISTS uq_plot_task_assignment;
ALTER TABLE plot_task_assignments ADD CONSTRAINT uq_plot_task_assignment UNIQUE (plot_id, task_template_id);


-- 2. Create the Database Trigger to automatically update progress and dates
CREATE OR REPLACE FUNCTION update_task_progress_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_plot_id UUID; -- Use TEXT if your IDs are string/varchar
    v_task_template_id UUID; -- Use TEXT if your IDs are string/varchar
    min_start TIMESTAMPTZ;
    max_end TIMESTAMPTZ;
    latest_progress INTEGER;
BEGIN
    -- Determine IDs based on operation
    IF TG_OP = 'DELETE' THEN
        v_plot_id := OLD.plot_id;
        v_task_template_id := OLD.task_template_id;
    ELSE
        v_plot_id := NEW.plot_id;
        v_task_template_id := NEW.task_template_id;
    END IF;

    -- Calculate Min Start Date
    SELECT MIN(created_at) INTO min_start
    FROM task_updates
    WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id;

    -- Calculate Max End Date (Only when progress reaches 100)
    SELECT MAX(created_at) INTO max_end
    FROM task_updates
    WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
      AND progress = 100;

    -- Calculate Latest Progress
    SELECT progress INTO latest_progress
    FROM task_updates
    WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- UPSERT into plot_task_assignments
    INSERT INTO plot_task_assignments (plot_id, task_template_id, current_progress, actual_start_date, actual_end_date)
    VALUES (v_plot_id, v_task_template_id, COALESCE(latest_progress, 0), min_start, max_end)
    ON CONFLICT (plot_id, task_template_id)
    DO UPDATE SET 
        current_progress = EXCLUDED.current_progress,
        actual_start_date = EXCLUDED.actual_start_date,
        actual_end_date = EXCLUDED.actual_end_date;

    RETURN NULL; -- AFTER trigger returns NULL
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_task_progress ON task_updates;
CREATE TRIGGER trigger_update_task_progress
AFTER INSERT OR UPDATE OR DELETE ON task_updates
FOR EACH ROW
EXECUTE FUNCTION update_task_progress_trigger();

-- To initialize existing data, we can manually trigger the update for all existing records
-- (Uncomment to run a one-time sync of historical data)
/*
DO $$
DECLARE
    row RECORD;
BEGIN
    FOR row IN SELECT DISTINCT plot_id, task_template_id FROM task_updates LOOP
        -- Will trigger the same logic implicitly or we can just copy the logic here
    END LOOP;
END;
$$;
*/


-- 3. Create Database Views for Aggregated Progress
-- View: Plot Progress
CREATE OR REPLACE VIEW vw_plot_progress AS
SELECT 
    p.id AS plot_id,
    p.project_name,
    p.house_type_id,
    p.foreman_name,
    COUNT(t.id) AS total_tasks,
    COALESCE(SUM(pta.current_progress), 0) AS sum_progress,
    COALESCE(SUM(t.cost), 0) AS total_cost,
    CASE 
        WHEN COALESCE(SUM(t.cost), 0) > 0 THEN 
            ROUND((SUM(pta.current_progress * t.cost) / SUM(t.cost))::NUMERIC)
        WHEN COUNT(t.id) > 0 THEN 
            ROUND(COALESCE(SUM(pta.current_progress), 0)::NUMERIC / COUNT(t.id)) 
        ELSE 0 
    END AS overall_progress
FROM plots p
LEFT JOIN task_templates t ON p.house_type_id = t.house_type_id
LEFT JOIN plot_task_assignments pta ON p.id = pta.plot_id AND t.id = pta.task_template_id
GROUP BY p.id, p.project_name, p.house_type_id, p.foreman_name;

-- View: Project Progress
CREATE OR REPLACE VIEW vw_project_progress AS
SELECT 
    vpp.project_name,
    COUNT(vpp.plot_id) AS plot_count,
    CASE 
        WHEN SUM(vpp.total_cost) > 0 THEN 
            ROUND((SUM(vpp.overall_progress * vpp.total_cost) / SUM(vpp.total_cost))::NUMERIC)
        WHEN COUNT(vpp.plot_id) > 0 THEN 
            ROUND(SUM(vpp.overall_progress)::NUMERIC / COUNT(vpp.plot_id)) 
        ELSE 0 
    END AS project_progress
FROM vw_plot_progress vpp
GROUP BY vpp.project_name;


-- 4. Apply RLS Policies
-- NOTE: The BuildTrack application currently uses client-side authentication (storing user and role in local state)
-- rather than Supabase Auth (auth.uid()). Native RLS requires Supabase Auth to securely identify users.
-- Enabling RLS without Supabase Auth means we must use 'anon' access or basic public policies for now,
-- otherwise the app will break. The optimal fix is to refactor the frontend to query selectively, e.g., 
-- supabase.from('notifications').select('*').or(`target_user.eq.${user},target_role.eq.${role}`)

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE plot_task_assignments ENABLE ROW LEVEL SECURITY;

-- Fallback permissive policies so the app continues to function with client-side auth.
-- (To be replaced with strict `auth.uid()` checks once Supabase Auth is integrated)
DROP POLICY IF EXISTS "Allow public select on notifications" ON notifications;
CREATE POLICY "Allow public select on notifications" ON notifications FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on notifications" ON notifications;
CREATE POLICY "Allow public insert on notifications" ON notifications FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on notifications" ON notifications;
CREATE POLICY "Allow public update on notifications" ON notifications FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Allow public delete on notifications" ON notifications;
CREATE POLICY "Allow public delete on notifications" ON notifications FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow public select on task_updates" ON task_updates;
CREATE POLICY "Allow public select on task_updates" ON task_updates FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on task_updates" ON task_updates;
CREATE POLICY "Allow public insert on task_updates" ON task_updates FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on task_updates" ON task_updates;
CREATE POLICY "Allow public update on task_updates" ON task_updates FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Allow public delete on task_updates" ON task_updates;
CREATE POLICY "Allow public delete on task_updates" ON task_updates FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow public select on plot_task_assignments" ON plot_task_assignments;
CREATE POLICY "Allow public select on plot_task_assignments" ON plot_task_assignments FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on plot_task_assignments" ON plot_task_assignments;
CREATE POLICY "Allow public insert on plot_task_assignments" ON plot_task_assignments FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public update on plot_task_assignments" ON plot_task_assignments;
CREATE POLICY "Allow public update on plot_task_assignments" ON plot_task_assignments FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Allow public delete on plot_task_assignments" ON plot_task_assignments;
CREATE POLICY "Allow public delete on plot_task_assignments" ON plot_task_assignments FOR DELETE USING (true);

-- ==============================================================================
-- END OF MIGRATION
-- ==============================================================================

-- ==========================================
-- Views for Optimized Data Fetching
-- ==========================================

-- View to get plot_task_assignments with project_name
CREATE OR REPLACE VIEW vw_plot_task_assignments_with_project AS
SELECT pta.*, p.project_name
FROM plot_task_assignments pta
JOIN plots p ON pta.plot_id = p.id;

-- View to get plot_task_schedules with project_name
CREATE OR REPLACE VIEW vw_plot_task_schedules_with_project AS
SELECT pts.*, p.project_name
FROM plot_task_schedules pts
JOIN plots p ON pts.plot_id = p.id;

-- Ensure public access to these views
GRANT SELECT ON vw_plot_task_assignments_with_project TO public;
GRANT SELECT ON vw_plot_task_schedules_with_project TO public;
GRANT SELECT ON vw_plot_task_assignments_with_project TO anon;
GRANT SELECT ON vw_plot_task_schedules_with_project TO anon;
GRANT SELECT ON vw_plot_task_assignments_with_project TO authenticated;
GRANT SELECT ON vw_plot_task_schedules_with_project TO authenticated;
