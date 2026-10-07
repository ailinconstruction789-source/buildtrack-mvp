// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { customerSheetHeaders, prepareSheetImportReview } from './sheet-import-review.mjs';
import { proposedProjectAliases } from './sheet-relationship-review.mjs';
import { reconcileSheetSourceRefresh } from './sheet-source-refresh.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture() {
    const rows = Array.from({ length: 966 }, (_, i) => ({ rowNumber: i + 2, hidden: i < 2, formulaColumns: [], values: Array(17).fill(null) }));
    for (const row of rows.slice(0, 2)) Object.assign(row.values, { 0: '2026-07-01', 2: 'SYNTHETIC SAME', 4: 'K4', 7: 'เยียมชม', 11: 'SYNTHETIC OWNER' });
    rows[0].values[0] = '2569-07-01';
    rows[0].values[5] = '01';
    const prior = { version: 'customer-sheet-extract-v1', sheet: 'ข้อมูลลูกค้า', sha256: 'a'.repeat(64),
        snapshotDate: '2026-09-28', phonePolicy: 'unknown_confirmed', headers: [...customerSheetHeaders], maxRow: 967, rows };
    const catalog = { version: 'sales-plot-catalog-read-only-v1', projectRef: 'kbthmdedilswdmmczfay',
        generatedAt: '2026-09-28T00:00:00Z', projectCount: 1, plotCount: 1, projects: [{ name: 'กานต์รวี4', isClosed: true }], plots: [{ id: 'K-1', projectName: 'กานต์รวี4', plotName: '1' }] };
    const dates = { sourceSha256: prior.sha256, decisions: [{ rowNumber: 2, columnIndex: 0, expectedValue: '2569-07-01',
        correctedDate: '2026-07-01', reason: 'SYNTHETIC confirmation', decisionRef: 'SYNTHETIC date' }] };
    const owners = { sourceSha256: prior.sha256, decisionRef: 'SYNTHETIC owner', mappings: [{ sourceOwnerLabel: 'SYNTHETIC OWNER', ownerLogin: 'JEEJEE' }] };
    const original = prepareSheetImportReview(prior, dates, owners);
    const approvals = { dates, owners,
        projects: { sourceSha256: prior.sha256, projectRef: catalog.projectRef, decisionRef: 'SYNTHETIC projects', aliases: proposedProjectAliases },
        plots: { sourceSha256: prior.sha256, catalogDigest: hash(catalog), decisionRef: 'SYNTHETIC plots', mappings: [{ row: 2, sourceProject: 'K4', sourcePlot: '01', targetLabel: '1', candidateId: 'K-1', kind: 'leading_zero' }] },
        identities: { sourceSha256: prior.sha256, reviewInputDigest: original.inputDigest, decisionRef: 'SYNTHETIC identities',
            decisions: [{ group: 'N001', rows: [2, 3], kind: 'same_person', centralOwnerLogin: 'JEEJEE', centralOwnerDecisionRef: 'SYNTHETIC central owner' }] },
        pending: { sourceSha256: prior.sha256, decisionRef: 'SYNTHETIC holds', rows: [] },
    };
    const fresh = structuredClone(prior); fresh.sha256 = 'b'.repeat(64); fresh.snapshotDate = '2026-09-29';
    fresh.rows[0].hidden = false; fresh.rows[0].values[0] = '2026-07-01';
    fresh.rows[965].values[2] = 'OUTSIDE RELEASE DO NOT IMPORT';
    return { prior, fresh, priorCatalog: catalog, freshCatalog: { ...structuredClone(catalog), generatedAt: '2026-09-29T00:00:00Z' }, approvals };
}
describe('source refresh carries only proven unchanged decisions', () => {
    it('binds the new hash, preserves historical unknowns and excludes row 967', () => {
        const input = fixture(), original = structuredClone(input);
        const { plan, receipt } = reconcileSheetSourceRefresh(input);
        expect(input).toEqual(original);
        expect(plan.sourceSha256).toBe(input.fresh.sha256);
        expect(plan.customers).toHaveLength(1);
        expect(plan.customers[0]).toMatchObject({ phone: null, leadDate: null, ownerLogin: 'JEEJEE' });
        expect(plan.skippedSourceRows).not.toContain(967);
        expect(JSON.stringify(plan)).not.toContain('OUTSIDE RELEASE');
        expect(receipt).toMatchObject({ includedRows: 965, excludedRows: 1, remainingDateCorrections: 0,
            visibilityChangedRows: 1, customerAndHistoryProposalsUnchanged: true, importReady: false, productionChanged: false });
        expect(receipt.alreadyConfirmedDatesAppliedInSource).toEqual([{ row: 2, column: 1, decisionRef: 'SYNTHETIC date' }]);
        expect(JSON.stringify(receipt)).not.toContain('SYNTHETIC SAME');
    });
    it('keeps a still-needed confirmed date correction in the import only', () => {
        const input = fixture(); input.fresh.rows[0].values[0] = '2569-07-01';
        const { plan, receipt } = reconcileSheetSourceRefresh(input);
        expect(receipt.remainingDateCorrections).toBe(1);
        expect(plan.sourceRecords[0].correctedDates).toHaveLength(1);
    });
    it.each([0, 2, 4, 7, 11, 12])('requires review for unapproved changes in column %s', col => {
        const input = fixture(); input.fresh.rows[1].values[col] = 'UNREVIEWED';
        expect(() => reconcileSheetSourceRefresh(input)).toThrow('REFRESH_VALUE_REVIEW_REQUIRED');
    });
    it('rejects changed formula presence, missing rows and invalid source hash', () => {
        const a = fixture(); a.fresh.rows[1].formulaColumns = [0];
        expect(() => reconcileSheetSourceRefresh(a)).toThrow('REFRESH_FORMULA_COLUMNS_CHANGED');
        const b = fixture(); b.fresh.rows.splice(10, 1);
        expect(() => reconcileSheetSourceRefresh(b)).toThrow();
        const c = fixture(); c.prior.sha256 = 'c'.repeat(64);
        expect(() => reconcileSheetSourceRefresh(c)).toThrow();
    });
    it('rejects changed catalog meaning or previously approved digest', () => {
        const a = fixture(); a.freshCatalog.projects[0].isClosed = false;
        expect(() => reconcileSheetSourceRefresh(a)).toThrow('REFRESH_CATALOG_CHANGED');
        const b = fixture(); b.approvals.identities.reviewInputDigest = 'c'.repeat(64);
        expect(() => reconcileSheetSourceRefresh(b)).toThrow('REFRESH_ORIGINAL_REVIEW_CHANGED');
    });
});
