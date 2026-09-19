import { isCentralUuid } from './centralContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { prepareSlaWorkCalendar, type RawSlaWorkCalendar, type RawSlaWorkPeriod } from './slaCalendar';

export const WORK_SCHEDULE_CONTRACT_VERSION = 'work_schedule_v1';
export const WORK_SCHEDULE_MAX_BODY_BYTES = 64 * 1024;
export const WORK_SCHEDULE_MAX_PERIODS = 400;
export const WORK_SCHEDULE_MAX_COVERAGE_DAYS = 366;

export interface WorkSchedulePeriod {
    readonly type: 'work' | 'leave' | 'break';
    readonly startsAt: string;
    readonly endsAt: string;
}
export interface WorkScheduleInput {
    readonly requestId: string;
    readonly salesUserId: string;
    readonly expectedVersion: string | null;
    readonly coverage: { readonly startsAt: string; readonly endsAt: string };
    readonly periods: readonly WorkSchedulePeriod[];
    readonly confirmedComplete: true;
    readonly reason: string;
}
export interface WorkScheduleSnapshot {
    readonly actor: { readonly userId: string; readonly role: 'admin' };
    readonly asOf: string;
    readonly sales: readonly { readonly userId: string; readonly displayName: string | null }[];
    readonly salesHasMore: boolean;
    readonly selectedSalesUserId: string | null;
    readonly calendar: null | {
        readonly raw: RawSlaWorkCalendar;
        readonly publishedAt: string;
        readonly publishedByUserId: string;
        readonly changeReason: string;
    };
}
export interface WorkScheduleResult {
    readonly calendarId: string;
    readonly version: string;
    readonly salesUserId: string;
    readonly replayed: boolean;
}

export class WorkScheduleInputError extends Error {
    readonly code = 'INVALID_INPUT';
    constructor(message = 'ข้อมูลตารางงานไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง') { super(message); this.name = 'WorkScheduleInputError'; }
}
export class WorkScheduleProjectionError extends Error {
    constructor() { super('ข้อมูลตารางงานไม่ตรงกับรูปแบบหรือ Sales ที่ร้องขอ'); this.name = 'WorkScheduleProjectionError'; }
}
const bad = (): never => { throw new WorkScheduleInputError(); };
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new WorkScheduleInputError('ข้อมูลมีฟิลด์ไม่ครบหรือมีฟิลด์ที่ไม่อนุญาต');
}
function uuid(value: unknown): string { return isCentralUuid(value) && value.length === 36 ? value.toLowerCase() : bad(); }
function nullableUuid(value: unknown): string | null { return value === null ? null : uuid(value); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : bad(); }
const minInstant = parseEvidenceTimestamp('0001-01-01T00:00:00Z')!;
const maxInstant = parseEvidenceTimestamp('9999-12-31T23:59:59.999999Z')!;
const maxCoverage = BigInt(WORK_SCHEDULE_MAX_COVERAGE_DAYS) * BigInt(86_400_000_000);
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || /[^0-9TZ:+.-]/u.test(value)) return bad();
    const instant = parseEvidenceTimestamp(value);
    return instant !== null && instant >= minInstant && instant <= maxInstant ? value : bad();
}
function instant(value: string): bigint { return parseEvidenceTimestamp(value)!; }
function reason(value: unknown): string {
    if (typeof value !== 'string' || Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029
            || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) throw new WorkScheduleInputError('เหตุผลต้องเป็นข้อความบรรทัดเดียวและใช้อักขระ Unicode ที่ถูกต้อง');
    const trimmed = value.trim();
    if (!trimmed || Array.from(trimmed).length > 1000) throw new WorkScheduleInputError('กรุณาระบุเหตุผลไม่เกิน 1,000 ตัวอักษร');
    return trimmed;
}
function coverageData(value: unknown) {
    const row = record(value);
    const startsAt = timestamp(row.startsAt), endsAt = timestamp(row.endsAt);
    const span = instant(endsAt) - instant(startsAt);
    if (span <= BigInt(0) || span > maxCoverage) throw new WorkScheduleInputError('ช่วงความครบถ้วนของตารางต้องมากกว่าศูนย์และไม่เกิน 366 วันจริง');
    return { startsAt, endsAt };
}
function periodData(value: unknown): WorkSchedulePeriod {
    const row = record(value);
    if (row.type !== 'work' && row.type !== 'leave' && row.type !== 'break') return bad();
    const startsAt = timestamp(row.startsAt), endsAt = timestamp(row.endsAt);
    if (instant(startsAt) >= instant(endsAt)) return bad();
    return { type: row.type, startsAt, endsAt };
}
function assertPrepared(raw: RawSlaWorkCalendar) {
    if (prepareSlaWorkCalendar(raw).state !== 'ready') throw new WorkScheduleInputError('ตารางไม่ครบถ้วน เวลางานทับซ้อน หรือช่วงเวลาไม่สอดคล้องกับช่วงที่รับรอง');
}

/** Shape/calendar validation only. Admin identity, active target and version are
 * resolved again by the trusted command RPC. Empty periods explicitly mean known
 * no-work coverage, never a guessed shift or a retroactive SLA recalculation.
 */
