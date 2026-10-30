import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RentalActionModal from '../RentalActionModal';
import type { Lead } from '@/types/sales';

type Row = Record<string, unknown> & { id: string };
type Result = { data: Row | Row[] | null; error: { message: string } | null; count?: number | null };
type Query = {
  table: string;
  action: 'read' | 'update' | 'insert';
  filters: { kind: 'eq' | 'neq' | 'in'; key: string; value: unknown }[];
  payload?: Record<string, unknown> | Record<string, unknown>[];
  columns?: string;
  single: boolean;
};

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

let database: Record<string, Row[]>;
let mutations: Query[];
let beforeRead: ((query: Query) => Result | void) | undefined;
let beforeWrite: ((query: Query) => Result | void) | undefined;
let afterWrite: ((query: Query) => Result | void) | undefined;

function matches(row: Row, query: Query) {
  return query.filters.every(({ kind, key, value }) => {
    if (kind === 'neq') return row[key] !== value;
    if (kind === 'in') return Array.isArray(value) && value.includes(row[key]);
    return (row[key] ?? null) === (value ?? null);
  });
}

function builder(table: string) {
  const query: Query = { table, action: 'read', filters: [], single: false };
  const api = {
    select(columns: string) { query.columns = columns; return api; },
    eq(key: string, value: unknown) { query.filters.push({ kind: 'eq', key, value }); return api; },
    is(key: string, value: unknown) { return api.eq(key, value); },
    neq(key: string, value: unknown) { query.filters.push({ kind: 'neq', key, value }); return api; },
    in(key: string, value: unknown[]) { query.filters.push({ kind: 'in', key, value }); return api; },
    order() { return api; },
    limit() { return api; },
    single() { query.single = true; return api; },
    maybeSingle() { query.single = true; return api; },
    update(payload: Record<string, unknown>) { query.action = 'update'; query.payload = payload; return api; },
    insert(payload: Record<string, unknown>[]) { query.action = 'insert'; query.payload = payload; return api; },
    then(resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve().then((): Result => {
        if (query.action === 'read') {
          const overridden = beforeRead?.(query);
          if (overridden) return overridden;
          const rows = database[table].filter(row => matches(row, query)).map(row => {
            const snapshot = structuredClone(row);
            if (!query.columns || query.columns === '*') return snapshot;
            return Object.fromEntries(query.columns.split(',').map(key => key.trim())
              .filter(key => key in snapshot).map(key => [key, snapshot[key]])) as Row;
          });
          return { data: query.single ? rows[0] ?? null : rows, error: null };
        }
        const overridden = beforeWrite?.(query);
        mutations.push(structuredClone(query));
        if (overridden) return overridden;
        let rows: Row[];
        if (query.action === 'insert') {
          rows = (query.payload as Record<string, unknown>[]).map(payload => ({
            id: `generated-${mutations.length}`, ...payload,
            updated_at: new Date(Date.parse(String(payload.created_at)) + 25).toISOString()
          }));
          database[table].push(...rows);
        } else {
          rows = database[table].filter(row => matches(row, query));
          rows.forEach(row => Object.assign(row, query.payload));
        }
        const response = afterWrite?.(query);
        return response ?? { data: query.single ? rows[0] ? { id: rows[0].id } : null : rows.map(row => ({ id: row.id })), error: null, count: rows.length };
      }).then(resolve, reject);
    }
  };
  return api;
}

const lostResponse: Result = { data: null, error: { message: 'Response lost after commit' } };
const salesWrites = () => mutations.filter(query => query.table === 'sales');
const isCancelledRead = (query: Query) => query.table === 'sales'
  && query.filters.some(filter => filter.key === 'contract_status' && filter.kind === 'eq' && filter.value === 'Cancelled');
const offsetTime = (value: unknown) => new Date(Date.parse(String(value)) + 7 * 60 * 60 * 1000).toISOString().replace('Z', '+07:00');

async function openModal() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<RentalActionModal isOpen contractId="contract-1" lead={database.leads[0] as unknown as Lead}
    user={{ username: 'Sales A', role: 'Sales' }} onSaved={onSaved} onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
  return { onSaved, onClose };
}

async function save() {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' }).closest('form')!);
  });
}

