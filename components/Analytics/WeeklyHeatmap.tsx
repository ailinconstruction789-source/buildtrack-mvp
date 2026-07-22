import React, { useMemo } from 'react';
import { Calendar } from 'lucide-react';

interface WeeklyHeatmapProps {
  data: any[];
  roleFilter: 'se' | 'qc';
  title: string;
  colorScheme: 'blue' | 'purple';
}

export default function WeeklyHeatmap({ data, roleFilter, title, colorScheme }: WeeklyHeatmapProps) {

  // hours 8 to 19
  const hours = Array.from({ length: 12 }, (_, i) => i + 8);
  const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

  const { matrix, maxCount, peakDay, peakHour, totalWeeks } = useMemo(() => {
    // matrix[dayIndex][hourIndex]
    const m = Array(7).fill(0).map(() => Array(12).fill(0));
    let max = 0;
    
    // For insights
    const dayTotals = Array(7).fill(0);
    const hourTotals = Array(12).fill(0);
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    data?.forEach(row => {
      // Role filtering
      if (roleFilter === 'se' && row.role === 'QC') return;
      if (roleFilter === 'qc' && row.role !== 'QC') return;

      const d = parseInt(row.day_of_week) - 1; // 1-7 to 0-6
      const h = parseInt(row.hour_of_day);

      if (row.date) {
        const rowDate = new Date(row.date);
        if (!minDate || rowDate < minDate) minDate = rowDate;
        if (!maxDate || rowDate > maxDate) maxDate = rowDate;
      }

      if (d >= 0 && d <= 6 && h >= 8 && h <= 19) {
        const count = parseInt(row.action_count);
        const hIdx = h - 8;
        m[d][hIdx] += count;
        dayTotals[d] += count;
        hourTotals[hIdx] += count;
        if (m[d][hIdx] > max) max = m[d][hIdx];
      }
    });

    let maxDayIdx = 0;
    let maxHourIdx = 0;
    for (let i=0; i<7; i++) if (dayTotals[i] > dayTotals[maxDayIdx]) maxDayIdx = i;
    for (let i=0; i<12; i++) if (hourTotals[i] > hourTotals[maxHourIdx]) maxHourIdx = i;

    let weeks = 1;
    if (minDate && maxDate) {
       const diffTime = Math.abs((maxDate as Date).getTime() - (minDate as Date).getTime());
       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
       weeks = Math.max(1, Math.ceil(diffDays / 7));
    }

    return { 
      matrix: m, 
      maxCount: max > 0 ? max : 1, // avoid div by 0
      peakDay: days[maxDayIdx],
      peakHour: maxHourIdx + 8,
      totalWeeks: weeks
    };
  }, [data, roleFilter]);

  const getColor = (count: number) => {
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
    const intensity = count / maxCount;
    
    if (colorScheme === 'blue') {
      if (intensity < 0.25) return 'bg-blue-200';
      if (intensity < 0.5) return 'bg-blue-400';
      if (intensity < 0.75) return 'bg-blue-600';
      return 'bg-blue-700';
    } else {
      if (intensity < 0.25) return 'bg-purple-200';
      if (intensity < 0.5) return 'bg-purple-400';
      if (intensity < 0.75) return 'bg-purple-600';
      return 'bg-purple-700';
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${colorScheme === 'blue' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
            <Calendar size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">{title}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">ความหนาแน่นของการทำงาน (จากข้อมูล {totalWeeks} สัปดาห์)</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
         <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-100 dark:border-slate-800">
            <div className="text-sm text-slate-500 mb-1">วันที่งานชุกที่สุด</div>
            <div className="text-xl font-bold text-slate-700 dark:text-slate-200">วัน{peakDay}</div>
         </div>
         <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-100 dark:border-slate-800">
            <div className="text-sm text-slate-500 mb-1">ช่วงเวลาที่แอคทีฟที่สุด</div>
            <div className="text-xl font-bold text-slate-700 dark:text-slate-200">{peakHour}:00 - {peakHour+1}:00 น.</div>
         </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Header row (Hours) */}
          <div className="flex mb-2 ml-16">
            {hours.map(h => (
              <div key={h} className="flex-1 text-center text-xs text-slate-400">
                {h}:00
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="space-y-2">
            {days.map((day, dIdx) => (
              <div key={day} className="flex items-center">
                <div className="w-16 text-sm font-medium text-slate-500 dark:text-slate-400 text-right pr-4">
                  {day}
                </div>
                <div className="flex flex-1 gap-1">
                  {hours.map((_, hIdx) => {
                    const count = matrix[dIdx][hIdx];
                    return (
                      <div
                        key={hIdx}
                        className={`flex-1 h-8 rounded-sm transition-colors duration-200 ${getColor(count)} hover:ring-2 ring-slate-400 ring-offset-1 dark:ring-offset-slate-900 cursor-pointer relative group`}
                      >
                         <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10 transition-opacity">
                            {count} รายการ
                         </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-end mt-4 space-x-2 text-xs text-slate-500">
             <span>น้อย</span>
             <div className="w-4 h-4 rounded-sm bg-gray-100 dark:bg-gray-800"></div>
             <div className={`w-4 h-4 rounded-sm ${colorScheme === 'blue' ? 'bg-blue-200' : 'bg-purple-200'}`}></div>
             <div className={`w-4 h-4 rounded-sm ${colorScheme === 'blue' ? 'bg-blue-400' : 'bg-purple-400'}`}></div>
             <div className={`w-4 h-4 rounded-sm ${colorScheme === 'blue' ? 'bg-blue-600' : 'bg-purple-600'}`}></div>
             <div className={`w-4 h-4 rounded-sm ${colorScheme === 'blue' ? 'bg-blue-700' : 'bg-purple-700'}`}></div>
             <span>มาก</span>
          </div>
        </div>
      </div>
    </div>
  );
}
