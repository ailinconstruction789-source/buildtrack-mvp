const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.from('defects').select('*').limit(1);
  if (error) {
    console.error('Error fetching defects:', error.message);
  } else {
    if (data.length > 0) {
      console.log('Columns in defects table:', Object.keys(data[0]));
    } else {
      console.log('Defects table is empty, but query succeeded.');
    }
  }
}

check();
