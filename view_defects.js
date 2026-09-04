require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function viewDefects() {
  const { data, error } = await supabase.from('defects').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("Latest defects:", data);
}

viewDefects();
