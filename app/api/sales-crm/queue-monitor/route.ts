import { handleQueueMonitorGet } from '@/lib/sales/queueMonitorServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleQueueMonitorGet(request); }
