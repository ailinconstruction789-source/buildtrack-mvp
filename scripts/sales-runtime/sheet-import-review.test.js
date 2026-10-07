// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertSameSheetReview, customerSheetHeaders, prepareSheetImportReview, summarizeSheetImportReview } from './sheet-import-review.mjs';
import { reviewedSheetOwners } from './sheet-owner-review-20260929.mjs';

const row = (rowNumber = 2, changes = {}) => ({ rowNumber, hidden: true, formulaColumns: [6, 14],
    values: ['2026-09-01', null, 'SYNTHETIC CUSTOMER', 'PRIVATE OCCUPATION', 'PROJECT A', '01',
        'calculated', 'เยียมชม', null, null, null, 'PRIVATE OWNER', null, null, 40, null, null], ...changes });
const fixture = (rows = [row()]) => ({ version: 'customer-sheet-extract-v1', sheet: 'ข้อมูลลูกค้า',
    sha256: 'a'.repeat(64), snapshotDate: '2026-09-28', phonePolicy: 'unknown_confirmed',
    headers: [...customerSheetHeaders], maxRow: rows.length + 1, rows });
const changed = (cells, rowNumber = 2) => {
    const r = row(rowNumber);
    for (const [i, value] of Object.entries(cells)) r.values[Number(i)] = value;
    return r;
};
const correction = () => ({ sourceSha256: 'a'.repeat(64), decisions: [{ rowNumber: 2, columnIndex: 0,
    expectedValue: '2569-07-25', correctedDate: '2026-07-25', reason: 'User confirmed', decisionRef: 'SYNTHETIC-DECISION' }] });
const owners = () => ({ sourceSha256: 'a'.repeat(64), decisionRef: 'SYNTHETIC-OWNER-DECISION',
    mappings: [{ sourceOwnerLabel: 'PRIVATE OWNER', ownerLogin: 'BELL' }] });

