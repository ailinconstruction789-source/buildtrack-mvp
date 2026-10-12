import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import HistoricalCustomerEvidence from '../HistoricalCustomerEvidence';
import type { HistoricalCustomerEvidenceApi } from '@/lib/sales/historicalCustomerEvidenceClient';
import type { HistoricalCustomerEvidenceSnapshot } from '@/lib/sales/historicalCustomerEvidenceContracts';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (sourceRow = 438) => ({ key: `source:${sourceRow}`, customerId: id(1), interestId: null, saleId: null, sourceRow,
  projectName: 'โครงการเดิม', projectNames: ['โครงการเดิม'], events: [{ kind: 'visited' as const, date: '2025-02-22', precision: 'day' as const }] });
const snapshot = (overrides: Partial<HistoricalCustomerEvidenceSnapshot> = {}): HistoricalCustomerEvidenceSnapshot => ({
  contractVersion: 'historical_customer_evidence_v1', actor: { userId: id(2), role: 'sales' },
  customerId: id(1), interestId: null, saleId: null, page: 0, hasMore: false, readOnly: true, records: [record()], ...overrides,
});
const makeApi = () => ({ read: vi.fn<HistoricalCustomerEvidenceApi['read']>().mockResolvedValue(snapshot()),
  watchIdentity: vi.fn<NonNullable<HistoricalCustomerEvidenceApi['watchIdentity']>>().mockReturnValue(vi.fn()) });
