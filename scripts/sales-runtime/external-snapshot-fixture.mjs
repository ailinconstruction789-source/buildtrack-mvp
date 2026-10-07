// Synthetic-only fixture. Never reads workbook, environment or network.
import { customerSheetHeaders, prepareSheetImportReview } from './sheet-import-review.mjs';
import { reviewSheetRelationships } from './sheet-relationship-review.mjs';
import { reviewSheetIdentityDecisions } from './sheet-identity-decisions.mjs';
import { prepareSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';

export function syntheticExternalSnapshot({ includeHeldBooking = false, firstBookingStage = 'transferred', sourceLastRow = 6 } = {}) {
    if (!['transferred', 'booked'].includes(firstBookingStage)) throw new Error('SYNTHETIC_STAGE_INVALID');
    if (![6, 966].includes(sourceLastRow)) throw new Error('SYNTHETIC_WINDOW_INVALID');
    const sha256 = 'a'.repeat(64);
    const cells = [
        { 2: 'SYNTHETIC SAME', 1: '2026-08-01', 5: '9', 7: 'โอนเเล้ว', 10: '2026-09-01' },
        { 2: 'SYNTHETIC SAME', 1: '2026-08-02', 4: 'AL3', 5: '53', 7: 'ยกเลิกจอง', 9: '2026-09-02', 11: 'SYNTHETIC P' },
        { 2: 'SYNTHETIC OWNERLESS', 11: null }, { 2: null },
        { 2: "SYNTHETIC CANCELLED ' \\ text", 7: 'ยกเลิกจอง' },
    ];
    if (firstBookingStage === 'booked') Object.assign(cells[0], { 7: 'จอง', 10: null });
    if (includeHeldBooking) Object.assign(cells[2], { 1: '2026-08-03', 5: '9', 7: 'ยกเลิกจอง', 9: '2026-09-03' });
    const rows = cells.map((changes, i) => {
        const values = ['2026-07-01', null, 'SYNTHETIC CUSTOMER', 'SYNTHETIC OCCUPATION', 'K4', null,
            null, 'เยียมชม', null, null, null, 'SYNTHETIC J', null, null, null, null, null];
        for (const [index, value] of Object.entries(changes)) values[Number(index)] = value;
        return { rowNumber: i + 2, hidden: true, formulaColumns: [], values };
    });
    for (let rowNumber = 7; rowNumber <= sourceLastRow; rowNumber++) {
        rows.push({ rowNumber, hidden: true, formulaColumns: [], values: Array(17).fill(null) });
    }
    const draft = prepareSheetImportReview({ version: 'customer-sheet-extract-v1', sheet: 'ข้อมูลลูกค้า',
        sha256, snapshotDate: '2026-09-28', phonePolicy: 'unknown_confirmed', headers: [...customerSheetHeaders],
        maxRow: rows.length + 1, rows }, null, { sourceSha256: sha256, decisionRef: 'SYNTHETIC',
        mappings: [{ sourceOwnerLabel: 'SYNTHETIC J', ownerLogin: 'JEEJEE' }, { sourceOwnerLabel: 'SYNTHETIC P', ownerLogin: 'PIEW' }] });
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
        ] });
    return prepareSheetSnapshotPlan(draft, reviewed, { sourceSha256: sha256, decisionRef: 'SYNTHETIC',
        rows: [{ row: 4, reason: 'OWNER_REQUIRED' }, { row: 5, reason: 'NAME_REQUIRED' }] });
}
