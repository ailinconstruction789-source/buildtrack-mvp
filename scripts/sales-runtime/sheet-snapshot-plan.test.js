// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { customerSheetHeaders, prepareSheetImportReview } from './sheet-import-review.mjs';
import { reviewSheetRelationships } from './sheet-relationship-review.mjs';
import { reviewSheetIdentityDecisions } from './sheet-identity-decisions.mjs';
import { prepareSheetSnapshotPlan, summarizeSheetSnapshotPlan, assertSameSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';
import { reviewedPendingRows } from './sheet-pending-review-20260929.mjs';

function fixture(sha256 = 'a'.repeat(64)) {
    const cells = [
        { 2: 'PRIVATE SAME', 1: '2026-08-01', 5: '9', 7: 'โอนเเล้ว', 10: '2026-09-01' },
        { 2: 'PRIVATE SAME', 1: '2026-08-02', 4: 'AL3', 5: '53', 7: 'ยกเลิกจอง', 9: '2026-09-02', 11: 'PRIVATE P' },
        { 2: 'PRIVATE NICKNAME' }, { 2: 'PRIVATE NICKNAME' },
        { 2: 'PRIVATE OWNERLESS', 11: null }, { 2: null },
        { 2: 'PRIVATE CANCELLED', 7: 'ยกเลิกจอง' },
        { 2: 'PRIVATE MULTI', 4: 'K4, AL3', 5: null }, { 2: 'PRIVATE CENTRAL', 4: null },
    ];
    const rows = cells.map((changes, i) => {
        const values = ['2026-07-01', null, 'PRIVATE CUSTOMER', 'PRIVATE OCCUPATION', 'K4', null,
            null, 'เยียมชม', null, null, null, 'PRIVATE J', null, null, null, null, null];
        for (const [index, value] of Object.entries(changes)) values[Number(index)] = value;
        return { rowNumber: i + 2, hidden: true, formulaColumns: [], values };
    });
    const draft = prepareSheetImportReview({ version: 'customer-sheet-extract-v1', sheet: 'ข้อมูลลูกค้า',
        sha256, snapshotDate: '2026-09-28', phonePolicy: 'unknown_confirmed', headers: [...customerSheetHeaders],
        maxRow: rows.length + 1, rows }, null, { sourceSha256: sha256, decisionRef: 'SYNTHETIC',
        mappings: [{ sourceOwnerLabel: 'PRIVATE J', ownerLogin: 'JEEJEE' }, { sourceOwnerLabel: 'PRIVATE P', ownerLogin: 'PIEW' }] });
    const aliases = [['K4', 'PROJECT K'], ['AL3', 'PROJECT A']];
    const catalog = { version: 'sales-plot-catalog-read-only-v1', projectRef: 'kbthmdedilswdmmczfay',
        generatedAt: '2026-09-29T00:00:00Z', projectCount: 2, plotCount: 2,
        projects: [{ name: 'PROJECT K' }, { name: 'PROJECT A' }],
        plots: [{ id: 'K-9', projectName: 'PROJECT K', plotName: '9' }, { id: 'A-53', projectName: 'PROJECT A', plotName: '53' }] };
    const relationships = reviewSheetRelationships(draft, catalog, aliases,
        { sourceSha256: sha256, projectRef: catalog.projectRef, decisionRef: 'SYNTHETIC', aliases });
    const reviewed = reviewSheetIdentityDecisions(relationships, { sourceSha256: sha256,
        reviewInputDigest: draft.inputDigest, decisionRef: 'SYNTHETIC', decisions: [
            { group: 'N001', rows: [2, 3], kind: 'same_person', centralOwnerLogin: 'JEEJEE', centralOwnerDecisionRef: 'SYNTHETIC' },
            { group: 'N002', rows: [4, 5], kind: 'distinct_people' },
        ] });
    const pending = { sourceSha256: sha256, decisionRef: 'SYNTHETIC',
        rows: [{ row: 6, reason: 'OWNER_REQUIRED' }, { row: 7, reason: 'NAME_REQUIRED' }] };
    return { draft, reviewed, pending };
}
const assemble = f => prepareSheetSnapshotPlan(f.draft, f.reviewed, f.pending);

describe('offline source snapshot plan (not an insert payload)', () => {
    it('preserves every source row and booking, with only explicitly confirmed identity joining', () => {
        const f = fixture(), before = structuredClone(f), plan = assemble(f);
        expect(f).toEqual(before);
        expect(summarizeSheetSnapshotPlan(plan).counts).toEqual({ preservedSourceRows: 9, customerCandidates: 7,
            customerCandidatesOnHold: 1, sourceRowsWithoutCustomer: 1, interestCandidates: 8,
            interestCandidatesOnHold: 1, bookingHistoryRows: 3, bookingHistoryOnHold: 1,
            bookingHistoryWithoutPlot: 1, sourceRowsAwaitingAdmin: 2 });
        const merged = plan.customers.find(c => c.sourceRows.includes(2));
        expect(merged.sourceRows).toEqual([2, 3]); expect(merged.ownerLogin).toBe('JEEJEE');
        expect(plan.interests.filter(i => i.customerKey === merged.sourceEntityKey).map(i => i.ownerLogin)).toEqual(['JEEJEE', 'PIEW']);
        expect(plan.bookings.slice(0, 2).map(b => b.customerKey)).toEqual([merged.sourceEntityKey, merged.sourceEntityKey]);
        expect(plan.bookings[0].sourceEntityKey).not.toBe(plan.bookings[1].sourceEntityKey);
        const nicknames = plan.customers.filter(c => c.name === 'PRIVATE NICKNAME');
        expect(nicknames).toHaveLength(2); expect(nicknames[0].sourceEntityKey).not.toBe(nicknames[1].sourceEntityKey);
    });
    it('holds missing names and owners without assigning Admin or losing evidence', () => {
        const plan = assemble(fixture());
        expect(plan.customers.find(c => c.sourceRows.includes(6))).toMatchObject({ ownerLogin: null, reviewHolds: ['OWNER_REQUIRED'] });
        expect(plan.customers.some(c => c.sourceRows.includes(7))).toBe(false);
        expect(plan.sourceRecords.find(s => s.sourceRow === 7)).toMatchObject({ customerKey: null, disposition: 'admin_review' });
        expect(plan.sourceRecords.find(s => s.sourceRow === 7).rawValues[3]).toBe('PRIVATE OCCUPATION');
        expect(plan.bookings.find(b => b.sourceRow === 8)).toMatchObject({ plotId: null, stage: 'cancelled', reviewHolds: ['PLOT_UNKNOWN'] });
    });
    it('does not invent phones, lead/KPI dates, completed visits, money or interest stages', () => {
        const p = assemble(fixture());
        expect(p.customers.every(c => c.phone === null && c.leadDate === null && c.phoneStatus === 'unknown')).toBe(true);
        expect(p.interests.every(i => i.status === null && i.classification === 'legacy_unclassified')).toBe(true);
        expect(p.sourceRecords.every(s => s.reviewedHistory.visitCompleted === false)).toBe(true);
        expect(p.bookings.every(b => b.salePrice === null && b.depositAmount === null)).toBe(true);
        expect(p.sourceRecords.find(s => s.sourceRow === 8).sourceIssues).toContain('CANCELLATION_DATE_UNKNOWN');
        expect(p).toMatchObject({ importReady: false, deletionAuthorized: false, productionChanged: false });
    });
    it('keeps reproducible keys/digest within the same snapshot regardless of input order', () => {
        const f = fixture(), p = assemble(f); f.draft.entries.reverse(); f.reviewed.identity.groups.reverse(); f.pending.rows.reverse();
        expect(assemble(f)).toEqual(p); expect(() => assertSameSheetSnapshotPlan(p, p.planDigest)).not.toThrow();
    });
    it('does not pretend row keys are permanent IDs across source revisions', () => {
        const old = assemble(fixture()), revised = assemble(fixture('c'.repeat(64)));
        expect(revised.customers[0].sourceEntityKey).not.toBe(old.customers[0].sourceEntityKey);
        expect(() => assertSameSheetSnapshotPlan(revised, old.planDigest)).toThrow('SNAPSHOT_PLAN_CHANGED');
    });
    it('detects changed plan contents even if the old fingerprint is left in place', () => {
        const p = assemble(fixture()), digest = p.planDigest; p.customers[0].ownerLogin = 'PIEW';
        expect(() => assertSameSheetSnapshotPlan(p, digest)).toThrow('SNAPSHOT_PLAN_CHANGED');
    });
    it('fingerprints reviewed central ownership but does not replace historical owners', () => {
        const f = fixture(), old = assemble(f); f.reviewed.identity.groups[0].centralOwnerLogin = 'PIEW';
        const next = assemble(f); expect(next.planDigest).not.toBe(old.planDigest);
        expect(next.interests.map(i => i.ownerLogin)).toEqual(old.interests.map(i => i.ownerLogin));
    });
    it('prints only redacted summary without names, occupations or raw cells', () => {
        const summary = JSON.stringify(summarizeSheetSnapshotPlan(assemble(fixture())));
        expect(summary).not.toMatch(/PRIVATE|PROJECT K|PROJECT A|rawValues|JEEJEE|PIEW/);
    });
    it.each([
        f => { f.reviewed.sourceSha256 = 'd'.repeat(64); },
        f => { f.reviewed.inputDigest = 'd'.repeat(64); },
        f => { f.reviewed.aliasStatus = 'proposed_not_import_authority'; },
        f => { f.reviewed.plots.activeCandidateCollisions.push({ rows: [2, 3] }); },
        f => { f.reviewed.identity.groups.pop(); },
        f => { f.reviewed.identity.groups[0].identityDecision = 'pending'; },
        f => { f.reviewed.identity.groups[0].customerPartitions = [[2]]; },
        f => { f.draft.entries[1].sourceKey = f.draft.entries[0].sourceKey; },
        f => { f.pending.rows.pop(); }, f => { f.pending.rows.push({ row: 2, reason: 'OWNER_REQUIRED' }); },
        f => { f.pending.sourceSha256 = 'd'.repeat(64); },
        f => { f.pending.rows.push({ ...f.pending.rows[0] }); },
        f => { f.reviewed.projects[0].catalogMatches = 2; },
        f => { f.reviewed.plots.reviews.pop(); },
        f => { f.reviewed.plots.reviews[0].sourcePlot = 'wrong'; },
        f => { f.reviewed.plots.reviews[0].reason = 'PLOT_LABEL_AMBIGUOUS'; },
    ])('rejects stale/incomplete/ambiguous decisions %#', mutate => {
        const f = fixture(); mutate(f); expect(() => assemble(f)).toThrow();
    });
    it.each(['PRIMARY_INPUT_FORMULA_REVIEW', 'STATUS_MAPPING_REQUIRED', 'PROJECT_LIST_REVIEW',
        'VISIT_DATE_REVIEW', 'SALE_PRICE_REVIEW', 'STATUS_EVENT_CONFLICT', 'BOOKING_EVENT_ORDER_REVIEW',
        'SALES_OWNER_UNMAPPED', 'UNKNOWN_FUTURE_ISSUE'])('does not discard unresolved structural issue %s', issue => {
        const f = fixture(); f.draft.entries[0].issues.push(issue);
        expect(() => assemble(f)).toThrow('SOURCE_ISSUES_REQUIRE_REVIEW');
    });
    it('pins exactly the six user-confirmed Admin holds', () => {
        expect(reviewedPendingRows.rows).toEqual([438, 439, 440, 444, 680, 894].map(row =>
            ({ row, reason: row === 680 ? 'NAME_REQUIRED' : 'OWNER_REQUIRED' })));
    });
});
