import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, onAuthStateChange, unsubscribe, getUser, rpc, from, createClient } = vi.hoisted(() => {
    const getSession = vi.fn(), onAuthStateChange = vi.fn(), unsubscribe = vi.fn(), getUser = vi.fn(), rpc = vi.fn();
    const from = vi.fn(() => { throw new Error('Direct table access forbidden in transport integration'); });
    return { getSession, onAuthStateChange, unsubscribe, getUser, rpc, from,
        createClient: vi.fn(() => ({ auth: { getUser }, rpc, from })) };
});
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange } } }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import SlaProcessingView from '../SlaProcessingView';
import { slaReceiptApi } from '@/lib/sales/slaReceiptClient';
import { slaProcessingApi } from '@/lib/sales/slaProcessingClient';
import { handleSlaReceiptGet } from '@/lib/sales/slaReceiptServer';
import { handleSlaProcessingPost } from '@/lib/sales/slaProcessingServer';
import { parseSlaPreviewSnapshot } from '@/lib/sales/slaPreviewContracts';
import { parseSlaProcessingInput, parseSlaProcessingResult, type SlaProcessingResult } from '@/lib/sales/slaProcessingContracts';
import { readSlaProcessingPending, slaProcessingPendingKey } from '@/lib/sales/slaProcessingPending';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1), OTHER_ADMIN = id(2), TASK = id(3), REQUEST = id(4), CUSTOMER = id(5), SALES = id(6);
const INPUT = { requestId: REQUEST, taskId: TASK }, AT = '2026-09-17T02:45:00.123456Z';
const CUSTOMER_NAME = 'Synthetic transport lead';
const FLAGS = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED',
    'SALES_CRM_SCHEDULE_ENABLED', 'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED', 'SALES_CRM_SLA_PROCESSING_ENABLED'];
const PROCESS = 'crm_v2_process_first_contact', LOOKUP = 'crm_v2_first_contact_receipt';

/** This is UI/HTTP transport integration, NOT a database test. The isolated fake
 * RPC ledger supplies already validated, synthetic receipts only. It does not
 * implement SQL locks, RLS, calendars, notification delivery or a real commit.
 * No network call can escape the two explicitly routed in-memory endpoints. */
function preview() {
    return parseSlaPreviewSnapshot({ actor: { userId: ADMIN, role: 'admin' }, asOf: AT,
        page: 0, pageSize: 20, hasMore: false, mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17', dueSoonMinutes: 30,
        rows: [{ taskId: TASK, customerId: CUSTOMER, customerName: CUSTOMER_NAME, ownerUserId: SALES, ownerName: 'Synthetic Sales',
            serviceDueAt: '2026-09-18T02:45:00.123456Z', state: 'held', reason: 'MISSING_CALENDAR', staffDueAt: null,
            notifyAt: null, rule: null, calendarVersion: null, notificationType: null }],
    }, 0, ADMIN);
}
function historicalReceipt(): SlaProcessingResult {
    return parseSlaProcessingResult({ actor: { userId: ADMIN, role: 'admin' }, ...INPUT, processedAt: AT,
        replayed: false, outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: '2026-09-18T02:45:00.123456Z',
        staffDueAt: null, notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null, withdrawnCount: 0,
    }, INPUT, ADMIN);
}

const ledger = new Map<string, SlaProcessingResult>();
const requestLog: Array<{ method: string; path: string; body: unknown }> = [];
const fetchRouter = vi.fn();
let dropPostResponse = false, hideReceiptSnapshot = false;
const postRequests = () => requestLog.filter(request => request.method === 'POST');
const lookupRequests = () => requestLog.filter(request => request.method === 'GET' && request.path.includes('?'));

