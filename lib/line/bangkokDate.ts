const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const THAI_SHORT_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
] as const;

export interface BangkokDayWindow {
  dateStr: string;       // YYYY-MM-DD
  startIso: string;      // YYYY-MM-DDT00:00:00+07:00
  endIso: string;        // YYYY-MM-DDT23:59:59.999+07:00
  startMs: number;
  endMs: number;
  monthStartStr: string; // YYYY-MM-01
  monthStartIso: string; // YYYY-MM-01T00:00:00+07:00
  plus7DaysStr: string;  // YYYY-MM-DD (+7 days)
  tomorrowStr: string;   // YYYY-MM-DD (+1 day)
}

/**
 * Returns YYYY-MM-DD in Asia/Bangkok (UTC+7) for a Date or ISO timestamp.
 */
export function toBangkokDateString(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) return null;
    const shifted = new Date(ms + BANGKOK_OFFSET_MS);
    return shifted.toISOString().slice(0, 10);
  }
  const ms = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Adds N calendar days to a YYYY-MM-DD string cleanly without timezone drift.
 */
export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/**
 * Computes signed calendar day difference (targetDate - baseDate) for YYYY-MM-DD strings.
 */
export function diffCalendarDays(baseDateStr: string, targetDateStr: string): number {
  const [y1, m1, d1] = baseDateStr.split('-').map(Number);
  const [y2, m2, d2] = targetDateStr.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * Builds the full Bangkok day window for a given YYYY-MM-DD (or current Bangkok today).
 */
export function getBangkokDayWindow(dateInput?: string | Date): BangkokDayWindow {
  let dateStr: string | null = null;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    dateStr = dateInput.trim();
  } else {
    dateStr = toBangkokDateString(dateInput ?? new Date());
  }
  if (!dateStr) {
    dateStr = toBangkokDateString(new Date())!;
  }

  const startIso = `${dateStr}T00:00:00+07:00`;
  const endIso = `${dateStr}T23:59:59.999+07:00`;
  const monthStartStr = `${dateStr.slice(0, 7)}-01`;
  const monthStartIso = `${monthStartStr}T00:00:00+07:00`;

  return {
    dateStr,
    startIso,
    endIso,
    startMs: Date.parse(startIso),
    endMs: Date.parse(endIso),
    monthStartStr,
    monthStartIso,
    tomorrowStr: addCalendarDays(dateStr, 1),
    plus7DaysStr: addCalendarDays(dateStr, 7),
  };
}

/**
 * Formats YYYY-MM-DD as Thai short Buddhist Era date, e.g., "28 พ.ย. 2569".
 */
export function formatThaiShortDate(dateStr: string, includeYear = true): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const day = Number(match[3]);
  const monthLabel = THAI_SHORT_MONTHS[monthIdx] ?? match[2];
  if (!includeYear) return `${day} ${monthLabel}`;
  const beYear = year < 2400 ? year + 543 : year;
  return `${day} ${monthLabel} ${beYear}`;
}
