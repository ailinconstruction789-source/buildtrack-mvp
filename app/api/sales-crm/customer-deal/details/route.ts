import { handleCustomerDealEditGet, handleCustomerDealEditPost } from '@/lib/sales/customerDealEditServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleCustomerDealEditGet(request); }
export function POST(request: Request) { return handleCustomerDealEditPost(request); }
