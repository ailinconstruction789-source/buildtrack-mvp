import { handleVisitFollowUpGet, handleVisitFollowUpPost } from '@/lib/sales/leadWorkServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleVisitFollowUpGet;
export const POST = handleVisitFollowUpPost;
