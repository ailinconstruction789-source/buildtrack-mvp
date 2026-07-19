import { createClient } from '@supabase/supabase-js';


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Fetching all task updates...');
  const { data: updates, error: fetchError } = await supabase
    .from('task_updates')
    .select('plot_id, task_template_id, progress, created_at')
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Error fetching updates:', fetchError);
    return;
  }
  
  console.log(`Found ${updates.length} task updates.`);
  const map = new Map();
  
  updates.forEach(upd => {
    const key = `${upd.plot_id}-${upd.task_template_id}`;
    if (!map.has(key)) {
      map.set(key, { plot_id: upd.plot_id, task_template_id: upd.task_template_id, min_start: upd.created_at, max_end: null, progress: upd.progress });
    } else {
      const existing = map.get(key);
      existing.progress = upd.progress;
      if (upd.progress === 100) {
        existing.max_end = upd.created_at;
      }
    }
  });

  console.log(`Unique task assignments to sync: ${map.size}`);
  let count = 0;
  for (const [key, val] of map.entries()) {
    const { data: existingRecords, error: checkError } = await supabase
      .from('plot_task_assignments')
      .select('id')
      .eq('plot_id', val.plot_id)
      .eq('task_template_id', val.task_template_id);

    if (existingRecords && existingRecords.length > 0) {
      // already exists, use update
      const { error: upsertError } = await supabase
        .from('plot_task_assignments')
        .update({
          current_progress: val.progress,
          actual_start_date: val.min_start,
          actual_end_date: val.max_end
        })
        .eq('plot_id', val.plot_id)
        .eq('task_template_id', val.task_template_id);

      if (upsertError) console.error(`Error updating ${key}:`, upsertError);
      else count++;
    } else {
      // does not exist, use insert
      const { error: insertError } = await supabase
        .from('plot_task_assignments')
        .insert({
          plot_id: val.plot_id,
          task_template_id: val.task_template_id,
          current_progress: val.progress,
          actual_start_date: val.min_start,
          actual_end_date: val.max_end
        });

      if (insertError) console.error(`Error inserting ${key}:`, insertError);
      else count++;
    }
  }
  
  console.log(`Successfully synced ${count} assignments.`);
}
run();
