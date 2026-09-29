'use client';

import Link from 'next/link';
import { bookingUuid } from '@/lib/sales/bookingContracts';
import { usePostBookingEnabled } from './SalesWorkspaceModeProvider';

/** Display gate only. Page/API/SQL independently recheck configuration and rights. */
export default function PostBookingLink({ saleId, label = 'งานสัญญา / สินเชื่อ / โอนและประวัติ →' }: { saleId: string; label?: string }) {
  if (!usePostBookingEnabled()) return null;
  return <Link href={`/sales-crm/post-booking?${new URLSearchParams({ saleId: bookingUuid(saleId) })}`} prefetch={false}
    className="inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100">{label}</Link>;
}
