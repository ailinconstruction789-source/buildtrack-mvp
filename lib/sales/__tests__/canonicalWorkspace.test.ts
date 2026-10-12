import { describe, it, expect, vi } from 'vitest';
import { EMPTY_CENTRAL_SEARCH, type CentralSnapshot, type CentralSearchSnapshot } from '../centralContracts';
import type { ProjectSaleRow, ProjectSalesSnapshot, ProjectSalesScope } from '../projectSalesContracts';
import { buildCanonicalWorkspace, readCanonicalWorkspace, canonicalCustomerCount, canonicalWorkspaceHref, remainingNativeWorkspaceLeads } from '../canonicalWorkspace';
import { nativeLeadId } from '../leadLifecycle';
import { customerOperationalYear } from '../customerBusinessDate';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { userId: id(1), role: 'sales' as const };
const membership = { active: true, revisionId: id(9000), originalLegacyLeadIds: [id(8000)], legacyScopeIncluded: true };
function customer(n = 2): CentralSnapshot['customers'][number] {
  return { id: id(n), name: 'ชื่อเดียวกัน', phone: null, channel: null, notes: null, ownerUserId: actor.userId,
    leadCreatedAt: null, intakeStatus: 'legacy_unclassified', sourceKind: 'reviewed_import', visitHistoryDate: null,
    interests: [{ id: id(n + 1000), projectName: 'Project', ownerUserId: actor.userId, workspaceState: 'project_active',
      engagementStatus: 'visited', plotId: 'plot', sourceKind: 'reviewed_import', visitHistoryDate: '2025-01-01' }] };
}
function sale(n = 2): ProjectSaleRow {
  return { saleId: id(n + 2000), customerId: id(n), customerName: 'ชื่อเดียวกัน', phone: null, interestId: id(n + 1000),
    projectName: 'Project', ownerUserId: actor.userId, ownerName: 'Sales', plotId: 'plot', plotName: '01', stage: 'booked',
    bookingRound: null, previousSaleId: null, bookedAt: null, cancelledAt: null, cancellationReason: null,
    listPrice: null, discountAmount: null, salePrice: 0, depositAmount: null, paymentMethod: null,
    bankName: null, expectedTransferDate: '2026-10-31', leadId: null, sourceKind: 'reviewed_import', visitHistoryDate: '2025-01-01' };
}
function build(customers = [customer()], sales = [sale()]) {
  return buildCanonicalWorkspace({ actor, customers, sales, salesOwners: [{ userId: actor.userId, displayName: 'Sales' }], projects: [{ name: 'Project' }] });
}
function centralPage(customers: CentralSnapshot['customers'], page = 0, hasMore = false): CentralSearchSnapshot {
  return { actor, customers, page, hasMore, projects: [{ name: 'Project' }], salesOwners: [{ userId: actor.userId, displayName: 'Sales' }],
    sourceMembership: page === 0 ? membership : { ...membership, legacyScopeIncluded: false, originalLegacyLeadIds: [] }, search: { contractVersion: 'central_search_v1', filters: { ...EMPTY_CENTRAL_SEARCH }, projects: ['Project'],
      owners: [{ userId: actor.userId, displayName: 'Sales' }], channels: [], hasMoreChannels: false } };
}
function projectPage(rows: ProjectSaleRow[], name: string | null = 'Project', page = 0, hasMore = false): ProjectSalesSnapshot {
  return { actor, rows, projectName: name, tab: 'all', query: '', page, hasMore, projects: [{ name: 'Project' }], sourceMembership: { ...membership, legacyScopeIncluded: false, originalLegacyLeadIds: [] } };
}
describe('canonical workspace identity and evidence', () => {
  it('never merges distinct people with identical names or creates native Lead identity', () => {
    const result = build([customer(2), customer(3)], [sale(2), sale(3)]);
    expect(result.rows).toHaveLength(2); expect(canonicalCustomerCount(result.rows)).toBe(2);
    expect(result.rows.map(row => nativeLeadId(row))).toEqual([null, null]);
    expect(result.rows[0]).toMatchObject({ saleId: id(2002), customerId: id(2), interestId: id(1002), sale_price: 0, bank_name: null, expectedTransferDate: '2026-10-31' });
  });
  it('preserves unknown project, price, business date and year without plot/import fallback', () => {
    const c = { ...customer(), interests: [], visitHistoryDate: null };
    const result = build([c], []); const row = result.rows[0];
    expect(row).toMatchObject({ project_name: '', interestId: null, saleId: null, sale_price: null, booking_date: null, created_at: null });
    expect(customerOperationalYear(row)).toBeNull();
    expect(canonicalWorkspaceHref(row, 'work')).toBe(`/sales-crm/${id(2)}`);
    expect(() => canonicalWorkspaceHref(row, 'visit')).toThrow();
    expect(() => canonicalWorkspaceHref(row, 'rental')).toThrow();
  });
  it('keeps a known visit day without inventing booking/transfer completion', () => {
    const row = build([customer()], []).rows[0];
    expect(row.actual_visit_date).toBe('2025-01-01'); expect(customerOperationalYear(row)).toBe(2025);
    expect(row.booking_date).toBeNull(); expect(row.transferred_date).toBeNull();
  });
  it('preserves the canonical nurture state and label instead of presenting it as a Lost transition', () => {
    const c = customer(); c.interests[0].engagementStatus = 'nurture';
    const row = build([c], []).rows[0];
    expect(row).toMatchObject({ status: 'nurture', crm_status: 'พักติดตาม', saleId: null });
  });
  it('shows two purchase interests/rounds separately while counting their customer once', () => {
    const c = customer(); c.interests.push({ ...c.interests[0], id: id(1010), plotId: 'plot2' });
    const s2 = { ...sale(), saleId: id(2010), interestId: id(1010), plotId: 'plot2', stage: 'cancelled' as const };
    const result = build([c], [sale(), s2]);
    expect(result.rows).toHaveLength(2); expect(canonicalCustomerCount(result.rows)).toBe(1);
    expect(result.rows.map(row => row.status)).toEqual(['Booked', 'Cancelled']);
  });
  it('rejects a Sale whose Interest belongs to a different exact Customer', () => {
    expect(() => build([customer(2), customer(3)], [{ ...sale(2), interestId: id(1003) }])).toThrow();
  });
  it('rejects duplicate Sale IDs and duplicate Interest IDs', () => {
    expect(() => build([customer()], [sale(), sale()])).toThrow();
    const c = customer(3); c.interests[0].id = id(1002);
    expect(() => build([customer(), c], [])).toThrow();
  });
  it('excludes only frozen old Lead IDs and actual native links, preserving same-name future Leads', () => {
    const snapshot = { ...build(), sourceMembership: membership };
    snapshot.sales[0].leadId = id(7000);
    const native = [8000, 7000, 6000].map(n => ({ id: id(n), customer_name: 'ชื่อเดียวกัน' }));
    expect(remainingNativeWorkspaceLeads(native, snapshot)).toEqual([native[2]]);
    expect(remainingNativeWorkspaceLeads(native, { ...snapshot, sourceMembership: { ...membership, active: false } })).toEqual([native[0], native[2]]);
  });
  it('dispatches existing workflows with exact IDs and no guessed project', () => {
    const row = build([customer()], []).rows[0];
    expect(canonicalWorkspaceHref(row, 'work')).toBe(`/sales-crm/${id(2)}?interestId=${id(1002)}`);
    expect(canonicalWorkspaceHref(row, 'booking')).toBe(`/sales-crm/bookings?customerId=${id(2)}`);
    expect(canonicalWorkspaceHref(row, 'visit')).toBe(`/sales-crm/visits?customerId=${id(2)}&interestId=${id(1002)}`);
    expect(canonicalWorkspaceHref(row, 'rental')).toBe(`/sales-crm/rentals?customerId=${id(2)}&projectName=Project`);
  });
});
describe('complete canonical workspace paging', () => {
  it('reads beyond five project pages and beyond the 1000-row central boundary', async () => {
    const customers = Array.from({ length: 1051 }, (_, n) => customer(n + 2));
    const sales = customers.slice(0, 301).map((_, n) => sale(n + 2));
    const central = { read: vi.fn(async (page: number) => centralPage(customers.slice(page * 50, page * 50 + 50), page, (page + 1) * 50 < customers.length)) };
    const projectSales = { read: vi.fn(async (scope: ProjectSalesScope) => scope.projectName === null ? projectPage([], null)
      : projectPage(sales.slice(scope.page * 50, scope.page * 50 + 50), 'Project', scope.page, (scope.page + 1) * 50 < sales.length)) };
    const result = await readCanonicalWorkspace({ central, projectSales });
    expect(result.customers).toHaveLength(1051); expect(result.sales).toHaveLength(301); expect(result.rows).toHaveLength(1051);
    expect(central.read).toHaveBeenCalledTimes(22); expect(projectSales.read).toHaveBeenCalledTimes(8);
    expect(result.sourceMembership).toEqual(membership);
  });
  it('fails instead of publishing earlier successful pages when a later page fails', async () => {
    const central = { read: vi.fn().mockResolvedValueOnce(centralPage(Array.from({ length: 50 }, (_, n) => customer(n + 2)), 0, true)).mockRejectedValueOnce(new Error('network')) };
    const projectSales = { read: vi.fn() };
    await expect(readCanonicalWorkspace({ central, projectSales })).rejects.toThrow('network'); expect(projectSales.read).not.toHaveBeenCalled();
  });
  it('rejects account changes between pages', async () => {
    const central = { read: vi.fn().mockResolvedValueOnce(centralPage(Array.from({ length: 50 }, (_, n) => customer(n + 2)), 0, true))
      .mockResolvedValueOnce({ ...centralPage([], 1), actor: { ...actor, userId: id(999) } }) };
    await expect(readCanonicalWorkspace({ central, projectSales: { read: vi.fn() } })).rejects.toThrow();
  });
  it('rejects a changed authority revision between discovery and project rows', async () => {
    const central = { read: vi.fn().mockResolvedValue(centralPage([customer()])) };
    const projectSales = { read: vi.fn().mockResolvedValue({ ...projectPage([], null), sourceMembership: { ...membership, revisionId: id(9999) } }) };
    await expect(readCanonicalWorkspace({ central, projectSales })).rejects.toThrow();
  });
  it('requires the reviewed original Lead scope on central page zero, not a revision-only project envelope', async () => {
    const central = { read: vi.fn().mockResolvedValue({ ...centralPage([customer()]), sourceMembership: { ...membership, legacyScopeIncluded: false, originalLegacyLeadIds: [] } }) };
    const projectSales = { read: vi.fn() };
    await expect(readCanonicalWorkspace({ central, projectSales })).rejects.toThrow(); expect(projectSales.read).not.toHaveBeenCalled();
  });
  it('stops stale workspace requests before beginning project reads', async () => {
    const projectSales = { read: vi.fn() };
    await expect(readCanonicalWorkspace({ central: { read: vi.fn().mockResolvedValue(centralPage([customer()])) }, projectSales, isCurrent: () => false })).rejects.toThrow();
    expect(projectSales.read).not.toHaveBeenCalled();
  });
});
