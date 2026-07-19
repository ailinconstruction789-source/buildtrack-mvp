const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function fixResetDates() {
  const { data: assignments, error } = await supabase.from('plot_task_assignments')
    .select('plot_id, task_template_id')
    .eq('latest_action', 'แอดมินย้อนสถานะงาน (Reset)')
    .not('actual_end_date', 'is', null);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${assignments.length} tasks to fix...`);
  for (const a of assignments) {
    const { error: updErr } = await supabase.from('plot_task_assignments')
      .update({ actual_end_date: null, actual_start_date: null })
      .eq('plot_id', a.plot_id).eq('task_template_id', a.task_template_id);
    if (updErr) console.error('Error updating', a, updErr);
  }
  console.log('Fixed all reset tasks.');
}
fixResetDates();
