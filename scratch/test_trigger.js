import { createClient } from '@supabase/supabase-js';

const supabase = createClient('http://127.0.0.1:54321', '...');

// wait, I don't have the anon key. Let me check if there is a supabase client setup in lib/supabaseClient.ts
