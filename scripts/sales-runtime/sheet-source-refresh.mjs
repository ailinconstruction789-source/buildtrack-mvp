// Offline reconciliation only. Never imports customers, grants roles or edits a workbook.
import { createHash } from 'node:crypto';
import { prepareSheetImportReview } from './sheet-import-review.mjs';
import { reviewSheetRelationships } from './sheet-relationship-review.mjs';
import { reviewSheetIdentityDecisions } from './sheet-identity-decisions.mjs';
import { prepareSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';

export const customerSheetLastRow = 966;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const requireCheck = (yes, code) => { if (!yes) throw new Error(code); };
const catalogShape = catalog => ({
    version: catalog.version, projectRef: catalog.projectRef, projectCount: catalog.projectCount, plotCount: catalog.plotCount,
    projects: catalog.projects.map(p => [p.name, p.isClosed]).sort((a, b) => a[0].localeCompare(b[0])),
    plots: catalog.plots.map(p => [p.id, p.projectName, p.plotName]).sort((a, b) => a[0].localeCompare(b[0])),
});

/** Changes in hidden-row presentation do not change identity. The sole allowed
 * value changes are exact, previously confirmed date corrections already made
 * in the source. Every other value/formula-column/membership change stops here.
 * Returned plan contains PII: persist only in an ignored private release folder.
 */
export function reconcileSheetSourceRefresh({ prior, fresh, priorCatalog, freshCatalog, approvals }) {
    const { dates, owners, projects, plots, identities, pending } = approvals;
    const original = prepareSheetImportReview(prior, dates, owners);
    requireCheck(original.inputDigest === identities.reviewInputDigest, 'REFRESH_ORIGINAL_REVIEW_CHANGED');
    const oldRelations = reviewSheetRelationships(original, priorCatalog, undefined, projects, plots);
    const oldReviewed = reviewSheetIdentityDecisions(oldRelations, identities);
    prepareSheetSnapshotPlan(original, oldReviewed, pending);
    // Validate full source row shape/continuity before deliberately bounding it.
    prepareSheetImportReview(fresh);
    requireCheck(prior.maxRow >= customerSheetLastRow && fresh.maxRow >= customerSheetLastRow
        && equal(prior.headers, fresh.headers) && prior.sheet === fresh.sheet
        && fresh.snapshotDate >= prior.snapshotDate, 'REFRESH_SOURCE_WINDOW_INVALID');
    requireCheck(original.entries.every(e => e.sourceRow <= customerSheetLastRow), 'REFRESH_PRIOR_SCOPE_CHANGED');
    requireCheck(equal(catalogShape(priorCatalog), catalogShape(freshCatalog)), 'REFRESH_CATALOG_CHANGED');
    const oldRows = new Map(prior.rows.map(r => [r.rowNumber, r]));
    const newRows = [...fresh.rows].filter(r => r.rowNumber <= customerSheetLastRow).sort((a, b) => a.rowNumber - b.rowNumber);
    const confirmedDates = new Map(dates.decisions.map(d => [`${d.rowNumber}:${d.columnIndex}`, d]));
    const appliedInSource = [], visibilityRows = [];
    for (const row of newRows) {
        const before = oldRows.get(row.rowNumber);
        requireCheck(equal(before.formulaColumns, row.formulaColumns), 'REFRESH_FORMULA_COLUMNS_CHANGED');
        if (before.hidden !== row.hidden) visibilityRows.push(row.rowNumber);
        for (let col = 0; col < 17; col++) {
            if (equal(before.values[col], row.values[col])) continue;
            const decision = confirmedDates.get(`${row.rowNumber}:${col}`);
            requireCheck(decision && equal(before.values[col], decision.expectedValue)
                && row.values[col] === decision.correctedDate && !row.formulaColumns.includes(col), 'REFRESH_VALUE_REVIEW_REQUIRED');
            appliedInSource.push({ row: row.rowNumber, column: col + 1, decisionRef: decision.decisionRef });
        }
    }
    const rebound = source => ({ ...structuredClone(source), sourceSha256: fresh.sha256 });
    const freshDates = rebound(dates);
    freshDates.decisions = freshDates.decisions.filter(d => !appliedInSource.some(c => c.row === d.rowNumber && c.column === d.columnIndex + 1));
    const bounded = { ...structuredClone(fresh), maxRow: customerSheetLastRow, rows: structuredClone(newRows) };
    const draft = prepareSheetImportReview(bounded, freshDates, rebound(owners));
    // No extra authority: the proposed customer/history data must remain exact.
    requireCheck(equal(original.entries.map(e => [e.sourceRow, e.proposal]), draft.entries.map(e => [e.sourceRow, e.proposal])), 'REFRESH_PROPOSAL_CHANGED');
    const freshPlots = { ...rebound(plots), catalogDigest: hash(freshCatalog) };
    const relations = reviewSheetRelationships(draft, freshCatalog, undefined, rebound(projects), freshPlots);
    const freshIdentities = { ...rebound(identities), reviewInputDigest: draft.inputDigest };
    const reviewed = reviewSheetIdentityDecisions(relations, freshIdentities);
    const plan = prepareSheetSnapshotPlan(draft, reviewed, rebound(pending));
    const rows = [...plan.sourceRecords.map(r => r.sourceRow), ...plan.skippedSourceRows].sort((a, b) => a - b);
    requireCheck(equal(rows, Array.from({ length: 965 }, (_, i) => i + 2)), 'REFRESH_PLAN_WINDOW_INVALID');
    const receipt = {
        version: 'customer-sheet-refresh-reconciliation-v1', priorSourceSha256: prior.sha256, sourceSha256: fresh.sha256,
        priorInputDigest: original.inputDigest, inputDigest: draft.inputDigest,
        priorCatalogDigest: hash(priorCatalog), catalogDigest: hash(freshCatalog), catalogMeaningUnchanged: true,
        sourceSnapshotDate: fresh.snapshotDate, firstRow: 2, lastRow: customerSheetLastRow, includedRows: 965,
        excludedRows: fresh.rows.length - newRows.length, visibilityChangedRows: visibilityRows.length,
        alreadyConfirmedDatesAppliedInSource: appliedInSource, remainingDateCorrections: freshDates.decisions.length,
        customerAndHistoryProposalsUnchanged: true, planDigest: plan.planDigest,
        priorDecisionReferences: [owners.decisionRef, projects.decisionRef, plots.decisionRef, identities.decisionRef, pending.decisionRef],
        importReady: false, productionChanged: false,
    };
    return { plan, receipt: { ...receipt, receiptDigest: hash(receipt) } };
}
