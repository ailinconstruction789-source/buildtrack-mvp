import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';

/** Shared presentation for the existing tracker and its central-data replacement.
 * No database calls or legacy mutation handlers belong in this component. */
export function LeadTrackerHeader({ subtitle, actions }: { subtitle: string; actions: ReactNode }) {
  return <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm md:flex-row md:items-center">
    <div>
      <h2 className="flex items-center gap-2.5 text-lg font-black text-slate-800 sm:text-xl">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100/50"><FileText size={20} /></span>
        📋 Lead Tracker (ระบบจัดการและติดตามลูกค้ามุ่งหวัง)
      </h2>
      <p className="mt-1 text-xs font-medium text-slate-500">{subtitle}</p>
    </div>
    <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto">{actions}</div>
  </div>;
}

export function LeadTrackerTable({ columns, children }: { columns: readonly string[]; children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-all">
    <div className="max-h-[680px] overflow-auto custom-scrollbar">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 font-bold text-slate-600 backdrop-blur shadow-xs">
          <tr>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3.5 tracking-wider uppercase text-[11px] text-slate-500">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100/90 font-medium">{children}</tbody>
      </table>
    </div>
  </div>;
}
