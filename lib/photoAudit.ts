/**
 * Utility functions and types for Photo Watermark Time Audit & EXIF
 * Compares actual photo capture timestamp against report submission timestamp
 */

import { supabase } from '@/lib/supabase';

export interface PhotoAuditStatus {
  status: 'on_time' | 'delayed_same_day' | 'delayed_late' | 'cross_day' | 'ahead_of_time' | 'unknown';
  statusLabel: string;
  statusBadgeColor: string; // Tailwind color classes
  timeDiffMinutes: number;
  timeDiffText: string;
  isSameDay: boolean;
  isPlotMatch: boolean | null;
  plotMatchLabel: string;
}

export interface PhotoAuditResult {
  hasWatermark: boolean;
  rawWatermarkText?: string;
  takenAt?: string; // ISO 8601 string
  takenDateStr?: string;
  takenTimeStr?: string;
  location?: string | null;
  plotTag?: string | null;
  audit?: PhotoAuditStatus;
  scannedAt: string;
  error?: string;
}

const THAI_MONTH_MAP: Record<string, number> = {
  'ม.ค.': 0, 'ก.พ.': 1, 'มี.ค.': 2, 'เม.ย.': 3, 'พ.ค.': 4, 'มิ.ย.': 5,
  'ก.ค.': 6, 'ส.ค.': 7, 'ก.ย.': 8, 'ต.ค.': 9, 'พ.ย.': 10, 'ธ.ค.': 11,
  'มกราคม': 0, 'กุมภาพันธ์': 1, 'มีนาคม': 2, 'เมษายน': 3, 'พฤษภาคม': 4, 'มิถุนายน': 5,
  'กรกฎาคม': 6, 'สิงหาคม': 7, 'กันยายน': 8, 'ตุลาคม': 9, 'พฤศจิกายน': 10, 'ธันวาคม': 11,
  'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
  'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
};

/**
 * Robust Thai & standard date/time string parser.
 * Handles Buddhist era (25xx -> 20xx) and Asia/Bangkok UTC offset (+07:00).
 */
