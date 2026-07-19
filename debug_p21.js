const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function debugPlot21() {
  const { data: assignments } = await supabase.from('plot_task_assignments').select('*').eq('plot_id', '21').eq('task_template_id', '8203498e-67c8-484c-ab87-5af7990f6343');
  
  for (const a of assignments) {
    const { data: updates } = await supabase.from('task_updates')
      .select('*')
      .eq('plot_id', a.plot_id)
      .eq('task_template_id', a.task_template_id)
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (updates && updates.length > 0) {
      const latest = updates[0];
      console.log('Assignment latest_action:', a.latest_action);
      console.log('Updates latest_action:', latest.action);
      console.log('Progress check:', latest.progress, a.current_progress);
      
      if (latest.action !== a.latest_action || latest.progress !== a.current_progress) {
        console.log('Should fix this!');
      } else {
        console.log('No mismatch detected?!');
      }
    }
  }
}
debugPlot21();
