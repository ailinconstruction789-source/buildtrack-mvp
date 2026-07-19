const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function run() {
  const { data, error } = await supabase.from('plot_task_assignments').upsert({
    plot_id: '27',
    task_template_id: '2784b218-a4dd-4cdf-aacc-71b3a2fe31a2',
    latest_action: 'Test Action',
    latest_role: 'Foreman',
    latest_update_created_at: new Date().toISOString(),
    current_progress: 100
  }, { onConflict: 'plot_id,task_template_id' });
  
  console.log('Error:', error);
}

run().catch(console.error);