const mount = (api: HistoricalCustomerEvidenceApi) => render(<HistoricalCustomerEvidence customerId={id(1)} expectedActorId={id(2)} api={api} />);
const open = () => fireEvent.click(screen.getByRole('button', { name: 'ดูประวัติเดิม' }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('read-only imported customer evidence', () => {
  it('reads only after click and exposes no write or appointment controls', async () => {
    const api = makeApi(); mount(api); expect(api.read).not.toHaveBeenCalled(); open();
    expect(await screen.findByText('22/02/2568')).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledWith({ customerId: id(1), interestId: null, saleId: null, page: 0 }, { signal: expect.any(AbortSignal) });
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /บันทึก|จอง|นัดหมาย/ })).not.toBeInTheDocument();
  });
  it('shows unknown project and date explicitly without inventing a day or time', async () => {
    const api = makeApi(); api.read.mockResolvedValue(snapshot({ records: [{ ...record(), projectName: null, projectNames: [],
      events: [{ kind: 'visited', date: null, precision: 'unknown' }] }] })); mount(api); open();
    expect(await screen.findByText('โครงการ: ไม่ทราบ')).toBeInTheDocument(); expect(screen.getByText('ไม่ทราบ', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByText('ไม่ทราบเวลา')).not.toBeInTheDocument();
  });
  it('keeps two source visits distinct even when they have the same project and day', async () => {
    const api = makeApi(); api.read.mockResolvedValue(snapshot({ records: [record(438), record(439)] })); mount(api); open();
    await screen.findByRole('article', { name: 'ประวัติแถว 438' }); expect(screen.getAllByText('22/02/2568')).toHaveLength(2);
    expect(screen.getByRole('article', { name: 'ประวัติแถว 439' })).toBeInTheDocument();
  });
  it('shows known multiple projects on one source record instead of calling them unknown', async () => {
    const api=makeApi();api.read.mockResolvedValue(snapshot({records:[{...record(),projectName:null,projectNames:['โครงการ A','โครงการ B']}]}));mount(api);open();
    expect(await screen.findByText('โครงการ: โครงการ A / โครงการ B')).toBeInTheDocument();expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByText('โครงการ: ไม่ทราบ')).not.toBeInTheDocument();
  });
  it('rejects duplicate lineage keys instead of rendering duplicate source evidence', async () => {
    const api = makeApi(); api.read.mockResolvedValue(snapshot({ records: [record(), record()] })); mount(api); open();
    expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลประวัติไม่ตรง'); expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it.each(['actor', 'customer', 'interest', 'sale', 'page', 'recordCustomer', 'writable'] as const)('rejects a response with mismatched %s', async field => {
    const api = makeApi(), data = snapshot();
    if (field === 'actor') data.actor.userId = id(99);
    if (field === 'customer') data.customerId = id(99);
    if (field === 'interest') data.interestId = id(99);
    if (field === 'sale') data.saleId = id(99);
    if (field === 'page') data.page = 1;
    if (field === 'recordCustomer') data.records[0].customerId = id(99);
    if (field === 'writable') Object.assign(data, { readOnly: false });
    api.read.mockResolvedValue(data); mount(api); open(); await screen.findByRole('alert');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('uses manual page loads and hides the old page while a different page is loading', async () => {
    const api = makeApi(); let finish!: (value: HistoricalCustomerEvidenceSnapshot) => void;
    api.read.mockResolvedValueOnce(snapshot({ hasMore: true })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount(api); open(); await screen.findByRole('article'); expect(api.read).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'ประวัติถัดไป' })); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(api.read).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }), expect.anything());
    await act(async () => finish(snapshot({ page: 1, records: [record(439)] })));
    expect(screen.getByRole('article', { name: 'ประวัติแถว 439' })).toBeInTheDocument(); expect(api.read).toHaveBeenCalledTimes(2);
  });
  it('retains a same-scope snapshot if refresh fails and retries without writing', async () => {
    const api = makeApi(); api.read.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue(snapshot());
    mount(api); open(); await screen.findByRole('article'); fireEvent.click(screen.getByRole('button', { name: 'อ่านประวัติล่าสุด' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('network unavailable'); expect(screen.getByRole('article')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอ่านประวัติอีกครั้ง' })); await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(api.read).toHaveBeenCalledTimes(3);
  });
  it('clears the old snapshot if refreshed scope is invalid', async () => {
    const api = makeApi(); api.read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ customerId: id(99) }));
    mount(api); open(); await screen.findByRole('article'); fireEvent.click(screen.getByRole('button', { name: 'อ่านประวัติล่าสุด' }));
    await screen.findByRole('alert'); expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('aborts and ignores a late result after customer scope changes without an automatic read', async () => {
    const api = makeApi(); let finish!: (value: HistoricalCustomerEvidenceSnapshot) => void;
    api.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = mount(api); open();
    const signal = api.read.mock.calls[0][1]!.signal!;
    view.rerender(<HistoricalCustomerEvidence customerId={id(3)} expectedActorId={id(2)} api={api} />);
    expect(signal.aborted).toBe(true); expect(screen.getByRole('button', { name: 'ดูประวัติเดิม' })).toBeInTheDocument();
    await act(async () => finish(snapshot())); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(api.read).toHaveBeenCalledOnce();
  });
  it('hides loaded data synchronously on actor/sale scope changes', async () => {
    const api = makeApi(), view = mount(api); open(); await screen.findByRole('article');
    view.rerender(<HistoricalCustomerEvidence customerId={id(1)} expectedActorId={id(9)} saleId={id(10)} api={api} />);
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'ดูประวัติเดิม' })).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledOnce();
  });
  it('hides account data and discards an in-flight refresh on identity change', async () => {
    const api = makeApi(); let changed!: (actor: string | null) => void, finish!: (value: HistoricalCustomerEvidenceSnapshot) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); });
    api.read.mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount(api); open(); await screen.findByRole('article'); fireEvent.click(screen.getByRole('button', { name: 'อ่านประวัติล่าสุด' }));
    act(() => changed(id(99))); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await act(async () => finish(snapshot())); expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(api.read).toHaveBeenCalledTimes(2);
  });
  it('ignores same-account identity notifications and prevents duplicate clicks', async () => {
    const api = makeApi(); let changed!: (actor: string | null) => void, finish!: (value: HistoricalCustomerEvidenceSnapshot) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); });
    api.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); mount(api); open();
    act(() => changed(id(2))); fireEvent.click(screen.getByRole('button', { name: 'อ่านประวัติล่าสุด' })); expect(api.read).toHaveBeenCalledOnce();
    await act(async () => finish(snapshot())); expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
