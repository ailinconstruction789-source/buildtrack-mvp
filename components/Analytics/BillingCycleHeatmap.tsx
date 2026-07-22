import React, { useMemo } from 'react';
import { Target, AlertTriangle } from 'lucide-react';

interface BillingCycleHeatmapProps {
  data: any[];
}

export default function BillingCycleHeatmap({ data }: BillingCycleHeatmapProps) {
  // 31 days in a month
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  const { counts, maxCount } = useMemo(() => {
    const c = Array(32).fill(0); // 1-indexed for ease
    let max = 0;

    data?.forEach(row => {
      const d = parseInt(row.day_of_month);
      if (d >= 1 && d <= 31) {
        const count = parseInt(row.action_count);
        c[d] += count;
        if (c[d] > max) max = c[d];
      }
    });

    return { 
      counts: c, 
      maxCount: max > 0 ? max : 1 
    };
  }, [data]);

  const getColor = (count: number) => {
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
    const intensity = count / maxCount;
    if (intensity < 0.25) return 'bg-orange-200';
    if (intensity < 0.5) return 'bg-orange-400';
    if (intensity < 0.75) return 'bg-orange-600';
    return 'bg-red-600';
  };

  const getRoundLabel = (day: number) => {
    if (day === 10) return 'QC Deadline 1';
    if (day === 20) return 'QC Deadline 2';
    if (day === 31) return 'QC Deadline 3';
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg text-red-600 dark:text-red-400">
            <Target size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Billing Cycle Tracking</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">ความหนาแน่นของการตรวจงานเทียบกับวันตัดรอบ (วันที่ 10, 20, สิ้นเดือน)</p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Round 1 */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center">
            รอบ 1 (วันที่ 1 - 10)
          </h3>
          <div className="flex gap-2 flex-wrap">
            {days.slice(0, 10).map(d => {
              const count = counts[d];
              const isDeadline = d === 10;
              const isSeDeadline = d === 8;
              return (
                <div key={d} className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-md transition-colors duration-200 ${getColor(count)} ${isDeadline ? 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-slate-900 z-10' : isSeDeadline ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900 z-10' : ''} flex items-center justify-center cursor-pointer relative group`}
                  >
                    <span className={`text-xs font-medium ${count === 0 ? 'text-slate-400' : (count / maxCount > 0.5 ? 'text-white' : 'text-slate-700')}`}>
                      {d}
                    </span>
                    <div className="absolute bottom-full mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-20">
                      วันที่ {d}: {count} รายการ
                    </div>
                  </div>
                  {isDeadline && (
                    <div className="text-[10px] text-red-500 font-bold mt-1 text-center leading-tight">
                      QC<br/>Deadline
                    </div>
                  )}
                  {isSeDeadline && (
                    <div className="text-[10px] text-blue-500 font-bold mt-1 text-center leading-tight">
                      SE<br/>Deadline
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Round 2 */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center">
            รอบ 2 (วันที่ 11 - 20)
          </h3>
          <div className="flex gap-2 flex-wrap">
            {days.slice(10, 20).map(d => {
              const count = counts[d];
              const isDeadline = d === 20;
              const isSeDeadline = d === 18;
              return (
                <div key={d} className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-md transition-colors duration-200 ${getColor(count)} ${isDeadline ? 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-slate-900 z-10' : isSeDeadline ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900 z-10' : ''} flex items-center justify-center cursor-pointer relative group`}
                  >
                    <span className={`text-xs font-medium ${count === 0 ? 'text-slate-400' : (count / maxCount > 0.5 ? 'text-white' : 'text-slate-700')}`}>
                      {d}
                    </span>
                    <div className="absolute bottom-full mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-20">
                      วันที่ {d}: {count} รายการ
                    </div>
                  </div>
                  {isDeadline && (
                    <div className="text-[10px] text-red-500 font-bold mt-1 text-center leading-tight">
                      QC<br/>Deadline
                    </div>
                  )}
                  {isSeDeadline && (
                    <div className="text-[10px] text-blue-500 font-bold mt-1 text-center leading-tight">
                      SE<br/>Deadline
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Round 3 */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center">
            รอบ 3 (วันที่ 21 - 31)
          </h3>
          <div className="flex gap-2 flex-wrap">
            {days.slice(20, 31).map(d => {
              const count = counts[d];
              const isDeadline = d === 30 || d === 31;
              const isSeDeadline = d === 28 || d === 29;
              return (
                <div key={d} className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-md transition-colors duration-200 ${getColor(count)} ${isDeadline ? 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-slate-900 z-10' : isSeDeadline ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900 z-10' : ''} flex items-center justify-center cursor-pointer relative group`}
                  >
                    <span className={`text-xs font-medium ${count === 0 ? 'text-slate-400' : (count / maxCount > 0.5 ? 'text-white' : 'text-slate-700')}`}>
                      {d}
                    </span>
                    <div className="absolute bottom-full mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-20">
                      วันที่ {d}: {count} รายการ
                    </div>
                  </div>
                  {isDeadline && (
                    <div className="text-[10px] text-red-500 font-bold mt-1 text-center leading-tight">
                      QC<br/>Deadline
                    </div>
                  )}
                  {isSeDeadline && (
                    <div className="text-[10px] text-blue-500 font-bold mt-1 text-center leading-tight">
                      SE<br/>Deadline
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
