-- ==============================================================================
-- Migration: Add 'งานเฟอร์นิเจอร์' task template & support custom handover tasks
-- ==============================================================================

DO $$
DECLARE
    ht RECORD;
    max_ord INTEGER;
BEGIN
    FOR ht IN SELECT id, type_name FROM public.house_types WHERE is_infrastructure = false OR is_infrastructure IS NULL LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.task_templates 
            WHERE house_type_id = ht.id AND task_name = 'งานเฟอร์นิเจอร์'
        ) THEN
            SELECT COALESCE(MAX(task_order), 0) INTO max_ord 
            FROM public.task_templates 
            WHERE house_type_id = ht.id;

            INSERT INTO public.task_templates (
                id, 
                house_type_id, 
                task_name, 
                task_order, 
                weight, 
                cost, 
                is_progress_counted, 
                created_at
            ) VALUES (
                gen_random_uuid(),
                ht.id,
                'งานเฟอร์นิเจอร์',
                max_ord + 1,
                1,
                0,
                false,
                NOW()
            );
        END IF;
    END LOOP;
END $$;
