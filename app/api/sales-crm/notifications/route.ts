import { handleNotificationGet, handleNotificationPost } from '@/lib/sales/notificationServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleNotificationGet(request); }
export async function POST(request: Request) { return handleNotificationPost(request); }
