const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, val] = line.split('=');
  if(key && val) acc[key.trim()] = val.trim();
  return acc;
}, {});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: plots } = await supabase.from('plots').select('id, plot_name, has_customer, is_completed').eq('has_customer', true);
  console.log('Plots with customer count:', plots?.length);
  console.log('Plots with customer but not completed:', plots?.filter(p => !p.is_completed).length);
  console.log('Sample uncompleted:', plots?.filter(p => !p.is_completed).slice(0, 5));
}

check();
