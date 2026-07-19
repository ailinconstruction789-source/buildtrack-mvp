const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkTasks() {
  const { data, error } = await supabase.from('task_templates').select('*').ilike('task_name', '%ปั้มน้ำ%');
  if (error) console.error(error);
  else {
      console.log('Tasks with ปั้มน้ำ:', data);
  }
}

checkTasks();
