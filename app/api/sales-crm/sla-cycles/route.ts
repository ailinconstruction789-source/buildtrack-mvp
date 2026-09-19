import { handleSlaCycleGet, handleSlaCyclePost } from '@/lib/sales/slaCycleServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleSlaCycleGet(request); }
export async function POST(request: Request) { return handleSlaCyclePost(request); }
