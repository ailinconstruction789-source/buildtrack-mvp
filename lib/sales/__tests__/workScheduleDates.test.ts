import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEvidenceTimestamp } from '../leadEvidence';
import { workScheduleFromLocal, workScheduleToLocal } from '../workScheduleDates';

afterEach(() => vi.unstubAllEnvs());

describe('fixed Bangkok work schedule timestamps', () => {
    it.each([
        ['2026-09-01T02:03:04Z', '2026-09-01T09:03:04'],
        ['2026-09-01T09:03:04+07:00', '2026-09-01T09:03:04'],
        ['2026-09-01T10:03:04+08:00', '2026-09-01T09:03:04'],
        ['2026-08-31T21:03:04-05:00', '2026-09-01T09:03:04'],
        ['2025-12-31T20:30:00Z', '2026-01-01T03:30:00'],
        ['2024-02-29T20:00:00Z', '2024-03-01T03:00:00'],
        ['2026-09-01T09:03:04.000001+07:00', '2026-09-01T09:03:04.000001'],
        ['2026-09-01T09:03:04.123456+07:00', '2026-09-01T09:03:04.123456'],
        ['2026-09-01T09:03:04.120000+07:00', '2026-09-01T09:03:04.12'],
        ['2026-09-01T09:03:04.000000+07:00', '2026-09-01T09:03:04'],
        ['1969-12-31T16:59:59.999999Z', '1969-12-31T23:59:59.999999'],
        ['1969-12-31T16:59:59.000001Z', '1969-12-31T23:59:59.000001'],
        ['0001-01-01T00:00:00+07:00', '0001-01-01T00:00:00'],
        ['9999-12-31T23:59:59.999999+07:00', '9999-12-31T23:59:59.999999'],
    ])('converts %s to exact local value %s and preserves its instant on round-trip', (zoned, expected) => {
        expect(workScheduleToLocal(zoned)).toBe(expected);
        expect(parseEvidenceTimestamp(workScheduleFromLocal(expected))).toBe(parseEvidenceTimestamp(zoned));
    });
    it.each([
        ['2026-09-01T09:30', '2026-09-01T09:30:00+07:00'],
        ['2026-09-01T09:30:00', '2026-09-01T09:30:00+07:00'],
        ['2026-09-01T09:30:01.1', '2026-09-01T09:30:01.1+07:00'],
        ['2026-09-01T09:30:01.120000', '2026-09-01T09:30:01.120000+07:00'],
        ['2026-09-01T09:30:01.000001', '2026-09-01T09:30:01.000001+07:00'],
        ['2024-02-29T09:30', '2024-02-29T09:30:00+07:00'],
    ])('binds local %s to explicit Bangkok offset without truncation', (local, expected) => {
        expect(workScheduleFromLocal(local)).toBe(expected);
    });
    it.each(['America/Los_Angeles', 'UTC', 'Asia/Tokyo'])('does not depend on machine timezone %s', zone => {
        vi.stubEnv('TZ', zone);
        expect(workScheduleFromLocal('2026-09-01T09:30:00.123456')).toBe('2026-09-01T09:30:00.123456+07:00');
        expect(workScheduleToLocal('2026-09-01T02:30:00.123456Z')).toBe('2026-09-01T09:30:00.123456');
    });
    it.each(['', ' ', null, undefined, 123, '2026-09-01', '2026-09-01T09:30Z', '2026-09-01T09:30+07:00',
        '2026-09-01 09:30', '2026-09-01T09:30\n', '2026-09-01T09:30\u2028', '2026-09-01T09:30 ',
        '2026-09-01T09:30.123', '2026-09-01T09:30:00.', '2026-09-01T09:30:00.1234567',
        '0000-01-01T09:30', '10000-01-01T09:30', '001-01-01T09:30', '2026-9-01T09:30',
        '2026-02-29T09:30', '1900-02-29T09:30', '2026-04-31T09:30', '2026-13-01T09:30', '2026-00-01T09:30',
        '2026-09-00T09:30', '2026-09-01T24:00', '2026-09-01T09:60', '2026-09-01T09:30:60',
    ])('rejects empty, invalid or non-local date %j without guessing', value => {
        expect(() => workScheduleFromLocal(value as string)).toThrow(/วันเวลาจัดเวรไม่ถูกต้อง/);
    });
    it.each(['', null, undefined, 123, '2026-09-01T09:30:00', '2026-09-01T09:30:00-00:00',
        '2026-09-01T09:30:00Z\n', '2026-09-01T09:30:00Z\u2029', '2026-09-01T09:30:00Z ',
        '2026-02-29T09:30:00Z', '2026-09-01T09:30:00.1234567Z', '0000-01-01T00:00:00Z',
        '2026-09-01T24:00:00Z', '2026-09-01T09:30:60Z', '2026-09-01T09:30:00+24:00',
        '9999-12-31T18:00:00Z', '0001-01-01T00:00:00+08:00',
    ])('rejects invalid zoned inputs or local values outside four-digit years: %j', value => {
        expect(() => workScheduleToLocal(value as string)).toThrow(/วันเวลาจัดเวรไม่ถูกต้อง/);
    });
});
