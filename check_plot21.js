const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function run() {
  const { data: plot } = await supabase.from('plots').select('id, project_name').eq('id', '21');
  
  const { data: taskTemplates } = await supabase.from('task_templates').select('id, task_name').like('task_name', '%งานติดตั้งไม้ซีแชแนล%');
  const taskId = taskTemplates[0].id;
  
  const { data: assignments } = await supabase.from('plot_task_assignments').select('*').eq('plot_id', '21').eq('task_template_id', taskId);
  
  const { data: updates } = await supabase.from('task_updates').select('*').eq('plot_id', '21').eq('task_template_id', taskId).order('created_at', { ascending: true });
  
  console.log('Assignments:', assignments);
  console.log('Updates:', updates.map(u => ({ action: u.action, role: u.role, progress: u.progress, time: u.created_at })));
}
run();
