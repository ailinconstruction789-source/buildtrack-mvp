'use client';

import React from 'react';
import type { RoadblockDisplayInfo } from '@/lib/foremanDuty';

interface RoadblockReasonCalloutProps {
  roadblock: RoadblockDisplayInfo;
  compact?: boolean;
  className?: string;
}

/**
 * Renders a foreman roadblock / non-start reason with its standard icon
 * and optional note, without internal `[ref:...]` deduplication tags.
 */
export default function RoadblockReasonCallout({
  roadblock,
  compact = false,
  className = '',
}: RoadblockReasonCalloutProps) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border bg-amber-50/80 border-amber-200/80 text-amber-950 font-medium leading-relaxed ${
        compact ? 'p-2.5 text-xs' : 'p-3.5 text-xs sm:text-sm'
      } ${className}`}
    >
      <span
        className={`${compact ? 'text-base' : 'text-base sm:text-lg'} leading-none shrink-0 mt-0.5`}
        aria-hidden="true"
      >
        {roadblock.icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-bold text-amber-900">
          เหตุผล: {roadblock.reasonLabel}
        </p>
        {roadblock.note && (
          <p className="text-amber-800 text-xs sm:text-sm">
            หมายเหตุ: {roadblock.note}
          </p>
        )}
      </div>
    </div>
  );
}
