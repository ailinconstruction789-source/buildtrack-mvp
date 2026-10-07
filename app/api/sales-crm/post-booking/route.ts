import { handlePostBookingGet, handlePostBookingPost } from '@/lib/sales/postBookingServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handlePostBookingGet(request); }
export function POST(request: Request) { return handlePostBookingPost(request); }