beforeEach(() => {
    vi.clearAllMocks(); sessionStorage.clear(); ledger.clear(); requestLog.length = 0;
    dropPostResponse = false; hideReceiptSnapshot = false;
    FLAGS.forEach(flag => vi.stubEnv(flag, 'true'));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic-supabase.invalid');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-public-anon');
    getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token', user: { id: ADMIN } } }, error: null });
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: null });
    rpc.mockImplementation(async (name: string, args?: { p_request?: unknown }) => {
        if (name === 'crm_v2_role') return { data: 'admin', error: null };
        if (name === 'crm_v2_sla_receipt_capabilities') return { data: {
            contract_version: 'first_contact_receipt_review_v1', enabled: true, processing_enabled: true,
        }, error: null };
        if (name === 'crm_v2_sla_processing_capabilities') return { data: { contract_version: 'first_contact_processing_v1', enabled: true }, error: null };
        if (name === PROCESS) {
            const command = parseSlaProcessingInput(args?.p_request);
            expect(command).toEqual(INPUT);
            // The real queue must be persisted before the real HTTP handler reaches the fake processor.
            expect(readSlaProcessingPending(ADMIN)).toEqual(command);
            const result = historicalReceipt(); ledger.set(command.requestId, result);
            return { data: result, error: null };
        }
        if (name === LOOKUP) {
            const command = parseSlaProcessingInput(args?.p_request), stored = ledger.get(command.requestId);
            const receipt = !hideReceiptSnapshot && stored?.taskId === command.taskId ? stored : null;
            return { data: { actor: { userId: ADMIN, role: 'admin' }, ...command, found: receipt !== null, receipt }, error: null };
        }
        throw new Error(`Unexpected synthetic RPC: ${name}`);
    });
    fetchRouter.mockImplementation(async (input: string, init?: RequestInit) => {
        // The real clients use only these relative paths. Absolute/external URLs are never delegated to fetch.
        if (typeof input !== 'string' || !input.startsWith('/api/sales-crm/')) throw new Error('External fetch blocked');
        const request = new Request(`https://synthetic-app.invalid${input}`, init);
        const path = new URL(request.url).pathname;
        const body = request.method === 'POST' ? await request.clone().json() : null;
        requestLog.push({ method: request.method, path: input, body });
        if (request.method === 'GET' && path === '/api/sales-crm/sla-receipts') return handleSlaReceiptGet(request);
        if (request.method === 'POST' && path === '/api/sales-crm/sla-process') {
            const response = await handleSlaProcessingPost(request);
            if (dropPostResponse && response.status === 200) throw new Error('Synthetic response loss after fake ledger commit');
            return response;
        }
        throw new Error('Unrouted in-memory request');
    });
    vi.stubGlobal('fetch', fetchRouter);
});
afterEach(() => {
    cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    expect(from).not.toHaveBeenCalled();
    expect(requestLog.every(request => request.method === 'GET' || (request.method === 'POST' && request.path === '/api/sales-crm/sla-process'))).toBe(true);
});

async function mount() {
    const newRequestId = vi.fn(() => REQUEST), previewApi = { read: vi.fn().mockResolvedValue(preview()) };
    render(<SlaProcessingView receiptApi={slaReceiptApi} processingApi={slaProcessingApi} previewApi={previewApi} newRequestId={newRequestId} />);
    const select = await screen.findByRole('button', { name: `ทบทวนงานของ ${CUSTOMER_NAME}` });
    await waitFor(() => expect(select).toBeEnabled());
    expect(postRequests()).toHaveLength(0); expect(newRequestId).not.toHaveBeenCalled();
    return { newRequestId, previewApi, select };
}
function explicitlyConfirm(select: HTMLElement) {
    fireEvent.click(select);
    const confirm = screen.getByRole('button', { name: 'ยืนยันประมวลผลหนึ่งงาน' });
    expect(confirm).toBeDisabled(); expect(postRequests()).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'ฉันตรวจรหัสงานและเข้าใจผลของการประมวลผลนี้แล้ว' }));
    expect(confirm).toBeEnabled(); expect(postRequests()).toHaveLength(0); fireEvent.click(confirm);
}
async function waitForLostResponse() {
    await screen.findByRole('alert');
    expect(await screen.findByRole('region', { name: 'คำขอค้างในแท็บ' })).toBeInTheDocument();
    expect(readSlaProcessingPending(ADMIN)).toEqual(INPUT); expect(ledger.get(REQUEST)).toEqual(historicalReceipt());
    expect(postRequests()).toEqual([{ method: 'POST', path: '/api/sales-crm/sla-process', body: INPUT }]);
}

