-- เพิ่ม Unique Constraint ให้ตาราง plot_task_schedules
-- เพื่อให้คำสั่ง upsert({ onConflict: 'plot_id,task_template_id' }) ทำงานได้โดยไม่เกิด Error: there is no unique or exclusion constraint matching the ON CONFLICT specification

ALTER TABLE public.plot_task_schedules 
ADD CONSTRAINT plot_task_schedules_plot_id_task_template_id_key 
UNIQUE (plot_id, task_template_id);
