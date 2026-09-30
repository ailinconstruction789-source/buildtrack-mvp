import { handleVisitsGet, handleVisitsPost } from '@/lib/sales/visitsServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleVisitsGet;
export const POST = handleVisitsPost;
