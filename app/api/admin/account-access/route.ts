import { handleAccountAccessRead } from '@/lib/auth/accountAccessServer';

// Observation only. No POST/PATCH/DELETE or account command is exposed.
export const GET = handleAccountAccessRead;
