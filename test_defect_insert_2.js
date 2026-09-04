require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkDefects() {
  const { data: plot } = await supabase.from('plots').select('id, house_type_id').limit(1).single();
  const { data: taskTemplate } = await supabase.from('task_templates').select('id').eq('house_type_id', plot.house_type_id).limit(1).single();
  const { data: contractor } = await supabase.from('contractors').select('id').limit(1).single();

  const { error } = await supabase.from('defects').insert([{
    plot_id: plot.id,
    description: 'test_error_2',
    reported_by: 'Owner',
    status: 'pending',
    defect_stage: 'handover',
    handover_cycle: 1,
    inspection_round: 1,
    task_template_id: taskTemplate ? taskTemplate.id : null,
    contractor_id: contractor ? contractor.id : null
  }]);
  
  console.log("Plot:", plot.id);
  console.log("Task Template:", taskTemplate?.id);
  console.log("Contractor:", contractor?.id);
  console.log("Insert Error:", error);
}

checkDefects();
