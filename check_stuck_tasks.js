const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kbthmdedilswdmmczfay.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGhtZGVkaWxzd2RtbWN6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5ODgsImV4cCI6MjA5MjgzNjk4OH0.IbzPM8uJwnGi0J6IsnAsDeH3K0y6rbAK0T8WSwm7zEQ');

async function run() {
  const { data: assignments, error: err1 } = await supabase.from('plot_task_assignments').select('plot_id, task_template_id, latest_action');
  
  const { data: updates, error: err2 } = await supabase.from('task_updates').select('plot_id, task_template_id, action, role, created_at').order('created_at', { ascending: false });

  if (err1 || err2) {
    console.error('Error fetching:', err1 || err2);
    return;
  }

  const latestUpdates = {};
  for (const u of updates) {
    const key = u.plot_id + '_' + u.task_template_id;
    if (!latestUpdates[key]) {
      latestUpdates[key] = u;
    }
  }

  const stuckTasks = [];
  for (const a of assignments) {
    const key = a.plot_id + '_' + a.task_template_id;
    const latest = latestUpdates[key];
    if (latest && latest.action !== a.latest_action) {
      stuckTasks.push({
        plot_id: a.plot_id,
        task_template_id: a.task_template_id,
        assignment_action: a.latest_action,
        actual_latest_action: latest.action,
        actual_latest_role: latest.role,
        actual_latest_time: latest.created_at
      });
    }
  }

  console.log(`Found ${stuckTasks.length} tasks with mismatched latest_action.`);
  if (stuckTasks.length > 0) {
    console.log(stuckTasks.slice(0, 5));
  }
}

run().catch(console.error);
