import { EMPTY_CENTRAL_SEARCH, type CentralSearchSnapshot, type CentralSnapshot } from './centralContracts';
import type { ProjectSaleRow, ProjectSalesScope, ProjectSalesSnapshot } from './projectSalesContracts';
import { customerBusinessDay } from './customerBusinessDate';
import { salesDealStages } from './dealStatus';
import { TRACKER_STATUS_LABELS, trackerStatus, trackerStatusLabel } from './centralTracker';

type Customer = CentralSnapshot['customers'][number];
type Actor = CentralSnapshot['actor'];
/** Presentation fields are deliberately separate from public.leads identity. */
export interface CanonicalWorkspaceRow extends Record<string, unknown> {
  id: string; sourceKind: 'crm_customer' | 'crm_sale'; leadId: null;
  recordOrigin: 'reviewed_import' | 'native' | null;
  customerId: string; crmCustomerId: string; interestId: string | null; saleId: string | null;
  ownerUserId: string; owner_user_id: string; customer_name: string; phone: string | null;
  project_name: string; interested_plot_id: string | null; interested_plot_name: string | null;
  sales_owner: string; created_by_agent: string; channel: string | null; notes: string | null;
  status: string; crm_status: string; crmStage?: string; sale_price: number | null;
  bank_name: string | null; expectedTransferDate: string | null;
  booking_date: string | null; transferred_date: string | null; actual_visit_date: string | null;
  created_at: string | null; importedHistory?: ProjectSaleRow['importedHistory'];
  _isMergedSalesRecord: boolean;
}
export interface CanonicalWorkspaceSnapshot {
  actor: Actor; customers: Customer[]; sales: ProjectSaleRow[]; rows: CanonicalWorkspaceRow[];
  salesOwners: CentralSnapshot['salesOwners']; projects: { name: string }[];
  sourceMembership?: { active: boolean; revisionId: string | null; originalLegacyLeadIds: string[]; legacyScopeIncluded?: boolean };
}
export interface CanonicalWorkspaceReaders {
  central: { read(page: number, filters: typeof EMPTY_CENTRAL_SEARCH): Promise<CentralSearchSnapshot> };
  projectSales: { read(scope: ProjectSalesScope): Promise<ProjectSalesSnapshot> };
}
const unavailable = (): never => { throw new Error('โหลดลูกค้า CRM ไม่ครบหรือข้อมูลเปลี่ยนระหว่างโหลด กรุณาลองใหม่'); };
export function isCanonicalWorkspaceRow(value: unknown): value is CanonicalWorkspaceRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<CanonicalWorkspaceRow>;
  return (row.sourceKind === 'crm_customer' || row.sourceKind === 'crm_sale') && row.leadId === null
    && typeof row.customerId === 'string' && typeof row.crmCustomerId === 'string' && row.customerId === row.crmCustomerId;
}
function sameActor(first: Actor, next: Actor) {
  if (first.userId !== next.userId || first.role !== next.role) unavailable();
}
/** Full pagination, bounded requests, and one coherent identity. Never return partial totals. */
export async function readCanonicalWorkspace({ central, projectSales, projectName = null, isCurrent = () => true }: CanonicalWorkspaceReaders & {
  projectName?: string | null; isCurrent?: () => boolean;
}): Promise<CanonicalWorkspaceSnapshot> {
  const first = await central.read(0, { ...EMPTY_CENTRAL_SEARCH });
  const membership = first.sourceMembership;
  if (!membership?.active || !membership.revisionId || membership.legacyScopeIncluded !== true) unavailable();
  const trustedMembership = membership!;
  const sameMembership = (next: { sourceMembership?: CanonicalWorkspaceSnapshot['sourceMembership'] }) => {
    if (next.sourceMembership?.active !== trustedMembership.active || next.sourceMembership?.revisionId !== trustedMembership.revisionId) unavailable();
  };
  const check = () => { if (!isCurrent()) unavailable(); };
  check();
  const customers: Customer[] = [...first.customers];
  let more = first.hasMore;
  for (let page = 1; more; page++) {
    if (page >= 200) unavailable();
    check();
    const next = await central.read(page, { ...EMPTY_CENTRAL_SEARCH });
    check(); sameActor(first.actor, next.actor); sameMembership(next);
    if (next.page !== page || next.hasMore && next.customers.length !== 50) unavailable();
    customers.push(...next.customers); more = next.hasMore;
  }
  if (new Set(customers.map(customer => customer.id)).size !== customers.length) unavailable();
  const index = await projectSales.read({ projectName: null, tab: 'all', query: '', page: 0 });
  check(); sameActor(first.actor, index.actor); sameMembership(index);
  if (index.projects.length > 100 || projectName !== null && !index.projects.some(project => project.name === projectName)) unavailable();
  const sales: ProjectSaleRow[] = [];
  // At most three project readers concurrently; pages within each project stay ordered.
  const names = projectName === null ? index.projects.map(project => project.name) : [projectName];
  for (let offset = 0; offset < names.length; offset += 3) {
    const groups = await Promise.all(names.slice(offset, offset + 3).map(async name => {
      const rows: ProjectSaleRow[] = [];
      for (let page = 0; ; page++) {
        if (page >= 200) unavailable();
        check();
        const next = await projectSales.read({ projectName: name, tab: 'all', query: '', page });
        check(); sameActor(first.actor, next.actor); sameMembership(next);
        if (next.projectName !== name || next.page !== page || next.hasMore && next.rows.length !== 50) unavailable();
        rows.push(...next.rows);
        if (!next.hasMore) break;
      }
      return rows;
    }));
    sales.push(...groups.flat());
  }
  check();
  const sourceMembership = (first as CentralSearchSnapshot & { sourceMembership?: CanonicalWorkspaceSnapshot['sourceMembership'] }).sourceMembership;
  return { ...buildCanonicalWorkspace({ actor: first.actor, customers, sales, salesOwners: first.search.owners, projects: index.projects, projectName }),
    ...(sourceMembership ? { sourceMembership } : {}) };
}
export function buildCanonicalWorkspace({ actor, customers, sales, salesOwners, projects, projectName = null }: {
  actor: Actor; customers: Customer[]; sales: ProjectSaleRow[]; salesOwners: CentralSnapshot['salesOwners']; projects: { name: string }[]; projectName?: string | null;
}): CanonicalWorkspaceSnapshot {
  const byCustomer = new Map(customers.map(customer => [customer.id, customer]));
  if (byCustomer.size !== customers.length || new Set(sales.map(sale => sale.saleId)).size !== sales.length) unavailable();
  const owners = new Map(salesOwners.map(owner => [owner.userId, owner.displayName]));
  const salesByInterest = new Map<string, ProjectSaleRow[]>();
  const allInterestIds = new Set<string>();
  for (const customer of customers) for (const interest of customer.interests) {
    if (allInterestIds.has(interest.id)) unavailable();
    allInterestIds.add(interest.id);
  }
  for (const sale of sales) {
    const customer = byCustomer.get(sale.customerId);
    const interest = customer?.interests.find(item => item.id === sale.interestId);
    if (!customer || !interest || interest.projectName !== sale.projectName) unavailable();
    const group = salesByInterest.get(sale.interestId) ?? [];
    group.push(sale); salesByInterest.set(sale.interestId, group);
  }
  const rows: CanonicalWorkspaceRow[] = [];
  for (const customer of customers) {
    const interests = customer.interests.length ? customer.interests : [null];
    for (const interest of interests) {
      if (projectName !== null && interest?.projectName !== projectName) continue;
      const deals: Array<ProjectSaleRow | null> = interest ? salesByInterest.get(interest.id) ?? [null] : [null];
      for (const sale of deals) {
        const ownerId = sale?.ownerUserId ?? interest?.ownerUserId ?? customer.ownerUserId;
        const stage = sale?.stage ?? interest?.engagementStatus ?? customer.intakeStatus;
        const state = sale ? stage === 'cancelled' ? 'Cancelled' : ['transferred', 'handover'].includes(stage) ? 'Transferred' : 'Booked'
          : stage === 'lost' ? 'Lost' : stage === 'visited' ? 'Visit' : stage;
        const effective = sale;
        rows.push({ id: sale ? `crm-sale:${sale.saleId}` : interest ? `crm-interest:${interest.id}` : `crm-customer:${customer.id}`,
          sourceKind: sale ? 'crm_sale' : 'crm_customer', leadId: null,
          recordOrigin: sale?.sourceKind ?? interest?.sourceKind ?? customer.sourceKind ?? null,
          customerId: customer.id, crmCustomerId: customer.id,
          interestId: interest?.id ?? null, saleId: sale?.saleId ?? null, ownerUserId: ownerId, owner_user_id: ownerId,
          customer_name: sale?.customerName ?? customer.name, phone: sale?.phone ?? customer.phone,
          project_name: interest?.projectName ?? '', interested_plot_id: sale?.plotId ?? interest?.plotId ?? null,
          interested_plot_name: sale?.plotName ?? (sale ? sale.plotId : interest?.plotId) ?? null,
          sales_owner: sale?.ownerName ?? owners.get(ownerId) ?? 'ไม่ทราบ', created_by_agent: owners.get(ownerId) ?? 'ไม่ทราบ',
          channel: customer.channel, notes: customer.notes, status: state,
          crm_status: sale ? salesDealStages.find(item => item.id === stage)?.label ?? stage
            : TRACKER_STATUS_LABELS[trackerStatus(stage)] ? trackerStatusLabel(stage) : state,
          ...(sale ? { crmStage: stage } : {}), sale_price: sale?.salePrice ?? null, bank_name: effective?.bankName ?? null,
          expectedTransferDate: effective?.expectedTransferDate ?? null,
          booking_date: sale ? customerBusinessDay(sale.bookedAt) ?? sale.importedHistory?.bookedDate ?? null : null,
          transferred_date: sale?.importedHistory?.transferredDate ?? null,
          actual_visit_date: effective?.visitHistoryDate ?? (interest ? interest.visitHistoryDate ?? null : customer.visitHistoryDate ?? null),
          created_at: customer.leadCreatedAt, ...(sale?.importedHistory ? { importedHistory: sale.importedHistory } : {}), _isMergedSalesRecord: Boolean(sale),
        });
      }
    }
  }
  return { actor, customers, sales, rows, salesOwners, projects };
}
/** Exact identifiers choose the workflow; no native Lead ID is invented. */
export function canonicalWorkspaceAction(row: CanonicalWorkspaceRow, type: 'work' | 'visit' | 'booking' | 'rental') {
  if (!isCanonicalWorkspaceRow(row) || type === 'visit' && !row.interestId) unavailable();
  return { type, customerId: row.customerId, interestId: row.interestId, saleId: row.saleId, projectName: row.project_name || null };
}
export function canonicalCustomerCount(rows: readonly { id?: unknown; customerId?: unknown; sourceKind?: unknown }[]) {
  return new Set(rows.map(row => row.sourceKind === 'crm_customer' || row.sourceKind === 'crm_sale' ? `crm:${row.customerId}` : `native:${row.id}`)).size;
}
/** Remove only the frozen approved legacy cohort and explicit native links. */
export function remainingNativeWorkspaceLeads<T extends { id: string }>(native: T[], snapshot: CanonicalWorkspaceSnapshot): T[] {
  const excluded = new Set(snapshot.sourceMembership?.active ? snapshot.sourceMembership.originalLegacyLeadIds : []);
  for (const sale of snapshot.sales) {
    const leadId = (sale as ProjectSaleRow & { leadId?: string | null }).leadId;
    if (leadId) excluded.add(leadId);
  }
  return native.filter(lead => !excluded.has(lead.id));
}
export function canonicalWorkspaceHref(row: CanonicalWorkspaceRow, type: 'work' | 'visit' | 'booking' | 'rental') {
  const target = canonicalWorkspaceAction(row, type);
  const params = new URLSearchParams({ customerId: target.customerId });
  if (type === 'work') {
    const query = target.interestId ? `?${new URLSearchParams({ interestId: target.interestId })}` : '';
    return `/sales-crm/${encodeURIComponent(target.customerId)}${query}`;
  }
  if (type === 'visit') { params.set('interestId', target.interestId!); return `/sales-crm/visits?${params}`; }
  if (type === 'rental') {
    if (!target.projectName) unavailable();
    params.set('projectName', target.projectName!); return `/sales-crm/rentals?${params}`;
  }
  return `/sales-crm/bookings?${params}`;
}