describe('real UI → clients → HTTP handlers with isolated fake RPC transport', () => {
    it('requires selection, checkbox and explicit confirmation before one minimal POST and receipt', async () => {
        const { select, newRequestId } = await mount();
        fireEvent.click(select); expect(newRequestId).not.toHaveBeenCalled(); expect(postRequests()).toHaveLength(0);
        const confirm = screen.getByRole('button', { name: 'ยืนยันประมวลผลหนึ่งงาน' }); expect(confirm).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox')); expect(postRequests()).toHaveLength(0); expect(newRequestId).not.toHaveBeenCalled();
        fireEvent.click(confirm);
        await screen.findByRole('region', { name: 'ใบรับการประมวลผล' });
        expect(screen.getByText('ได้รับใบรับคำสั่งแล้ว')).toBeInTheDocument();
        expect(postRequests()).toEqual([{ method: 'POST', path: '/api/sales-crm/sla-process', body: INPUT }]);
        expect(rpc.mock.calls.filter(([name]) => name === PROCESS)).toEqual([[PROCESS, { p_request: INPUT }]]);
        expect(newRequestId).toHaveBeenCalledTimes(1); expect(readSlaProcessingPending(ADMIN)).toBeNull();
        expect(getUser).toHaveBeenCalledWith('synthetic-token');
        expect(createClient).toHaveBeenCalledWith('https://synthetic-supabase.invalid', 'synthetic-public-anon', expect.objectContaining({
            global: { headers: { Authorization: 'Bearer synthetic-token' } },
        }));
        expect(lookupRequests()).toHaveLength(0);
    });
    it('recovers a lost POST response by GET receipt and clears only the matching queue without another POST', async () => {
        dropPostResponse = true;
        const otherPending = JSON.stringify({ version: 1, actorId: OTHER_ADMIN, uncertain: true, input: { requestId: id(20), taskId: id(21) } });
        sessionStorage.setItem(slaProcessingPendingKey(OTHER_ADMIN), otherPending);
        const { select, newRequestId } = await mount(); explicitlyConfirm(select); await waitForLostResponse();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        await screen.findByText('พบใบรับเดิมจากการอ่านเท่านั้น');
        expect(readSlaProcessingPending(ADMIN)).toBeNull();
        expect(sessionStorage.getItem(slaProcessingPendingKey(OTHER_ADMIN))).toBe(otherPending);
        expect(screen.queryByRole('region', { name: 'คำขอค้างในแท็บ' })).not.toBeInTheDocument();
        expect(lookupRequests()).toEqual([{ method: 'GET', path: `/api/sales-crm/sla-receipts?requestId=${REQUEST}&taskId=${TASK}`, body: null }]);
        expect(postRequests()).toHaveLength(1); expect(newRequestId).toHaveBeenCalledTimes(1);
        expect(rpc.mock.calls.filter(([name]) => name === PROCESS)).toHaveLength(1);
    });
    it('keeps uncertainty and blocks new UUIDs when the read snapshot reports not found', async () => {
        dropPostResponse = true; hideReceiptSnapshot = true;
        const { select, newRequestId } = await mount(); explicitlyConfirm(select); await waitForLostResponse();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        await screen.findByText(/ยังไม่พบใบรับที่ตรงคำขอ/);
        expect(readSlaProcessingPending(ADMIN)).toEqual(INPUT);
        expect(screen.queryByRole('region', { name: 'ใบรับการประมวลผล' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'โหลดงานล่าสุด' }));
        const blocked = await screen.findByRole('button', { name: `ทบทวนงานของ ${CUSTOMER_NAME}` });
        await waitFor(() => expect(screen.getByRole('button', { name: 'โหลดงานล่าสุด' })).toBeEnabled());
        expect(blocked).toBeDisabled(); fireEvent.click(blocked);
        expect(screen.queryByRole('region', { name: 'ยืนยันการประมวลผล' })).not.toBeInTheDocument();
        expect(newRequestId).toHaveBeenCalledTimes(1); expect(postRequests()).toHaveLength(1);
        expect(readSlaProcessingPending(ADMIN)).toEqual(INPUT); expect(lookupRequests()).toHaveLength(1);
    });
    it('keeps receipt GET recovery available with the seventh processing switch off', async () => {
        dropPostResponse = true;
        const { select, newRequestId } = await mount(); explicitlyConfirm(select); await waitForLostResponse();
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'โหลดงานล่าสุด' }));
        await screen.findByText('ปิดการประมวลผลอยู่ — ตรวจใบรับเดิมได้ แต่ส่งหรือลองคำสั่งซ้ำไม่ได้');
        await waitFor(() => expect(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' })).toBeEnabled());
        expect(screen.getByRole('button', { name: 'ทบทวนการลองคำขอเดิม' })).toBeDisabled();
        expect(screen.getByRole('button', { name: `ทบทวนงานของ ${CUSTOMER_NAME}` })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        await screen.findByText('พบใบรับเดิมจากการอ่านเท่านั้น');
        expect(readSlaProcessingPending(ADMIN)).toBeNull(); expect(postRequests()).toHaveLength(1);
        expect(newRequestId).toHaveBeenCalledTimes(1); expect(lookupRequests()).toHaveLength(1);
        expect(rpc.mock.calls.filter(([name]) => name === PROCESS)).toHaveLength(1);
    });
});
