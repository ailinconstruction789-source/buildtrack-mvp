const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function run() {
  const { data: plots } = await supabase.from('plots').select('*').eq('id', '27').eq('project_name', 'ไอลิน6');
  const plot = plots[0];
  
  const { data: tasks } = await supabase.from('task_templates')
    .select('*')
    .eq('house_type_id', plot.house_type_id)
    .or('task_name.ilike.%ทาสีรองพื้น%,task_name.ilike.%ทาสีฝ้า%');
  
  console.log('Tasks found:', tasks.map(t => ({ id: t.id, name: t.task_name })));
  const taskIds = tasks.map(t => t.id);

  const { data: assignments } = await supabase.from('plot_task_assignments')
    .select('*')
    .eq('plot_id', '27')
    .in('task_template_id', taskIds);
  console.log('\n--- Assignments ---');
  console.log(JSON.stringify(assignments, null, 2));

  const { data: updates } = await supabase.from('task_updates')
    .select('*')
    .eq('plot_id', '27')
    .in('task_template_id', taskIds)
    .order('created_at', { ascending: true });
  console.log('\n--- Task Updates ---');
  console.log(JSON.stringify(updates, null, 2));
}

run().catch(console.error);
