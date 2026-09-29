import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';

/** Shared presentation for the existing tracker and its central-data replacement.
 * No database calls or legacy mutation handlers belong in this component. */
export function LeadTrackerHeader({ subtitle, actions }: { subtitle: string; actions: ReactNode }) {
  return <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
    <div>
      <h2 className="flex items-center gap-2 text-lg font-black text-slate-800 sm:text-xl">
        <span className="rounded-xl bg-blue-50 p-2 text-blue-600"><FileText size={20} /></span>
        📋 Lead Tracker (ระบบจัดการและติดตามลูกค้ามุ่งหวัง)
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
    </div>
    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">{actions}</div>
  </div>;
}

export function LeadTrackerTable({ columns, children }: { columns: readonly string[]; children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
    <div className="max-h-[680px] overflow-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 font-bold text-slate-600 shadow-sm">
          <tr>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap p-3">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-medium">{children}</tbody>
      </table>
    </div>
  </div>;
}
