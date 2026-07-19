const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v) acc[k] = v.join('=').trim().replace(/['"]/g, '');
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  const { data, error } = await supabase.from('projects').select('layout_data').eq('name', 'โยริว').single();
  const plotCells = data.layout_data.filter(c => c.type === 'plot');
  console.log('Sample layout plotIds:', plotCells.slice(0, 5).map(c => c.plotId));
}
test();
