import { handleLeadLifecycleGet, handleLeadLifecyclePost } from '@/lib/sales/leadLifecycleServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    return handleLeadLifecyclePost(request);
}

export async function GET(request: Request) {
    return handleLeadLifecycleGet(request);
}
