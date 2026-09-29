import { handleBookingGet, handleBookingPost } from '@/lib/sales/bookingServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleBookingGet(request); }
export const POST = handleBookingPost;
