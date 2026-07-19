import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function addColumn() {
  const { data, error } = await supabase.rpc('execute_sql', { sql: 'ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS expected_transfer_date DATE;' });
  console.log("Result:", data, error);
}

addColumn();