function existingSale() {
  database.sales.push({ id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved',
    crm_stage: 'booked', sale_price: 1800000, booked_at: '2026-01-01T12:00:00+00:00', updated_at: '2026-01-01T00:00:00.123456+00:00' });
}

describe('Rental sale recovery with database timestamp semantics', () => {
  beforeEach(() => {
    mutations = [];
    beforeRead = undefined;
    beforeWrite = undefined;
    afterWrite = undefined;
    database = {
      rental_contracts: [{ id: 'contract-1', lead_id: 'lead-1', plot_id: 'plot-1', plot_name: '1',
        project_name: 'Project', tenant_name: 'Alice', program_type: 'program_a', status: 'Active',
        monthly_rent: 15000, security_deposit: 30000, advance_rent: 15000, lease_duration_months: 12,
        lease_start_date: '2026-01-01', lease_end_date: '2027-01-01', created_at: '2026-01-01',
        base_price: 2000000, notes: 'Contract note' }],
      leads: [{ id: 'lead-1', customer_name: 'Alice', status: 'Rented', rental_status: 'Active',
        active_rental_contract_id: 'contract-1', notes: 'Lead note' }],
      plots: [{ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Alice',
        customer_name: 'Alice', monthly_rent: 15000, lease_end_date: '2027-01-01' }],
      sales: []
    };
    mocks.from.mockImplementation(builder);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses a cryptographic UUID fallback before any conversion writes', async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      expect(mutations).toHaveLength(0);
      bytes.fill(255);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const { onSaved, onClose } = await openModal();
    await save();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(database.sales[0]?.id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(database.rental_contracts[0].status).toBe('ConvertedToBuy');
    expect(database.leads[0].status).toBe('Booked');
    expect(database.plots[0].sale_status).toBe('Reserved');
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'throwing', 'missing-crypto', 'native-throwing'] as const)(
    'does not mutate any records when UUID generation is %s, and permits retry', async failure => {
      const originalCrypto = globalThis.crypto;
      vi.stubGlobal('crypto', failure === 'missing-crypto' ? undefined : failure === 'throwing'
        ? { getRandomValues: () => { throw new Error('Random source unavailable'); } }
        : failure === 'native-throwing'
          ? { randomUUID: () => { throw new Error('Random source unavailable'); } }
          : {});
      const initialDatabase = structuredClone(database);
      const { onSaved, onClose } = await openModal();
      await save();
      expect(mutations).toHaveLength(0);
      expect(database).toEqual(initialDatabase);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText(/สร้างรหัสรายการขาย|Random source unavailable/)).toBeInTheDocument();
      vi.stubGlobal('crypto', originalCrypto);
      await save();
      expect(onSaved).toHaveBeenCalledOnce();
      expect(database.sales).toHaveLength(1);
    }
  );

  it('does not require a UUID generator when updating an existing sale', async () => {
    existingSale();
    vi.stubGlobal('crypto', undefined);
    const { onSaved } = await openModal();
    await save();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(database.sales).toHaveLength(1);
    expect(database.sales[0].id).toBe('sale-1');
    expect(salesWrites()[0].action).toBe('update');
  });

  it('keeps the prepared UUID when a preceding conversion step needs retry', async () => {
    const randomUUID = vi.fn(() => '12345678-1234-4234-8234-123456789abc');
    vi.stubGlobal('crypto', { randomUUID });
    const { onSaved } = await openModal();
    beforeWrite = query => query.table === 'plots' ? lostResponse : undefined;
    await save();
    expect(database.rental_contracts[0].status).toBe('ConvertedToBuy');
    expect(database.sales).toHaveLength(0);
    expect(randomUUID).toHaveBeenCalledOnce();
    beforeWrite = undefined;
    vi.stubGlobal('crypto', undefined);
    await save();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(database.sales[0].id).toBe('12345678-1234-4234-8234-123456789abc');
  });

  it.each([false, true])('reconciles a committed insert with server timestamps (UUID fallback: %s)', async fallback => {
    if (fallback) vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const { onSaved } = await openModal();
    afterWrite = query => {
      if (query.table !== 'sales') return;
      database.sales[0].created_at = offsetTime(database.sales[0].created_at);
      database.sales[0].booked_at = offsetTime(database.sales[0].booked_at);
      return lostResponse;
    };
    await save();
    expect(onSaved).not.toHaveBeenCalled();
    expect(database.sales[0].updated_at).not.toBe(database.sales[0].created_at);
    afterWrite = undefined;
    await save();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(salesWrites()).toHaveLength(1);
    expect(database.sales).toHaveLength(1);
  });

  it('reconciles an update with server-trigger updated_at and offset-formatted booked_at', async () => {
    existingSale();
    const { onSaved } = await openModal();
    afterWrite = query => {
      if (query.table !== 'sales') return;
      database.sales[0].booked_at = offsetTime(database.sales[0].booked_at);
      database.sales[0].updated_at = new Date(Date.parse(String(database.sales[0].updated_at)) + 25).toISOString();
      return lostResponse;
    };
    await save();
    afterWrite = undefined;
    await save();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(salesWrites()).toHaveLength(1);
  });

  it('does not recreate a cancelled committed insert when its timestamp representation changes', async () => {
    const { onSaved, onClose } = await openModal();
    afterWrite = query => query.table === 'sales' ? lostResponse : undefined;
    await save();
    afterWrite = undefined;
    database.sales[0].contract_status = 'Cancelled';
    database.sales[0].created_at = offsetTime(database.sales[0].created_at);
    await save();
    expect(salesWrites()).toHaveLength(1);
    expect(database.sales).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/รายการขายถูกยกเลิก/)).toBeInTheDocument();
  });

  it.each(['result', 'exception'] as const)('fails closed on cancelled-sale read %s and safely retries the read', async failure => {
    const { onSaved, onClose } = await openModal();
    afterWrite = query => query.table === 'sales' ? lostResponse : undefined;
    await save();
    afterWrite = undefined;
    database.sales[0].contract_status = 'Cancelled';
    beforeRead = query => {
      if (!isCancelledRead(query)) return;
      if (failure === 'exception') throw new Error('Cancelled lookup offline');
      return { data: null, error: { message: 'Cancelled lookup offline' } };
    };
    await save();
    expect(salesWrites()).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Cancelled lookup offline/)).toBeInTheDocument();
    beforeRead = undefined;
    await save();
    expect(salesWrites()).toHaveLength(1);
    expect(screen.getByText(/รายการขายถูกยกเลิก/)).toBeInTheDocument();
  });

  it('does not identify another sale by matching timestamps and identical business fields', async () => {
    const { onSaved } = await openModal();
    afterWrite = query => {
      if (query.table !== 'sales') return;
      database.sales[0].id = 'another-operation';
      database.sales[0].updated_at = database.sales[0].created_at;
      return lostResponse;
    };
    await save();
    afterWrite = undefined;
    await save();
    expect(onSaved).not.toHaveBeenCalled();
    expect(salesWrites()).toHaveLength(1);
    expect(database.sales[0].id).toBe('another-operation');
  });

  it.each([false, true])('reuses the insert ID after a failure before commit (UUID fallback: %s)', async fallback => {
    if (fallback) vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const { onSaved } = await openModal();
    beforeWrite = query => query.table === 'sales' ? { data: null, error: { message: 'Network unavailable before commit' } } : undefined;
    await save();
    expect(database.sales).toHaveLength(0);
    const firstPayload = (salesWrites()[0].payload as Record<string, unknown>[])[0];
    expect(firstPayload.id).toEqual(expect.any(String));
    beforeWrite = undefined;
    await save();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(database.sales).toHaveLength(1);
    expect(database.sales[0].id).toBe(firstPayload.id);
  });

  it('preserves external price changes after an insert response is lost', async () => {
    const { onSaved } = await openModal();
    afterWrite = query => query.table === 'sales' ? lostResponse : undefined;
    await save();
    afterWrite = undefined;
    database.sales[0].sale_price = 3000000;
    await save();
    expect(onSaved).not.toHaveBeenCalled();
    expect(database.sales[0].sale_price).toBe(3000000);
    expect(salesWrites()).toHaveLength(1);
  });

  it('does not truncate microsecond differences in booked_at during reconciliation', async () => {
    existingSale();
    const { onSaved } = await openModal();
    afterWrite = query => {
      if (query.table !== 'sales') return;
      database.sales[0].booked_at = String(database.sales[0].booked_at).replace('Z', '.000001+00:00');
      return lostResponse;
    };
    await save();
    afterWrite = undefined;
    await save();
    expect(onSaved).not.toHaveBeenCalled();
    expect(salesWrites()).toHaveLength(1);
  });
});
