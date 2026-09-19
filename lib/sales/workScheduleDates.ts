import { parseEvidenceTimestamp } from './leadEvidence';

const microsecondsPerSecond = BigInt(1_000_000);
const bangkokOffset = BigInt(7 * 60 * 60) * microsecondsPerSecond;
const minimumLocal = parseEvidenceTimestamp('0001-01-01T00:00:00.000000Z')!;
const maximumLocal = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
const invalid = () => new Error('วันเวลาจัดเวรไม่ถูกต้อง กรุณาระบุวันเวลาให้ครบตามเวลากรุงเทพฯ (UTC+07:00) และเศษวินาทีไม่เกิน 6 หลัก');

/** Zoned instant -> fixed Bangkok wall clock. Integral seconds alone enter Date;
 * fractional microseconds stay bigint, including for times before the Unix epoch.
 * Output always contains seconds; nonzero fractions are exact with trailing zeros trimmed. */
export function workScheduleToLocal(timestamp: string): string {
    if (typeof timestamp !== 'string' || /[^0-9TZ:+.-]/u.test(timestamp)) throw invalid();
    const instant = parseEvidenceTimestamp(timestamp);
    if (instant === null) throw invalid();
    const local = instant + bangkokOffset;
    if (local < minimumLocal || local > maximumLocal) throw invalid();
    let seconds = local / microsecondsPerSecond;
    let fraction = local % microsecondsPerSecond;
    if (fraction < BigInt(0)) { seconds -= BigInt(1); fraction += microsecondsPerSecond; }
    const wholeSecond = new Date(Number(seconds * BigInt(1000))).toISOString().slice(0, 19);
    const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '');
    return `${wholeSecond}${fractionText ? `.${fractionText}` : ''}`;
}

/** datetime-local -> explicit +07:00, NEVER the host timezone. Empty/partial or
 * rolled-over dates throw; no current-time default or precision truncation exists.
 * Supplied fractional digits are retained (ToLocal is the canonical display form). */
export function workScheduleFromLocal(local: string): string {
    if (typeof local !== 'string' || /[^0-9T:.-]/u.test(local)
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(local)) throw invalid();
    const timestamp = `${local.length === 16 ? `${local}:00` : local}+07:00`;
    if (parseEvidenceTimestamp(timestamp) === null) throw invalid();
    return timestamp;
}
