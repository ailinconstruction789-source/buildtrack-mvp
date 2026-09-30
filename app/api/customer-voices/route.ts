import { handlePublicCustomerVoicePost } from '@/lib/sales/customerVoicesServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handlePublicCustomerVoicePost;
