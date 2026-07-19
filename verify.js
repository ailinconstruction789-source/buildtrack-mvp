const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function verify() {
  const { data: assignments } = await supabase.from('plot_task_assignments')
    .select('latest_action')
    .eq('plot_id', '21')
    .eq('task_template_id', '8203498e-67c8-484c-ab87-5af7990f6343');
    
  console.log('Plot 21 Action:', assignments[0]?.latest_action);
}
verify();
