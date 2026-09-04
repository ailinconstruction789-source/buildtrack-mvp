require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkDefects() {
  const { error } = await supabase.from('defects').insert([{
    plot_id: 'e453715c-3720-4127-b9cd-90ef59530d12', // dummy but real plot if possible
    description: 'test_error',
    reported_by: 'Owner',
    status: 'pending',
    defect_stage: 'handover',
    handover_cycle: 1,
    inspection_round: 1
  }]);
  console.log("Insert Error:", error);
}

checkDefects();
