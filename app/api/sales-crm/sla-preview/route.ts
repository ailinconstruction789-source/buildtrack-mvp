import { handleSlaPreviewGet } from '@/lib/sales/slaPreviewServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleSlaPreviewGet(request); }