export function parseWorkScheduleInput(value: unknown): WorkScheduleInput {
    const root = record(value);
    exactKeys(root, ['requestId', 'salesUserId', 'expectedVersion', 'coverage', 'periods', 'confirmedComplete', 'reason']);
    const coverageRow = record(root.coverage); exactKeys(coverageRow, ['startsAt', 'endsAt']);
    if (root.confirmedComplete !== true || !Array.isArray(root.periods) || root.periods.length > WORK_SCHEDULE_MAX_PERIODS) return bad();
    const input: WorkScheduleInput = {
        requestId: uuid(root.requestId), salesUserId: uuid(root.salesUserId), expectedVersion: nullableUuid(root.expectedVersion),
        coverage: coverageData(coverageRow), periods: root.periods.map(value => {
            const row = record(value); exactKeys(row, ['type', 'startsAt', 'endsAt']); return periodData(row);
        }), confirmedComplete: true, reason: reason(root.reason),
    };
    // Synthetic identities exist only for pure preparation validation. They are
    // neither database row IDs nor fields forwarded to the publication command.
    assertPrepared({ id: input.requestId, version: input.requestId, ownerUserId: input.salesUserId,
        coverage: { ...input.coverage, complete: true },
        periods: input.periods.map((period, index) => ({ ...period, id: `input:${index}`, salesUserId: input.salesUserId })) });
    return input;
}

export function parseWorkScheduleQuery(url: string): string | null {
    try {
        const params = new URL(url).searchParams;
        if (Array.from(params.keys()).some(key => key !== 'salesUserId') || params.getAll('salesUserId').length > 1) return bad();
        return params.has('salesUserId') ? uuid(params.get('salesUserId')) : null;
    } catch { throw new WorkScheduleInputError('Sales ที่ร้องขอไม่ถูกต้อง'); }
}

function nullableName(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || Array.from(value).some(character => {
        const code = character.charCodeAt(0); return code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })) return bad();
    return value;
}
function rawCalendar(value: unknown): RawSlaWorkCalendar {
    const root = record(value), coverage = record(root.coverage);
    if (coverage.complete !== true || !Array.isArray(root.periods) || root.periods.length > WORK_SCHEDULE_MAX_PERIODS) return bad();
    const periods: RawSlaWorkPeriod[] = root.periods.map(value => {
        const row = record(value); return { id: uuid(row.id), salesUserId: uuid(row.salesUserId), ...periodData(row) };
    });
    const raw: RawSlaWorkCalendar = { id: uuid(root.id), version: uuid(root.version), ownerUserId: uuid(root.ownerUserId),
        coverage: { ...coverageData(coverage), complete: true }, periods };
    assertPrepared(raw);
    return raw;
}

/** Strict public projection; does not authenticate Admin claims or grant writes. */
export function parseWorkScheduleSnapshot(value: unknown, expectedSalesUserId?: string | null): WorkScheduleSnapshot {
    try {
        const root = record(value), actorRow = record(root.actor);
        if (actorRow.role !== 'admin') return bad();
        const actor = { userId: uuid(actorRow.userId), role: 'admin' as const };
        const asOf = timestamp(root.asOf);
        if (!Array.isArray(root.sales) || root.sales.length > 200) return bad();
        const seen = new Set<string>();
        const sales = root.sales.map(value => {
            const row = record(value), userId = uuid(row.userId);
            if (seen.has(userId)) return bad(); seen.add(userId);
            return { userId, displayName: nullableName(row.displayName) };
        });
        if (seen.size !== sales.length) return bad();
        const salesHasMore = bool(root.salesHasMore);
        if (salesHasMore && sales.length !== 200) return bad();
        const selectedSalesUserId = nullableUuid(root.selectedSalesUserId);
        if (expectedSalesUserId !== undefined && selectedSalesUserId !== nullableUuid(expectedSalesUserId)) return bad();
        if (selectedSalesUserId !== null && !seen.has(selectedSalesUserId)) return bad();
        let calendar: WorkScheduleSnapshot['calendar'] = null;
        if (root.calendar !== null) {
            const row = record(root.calendar);
            calendar = { raw: rawCalendar(row.raw), publishedAt: timestamp(row.publishedAt),
                publishedByUserId: uuid(row.publishedByUserId), changeReason: reason(row.changeReason) };
            if (selectedSalesUserId === null || calendar.raw.ownerUserId !== selectedSalesUserId || instant(calendar.publishedAt) > instant(asOf)) return bad();
        }
        return { actor, asOf, sales, salesHasMore, selectedSalesUserId, calendar };
    } catch { throw new WorkScheduleProjectionError(); }
}

/** Malformed success is uncertain: keep the same request key and payload. */
export function parseWorkScheduleResult(value: unknown, input: Pick<WorkScheduleInput, 'salesUserId' | 'expectedVersion'>): WorkScheduleResult {
    try {
        const intent = record(input), row = record(value);
        const expectedVersion = nullableUuid(intent.expectedVersion), salesUserId = uuid(intent.salesUserId);
        const result = { calendarId: uuid(row.calendarId), version: uuid(row.version), salesUserId: uuid(row.salesUserId), replayed: bool(row.replayed) };
        if (result.salesUserId !== salesUserId || result.version === expectedVersion) return bad();
        return result;
    } catch { throw new WorkScheduleProjectionError(); }
}
