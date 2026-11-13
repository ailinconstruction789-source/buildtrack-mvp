import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
let url='', key='';
for (const line of env.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
}
const supabase = createClient(url, key);

async function main() {
  await supabase.auth.signInWithPassword({ email: 'owner@buildtrack.local', password: '1234BT!' });
  console.log('Logged in as owner.');

  // 1. Get plots in ไอลิน6
  const { data: plots } = await supabase.from('plots').select('id, plot_name, house_type_id').eq('project_name', 'ไอลิน6');
  const plotIds = plots.map(p => p.id);
  console.log('Total plots:', plotIds.length);

  // 2. Get house types
  const houseTypeIds = [...new Set(plots.map(p => p.house_type_id).filter(Boolean))];
  const { data: taskTemplates } = await supabase.from('task_templates')
    .select('id, house_type_id, task_name, task_order')
    .in('house_type_id', houseTypeIds)
    .order('task_order', { ascending: true })
    .limit(5000);
  
  const tasksByHouseType = new Map();
  for (const t of taskTemplates || []) {
    if (!tasksByHouseType.has(t.house_type_id)) tasksByHouseType.set(t.house_type_id, []);
    tasksByHouseType.get(t.house_type_id).push(t);
  }

  // 3. Get standard sets
  const { data: stdSets } = await supabase.from('qc_standard_sets')
    .select('house_type_id, task_name, form_template_id, form_version, drawing_id, drawing_version, selected_pages, require_plot_drawing')
    .in('house_type_id', houseTypeIds)
    .eq('is_active', true)
    .limit(5000);

  const stdSetMap = new Map();
  for (const s of stdSets || []) {
    stdSetMap.set(`${s.house_type_id}_${s.task_name.trim()}`, s);
  }
  console.log('Total stdSets mapped:', stdSetMap.size);

  // 4. Fetch genuine QC completed tasks from task_updates
  const completedSet = new Set();
  const chunkSize = 30;
  for (let i = 0; i < plotIds.length; i += chunkSize) {
    const chunk = plotIds.slice(i, i + chunkSize);
    const { data: updates } = await supabase
      .from('task_updates')
      .select('plot_id, task_template_id, action, created_at')
      .in('plot_id', chunk)
      .or('action.ilike.%QC%,action.ilike.%PE%')
      .order('created_at', { ascending: true })
      .limit(10000);

    for (const u of updates || []) {
      const key = `${u.plot_id}_${u.task_template_id}`;
      const action = u.action || '';
      if (action.includes('QC อนุมัติ') || action.includes('QC ผ่าน') || action.includes('PE อนุมัติ')) {
        completedSet.add(key);
      } else if (action.includes('แจ้งแก้ไข') || action.includes('ไม่อนุมัติ') || action.includes('ตีกลับ')) {
        completedSet.delete(key);
      }
    }
  }
  console.log('Total genuine QC completed plot_tasks:', completedSet.size);

  // 5. Build configs
  let totalExempted = 0;
  let totalActivated = 0;
  const allConfigs = [];

  for (const plot of plots) {
    const tasks = tasksByHouseType.get(plot.house_type_id) || [];
    for (const task of tasks) {
      const isCompleted = completedSet.has(`${plot.id}_${task.id}`);
      const stdSet = stdSetMap.get(`${plot.house_type_id}_${task.task_name.trim()}`);

      if (isCompleted) {
        allConfigs.push({
          project_name: 'ไอลิน6',
          plot_id: plot.id,
          task_template_id: task.id,
          task_name: task.task_name,
          inspection_method: 'legacy',
          is_active: false,
          form_template_id: null,
          form_version: null,
          drawing_id: null,
          drawing_version: null,
          selected_pages: [],
          require_plot_drawing: false,
          is_plot_override: false,
          created_by: 'Admin',
          updated_at: new Date().toISOString()
        });
        totalExempted++;
      } else if (stdSet) {
        allConfigs.push({
          project_name: 'ไอลิน6',
          plot_id: plot.id,
          task_template_id: task.id,
          task_name: task.task_name,
          inspection_method: 'form_v2',
          is_active: true,
          form_template_id: stdSet.form_template_id,
          form_version: stdSet.form_version,
          drawing_id: stdSet.drawing_id || null,
          drawing_version: stdSet.drawing_version || null,
          selected_pages: stdSet.selected_pages || [],
          require_plot_drawing: Boolean(stdSet.require_plot_drawing),
          is_plot_override: false,
          created_by: 'Admin',
          updated_at: new Date().toISOString()
        });
        totalActivated++;
      } else {
        allConfigs.push({
          project_name: 'ไอลิน6',
          plot_id: plot.id,
          task_template_id: task.id,
          task_name: task.task_name,
          inspection_method: 'legacy',
          is_active: false,
          form_template_id: null,
          form_version: null,
          drawing_id: null,
          drawing_version: null,
          selected_pages: [],
          require_plot_drawing: false,
          is_plot_override: false,
          created_by: 'Admin',
          updated_at: new Date().toISOString()
        });
        totalExempted++;
      }
    }
  }

  console.log(`Exempted (Legacy): ${totalExempted}, Activated (Form V2): ${totalActivated}, Total: ${allConfigs.length}`);

  // Upsert in batches of 50
  for (let i = 0; i < allConfigs.length; i += 50) {
    const batch = allConfigs.slice(i, i + 50);
    const { error } = await supabase.from('qc_plot_task_configs')
      .upsert(batch, { onConflict: 'plot_id,task_template_id' });
    if (error) {
      console.error('Batch error at', i, error);
      break;
    }
  }

  console.log('Smart activation completed successfully!');
}

main().catch(console.error);
