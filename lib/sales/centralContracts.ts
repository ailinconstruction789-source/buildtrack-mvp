import type { CrmRole } from './workflow';

export type { CrmRole } from './workflow';

export const CENTRAL_CONTRACT_VERSION = 'central_intake_v1';
export const CENTRAL_SEARCH_CONTRACT_VERSION = 'central_search_v1';
export const CENTRAL_PAGE_SIZE = 50;
export const CENTRAL_MAX_BODY_BYTES = 16 * 1024;

export interface CentralInterest {
    id: string;
    projectName: string;
    ownerUserId: string;
    workspaceState: 'central_interest' | 'project_active';
    engagementStatus: string;
    plotId: string | null;
}

export interface CentralSnapshot {
    actor: { userId: string; role: CrmRole };
    projects: { name: string }[];
    salesOwners: { userId: string; displayName: string }[];
    customers: {
        id: string;
        name: string;
        /** Imported historical records may have no evidenced phone; live intake still requires one. */
        phone: string | null;
        channel: string | null;
        notes: string | null;
        ownerUserId: string;
        leadCreatedAt: string | null;
        intakeStatus: string;
        interests: CentralInterest[];
    }[];
    page: number;
    hasMore: boolean;
}

export interface CentralSearchFilters {
    search: string; project: string; channel: string; owner: string; status: string; unassignedOnly: boolean;
}
export const EMPTY_CENTRAL_SEARCH: CentralSearchFilters = {
    search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false,
};
export interface CentralSearchSnapshot extends CentralSnapshot {
    search: {
        contractVersion: typeof CENTRAL_SEARCH_CONTRACT_VERSION;
        filters: CentralSearchFilters;
        projects: string[];
        owners: CentralSnapshot['salesOwners'];
        channels: string[];
        hasMoreChannels: boolean;
    };
}

export interface CentralCreateInput {
    requestId: string;
    name: string;
    phone: string;
    channel: string;
    notes: string;
    interests: { projectName: string; plotId: string | null }[];
    assignedSalesUserId?: string;
}

export interface CentralCreateResult {
    customerId: string;
    replayed: boolean;
}

export type CentralApiEnvelope<T> = { data: T } | { error: { code: string; message: string } };

export class CentralInputError extends Error {
    readonly code = 'INVALID_INPUT';

    constructor(message = 'ข้อมูล Lead ไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่') {
        super(message);
        this.name = 'CentralInputError';
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCentralUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CentralInputError();
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
    if (Object.keys(value).some(key => !allowed.includes(key))) {
        throw new CentralInputError('มีฟิลด์ที่ระบบไม่อนุญาตให้กำหนดเอง');
    }
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
        throw new CentralInputError();
    }
    const trimmed = value.trim();
    if (!allowEmpty && !trimmed) throw new CentralInputError('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
    return trimmed;
}

/** A browser may supply intake data, never its own role, creator, owner, or status. */
export function parseCentralCreateInput(value: unknown): CentralCreateInput {
    const input = record(value);
    exactKeys(input, ['requestId', 'name', 'phone', 'channel', 'notes', 'interests', 'assignedSalesUserId']);
    if (!isCentralUuid(input.requestId)) throw new CentralInputError('รหัสคำขอบันทึกไม่ถูกต้อง กรุณาเปิดฟอร์มใหม่');
    const name = boundedText(input.name, 200);
    const phone = boundedText(input.phone, 32);
    const phoneDigits = phone.replace(/\D/g, '');
    if (!/^\+?[0-9 ()-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
        throw new CentralInputError('กรุณาระบุเบอร์โทรที่ถูกต้อง (ตัวเลข 7–15 หลัก)');
    }
    const channel = boundedText(input.channel, 80);
    const notes = boundedText(input.notes, 4000, true);
    if (!Array.isArray(input.interests) || input.interests.length > 20) throw new CentralInputError('ระบุโครงการที่สนใจได้ไม่เกิน 20 โครงการ');
    const projects = new Set<string>();
    const interests = input.interests.map(value => {
        const interest = record(value);
        exactKeys(interest, ['projectName', 'plotId']);
        const projectName = boundedText(interest.projectName, 200);
        if (projects.has(projectName)) throw new CentralInputError('มีโครงการที่สนใจซ้ำกัน');
        projects.add(projectName);
        const plotId = interest.plotId === null ? null : boundedText(interest.plotId, 255);
        return { projectName, plotId };
    });
    const result: CentralCreateInput = { requestId: input.requestId, name, phone, channel, notes, interests };
    if (Object.hasOwn(input, 'assignedSalesUserId')) {
        if (!isCentralUuid(input.assignedSalesUserId)) throw new CentralInputError('กรุณาเลือก Sales ผู้ดูแลที่ถูกต้อง');
        result.assignedSalesUserId = input.assignedSalesUserId;
    }
    return result;
}

export function parseCentralPage(url: string): number {
    const params = new URL(url).searchParams;
    if (Array.from(params.keys()).some(key => key !== 'page') || params.getAll('page').length > 1) {
        throw new CentralInputError('พารามิเตอร์รายการ Lead ไม่ถูกต้อง');
    }
    const value = params.get('page');
    if (value === null) return 0;
    if (!/^(0|[1-9]\d{0,5})$/.test(value) || Number(value) > 100000) throw new CentralInputError('เลขหน้ารายการ Lead ไม่ถูกต้อง');
    return Number(value);
}

const SEARCH_KEYS = ['search', 'project', 'channel', 'owner', 'status', 'unassignedOnly'] as const;
const SEARCH_STATUSES = ['', 'new', 'contacted', 'considering', 'follow_up', 'nurture', 'lost', 'legacy_unclassified'];
function searchText(value: unknown, maximum: number, trim = false): string {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)
        || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new CentralInputError();
    const text = trim ? value.trim() : value;
    if ([...text].length > maximum) throw new CentralInputError('คำค้นหาหรือตัวกรองยาวเกินกำหนด');
    return text;
}
export function parseCentralSearchFilters(value: unknown): CentralSearchFilters {
    const input = record(value); exactKeys(input, SEARCH_KEYS);
    const search = searchText(input.search, 200, true);
    const project = searchText(input.project, 200);
    const channel = searchText(input.channel, 80);
    const owner = searchText(input.owner, 36);
    const status = searchText(input.status, 30);
    if ((owner !== '' && !isCentralUuid(owner)) || !SEARCH_STATUSES.includes(status)
        || typeof input.unassignedOnly !== 'boolean' || (input.unassignedOnly && project)) throw new CentralInputError();
    return { search, project, channel, owner: owner.toLowerCase(), status, unassignedOnly: input.unassignedOnly };
}
export function parseCentralSearchQuery(url: string): { page: number; filters: CentralSearchFilters } {
    const params = new URL(url).searchParams;
    const keys: readonly string[] = ['page', ...SEARCH_KEYS];
    if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1)) throw new CentralInputError();
    const page = parseCentralPage(`https://local.invalid/${params.has('page') ? `?page=${encodeURIComponent(params.get('page')!)}` : ''}`);
    const unassigned = params.get('unassignedOnly');
    if (unassigned !== null && unassigned !== 'true' && unassigned !== 'false') throw new CentralInputError();
    return { page, filters: parseCentralSearchFilters({
        search: params.get('search') ?? '', project: params.get('project') ?? '', channel: params.get('channel') ?? '',
        owner: params.get('owner') ?? '', status: params.get('status') ?? '', unassignedOnly: unassigned === 'true',
    }) };
}

