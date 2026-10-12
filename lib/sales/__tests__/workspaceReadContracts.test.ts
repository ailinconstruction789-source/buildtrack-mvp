import { describe, expect, it } from 'vitest';
import { parseProjectSalesSnapshot } from '../projectSalesContracts';
import { EMPTY_CENTRAL_SEARCH, parseCentralSearchSnapshot } from '../centralContracts';
import { parseSourceMembershipMetadata, parseWorkspaceHistoryMetadata } from '../workspaceReadContracts';
import { projectSale, projectScope, projectSnapshot, pid } from './projectSalesFixtures';
const sourceMembership = { active: true, revisionId: pid(90), originalLegacyLeadIds: [pid(80)] };
const enriched = () => ({ ...projectSnapshot(), sourceMembership, rows: [projectSale({ bankName: 'ธนาคาร A', expectedTransferDate: '2026-12-25', leadId: null,
  sourceKind: 'reviewed_import', visitHistoryDate: '2024-10-01', salePrice: 4136000 })] });
describe('trusted workspace read fields', () => {
  it('retains effective bank, columnP forecast, exact identities and evidenced visit date', () => {
    const row = parseProjectSalesSnapshot(enriched(), projectScope()).rows[0];
    expect(row).toMatchObject({ bankName: 'ธนาคาร A', expectedTransferDate: '2026-12-25', leadId: null, sourceKind: 'reviewed_import', visitHistoryDate: '2024-10-01', salePrice: 4136000, saleId: pid(1), customerId: pid(2), interestId: pid(3) });
  });
  it('preserves explicit corrected nulls without deriving price/bank/day from a different record', () => {
    const snapshot = enriched(); Object.assign(snapshot.rows[0], { bankName: null, expectedTransferDate: null, visitHistoryDate: null, leadId: pid(55) });
    expect(parseProjectSalesSnapshot(snapshot, projectScope()).rows[0]).toMatchObject({ bankName: null, expectedTransferDate: null, visitHistoryDate: null, leadId: pid(55) });
  });
  it.each([{ expectedTransferDate: '2026-02-30' }, { expectedTransferDate: '2026-12-25T00:00:00Z' }, { bankName: 123 }, { leadId: 'guessed-name' }, { visitHistoryDate: '2026-02-30' }, { sourceKind: 'legacy' }])('rejects malformed enriched data %j', change => {
    const snapshot = enriched(); Object.assign(snapshot.rows[0], change); expect(() => parseProjectSalesSnapshot(snapshot, projectScope())).toThrow();
  });
  it('blocks a partially installed reader instead of dropping bank/P fields', () => {
    const snapshot = enriched(); delete snapshot.rows[0].bankName; expect(() => parseProjectSalesSnapshot(snapshot, projectScope())).toThrow();
  });
  it('validates only explicit frozen UUID scope and inactive metadata cannot exclude legacy rows', () => {
    expect(parseSourceMembershipMetadata(sourceMembership)).toEqual(sourceMembership);
    expect(parseSourceMembershipMetadata({ active: false, revisionId: null, originalLegacyLeadIds: [] })).toEqual({ active: false, revisionId: null, originalLegacyLeadIds: [] });
    for (const v of [{ ...sourceMembership, originalLegacyLeadIds: ['name'] }, { ...sourceMembership, originalLegacyLeadIds: [pid(80), pid(80)] }, { ...sourceMembership, active: false }, { ...sourceMembership, revisionId: null }]) expect(() => parseSourceMembershipMetadata(v)).toThrow();
  });
  it('keeps unknown historical day unknown and rejects dates without provenance', () => {
    expect(parseWorkspaceHistoryMetadata({ sourceKind: 'reviewed_import', visitHistoryDate: null })).toEqual({ sourceKind: 'reviewed_import', visitHistoryDate: null });
    expect(() => parseWorkspaceHistoryMetadata({ visitHistoryDate: '2024-01-01' })).toThrow();
  });
  it('distinguishes the full first-page legacy scope from revision-only later pages', () => {
    expect(parseSourceMembershipMetadata({ ...sourceMembership, legacyScopeIncluded: true })?.legacyScopeIncluded).toBe(true);
    expect(parseSourceMembershipMetadata({ ...sourceMembership, originalLegacyLeadIds: [], legacyScopeIncluded: false })?.legacyScopeIncluded).toBe(false);
    expect(() => parseSourceMembershipMetadata({ ...sourceMembership, legacyScopeIncluded: false })).toThrow();
  });
  it('projects Customer and Interest source histories separately for a shared Customer', () => {
    const input = { actor: { userId: pid(8), role: 'sales' }, page: 0, hasMore: false, projects: [], salesOwners: [], sourceMembership,
      customers: [{ id: pid(2), name: 'Customer', phone: null, channel: null, notes: null, ownerUserId: pid(8), leadCreatedAt: null, intakeStatus: 'legacy_unclassified', sourceKind: 'reviewed_import', visitHistoryDate: '2020-01-01',
        interests: [{ id: pid(3), projectName: 'A', ownerUserId: pid(8), workspaceState: 'project_active', engagementStatus: 'visited', plotId: null, sourceKind: 'reviewed_import', visitHistoryDate: '2022-01-02' }] }],
      search: { contractVersion: 'central_search_v1', filters: EMPTY_CENTRAL_SEARCH, projects: [], owners: [], channels: [], hasMoreChannels: false } };
    const snapshot = parseCentralSearchSnapshot(input, EMPTY_CENTRAL_SEARCH, 0);
    expect(snapshot.sourceMembership).toEqual(sourceMembership); expect(snapshot.customers[0].leadCreatedAt).toBeNull();
    expect(snapshot.customers[0].visitHistoryDate).toBe('2020-01-01'); expect(snapshot.customers[0].interests[0].visitHistoryDate).toBe('2022-01-02');
    delete (input.customers[0] as Partial<typeof input.customers[number]>).sourceKind;
    expect(() => parseCentralSearchSnapshot(input, EMPTY_CENTRAL_SEARCH, 0)).toThrow();
  });
});
