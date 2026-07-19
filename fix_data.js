const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function run() {
  const { error } = await supabase.from('plot_task_assignments').update({
    latest_action: 'ส่งงาน 100%',
    latest_role: 'Foreman',
    latest_update_created_at: '2026-07-18T09:16:54.998199+00:00'
  }).eq('plot_id', '27').eq('task_template_id', '2784b218-a4dd-4cdf-aacc-71b3a2fe31a2');
  
  console.log('Update Error:', error);
}

run().catch(console.error);
