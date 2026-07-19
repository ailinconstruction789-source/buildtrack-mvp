const { createClient } = require('@supabase/supabase-js');

// Create a single supabase client for interacting with your database
// Note: You need a service role key to query pg_trigger, or we can just use the command line directly.
