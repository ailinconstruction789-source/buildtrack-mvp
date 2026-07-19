require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
supabase.from('plots').select('*').limit(1).then(res => {
  if (res.error) console.error(res.error);
  else console.log("COLUMNS:", Object.keys(res.data[0] || {}));
});
