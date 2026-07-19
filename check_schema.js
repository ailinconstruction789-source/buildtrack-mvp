const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkSchema() {
  // Check plot schema
  const { data: plots } = await supabase.from('plots').select('*').limit(1);
  console.log('Plots Table Schema:', Object.keys(plots[0] || {}));

  // Check task_updates schema
  const { data: updates } = await supabase.from('task_updates').select('*').limit(1);
  console.log('Task Updates Table Schema:', Object.keys(updates[0] || {}));

  // Check QC table schema
  const { data: qc } = await supabase.from('task_qc_inspections').select('*').limit(1);
  console.log('QC Table Schema:', qc && qc.length > 0 ? Object.keys(qc[0] || {}) : 'None');

  // Check sales table schema
  const { data: sales } = await supabase.from('sales').select('*').limit(1);
  console.log('Sales Table Schema:', Object.keys(sales[0] || {}));
}

checkSchema();
