'use client';
import React from 'react';
import { Pickaxe, ChevronDown } from 'lucide-react';

export interface TodayUpdatedTask {
  task_order: number | string;
  task_name?: string | null;
}

interface TodayUpdatedBadgeProps {
  tasks: TodayUpdatedTask[];
  label: string; // เช่น "อัปเดตวันนี้" หรือ "วันนี้"
  className?: string;
  /** แสดงชื่อในป้ายเลย ถ้าจำนวนงาน <= ค่านี้ (ค่าเริ่มต้น 2) */
  inlineLimit?: number;
  /** ความยาวสูงสุดของชื่องานที่แสดงในป้าย */
  maxNameLength?: number;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

export default function TodayUpdatedBadge({
  tasks,
  label,
  className = '',
  inlineLimit = 2,
  maxNameLength = 14,
}: TodayUpdatedBadgeProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const count = tasks.length;
  const isInline = count > 0 && count <= inlineLimit;
  const fullTitle = tasks.map((t) => `#${t.task_order} ${t.task_name ?? ''}`).join(', ');

  return (
    <span ref={ref} className="relative inline-flex">
      <span
        role={isInline || count === 0 ? undefined : 'button'}
        title={fullTitle || undefined}
        onClick={() => !isInline && count > 0 && setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 text-orange-700 bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded text-[9px] font-bold normal-case tracking-normal ${
          !isInline && count > 0 ? 'cursor-pointer hover:bg-orange-200' : ''
        } ${className}`}
      >
        <Pickaxe size={10} className="text-orange-600 shrink-0" />
        <span className="whitespace-nowrap">
          {label} ({count} งาน)
          {isInline &&
            ': ' + tasks.map((t) => `#${t.task_order} ${truncate(t.task_name ?? '', maxNameLength)}`).join(', ')}
        </span>
        {!isInline && count > 0 && <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
      </span>
      {open && !isInline && (
        <div className="absolute left-0 top-full mt-1 z-[100] w-64 max-h-64 overflow-y-auto rounded-lg border border-orange-200 bg-white shadow-lg p-1.5 normal-case tracking-normal text-left">
          <div className="text-[10px] font-bold text-orange-700 px-1.5 pb-1 border-b border-orange-100 mb-1">
            งานที่อัปเดตวันนี้ ({count})
          </div>
          {tasks.map((t) => (
            <div key={String(t.task_order)} className="flex gap-1.5 px-1.5 py-1 text-[11px] text-slate-700 rounded hover:bg-orange-50">
              <span className="font-bold text-orange-600 shrink-0">#{t.task_order}</span>
              <span className="font-medium">{t.task_name}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