describe('customer sheet provisional review, no database or workbook writes', () => {
    it('keeps historical phone/date/owner unknown and does not fabricate completed visits', () => {
        const s = fixture(), original = structuredClone(s);
        const draft = prepareSheetImportReview(s);
        expect(draft.entries[0].proposal).toMatchObject({ phone: null, phoneStatus: 'unknown',
            leadDate: null, ownerLogin: null, intakeStatus: 'legacy_unclassified',
            visitHistoryDate: '2026-09-01', visitCompleted: false, booking: null });
        expect(s).toEqual(original);
        expect(draft).toMatchObject({ importReady: false, deletionAuthorized: false, productionChanged: false });
        expect(draft.globalPending).toContain('IMPORT_PROVENANCE_SCHEMA');
    });
    it('retains hidden rows, skips derived/empty rows and reports no customer identities', () => {
        const s = fixture([row(), row(3, { hidden: false }), row(4, { values: Array(17).fill(null) })]);
        const draft = prepareSheetImportReview(s), summary = summarizeSheetImportReview(draft);
        expect(summary.counts).toMatchObject({ sourceRecords: 2, namedRecords: 2, phoneUnknown: 2,
            hiddenRecords: 1, repeatedNameGroups: 1, skippedFormulaOrEmptyRows: 1 });
        expect(JSON.stringify(summary)).not.toMatch(/SYNTHETIC CUSTOMER|PRIVATE OWNER|PRIVATE OCCUPATION|PROJECT A/);
        expect(draft.entries[0].sourceKey).not.toBe(draft.entries[1].sourceKey);
        expect(draft.entries.every(e => e.issues.includes('CUSTOMER_IDENTITY_REVIEW'))).toBe(true);
    });
    it('retains unnamed rows for review without discarding their history', () => {
        const draft = prepareSheetImportReview(fixture([changed({ 2: '', 11: null })]));
        expect(draft.entries).toHaveLength(1);
        expect(draft.entries[0].issues).toEqual(expect.arrayContaining(['CUSTOMER_NAME_MISSING', 'SALES_OWNER_MISSING']));
    });
    it('retains multiple interests without treating a target plot as booked', () => {
        const e = prepareSheetImportReview(fixture([changed({ 4: 'PROJECT A, PROJECT B' })])).entries[0];
        expect(e.proposal.projectLabels).toEqual(['PROJECT A', 'PROJECT B']);
        expect(e.proposal.targetPlotLabel).toBe('01'); expect(e.proposal.booking).toBeNull();
    });
    it.each([['จอง', 'booked', null, null], ['โอนเเล้ว', 'transferred', null, '2026-09-15'],
        ['ยกเลิกจอง', 'cancelled', '2026-09-16', null]])('preserves booking stage %s', (status, stage, cancelled, transferred) => {
        const e = prepareSheetImportReview(fixture([changed({ 1: '2026-09-02', 7: status, 9: cancelled, 10: transferred, 12: 2500000 })])).entries[0];
        expect(e.proposal.booking).toMatchObject({ stage, bookedDate: '2026-09-02', cancelledDate: cancelled,
            transferredDate: transferred, salePrice: 2500000, depositAmount: null, paymentMethod: null, cancellationReason: null });
    });
    it('keeps cancellation and rebooking separate and only flags simultaneous active claims', () => {
        const s = fixture([changed({ 7: 'ยกเลิกจอง' }), changed({ 7: 'จอง' }, 3)]);
        expect(prepareSheetImportReview(s).plotCollisionRows).toEqual([]);
        s.rows.push(changed({ 7: 'โอนเเล้ว' }, 4)); s.maxRow++;
        const draft = prepareSheetImportReview(s);
        expect(draft.entries).toHaveLength(3);
        expect(draft.plotCollisionRows).toEqual([[3, 4]]);
    });
    it.each([null, '', '-', 0, 2000000])('keeps absent money unknown but numeric zero genuine: %s', value => {
        const e = prepareSheetImportReview(fixture([changed({ 7: 'จอง', 12: value })])).entries[0];
        expect(e.proposal.booking.salePrice).toBe(typeof value === 'number' ? value : null);
    });
    it.each(['2,000,000', -1, 1.234])('holds unnormalized or invalid money %s', value => {
        const e = prepareSheetImportReview(fixture([changed({ 7: 'จอง', 12: value })])).entries[0];
        expect(e.proposal.booking.salePrice).toBeNull(); expect(e.issues).toContain('SALE_PRICE_REVIEW');
    });
    it('allows future forecasts but holds uncertain or impossible actual dates', () => {
        const e = prepareSheetImportReview(fixture([changed({ 0: '2569-07-25', 1: '26 กย 26', 16: '2027-01-01' })])).entries[0];
        expect(e.issues).toEqual(expect.arrayContaining(['VISIT_DATE_REVIEW', 'BOOKING_DATE_REVIEW']));
        expect(e.proposal.visitHistoryDate).toBeNull(); expect(e.proposal.expectedTransferDate).toBe('2027-01-01');
    });
    it.each(['2026-02-30', '2026-09-01T14:00:00', '2026-10-01'])('does not truncate/infer actual date %s', value => {
        expect(prepareSheetImportReview(fixture([changed({ 0: value })])).entries[0].issues).toContain('VISIT_DATE_REVIEW');
    });
    it('applies source-bound approved dates while preserving raw evidence and fingerprinting the decision', () => {
        const s = fixture([changed({ 0: '2569-07-25' })]), before = structuredClone(s), review = correction();
        const original = prepareSheetImportReview(s), draft = prepareSheetImportReview(s, review);
        expect(draft.entries[0].proposal.visitHistoryDate).toBe('2026-07-25');
        expect(draft.entries[0].rawValues[0]).toBe('2569-07-25');
        expect(draft.entries[0].appliedCorrections).toEqual(review.decisions);
        expect(s).toEqual(before); expect(draft.inputDigest).not.toBe(original.inputDigest);
        expect(summarizeSheetImportReview(draft).counts.approvedDateCorrections).toBe(1);
    });
    it.each([
        r => { r.sourceSha256 = 'b'.repeat(64); }, r => { r.decisions[0].expectedValue = 'changed'; },
        r => { r.decisions[0].rowNumber = 3; }, r => { r.decisions[0].columnIndex = 2; },
        r => { r.decisions[0].correctedDate = '2026-02-30'; }, r => { r.decisions[0].reason = ''; },
        r => { r.decisions[0].decisionRef = ''; }, r => { r.decisions.push({ ...r.decisions[0] }); },
    ])('rejects unbound date approval %#', mutate => {
        const r = correction(); mutate(r);
        expect(() => prepareSheetImportReview(fixture([changed({ 0: '2569-07-25' })]), r)).toThrow('SHEET_DATE_REVIEW_INVALID');
    });
    it('does not discard a formula in a primary column even if its cache is blank', () => {
        const r = row(2, { values: Array(17).fill(null), formulaColumns: [2] });
        const draft = prepareSheetImportReview(fixture([r]));
        expect(draft.entries).toHaveLength(1); expect(draft.entries[0].issues).toContain('PRIMARY_INPUT_FORMULA_REVIEW');
    });
    it('holds contradictory status and chronology, and does not infer mortgage from rent-to-own', () => {
        const e = prepareSheetImportReview(fixture([changed({ 1: '2026-08-15', 7: 'จอง', 8: 'เช่าซื้อ', 9: '2026-08-01' })])).entries[0];
        expect(e.issues).toEqual(expect.arrayContaining(['STATUS_EVENT_CONFLICT', 'BOOKING_EVENT_ORDER_REVIEW',
            'BOOKING_BEFORE_RECORDED_VISIT_REVIEW', 'PAYMENT_METHOD_REVIEW']));
    });
    it.each([
        s => { s.sha256 = 'bad'; }, s => { s.headers[0] = 'different'; }, s => { s.snapshotDate = '2026-02-30'; },
        s => { s.phonePolicy = 'guess'; }, s => { s.rows = []; }, s => { s.rows[0].hidden = undefined; },
        s => { s.rows[0].values[0] = {}; }, s => { s.rows[0].formulaColumns = [17]; },
    ])('fails closed on invalid source contract %#', mutate => {
        const s = fixture(); mutate(s); expect(() => prepareSheetImportReview(s)).toThrow();
    });
    it('requires complete contiguous row coverage, including hidden and empty rows', () => {
        expect(() => prepareSheetImportReview(fixture([row(), row(2)]))).toThrow('SHEET_ROW_COVERAGE_INVALID');
        expect(() => prepareSheetImportReview(fixture([row(3)]))).toThrow();
    });
    it('keeps review deterministic and invalidates changed rows/source, not a database replay guarantee', () => {
        const s = fixture([row(), row(3)]), draft = prepareSheetImportReview(s);
        s.rows.reverse(); expect(prepareSheetImportReview(s).inputDigest).toBe(draft.inputDigest);
        expect(() => assertSameSheetReview(draft, draft.inputDigest)).not.toThrow();
        s.rows[0].values[2] = 'REVISED';
        expect(() => assertSameSheetReview(prepareSheetImportReview(s), draft.inputDigest)).toThrow('SHEET_REVIEW_INPUT_CHANGED');
        s.sha256 = 'b'.repeat(64);
        expect(prepareSheetImportReview(s).entries[0].sourceKey).not.toBe(draft.entries[0].sourceKey);
    });
    it('applies explicit owner decisions without changing input, raw history or readiness', () => {
        const s = fixture(), review = owners(), before = structuredClone({ s, review });
        const draft = prepareSheetImportReview(s, null, review);
        expect(draft.entries[0].proposal).toMatchObject({ ownerLogin: 'BELL', sourceOwnerLabel: 'PRIVATE OWNER', phone: null });
        expect(draft.entries[0].rawValues[11]).toBe('PRIVATE OWNER');
        expect({ s, review }).toEqual(before);
        expect(draft.globalPending).not.toContain('SALES_ACCOUNT_MAP');
        expect(draft.globalPending).toContain('SALES_ACCOUNT_BINDING');
        expect(draft).toMatchObject({ importReady: false, deletionAuthorized: false, productionChanged: false });
        const summary = summarizeSheetImportReview(draft);
        expect(summary.ownerMapping).toEqual({ reviewed: true, mappedRecords: 1, mappedNamedRecords: 1,
            missingOwnerRows: [], unmappedOwnerRows: [], byLogin: { BELL: { sourceRecords: 1, namedRecords: 1 } } });
        expect(JSON.stringify(summary)).not.toMatch(/PRIVATE OWNER|SYNTHETIC CUSTOMER/);
    });
    it('never assigns blank, similar-name or formula-derived owners automatically', () => {
        const s = fixture([row(), changed({ 11: null }, 3), changed({ 11: 'PRIVATE OWNER TWO' }, 4),
            row(5, { formulaColumns: [11] })]);
        const draft = prepareSheetImportReview(s, null, owners());
        expect(draft.entries.map(e => e.proposal.ownerLogin)).toEqual(['BELL', null, null, null]);
        const summary = summarizeSheetImportReview(draft);
        expect(summary.ownerMapping.missingOwnerRows).toEqual([3]);
        expect(summary.ownerMapping.unmappedOwnerRows).toEqual([4, 5]);
        expect(draft.globalPending).toEqual(expect.arrayContaining(['SALES_ACCOUNT_MAP', 'SALES_OWNER_ASSIGNMENT']));
    });
    it('counts named and unnamed records separately, and keeps differing owners on same-name rows', () => {
        const s = fixture([row(), changed({ 11: 'SECOND OWNER' }, 3), changed({ 2: null }, 4)]);
        const review = owners(); review.mappings.push({ sourceOwnerLabel: 'SECOND OWNER', ownerLogin: 'FIELD' });
        const draft = prepareSheetImportReview(s, null, review), summary = summarizeSheetImportReview(draft);
        expect(draft.entries).toHaveLength(3);
        expect(draft.entries.map(e => e.proposal.ownerLogin)).toEqual(['BELL', 'FIELD', 'BELL']);
        expect(draft.repeatedNameRows).toEqual([[2, 3]]);
        expect(summary.ownerMapping).toMatchObject({ mappedRecords: 3, mappedNamedRecords: 2,
            byLogin: { BELL: { sourceRecords: 2, namedRecords: 1 }, FIELD: { sourceRecords: 1, namedRecords: 1 } } });
    });
    it.each([
        r => { r.sourceSha256 = 'b'.repeat(64); }, r => { r.decisionRef = ''; },
        r => { r.mappings = []; }, r => { r.mappings[0] = null; },
        r => { r.mappings[0].sourceOwnerLabel = ''; }, r => { r.mappings[0].sourceOwnerLabel = 'UNKNOWN'; },
        r => { r.mappings[0].ownerLogin = 'Admin'; }, r => { r.mappings[0].ownerLogin = 'Owner'; },
        r => { r.mappings[0].ownerLogin = 'BELL-UNKNOWN'; },
        r => { r.mappings.push({ sourceOwnerLabel: ' PRIVATE   OWNER ', ownerLogin: 'FIELD' }); },
    ])('rejects stale, conflicting or invalid owner decisions %#', mutate => {
        const review = owners(); mutate(review);
        expect(() => prepareSheetImportReview(fixture(), null, review)).toThrow('SHEET_OWNER_REVIEW_INVALID');
    });
    it('fingerprints mapping changes and remains deterministic across mapping order', () => {
        const s = fixture([row(), changed({ 11: 'SECOND OWNER' }, 3)]), review = owners();
        review.mappings.push({ sourceOwnerLabel: 'SECOND OWNER', ownerLogin: 'FIELD' });
        const draft = prepareSheetImportReview(s, null, review);
        review.mappings.reverse(); expect(prepareSheetImportReview(s, null, review).inputDigest).toBe(draft.inputDigest);
        review.mappings[0].ownerLogin = 'YING';
        expect(() => assertSameSheetReview(prepareSheetImportReview(s, null, review), draft.inputDigest)).toThrow('SHEET_REVIEW_INPUT_CHANGED');
        expect(prepareSheetImportReview(s).inputDigest).not.toBe(draft.inputDigest);
    });
    it('records all seven mappings exactly as confirmed by the user', () => {
        expect(reviewedSheetOwners.mappings.map(m => [m.sourceOwnerLabel, m.ownerLogin])).toEqual([
            ['นางสาว อัจฉรา ตาปัน', 'JEEJEE'], ['นางสาว สุมลยา คูหา', 'NOOK'],
            ['นางสาว ปวีณา มีวงศ์', 'PIEW'], ['นางสาว วีรกาณต์ เก่งกาจ', 'TEAW'],
            ['นางสาว พนิดดา เสนามิตร', 'BELL'], ['นางสาว จริยา ขันติพงษ์', 'YING'],
            ['นาย กรุณพล อินทร์สุวรรณ', 'FIELD'],
        ]);
        const s = fixture(reviewedSheetOwners.mappings.map((m, i) => changed({ 11: m.sourceOwnerLabel }, i + 2)));
        s.sha256 = reviewedSheetOwners.sourceSha256;
        const summary = summarizeSheetImportReview(prepareSheetImportReview(s, null, reviewedSheetOwners));
        expect(summary.ownerMapping.mappedNamedRecords).toBe(7);
        expect(summary.ownerMapping.unmappedOwnerRows).toEqual([]);
    });
});
