import React, { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import SalesKanban, { STATUS_CONFIG, stageToKanbanStatus } from '../SalesKanban';

const db = vi.hoisted(() => ({ lead: {} as Record<string, any>, sale: {} as Record<string, any>, writes: vi.fn(), failLeadWrites: 0,
  history: [] as Record<string, any>[], historyErrorFor: null as string | null,
  historyPendingFor: null as string | null, historyPending: null as Promise<any> | null }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<any>) => {
  if (!loader.toString().includes('SalesDealStatusModal')) return () => null;
  const Component = React.lazy(loader);
  return (props: Record<string, unknown>) => <Suspense fallback={<p>Loading editor</p>}><Component {...props} /></Suspense>;
} }));
const plot = { id: 'P1', plot_name: 'A1', project_name: 'Project A', selling_price: 3000000, has_customer: true, sale_status: 'Reserved' };
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: async (table: string) => table === 'leads' ? [{ ...db.lead }] : table === 'sales' ? [{ ...db.sale, plots: plot }] : table === 'plots' ? [plot] : [] }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../SalesMap', () => ({ default: ({ onPlotClick, leads }: any) => <button data-agent={leads[0]?.agentName} data-lead={leads[0]?.leadId} onClick={() => onPlotClick('P1', 'Reserved', leads[0])}>Open occupied test plot</button> }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({ isSampleHouse: () => false, isPlotEligibleForSampleHouse: () => false, fetchTodayInspectionStatus: async () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let patch: Record<string, unknown> | null = null; const filters: Record<string, unknown> = {};
    const result = () => {
      if (table === 'users') return { data: [{ id: 'U1', username: 'Sales One', role: 'Sales' }], error: null };
      if (table === 'status_history' && patch) { db.writes(table, patch, { ...filters }); db.history.push({ id: `H${db.history.length + 1}`, ...patch }); return { data: { id: 'H1' }, error: null }; }
      const row: Record<string, unknown> = table === 'leads' ? db.lead : table === 'sales' ? db.sale : plot;
      if (patch) {
        if (table === 'leads' && db.failLeadWrites-- > 0) {
          db.writes(table, patch, { ...filters }); return { data: null, error: { message: 'Fixture lead write failed' } };
        }
        const matches = Object.entries(filters).every(([key, value]) => row[key] == value);
        if (!matches) return { data: null, error: { message: 'Concurrent update' } };
        db.writes(table, patch, { ...filters }); Object.assign(row, patch, { updated_at: String(Number(row.updated_at || 0) + 1) });
        return { data: { id: row.id }, error: null };
      }
      return { data: { ...row }, error: null };
    };
    const query = {
      select: () => query, insert: (value: Record<string, unknown>) => { patch = value; return query; }, update: (value: Record<string, unknown>) => { patch = value; return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      neq: () => query, limit: () => query, order: () => query, or: () => query,
      range: async (from: number, to: number) => {
        if (table !== 'status_history') return { data: [], error: null };
        if (filters.entity_id === db.historyPendingFor) return db.historyPending;
        return { data: db.history.filter(row => row.entity_id === filters.entity_id && row.entity_type === filters.entity_type).slice(from, to + 1),
          error: filters.entity_id === db.historyErrorFor ? { message: 'Fixture history failure' } : null };
      },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(table === 'users' ? result() : { data: table === 'sales' && filters.lead_id ? [{ ...db.sale }] : [], error: null }).then(resolve, reject),
    }; return query;
  }, rpc: async () => ({ data: { rows: [] }, error: null }),
} }));
const user = { id: 'U1', username: 'Sales One', role: 'Sales' };
let mapMode = false;
beforeEach(() => {
  mapMode = false;
  db.failLeadWrites = 0;
  db.history = []; db.historyErrorFor = null; db.historyPendingFor = null; db.historyPending = null;
  db.lead = { id: 'L1', customer_name: 'Original Customer', phone: '0811111111', occupation: 'Designer', status: 'Booked', crm_status: 'Booked — จองแล้ว', project_name: 'Project A', interested_plot_name: 'A1', interested_plot_id: 'P1', sales_owner: 'Sales One', notes: 'Original history', created_at: '2026-01-01', updated_at: '1' };
  // A recorded native booking day is distinct from row creation metadata.
  db.sale = { id: 'S1', lead_id: 'L1', plot_id: 'P1', customer_name: 'Old snapshot customer', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 2793000, bank_name: 'Old bank', booked_at: '2026-01-01T05:00:00Z', created_at: '2026-01-01', updated_at: '1' };
  db.writes.mockClear(); vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function openHub(name: string) {
  mapMode = false;
  const view = render(<MySalesWorkspace currentUser={user} projects={[{ name: 'Project A' }]} loadStartupData={async () => ({ leads: [{ ...db.lead }], plots: [plot] })} />);
  const customer = await screen.findByText(name);
  fireEvent.click(within(customer.closest('tr')!).getByRole('button', { name: /อัปเดตสถานะ|อัปเดตส่งมอบ|ดูสถานะ/ }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
  return view;
}
const edit = (name: string, value: string) => fireEvent.change(screen.getByRole(name === 'ธนาคาร' ? 'combobox' : mapMode && ['ราคาขายสุทธิ', 'ราคาประเมิน'].includes(name) ? 'spinbutton' : 'textbox', { name }), { target: { value } });
async function save() {
  fireEvent.click(screen.getByRole('button', { name: mapMode ? 'บันทึกการเปลี่ยนแปลง' : 'บันทึกข้อมูล' }));
  await waitFor(() => expect(mapMode ? screen.queryByRole('textbox', { name: 'ชื่อลูกค้า' }) : screen.queryByRole('dialog', { name: 'สถานะหลังจอง' })).not.toBeInTheDocument());
}

describe('bidirectional customer editing with mock database only', () => {
  it('persists Lead edits into the map editor, then map edits back into the Lead editor', async () => {
    const hub = await openHub('Original Customer');
    edit('ชื่อลูกค้า', 'Updated from Lead'); edit('เบอร์โทรศัพท์', '0899999999'); edit('อาชีพ', 'Engineer'); edit('ราคาขายสุทธิ', '2650000'); edit('ธนาคาร', 'กสิกรไทย'); edit('หมายเหตุสถานะ', 'Lead note');
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะหลังจอง' }), { target: { value: 'contracted' } });
    await save(); hub.unmount();
    const map = await openMap();
    expect(await within(screen.getByLabelText('ประวัติสถานะ')).findByText('ทำสัญญา')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).toHaveValue('Updated from Lead'));
    expect(screen.getByRole('textbox', { name: 'เบอร์โทรศัพท์' })).toHaveValue('0899999999');
    expect(screen.getByRole('textbox', { name: 'อาชีพ' })).toHaveValue('Engineer');
    expect(screen.getByRole('spinbutton', { name: 'ราคาขายสุทธิ' })).toHaveValue(2650000);
    expect(screen.getByRole('button', { name: STATUS_CONFIG.Contracted.label })).toHaveAttribute('aria-pressed', 'true');
    choose('document_prep');
    expect(screen.getByRole('combobox', { name: 'ธนาคาร' })).toHaveValue('กสิกรไทย');
    edit('ชื่อลูกค้า', 'Updated from Map'); edit('ธนาคาร', 'ไทยพาณิชย์'); edit('ราคาขายสุทธิ', '2600000'); edit('หมายเหตุสถานะ', 'Map note');
    await save(); map.unmount();
    await openHub('Updated from Map');
    expect(screen.getByRole('textbox', { name: 'ราคาขายสุทธิ' })).toHaveValue('2600000'); expect(screen.getByRole('combobox', { name: 'ธนาคาร' })).toHaveValue('ไทยพาณิชย์');
    expect(db.lead.notes).toContain('Lead note'); expect(db.lead.notes).toContain('Map note'); expect(db.lead.notes).toContain('Original history');
    expect(db.writes.mock.calls.map(call => call[0])).toEqual(['sales', 'leads', 'status_history', 'sales', 'leads', 'status_history']);
    expect(db.sale.crm_stage).toBe('document_prep');
    expect(plot.selling_price).toBe(3000000);
  });
});

async function openMap() {
  mapMode = true;
  const view = render(<SalesKanban project={{ name: 'Project A' }} user={user} initialTab="map" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open occupied test plot' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Open occupied test plot' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
  expect(screen.queryByRole('dialog', { name: 'สถานะหลังจอง' })).not.toBeInTheDocument();
  expect(screen.getByText('ข้อมูลลูกค้า')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' })).toBeInTheDocument();
  return view;
}
const choose = (stage: string) => mapMode ? fireEvent.click(screen.getByRole('button', { name: STATUS_CONFIG[stageToKanbanStatus(stage)].label })) : fireEvent.change(screen.getByRole('combobox', { name: 'สถานะหลังจอง' }), { target: { value: stage } });
function confirm() {
  fireEvent.change(screen.getByLabelText('วันที่ทำรายการ'), { target: { value: '2026-10-09' } });
  if (mapMode) edit('ราคาประเมิน', '2500000');
  else fireEvent.click(screen.getByRole('checkbox', { name: 'ยืนยันรายการ' }));
}
describe('shared lifecycle through both actual entry components with fixture database', () => {
  it('moves a cash customer from booking through transfer and handover using alternate routes', async () => {
    let view = await openHub('Original Customer'); choose('contracted'); await save(); view.unmount();
    view = await openMap(); choose('document_prep'); edit('ธนาคาร', 'ซื้อเงินสด'); choose('transfer_pending'); await save(); view.unmount();
    expect(db.sale.payment_method).toBe('cash'); expect(db.sale.crm_stage).toBe('transfer_pending');
    view = await openHub('Original Customer'); expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).toHaveValue('transfer_pending'); choose('transferred'); confirm(); await save(); view.unmount();
    expect(db.lead.status).toBe('Transferred'); expect(db.sale.contract_status).toBe('Transferred'); expect(db.sale.transferred_at).toBe('2026-10-09T05:00:00.000Z');
    view = await openMap(); choose('handover'); confirm(); await save(); view.unmount();
    expect(db.lead.status).toBe('Handover'); expect(db.sale.crm_stage).toBe('handover'); expect(db.sale.crm_handover_at).toBe('2026-10-09T05:00:00.000Z');
    expect(db.sale.land_office_price).toBe(2500000);
    expect(db.writes.mock.calls.filter(c => c[0] === 'status_history').map(c => c[1].new_status)).toEqual(['contracted', 'transfer_pending', 'transferred', 'handover']);
    expect(db.writes.mock.calls.every(c => ['sales', 'leads', 'status_history'].includes(c[0]))).toBe(true);
    render(<MySalesWorkspace currentUser={user} projects={[{ name: 'Project A' }]} loadStartupData={async () => ({ leads: [{ ...db.lead }], plots: [plot] })} />);
    const customer = await screen.findByText('Original Customer'); fireEvent.click(within(customer.closest('tr')!).getByRole('button', { name: 'ดูสถานะ' }));
    expect(screen.queryByRole('button', { name: 'บันทึกข้อมูล' })).not.toBeInTheDocument();
  });
  it('keeps a mortgage rejection active, preserves history and resumes preparation from the other route', async () => {
    db.sale.crm_stage = 'loan_submitted'; db.sale.contract_status = 'Contracted'; db.sale.payment_method = 'mortgage'; db.sale.bank_name = 'กสิกรไทย'; db.lead.status = 'Contracted'; db.lead.crm_status = 'Loan Pre-Approval';
    let view = await openMap(); choose('loan_rejected'); edit('เหตุผล', 'Income documents incomplete'); await save(); view.unmount();
    expect(db.lead.status).toBe('Contracted'); expect(db.sale.contract_status).toBe('Contracted');
    view = await openHub('Original Customer'); expect(screen.getByRole('combobox', { name: 'สถานะหลังจอง' })).toHaveValue('loan_rejected'); choose('document_prep'); await save(); view.unmount();
    view = await openMap(); choose('loan_submitted'); await save(); view.unmount();
    expect(db.sale.crm_stage).toBe('loan_submitted'); expect(db.lead.notes).toContain('Income documents incomplete'); expect(db.lead.notes).toContain('Original history');
    expect(db.writes.mock.calls.filter(c => c[0] === 'status_history').map(c => c[1].new_status)).toEqual(['loan_rejected', 'document_prep', 'loan_submitted']);
  });
});

describe('existing sidebar save binding safety with fixture data', () => {
  it('reads the saved booking-to-contract event when the same sidebar is reopened', async () => {
    await openMap(); choose('contracted'); await save();
    fireEvent.click(screen.getByRole('button', { name: 'Open occupied test plot' }));
    const timeline = await screen.findByLabelText('ประวัติสถานะ');
    expect(await within(timeline).findByText('ทำสัญญา')).toBeInTheDocument();
    expect(within(timeline).getAllByText('ทำสัญญา')).toHaveLength(1);
    expect(db.history).toHaveLength(1);
    expect(db.history[0]).toMatchObject({ entity_type: 'lead', entity_id: 'L1', old_status: 'booked', new_status: 'contracted' });
  });

  it('keeps date milestones and lets a failed history read be retried', async () => {
    db.history = [{ id: 'H1', entity_type: 'lead', entity_id: 'L1', new_status: 'contracted', created_at: '2026-10-12T05:00:00Z', changed_by: 'Sales One' }];
    db.historyErrorFor = 'L1';
    await openMap();
    const timeline = screen.getByLabelText('ประวัติสถานะ');
    expect(await within(timeline).findByRole('alert')).toHaveTextContent('โหลดประวัติสถานะไม่สำเร็จ');
    expect(within(timeline).getByText('จองแล้ว')).toBeInTheDocument();
    db.historyErrorFor = null;
    fireEvent.click(within(timeline).getByRole('button', { name: 'ลองใหม่' }));
    expect(await within(timeline).findByText('ทำสัญญา')).toBeInTheDocument();
    expect(within(timeline).queryByRole('alert')).not.toBeInTheDocument();
    expect(db.writes).not.toHaveBeenCalled();
  });

  it('ignores an old account history reply after switching customer/account', async () => {
    let resolveOld!: (value: unknown) => void;
    db.historyPendingFor = 'L1';
    db.historyPending = new Promise(resolve => { resolveOld = resolve; });
    const map = await openMap();
    db.lead = { ...db.lead, id: 'L2', customer_name: 'Second customer' };
    db.sale = { ...db.sale, id: 'S2', lead_id: 'L2' };
    db.history = [{ id: 'H2', entity_type: 'lead', entity_id: 'L2', new_status: 'contracted', created_at: '2026-10-12T05:00:00Z', changed_by: 'Sales Two' }];
    map.rerender(<SalesKanban project={{ name: 'Project A' }} user={{ ...user, id: 'U2' }} initialTab="map" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open occupied test plot' })).toHaveAttribute('data-lead', 'L2'));
    fireEvent.click(screen.getByRole('button', { name: 'Open occupied test plot' }));
    const timeline = await screen.findByLabelText('ประวัติสถานะ');
    expect(await within(timeline).findByText('ทำสัญญา')).toBeInTheDocument();
    await act(async () => resolveOld({ data: [{ id: 'H1', entity_type: 'lead', entity_id: 'L1', new_status: 'loan_approved', created_at: '2026-10-12T05:00:00Z', changed_by: 'Old account' }], error: null }));
    expect(within(timeline).queryByText('อนุมัติแล้ว')).not.toBeInTheDocument();
    expect(within(timeline).getByText('ทำสัญญา')).toBeInTheDocument();
  });

  it('keeps the existing direct form-child layout and saves the agent to the exact linked Lead', async () => {
    db.sale.agent_name = 'Old snapshot agent';
    await openMap();
    const name = screen.getByRole('textbox', { name: 'ชื่อลูกค้า' });
    const form = name.closest('form')!;
    expect(form.className).toBe('space-y-4 flex-1');
    expect(form.firstElementChild?.tagName).toBe('DIV');
    expect(form.querySelector('fieldset')).toBeNull();
    edit('พนักงานขาย', 'Sales Two'); choose('contracted'); await save();
    expect(db.lead.agent_name).toBe('Sales Two');
    expect(db.writes.mock.calls.find(c => c[0] === 'leads')?.[2].id).toBe('L1');
    expect(db.writes.mock.calls.find(c => c[0] === 'sales')?.[2].id).toBe('S1');
    expect(db.sale.customer_name).toBe('Old snapshot customer');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open occupied test plot' })).toHaveAttribute('data-agent', 'Sales Two'));
    expect(plot.selling_price).toBe(3000000);
  });

  it('leaves the retry button usable while freezing inputs after an acknowledged partial save', async () => {
    await openMap(); choose('contracted'); db.failLeadWrites = 1;
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกบางส่วนแล้ว');
    expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).toBeDisabled();
    expect(screen.getByRole('button', { name: STATUS_CONFIG.Contracted.label })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' })).toBeEnabled());
    await save();
    expect(db.writes.mock.calls.map(c => c[0])).toEqual(['sales', 'leads', 'leads', 'status_history']);
    expect(db.lead.status).toBe('Contracted');
    expect(db.sale.crm_stage).toBe('contracted');
  });

  it('rejects a profile changed in another tab instead of overwriting it from the sidebar', async () => {
    await openMap(); edit('ชื่อลูกค้า', 'Local changed name');
    db.lead.customer_name = 'Concurrent changed name';
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลลูกค้าเปลี่ยนแล้ว');
    expect(db.writes).not.toHaveBeenCalled();
    expect(db.lead.customer_name).toBe('Concurrent changed name');
  });

  it('keeps Owner sidebar fields and save read-only', async () => {
    render(<SalesKanban project={{ name: 'Project A' }} user={{ ...user, role: 'Owner' }} initialTab="map" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open occupied test plot' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' })).toBeDisabled();
    expect(db.writes).not.toHaveBeenCalled();
  });
});