/** Shared strict projection. Never turn an old page-local response into a global-search result. */
export function parseCentralSearchSnapshot(value: unknown, filters: CentralSearchFilters, page: number,
    actor?: CentralSnapshot['actor']): CentralSearchSnapshot {
    const data = record(value); const identity = record(data.actor); const scope = record(data.search);
    const uuid = (value: unknown) => { if (!isCentralUuid(value)) throw new CentralInputError(); return value; };
    const text = (value: unknown) => { if (typeof value !== 'string') throw new CentralInputError(); return value; };
    const nullable = (value: unknown) => value === null ? null : text(value);
    const list = (value: unknown) => { if (!Array.isArray(value)) throw new CentralInputError(); return value; };
    const role = identity.role;
    if (!['sales', 'admin', 'owner'].includes(String(role)) || !isCentralUuid(identity.userId)
        || (actor && (actor.userId !== identity.userId || actor.role !== role))
        || data.page !== page || typeof data.hasMore !== 'boolean' || scope.contractVersion !== CENTRAL_SEARCH_CONTRACT_VERSION
        || typeof scope.hasMoreChannels !== 'boolean') throw new CentralInputError();
    const receivedFilters = parseCentralSearchFilters(scope.filters);
    if (JSON.stringify(receivedFilters) !== JSON.stringify(parseCentralSearchFilters(filters))
        || SEARCH_KEYS.some(key => record(scope.filters)[key] !== receivedFilters[key])) throw new CentralInputError();
    const owners = (value: unknown) => list(value).map(item => {
        const row = record(item); return { userId: uuid(row.userId), displayName: text(row.displayName) };
    });
    const customers = list(data.customers).map(item => {
        const row = record(item);
        return { id: uuid(row.id), name: text(row.name), phone: nullable(row.phone), channel: nullable(row.channel),
            notes: nullable(row.notes), ownerUserId: uuid(row.ownerUserId), leadCreatedAt: nullable(row.leadCreatedAt),
            intakeStatus: text(row.intakeStatus), interests: list(row.interests).map((item): CentralInterest => {
                const interest = record(item); const workspaceState = interest.workspaceState;
                if (workspaceState !== 'central_interest' && workspaceState !== 'project_active') throw new CentralInputError();
                return { id: uuid(interest.id), projectName: text(interest.projectName), ownerUserId: uuid(interest.ownerUserId),
                    workspaceState, engagementStatus: text(interest.engagementStatus), plotId: nullable(interest.plotId) };
            }) };
    });
    const channels = list(scope.channels).map(text);
    if (customers.length > CENTRAL_PAGE_SIZE || new Set(customers.map(c => c.id)).size !== customers.length
        || channels.length > 200 || new Set(channels).size !== channels.length
        || channels.some(c => !c || [...c].length > 80) || (data.hasMore && customers.length !== CENTRAL_PAGE_SIZE)) throw new CentralInputError();
    return { actor: { userId: identity.userId, role: role as CrmRole }, page, hasMore: data.hasMore, customers,
        projects: list(data.projects).map(item => ({ name: text(record(item).name) })), salesOwners: owners(data.salesOwners),
        search: { contractVersion: CENTRAL_SEARCH_CONTRACT_VERSION, filters: receivedFilters,
            projects: list(scope.projects).map(text), owners: owners(scope.owners), channels, hasMoreChannels: scope.hasMoreChannels } };
}
