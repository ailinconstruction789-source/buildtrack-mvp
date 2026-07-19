const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function checkResetDates() {
  const { data, error } = await supabase.from('plot_task_assignments')
    .select('plot_id, task_template_id, latest_action, current_progress, actual_end_date')
    .eq('latest_action', 'แอดมินย้อนสถานะงาน (Reset)');
    
  if (data && data.length > 0) {
    console.log(data);
  } else {
    console.log('No Reset tasks found.');
  }
}
checkResetDates();
