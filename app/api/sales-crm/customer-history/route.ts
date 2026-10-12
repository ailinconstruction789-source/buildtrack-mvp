import { handleHistoricalCustomerEvidence } from '@/lib/sales/historicalCustomerEvidenceServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleHistoricalCustomerEvidence(request); }
