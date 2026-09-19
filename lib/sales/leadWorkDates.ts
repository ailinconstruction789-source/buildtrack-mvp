import { parseEvidenceTimestamp } from './leadEvidence';

/** datetime-local is a Bangkok wall-clock input, NEVER the machine timezone. */
export function bangkokInputTimestamp(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(value) || /\s/u.test(value)) {
        throw new Error('กรุณาระบุวันเวลาให้ครบ ตามเวลากรุงเทพฯ (UTC+07:00)');
    }
    const timestamp = `${value.length === 16 ? `${value}:00` : value}+07:00`;
    if (parseEvidenceTimestamp(timestamp) === null) throw new Error('วันเวลาไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
    return timestamp;
}

export function bangkokTimestampInput(value: string): string {
    const instant = parseEvidenceTimestamp(value);
    if (instant === null) return '';
    // Display only. The original pending payload, including microseconds, is never changed.
    return new Date(Number(instant / BigInt(1000)) + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

export function displayBangkokTime(value: string | null): string {
    if (!value || parseEvidenceTimestamp(value) === null) return 'ไม่ทราบเวลา';
    return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
}

export function isLeadWorkOverdue(dueAt: string, asOf: string): boolean {
    const due = parseEvidenceTimestamp(dueAt), clock = parseEvidenceTimestamp(asOf);
    return due !== null && clock !== null && due < clock;
}
