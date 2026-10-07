// Every accidental real-client operation fails closed, including auth.
export const supabase = new Proxy({}, { get() { throw new Error('Synthetic preview: Supabase access prohibited'); } });