export function parseThaiOrIsoDate(input: string): Date | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // Try standard ISO parse first
  if (trimmed.includes('T') || (trimmed.length >= 19 && /^\d{4}-\d{2}-\d{2}/.test(trimmed))) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // Thai pattern: "16 ต.ค. 2569 13:50:41" or "16 ตุลาคม 2569 13:50"
  const thaiMatch = trimmed.match(/(\d{1,2})\s+([^\s\d]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (thaiMatch) {
    const day = parseInt(thaiMatch[1], 10);
    const monthKey = thaiMatch[2].toLowerCase();
    let year = parseInt(thaiMatch[3], 10);
    if (year > 2400) year -= 543; // Buddhist to Gregorian

    let month = 0;
    for (const [k, v] of Object.entries(THAI_MONTH_MAP)) {
      if (monthKey.startsWith(k.toLowerCase()) || k.toLowerCase().startsWith(monthKey)) {
        month = v;
        break;
      }
    }

    const hour = thaiMatch[4] ? parseInt(thaiMatch[4], 10) : 12;
    const min = thaiMatch[5] ? parseInt(thaiMatch[5], 10) : 0;
    const sec = thaiMatch[6] ? parseInt(thaiMatch[6], 10) : 0;

    // Bangkok is UTC+7
    return new Date(Date.UTC(year, month, day, hour - 7, min, sec));
  }

  // Fallback: standard slash pattern "DD/MM/YYYY HH:mm:ss" or "YYYY/MM/DD"
  const slashMatch = trimmed.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (slashMatch) {
    let year = parseInt(slashMatch[1], 10);
    let month = parseInt(slashMatch[2], 10) - 1;
    let day = parseInt(slashMatch[3], 10);

    // If day was first: DD/MM/YYYY
    if (slashMatch[3].length === 4) {
      day = parseInt(slashMatch[1], 10);
      month = parseInt(slashMatch[2], 10) - 1;
      year = parseInt(slashMatch[3], 10);
    }
    if (year > 2400) year -= 543;

    const hour = slashMatch[4] ? parseInt(slashMatch[4], 10) : 12;
    const min = slashMatch[5] ? parseInt(slashMatch[5], 10) : 0;
    const sec = slashMatch[6] ? parseInt(slashMatch[6], 10) : 0;

    return new Date(Date.UTC(year, month, day, hour - 7, min, sec));
  }

  return null;
}

/**
 * Normalizes plot IDs for fuzzy matching (e.g. "AL6-45" matches "45" or "AL6-45")
 */
export function isPlotTagMatch(watermarkPlot?: string | null, reportedPlot?: string | null): boolean | null {
  if (!watermarkPlot || !reportedPlot) return null;
  const cleanW = watermarkPlot.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const cleanR = reportedPlot.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (!cleanW || !cleanR) return null;
  if (cleanW === cleanR) return true;
  if (cleanR.includes(cleanW) || cleanW.includes(cleanR)) return true;

  // Extract trailing digits e.g. "AL6-45" -> "45"
  const digitW = watermarkPlot.match(/\d+$/)?.[0];
  const digitR = reportedPlot.match(/\d+$/)?.[0];
  if (digitW && digitR && digitW === digitR) return true;

  return false;
}

/**
 * Compares takenDate vs reportedCreatedAt and checks plotTag match.
 */
export function calculatePhotoAudit(
  takenInput: Date | string,
  reportedInput: Date | string,
  plotTag?: string | null,
  reportedPlotId?: string | null
): PhotoAuditStatus {
  const takenDate = typeof takenInput === 'string' ? parseThaiOrIsoDate(takenInput) : takenInput;
  const reportedDate = typeof reportedInput === 'string' ? new Date(reportedInput) : reportedInput;

  if (!takenDate || isNaN(takenDate.getTime()) || !reportedDate || isNaN(reportedDate.getTime())) {
    return {
      status: 'unknown',
      statusLabel: 'ไม่สามารถคำนวณผลต่างเวลาได้',
      statusBadgeColor: 'bg-slate-100 text-slate-700 border-slate-300',
      timeDiffMinutes: 0,
      timeDiffText: '-',
      isSameDay: true,
      isPlotMatch: null,
      plotMatchLabel: 'ไม่สามารถตรวจสอบแปลงได้'
    };
  }

  // Calculate difference in minutes (reported - taken)
  const diffMs = reportedDate.getTime() - takenDate.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  // Check if same calendar day in Bangkok (+7 hours)
  const bkkOffset = 7 * 60 * 60 * 1000;
  const takenBkkDay = new Date(takenDate.getTime() + bkkOffset).toISOString().slice(0, 10);
  const repBkkDay = new Date(reportedDate.getTime() + bkkOffset).toISOString().slice(0, 10);
  const isSameDay = takenBkkDay === repBkkDay;

  // Format time difference text
  const absMinutes = Math.abs(diffMinutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  const timeDiffText = hours > 0
    ? `${hours} ชม. ${mins > 0 ? `${mins} นาที` : ''}`
    : `${mins} นาที`;

  // Plot verification
  const plotMatch = isPlotTagMatch(plotTag, reportedPlotId);
  const plotMatchLabel = plotMatch === true
    ? `✅ แปลงตรงกัน (${plotTag})`
    : plotMatch === false
      ? `⚠️ ลายน้ำ (${plotTag}) ไม่ตรงกับแปลงที่รายงาน (${reportedPlotId})`
      : 'ℹ️ ไม่พบลายน้ำระบุแปลง';

  // Determine status
  if (!isSameDay && diffMinutes > 720) {
    const daysDiff = Math.max(1, Math.round(diffMinutes / 1440));
    return {
      status: 'cross_day',
      statusLabel: `🔴 ถ่ายข้ามวัน (ถ่ายก่อนส่ง ${daysDiff} วัน)`,
      statusBadgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
      timeDiffMinutes: diffMinutes,
      timeDiffText: `ส่งหลังถ่าย ${daysDiff} วัน (${timeDiffText})`,
      isSameDay: false,
      isPlotMatch: plotMatch,
      plotMatchLabel
    };
  }

  if (diffMinutes < -15) {
    return {
      status: 'ahead_of_time',
      statusLabel: `⚠️ เวลาในรูปล้ำหน้า (${timeDiffText})`,
      statusBadgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
      timeDiffMinutes: diffMinutes,
      timeDiffText: `เวลาในรูปล้ำหน้า ${timeDiffText}`,
      isSameDay,
      isPlotMatch: plotMatch,
      plotMatchLabel
    };
  }

  if (diffMinutes <= 30) {
    return {
      status: 'on_time',
      statusLabel: '🟢 ส่งทันที (ภายใน 30 นาที)',
      statusBadgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      timeDiffMinutes: diffMinutes,
      timeDiffText: `ส่งหลังถ่าย ${timeDiffText}`,
      isSameDay,
      isPlotMatch: plotMatch,
      plotMatchLabel
    };
  }

  if (diffMinutes <= 180) {
    return {
      status: 'delayed_same_day',
      statusLabel: `🟡 ถ่ายล่วงหน้า / ส่งช้า (${timeDiffText})`,
      statusBadgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
      timeDiffMinutes: diffMinutes,
      timeDiffText: `ส่งหลังถ่าย ${timeDiffText}`,
      isSameDay,
      isPlotMatch: plotMatch,
      plotMatchLabel
    };
  }

  return {
    status: 'delayed_late',
    statusLabel: `🟠 ส่งล่าช้ามาก (${timeDiffText})`,
    statusBadgeColor: 'bg-orange-100 text-orange-800 border-orange-300',
    timeDiffMinutes: diffMinutes,
    timeDiffText: `ส่งหลังถ่าย ${timeDiffText}`,
    isSameDay,
    isPlotMatch: plotMatch,
    plotMatchLabel
  };
}

/**
 * Cache storage helpers using localStorage to save token usage
 */
function getStorageKey(imageUrl: string): string {
  // Simple hash for url
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i++) {
    hash = (hash << 5) - hash + imageUrl.charCodeAt(i);
    hash |= 0;
  }
  return `buildtrack_photo_audit_${Math.abs(hash)}`;
}

export function getCachedPhotoAudit(imageUrl: string): PhotoAuditResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getStorageKey(imageUrl));
    if (!raw) return null;
    return JSON.parse(raw) as PhotoAuditResult;
  } catch {
    return null;
  }
}

