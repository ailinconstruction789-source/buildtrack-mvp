import { handleWorkScheduleGet, handleWorkSchedulePost } from '@/lib/sales/workScheduleServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleWorkScheduleGet(request); }
export async function POST(request: Request) { return handleWorkSchedulePost(request); }
