import { handleCustomerVoicesGet, handleCustomerVoicesPost } from '@/lib/sales/customerVoicesServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleCustomerVoicesGet;
export const POST = handleCustomerVoicesPost;
