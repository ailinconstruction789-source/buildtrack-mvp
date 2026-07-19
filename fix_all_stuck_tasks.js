const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function fixAllTasks() {
  const { data: assignments, error: err1 } = await supabase.from('plot_task_assignments').select('*');
  if (err1) { console.error(err1); return; }

  let allUpdates = [];
  let page = 0;
  let pageSize = 1000;
  
  while (true) {
    const { data: updates, error: err2 } = await supabase.from('task_updates')
      .select('plot_id, task_template_id, action, role, created_at, progress')
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);
      
    if (err2) { console.error(err2); return; }
    if (updates.length === 0) break;
    
    allUpdates = allUpdates.concat(updates);
    page++;
  }

  const latestUpdates = {};
  for (const u of allUpdates) {
    const key = u.plot_id + '_' + u.task_template_id;
    if (!latestUpdates[key]) {
      latestUpdates[key] = u;
    }
  }

  let fixCount = 0;
  for (const a of assignments) {
    const key = a.plot_id + '_' + a.task_template_id;
    const latest = latestUpdates[key];
    
    if (latest && (latest.action !== a.latest_action || latest.progress !== a.current_progress)) {
      console.log(`Fixing ${a.plot_id} - ${a.task_template_id} to action=${latest.action}, progress=${latest.progress}`);
      const { error } = await supabase.from('plot_task_assignments').update({
        latest_action: latest.action,
        latest_role: latest.role,
        latest_update_created_at: latest.created_at,
        current_progress: latest.progress
      }).eq('plot_id', a.plot_id).eq('task_template_id', a.task_template_id);
      
      if (error) console.error('Error updating:', error);
      else fixCount++;
    }
  }
  console.log(`Finished fixing ${fixCount} tasks.`);
}

fixAllTasks().catch(console.error);
