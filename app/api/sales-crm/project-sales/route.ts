import { handleProjectSalesGet } from '@/lib/sales/projectSalesServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleProjectSalesGet(request); }
