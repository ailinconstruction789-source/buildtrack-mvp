const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    value = value.trim().replace(/^['"]|['"]$/g, '');
    env[match[1]] = value;
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkAL6HouseTypes() {
  const { data: houseTypes } = await supabase.from('house_types').select('id, type_name, floor_count');
  console.log('Current house_types in DB:', houseTypes);

  const { data: plots } = await supabase.from('plots').select('id, project_name, house_type_id').limit(5);
  console.log('Sample plots:', plots);
}

checkAL6HouseTypes();