export function setCachedPhotoAudit(imageUrl: string, result: PhotoAuditResult): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(imageUrl), JSON.stringify(result));
  } catch {
    // Quota exceeded or private browsing fallback
  }
}

/**
 * Primary client-side call to audit a photo. Checks cache first.
 */
export async function auditPhoto({
  imageUrl,
  imageBase64,
  reportedPlotId,
  reportedCreatedAt,
  forceRescan = false
}: {
  imageUrl?: string;
  imageBase64?: string;
  reportedPlotId?: string;
  reportedCreatedAt?: string;
  forceRescan?: boolean;
}): Promise<PhotoAuditResult> {
  const cacheKey = imageUrl || (imageBase64 ? imageBase64.slice(0, 100) : '');

  if (!forceRescan && cacheKey) {
    const cached = getCachedPhotoAudit(cacheKey);
    if (cached) {
      // Re-evaluate audit against reported values if available
      if (cached.takenAt && reportedCreatedAt) {
        cached.audit = calculatePhotoAudit(cached.takenAt, reportedCreatedAt, cached.plotTag, reportedPlotId);
      }
      return cached;
    }
  }

  const response = await fetch('/api/photo-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl,
      imageBase64,
      reportedPlotId,
      reportedCreatedAt
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to audit photo (${response.status})`);
  }

  const result: PhotoAuditResult = await response.json();
  if (cacheKey && result.hasWatermark) {
    setCachedPhotoAudit(cacheKey, result);
  }
  return result;
}

/**
 * Fetch cached audits from central database in Supabase in bulk.
 * Saves to localStorage and returns a map of imageUrl -> PhotoAuditResult.
 */
export async function fetchBatchPhotoAuditsFromDb(imageUrls: string[]): Promise<Record<string, PhotoAuditResult>> {
  if (!imageUrls || imageUrls.length === 0) return {};
  const uniqueUrls = Array.from(new Set(imageUrls.filter(u => u && typeof u === 'string' && u.length > 5)));
  if (uniqueUrls.length === 0) return {};

  const resultMap: Record<string, PhotoAuditResult> = {};

  try {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < uniqueUrls.length; i += CHUNK_SIZE) {
      const chunk = uniqueUrls.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('photo_watermark_audits')
        .select('*')
        .in('image_url', chunk);

      if (error || !data) continue;

      for (const row of data) {
        const auditRes: PhotoAuditResult = {
          hasWatermark: Boolean(row.has_watermark),
          rawWatermarkText: row.raw_watermark_text || '',
          takenAt: row.taken_at,
          takenDateStr: row.taken_date_str,
          takenTimeStr: row.taken_time_str,
          location: row.location,
          plotTag: row.plot_tag,
          audit: row.audit_data || undefined,
          scannedAt: row.created_at
        };
        resultMap[row.image_url] = auditRes;
        setCachedPhotoAudit(row.image_url, auditRes);
      }
    }
  } catch {
    // Table may not exist yet, fallback smoothly
  }

  return resultMap;
}

/**
 * Trigger background auto-scan for newly uploaded photos.
 * NON-BLOCKING: Detached via setTimeout, never throws, ignores quota errors gracefully.
 */
export function triggerBackgroundPhotoAudit(
  imageUrls: string[],
  reportedPlotId?: string,
  reportedCreatedAt?: string
): void {
  if (!imageUrls || imageUrls.length === 0) return;
  const validUrls = imageUrls.filter(u => u && typeof u === 'string' && u.length > 5);
  if (validUrls.length === 0) return;

  // Run in background without holding UI
  setTimeout(async () => {
    for (const url of validUrls) {
      try {
        // Skip if already in local cache
        if (getCachedPhotoAudit(url)) continue;

        await auditPhoto({
          imageUrl: url,
          reportedPlotId,
          reportedCreatedAt: reportedCreatedAt || new Date().toISOString(),
          forceRescan: false
        });

        // Small pause between multiple photos to avoid bursting
        await new Promise(res => setTimeout(res, 800));
      } catch {
        // Silently skip any failure (e.g. rate limit / network error)
      }
    }
  }, 150);
}
