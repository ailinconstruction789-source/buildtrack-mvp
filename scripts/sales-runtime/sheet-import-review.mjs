// Pure, provisional review only. No SQL, database client, file IO or account writes.
// Raw entries contain personal data: callers must output summarizeSheetImportReview only.
import { createHash } from 'node:crypto';
import { centralRosterApproval } from './central-roster.mjs';

export const customerSheetHeaders = Object.freeze(['วันที่เยี่ยมชม', 'วันที่จอง', 'ชื่อ-นามสกุล',
    'อาชีพ', 'โครงการ', 'แปลง', 'รหัสแปลง', 'โอนเเล้ว', 'หมายเหตุสินเชื่อ', 'วันที่ยกเลิก',
    'วันที่โอน', 'พนักงานขาย', 'ราคาซื้อขาย', 'ราคาทด 13', 'ที่ดิน', 'คาดโอนเดือน', 'วันที่คาดว่าจะโอน']);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clean = v => String(v ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const missing = v => v === null || clean(v) === '' || clean(v) === '-';
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const requireCheck = (yes, code) => { if (!yes) throw new Error(code); };
const primary = Array.from({ length: 17 }, (_, i) => i).filter(i => i !== 6 && i !== 14);
const statusMap = new Map([['เยียมชม', 'visit_history'], ['จอง', 'booked'],
    ['โอนเเล้ว', 'transferred'], ['ยกเลิกจอง', 'cancelled']]);

/** Expects the bounded A:Q extraction from read-customer-sheet.py. Only explicit,
 * source-bound date/owner decisions are accepted; no automatic identity mapping.
 * Row keys identify this exact snapshot, never a persistent customer across revisions.
 */
export function prepareSheetImportReview(source, dateReview = null, ownerReview = null) {
    requireCheck(source?.version === 'customer-sheet-extract-v1'
        && source.sheet === 'ข้อมูลลูกค้า' && /^[a-f0-9]{64}$/.test(source.sha256 ?? '')
        && day(source.snapshotDate) && source.phonePolicy === 'unknown_confirmed'
        && JSON.stringify(source.headers) === JSON.stringify(customerSheetHeaders)
        && Number.isSafeInteger(source.maxRow) && source.maxRow >= 2 && source.maxRow <= 50000
        && Array.isArray(source.rows) && source.rows.length === source.maxRow - 1,
    'SHEET_SOURCE_CONTRACT_INVALID');
    const rows = source.rows.map(row => {
        requireCheck(Number.isSafeInteger(row?.rowNumber) && row.rowNumber >= 2 && row.rowNumber <= source.maxRow
            && typeof row.hidden === 'boolean' && Array.isArray(row.values) && row.values.length === 17
            && row.values.every(v => v === null || typeof v === 'string' || typeof v === 'boolean'
                || (typeof v === 'number' && Number.isFinite(v)))
            && Array.isArray(row.formulaColumns) && row.formulaColumns.every(v => Number.isInteger(v) && v >= 0 && v < 17),
        'SHEET_ROW_INVALID');
        return structuredClone(row);
    }).sort((a, b) => a.rowNumber - b.rowNumber);
    requireCheck(rows.every((r, i) => r.rowNumber === i + 2), 'SHEET_ROW_COVERAGE_INVALID');
    const ownerMap = new Map();
    if (ownerReview !== null) {
        requireCheck(ownerReview?.sourceSha256 === source.sha256
            && typeof ownerReview.decisionRef === 'string' && clean(ownerReview.decisionRef) !== ''
            && Array.isArray(ownerReview.mappings) && ownerReview.mappings.length > 0, 'SHEET_OWNER_REVIEW_INVALID');
        const salesLogins = new Set(centralRosterApproval.filter(a => a.role === 'Sales').map(a => a.username));
        const sourceLabels = new Set(rows.map(r => clean(r.values[11])));
        for (const m of ownerReview.mappings) {
            requireCheck(typeof m?.sourceOwnerLabel === 'string' && !missing(m.sourceOwnerLabel)
                && sourceLabels.has(clean(m.sourceOwnerLabel)) && !ownerMap.has(clean(m.sourceOwnerLabel))
                && salesLogins.has(m.ownerLogin), 'SHEET_OWNER_REVIEW_INVALID');
            ownerMap.set(clean(m.sourceOwnerLabel), m.ownerLogin);
        }
    }
    const corrections = new Map();
    if (dateReview !== null) {
        requireCheck(dateReview?.sourceSha256 === source.sha256 && Array.isArray(dateReview.decisions),
            'SHEET_DATE_REVIEW_INVALID');
        for (const decision of dateReview.decisions) {
            const { rowNumber, columnIndex, expectedValue, correctedDate, reason, decisionRef } = decision ?? {};
            const row = rows[rowNumber - 2], key = `${rowNumber}:${columnIndex}`;
            requireCheck(Number.isSafeInteger(rowNumber) && row?.rowNumber === rowNumber
                && [0, 1, 9, 10, 16].includes(columnIndex) && !corrections.has(key)
                && !row.formulaColumns.includes(columnIndex) && row.values[columnIndex] === expectedValue
                && day(correctedDate) && (columnIndex === 16 || correctedDate <= source.snapshotDate)
                && typeof reason === 'string' && clean(reason) !== ''
                && typeof decisionRef === 'string' && clean(decisionRef) !== '', 'SHEET_DATE_REVIEW_INVALID');
            corrections.set(key, structuredClone(decision));
        }
    }
    const entries = [], skippedRows = [], nameGroups = new Map(), plotClaims = new Map();
    for (const row of rows) {
        const v = row.values, issues = [];
        // Ignore calculated G/O, but never silently discard a formula in primary input.
        if (!primary.some(i => !missing(v[i]) || row.formulaColumns.includes(i))) {
            skippedRows.push(row.rowNumber); continue;
        }
        const issue = code => { if (!issues.includes(code)) issues.push(code); };
        const appliedCorrections = [];
        const readDate = (i, field, allowFuture = false) => {
            const correction = corrections.get(`${row.rowNumber}:${i}`);
            if (correction) appliedCorrections.push(correction);
            const value = correction?.correctedDate ?? v[i];
            if (missing(value)) return null;
            if (!day(value) || (!allowFuture && value > source.snapshotDate)) { issue(`${field}_DATE_REVIEW`); return null; }
            return value;
        };
        const name = missing(v[2]) ? null : clean(v[2]);
        const owner = missing(v[11]) ? null : clean(v[11]);
        const stage = statusMap.get(clean(v[7])) ?? null;
        if (row.formulaColumns.some(i => primary.includes(i))) issue('PRIMARY_INPUT_FORMULA_REVIEW');
        if (!name) issue('CUSTOMER_NAME_MISSING');
        if (!owner) issue('SALES_OWNER_MISSING');
        const ownerLogin = owner && !row.formulaColumns.includes(11) ? ownerMap.get(owner) ?? null : null;
        if (ownerReview && owner && !ownerLogin) issue('SALES_OWNER_UNMAPPED');
        if (!stage) issue('STATUS_MAPPING_REQUIRED');
        const projects = missing(v[4]) ? [] : clean(v[4]).split(',').map(p => p.trim());
        if (projects.some(p => !p) || new Set(projects).size !== projects.length) issue('PROJECT_LIST_REVIEW');
        const plot = missing(v[5]) ? null : clean(v[5]);
        const visitDate = readDate(0, 'VISIT'), bookedDate = readDate(1, 'BOOKING');
        const cancelledDate = readDate(9, 'CANCELLATION'), transferredDate = readDate(10, 'TRANSFER');
        const expectedTransferDate = readDate(16, 'EXPECTED_TRANSFER', true);
        let price = null;
        if (!missing(v[12])) {
            if (typeof v[12] !== 'number' || !/^\d{1,13}(\.\d{1,2})?$/.test(String(v[12]))) issue('SALE_PRICE_REVIEW');
            else price = v[12];
        }
        const booking = ['booked', 'transferred', 'cancelled'].includes(stage) ? {
            stage, projectLabel: projects.length === 1 ? projects[0] : null, plotLabel: plot,
            bookedDate, cancelledDate, transferredDate, salePrice: price,
            depositAmount: null, paymentMethod: null, cancellationReason: null,
        } : null;
        if (booking) {
            if (projects.length !== 1) issue('BOOKING_PROJECT_REVIEW');
            if (!plot) issue('BOOKING_PLOT_MISSING');
            if (!bookedDate) issue('BOOKING_DATE_UNKNOWN');
            if (price === null) issue('SALE_PRICE_UNKNOWN');
            if (stage === 'transferred' && !transferredDate) issue('TRANSFER_DATE_UNKNOWN');
            if (stage === 'cancelled' && !cancelledDate) issue('CANCELLATION_DATE_UNKNOWN');
        } else if (bookedDate || transferredDate || cancelledDate || !missing(v[1]) || !missing(v[9]) || !missing(v[10])) {
            issue('STATUS_EVENT_CONFLICT');
        }
        if (stage !== 'cancelled' && !missing(v[9])) issue('STATUS_EVENT_CONFLICT');
        if (stage !== 'transferred' && !missing(v[10])) issue('STATUS_EVENT_CONFLICT');
        if (bookedDate && visitDate && bookedDate < visitDate) issue('BOOKING_BEFORE_RECORDED_VISIT_REVIEW');
        if (cancelledDate && visitDate && cancelledDate < visitDate) issue('CANCELLATION_BEFORE_RECORDED_VISIT_REVIEW');
        if (bookedDate && [cancelledDate, transferredDate].some(d => d && d < bookedDate)) issue('BOOKING_EVENT_ORDER_REVIEW');
        if (clean(v[8]).includes('เช่าซื้อ')) issue('PAYMENT_METHOD_REVIEW');
        const entry = {
            sourceKey: digest([source.sha256, source.sheet, row.rowNumber]), sourceRow: row.rowNumber,
            rowDigest: digest(row), hidden: row.hidden, rawValues: v, appliedCorrections, issues,
            proposal: { customerName: name, phone: null, phoneStatus: 'unknown',
                leadDate: null, intakeStatus: 'legacy_unclassified', ownerLogin, sourceOwnerLabel: owner,
                projectLabels: projects, targetPlotLabel: plot, visitHistoryDate: visitDate,
                visitCompleted: false, expectedTransferDate, booking },
        };
        entries.push(entry);
        if (name) { if (!nameGroups.has(name)) nameGroups.set(name, []); nameGroups.get(name).push(entry); }
        if (booking && stage !== 'cancelled' && projects.length === 1 && plot) {
            const k = JSON.stringify([projects[0], plot]);
            if (!plotClaims.has(k)) plotClaims.set(k, []); plotClaims.get(k).push(entry);
        }
    }
    const repeatedNames = [...nameGroups.values()].filter(g => g.length > 1);
    const collisions = [...plotClaims.values()].filter(g => g.length > 1);
    for (const g of repeatedNames) for (const e of g) e.issues.push('CUSTOMER_IDENTITY_REVIEW');
    for (const g of collisions) for (const e of g) e.issues.push('ACTIVE_PLOT_COLLISION_REVIEW');
    const globalPending = ['CUSTOMER_IDENTITY_MAP', 'PROJECT_PLOT_CATALOG',
        'SOURCE_HISTORY_COMPLETENESS', 'IMPORT_PROVENANCE_SCHEMA', 'LATEST_SNAPSHOT_RECONCILIATION'];
    if (!ownerReview || entries.some(e => e.proposal.sourceOwnerLabel && !e.proposal.ownerLogin)) globalPending.push('SALES_ACCOUNT_MAP');
    // A confirmed label is not a fresh account UUID, permission or availability check.
    if (ownerReview) globalPending.push('SALES_ACCOUNT_BINDING');
    if (entries.some(e => !e.proposal.sourceOwnerLabel)) globalPending.push('SALES_OWNER_ASSIGNMENT');
    return {
        version: 'customer-sheet-review-draft-v1', sha256: source.sha256, snapshotDate: source.snapshotDate,
        inputDigest: digest([source.version, source.sha256, source.sheet, source.snapshotDate,
            source.phonePolicy, source.headers, rows, [...corrections.values()].sort((a, b) => a.rowNumber - b.rowNumber || a.columnIndex - b.columnIndex),
            ...(ownerReview ? [ownerReview.decisionRef, [...ownerMap.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)] : [])]),
        importReady: false, deletionAuthorized: false, productionChanged: false,
        globalPending, ownerDecisionRef: ownerReview?.decisionRef ?? null,
        entries, skippedRows,
        repeatedNameRows: repeatedNames.map(g => g.map(e => e.sourceRow)),
        plotCollisionRows: collisions.map(g => g.map(e => e.sourceRow)),
    };
}

export function summarizeSheetImportReview(draft) {
    const counts = { sourceRecords: draft.entries.length, namedRecords: 0, phoneUnknown: 0,
        hiddenRecords: 0, bookingProposals: 0, multipleProjectRecords: 0,
        recordsWithReviewIssues: 0, approvedDateCorrections: 0, skippedFormulaOrEmptyRows: draft.skippedRows.length,
        repeatedNameGroups: draft.repeatedNameRows.length, plotCollisionGroups: draft.plotCollisionRows.length };
    const issueRows = {}, stages = {};
    const ownerMapping = { reviewed: draft.ownerDecisionRef !== null, mappedRecords: 0,
        mappedNamedRecords: 0, missingOwnerRows: [], unmappedOwnerRows: [], byLogin: {} };
    for (const e of draft.entries) {
        const login = e.proposal.ownerLogin;
        if (login) {
            ownerMapping.mappedRecords++;
            const tally = ownerMapping.byLogin[login] ??= { sourceRecords: 0, namedRecords: 0 };
            tally.sourceRecords++;
            if (e.proposal.customerName) { ownerMapping.mappedNamedRecords++; tally.namedRecords++; }
        } else if (!e.proposal.sourceOwnerLabel) ownerMapping.missingOwnerRows.push(e.sourceRow);
        else ownerMapping.unmappedOwnerRows.push(e.sourceRow);
        counts.approvedDateCorrections += e.appliedCorrections.length;
        if (e.proposal.customerName) { counts.namedRecords++; counts.phoneUnknown++; }
        if (e.hidden) counts.hiddenRecords++;
        if (e.proposal.booking) counts.bookingProposals++;
        if (e.proposal.projectLabels.length > 1) counts.multipleProjectRecords++;
        if (e.issues.length) counts.recordsWithReviewIssues++;
        const stage = e.proposal.booking?.stage ?? 'without_booking_proposal';
        stages[stage] = (stages[stage] ?? 0) + 1;
        for (const issue of e.issues) (issueRows[issue] ??= []).push(e.sourceRow);
    }
    return { version: draft.version, sha256: draft.sha256, snapshotDate: draft.snapshotDate,
        inputDigest: draft.inputDigest, counts, stages, issueRows, ownerMapping, globalPending: [...draft.globalPending],
        importReady: false, deletionAuthorized: false, productionChanged: false };
}

/** Prevent silently reusing an old review for edited input. Not a DB replay guard. */
export function assertSameSheetReview(draft, approvedInputDigest) {
    requireCheck(typeof approvedInputDigest === 'string' && /^[a-f0-9]{64}$/.test(approvedInputDigest)
        && draft.inputDigest === approvedInputDigest, 'SHEET_REVIEW_INPUT_CHANGED');
}
