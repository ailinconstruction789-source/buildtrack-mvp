const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function fixSafely() {
  const { data: assignments } = await supabase.from('plot_task_assignments').select('*');
  let fixCount = 0;
  
  for (const a of assignments) {
    const { data: updates } = await supabase.from('task_updates')
      .select('*')
      .eq('plot_id', a.plot_id)
      .eq('task_template_id', a.task_template_id)
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (updates && updates.length > 0) {
      const latest = updates[0];
      if (latest.action !== a.latest_action || latest.progress !== a.current_progress) {
        console.log(`Fixing ${a.plot_id} - ${a.task_template_id}: ${a.latest_action} -> ${latest.action}`);
        await supabase.from('plot_task_assignments').update({
          latest_action: latest.action,
          latest_role: latest.role,
          latest_update_created_at: latest.created_at,
          current_progress: latest.progress
        }).eq('plot_id', a.plot_id).eq('task_template_id', a.task_template_id);
        fixCount++;
      }
    }
  }
  console.log('Fixed:', fixCount);
}
fixSafely();
