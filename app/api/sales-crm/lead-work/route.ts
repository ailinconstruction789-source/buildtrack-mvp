import { handleLeadWorkGet, handleLeadWorkPost } from '@/lib/sales/leadWorkServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    return handleLeadWorkPost(request);
}

export async function GET(request: Request) {
    return handleLeadWorkGet(request);
}
