import { handleCentralGet, handleCentralPost } from '@/lib/sales/centralServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    return handleCentralGet(request);
}

export async function POST(request: Request) {
    return handleCentralPost(request);
}
