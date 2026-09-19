import type { CrmRole } from './workflow';

export type { CrmRole } from './workflow';

export const CENTRAL_CONTRACT_VERSION = 'central_intake_v1';
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
