import { handleRentalCommandGet, handleRentalCommandPost } from '@/lib/sales/rentalCommandServer';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = handleRentalCommandGet;
export const POST = handleRentalCommandPost;
