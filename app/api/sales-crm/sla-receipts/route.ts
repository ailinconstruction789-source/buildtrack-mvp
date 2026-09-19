import { handleSlaReceiptGet } from '@/lib/sales/slaReceiptServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleSlaReceiptGet(request); }
