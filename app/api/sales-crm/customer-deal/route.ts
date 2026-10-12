import { handleCustomerDealRead } from '@/lib/sales/customerDealReadServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleCustomerDealRead(request); }
