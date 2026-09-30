import { handleVisitSopGet, handleVisitSopPost } from '@/lib/sales/visitSopServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleVisitSopGet;
export const POST = handleVisitSopPost;
