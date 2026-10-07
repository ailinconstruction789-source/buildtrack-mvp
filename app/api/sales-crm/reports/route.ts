import { handleSalesReportsGet } from '@/lib/sales/salesReportsServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleSalesReportsGet(request); }
