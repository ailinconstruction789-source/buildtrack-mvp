// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reviewReplacementSnapshot } from './replacement-snapshot.mjs';

const catalog = () => ({ projects: ['P1', 'P2'], salesOwners: ['S1', 'S2'],
    plots: [{ id: 'A', project: 'P1' }, { id: 'B', project: 'P2' }] });
const fixture = () => ({ version: 'sales-replacement-source-v1', mode: 'full_snapshot',
    sourceRevision: 'SYNTHETIC-1', asOfDate: '2026-09-28', historyCoverage: 'latest_only',
    declaredCounts: { customers: 1, interests: 1, bookings: 1 },
    customers: [{ sourceKey: 'C1', name: 'SYNTHETIC PERSON', owner: 'S1',
        phone: '0812345678', phoneStatus: 'provided', status: 'following_up', leadDate: '2026-09-01' }],
    interests: [{ sourceKey: 'I1', customerKey: 'C1', project: 'P1', owner: 'S2', status: 'considering' }],
    bookings: [{ sourceKey: 'B1', interestKey: 'I1', plotId: 'A', stage: 'booked',
        bookedDate: '2026-09-10', transferredDate: null, cancelledDate: null,
        cancelReason: null, salePrice: 2000000, depositAmount: null }] });
const codes = r => r.errors.map(e => e.code);
const recount = s => { for (const k of ['customers', 'interests', 'bookings']) s.declaredCounts[k] = s[k].length; };

describe('full replacement source review, no side effects', () => {
    it('accepts valid review input but never authorizes import or deletion', () => {
        const s = fixture(), c = catalog(), before = structuredClone({ s, c });
        const r = reviewReplacementSnapshot(s, c);
        expect(r.canProceedToMappingReview).toBe(true);
        expect(r).toMatchObject({ importReady: false, deletionAuthorized: false, productionChanged: false });
        expect({ s, c }).toEqual(before);
        expect(r.warnings.map(w => w.code)).toContain('HISTORY_NOT_PROVEN_COMPLETE');
        expect(JSON.stringify(r)).not.toMatch(/SYNTHETIC PERSON|0812345678|S1|2000000/);
    });
    it.each([null, {}, { ...fixture(), mode: 'incremental' }, { ...fixture(), asOfDate: '2026-02-30' },
        { ...fixture(), sourceRevision: '' }, { ...fixture(), historyCoverage: 'assumed' }])('rejects invalid envelope %#', s => {
        expect(codes(reviewReplacementSnapshot(s, catalog()))).toContain('SOURCE_CONTRACT_INVALID');
    });
    it.each([null, {}, { ...catalog(), salesOwners: ['S1', 'S1'] },
        { ...catalog(), plots: [{ id: 'A', project: 'missing' }] }])('requires unambiguous reference catalog %#', c => {
        expect(codes(reviewReplacementSnapshot(fixture(), c))).toContain('REFERENCE_CATALOG_INVALID');
    });
    it('does not let an empty file become a replacement', () => {
        const s = fixture(); s.customers = []; s.interests = []; s.bookings = []; recount(s);
        expect(codes(reviewReplacementSnapshot(s, catalog()))).toContain('EMPTY_REPLACEMENT_BLOCKED');
    });
    it.each([
        [s => { s.declaredCounts.customers = 895; }, 'SOURCE_COUNT_MISMATCH'],
        [s => { s.customers[0].sourceKey = null; }, 'SOURCE_KEY_REQUIRED'],
        [s => { s.customers.push({ ...s.customers[0] }); recount(s); }, 'DUPLICATE_SOURCE_KEY'],
        [s => { s.customers[0].name = ''; }, 'CUSTOMER_NAME_REQUIRED'],
        [s => { s.customers[0].owner = 'Admin'; }, 'SALES_OWNER_UNREVIEWED'],
        [s => { s.customers[0].phone = '000-000-0000'; }, 'PLACEHOLDER_PHONE_REQUIRES_REVIEW'],
        [s => { s.customers[0].phone = null; }, 'PHONE_EVIDENCE_INVALID'],
        [s => { s.customers[0].leadDate = '2026-02-30'; }, 'EVENT_DATE_INVALID'],
        [s => { s.customers[0].leadDate = '2027-01-01'; }, 'EVENT_DATE_INVALID'],
        [s => { s.customers[0].leadDate = undefined; }, 'EVENT_DATE_INVALID'],
        [s => { s.customers[0].status = 'Visited'; }, 'STATUS_MAPPING_REQUIRED'],
        [s => { s.interests[0].customerKey = 'missing'; }, 'CUSTOMER_REFERENCE_MISSING'],
        [s => { s.interests[0].project = 'missing'; }, 'PROJECT_REFERENCE_MISSING'],
        [s => { s.interests.push({ ...s.interests[0], sourceKey: 'I2' }); recount(s); }, 'DUPLICATE_CUSTOMER_PROJECT'],
        [s => { s.bookings[0].interestKey = 'missing'; }, 'INTEREST_REFERENCE_MISSING'],
        [s => { s.bookings[0].plotId = 'missing'; }, 'PLOT_REFERENCE_MISSING'],
        [s => { s.bookings[0].plotId = 'B'; }, 'PLOT_PROJECT_MISMATCH'],
        [s => { s.bookings[0].stage = 'unknown'; }, 'STATUS_MAPPING_REQUIRED'],
        [s => { s.bookings.push({ ...s.bookings[0], sourceKey: 'B2' }); recount(s); }, 'PLOT_HAS_MULTIPLE_ACTIVE_BOOKINGS'],
        [s => { s.bookings[0].cancelledDate = '2026-09-20'; }, 'CANCELLATION_STATE_CONFLICT'],
        [s => { s.bookings[0].transferredDate = '2026-09-20'; }, 'TRANSFER_STATE_CONFLICT'],
        [s => { s.bookings[0].stage = 'transferred'; s.bookings[0].transferredDate = '2026-09-02'; }, 'EVENT_ORDER_INVALID'],
        [s => { s.bookings[0].salePrice = '2000000'; }, 'MONEY_INVALID'],
        [s => { s.bookings[0].depositAmount = -1; }, 'MONEY_INVALID'],
        [s => { s.bookings[0].depositAmount = 0.00001; }, 'MONEY_INVALID'],
        [s => { s.customers[0] = null; }, 'ROW_INVALID'],
    ])('blocks bad mapping %#', (mutate, expected) => {
        const s = fixture(); mutate(s);
        const r = reviewReplacementSnapshot(s, catalog());
        expect(r.canProceedToMappingReview).toBe(false); expect(codes(r)).toContain(expected);
    });
    it('keeps unknown historical fields unknown without inventing dates or money', () => {
        const s = fixture(); Object.assign(s.customers[0], { phone: null, phoneStatus: 'unknown', leadDate: null });
        Object.assign(s.bookings[0], { stage: 'cancelled', bookedDate: null, salePrice: null });
        const r = reviewReplacementSnapshot(s, catalog());
        expect(r.errors).toEqual([]);
        expect(r.warnings.map(w => w.code)).toEqual(expect.arrayContaining([
            'PHONE_UNKNOWN', 'DATE_UNKNOWN', 'MONEY_UNKNOWN', 'CANCELLATION_DATE_UNKNOWN', 'CANCELLATION_REASON_UNKNOWN']));
        expect(s.bookings[0].salePrice).toBeNull(); expect(s.customers[0].leadDate).toBeNull();
    });
    it('does not merge people by shared phone or identical name', () => {
        const s = fixture(); s.customers.push({ ...s.customers[0], sourceKey: 'C2', phone: '+66 81 234 5678' }); recount(s);
        const r = reviewReplacementSnapshot(s, catalog());
        expect(r.errors).toEqual([]); expect(r.counts.customers).toBe(2);
        expect(r.warnings.map(w => w.code)).toContain('SHARED_PHONE_DO_NOT_MERGE');
    });
    it('allows central customers with no interest or booking', () => {
        const s = fixture(); s.interests = []; s.bookings = []; recount(s);
        expect(reviewReplacementSnapshot(s, catalog()).errors).toEqual([]);
    });
    it('allows multiple projects and different project owners for one customer', () => {
        const s = fixture(); s.interests.push({ ...s.interests[0], sourceKey: 'I2', project: 'P2', owner: 'S1' }); recount(s);
        expect(reviewReplacementSnapshot(s, catalog()).errors).toEqual([]);
    });
    it('keeps a cancellation and rebooking as separate records', () => {
        const s = fixture(); s.bookings.push({ ...s.bookings[0], sourceKey: 'B2', stage: 'cancelled',
            cancelledDate: '2026-09-11', cancelReason: 'SYNTHETIC reason' }); recount(s);
        const r = reviewReplacementSnapshot(s, catalog());
        expect(r.errors).toEqual([]); expect(r.counts.bookings).toBe(2);
    });
    it('counts transferred and loan-rejected bookings as occupying plots until explicit cancellation', () => {
        for (const stage of ['loan_rejected', 'transferred', 'handover']) {
            const s = fixture(); s.bookings.push({ ...s.bookings[0], sourceKey: 'B2', stage }); recount(s);
            expect(codes(reviewReplacementSnapshot(s, catalog()))).toContain('PLOT_HAS_MULTIPLE_ACTIVE_BOOKINGS');
        }
    });
    it('does not assert historical completeness even when source claims full history', () => {
        const s = fixture(); s.historyCoverage = 'full'; s.bookings[0].depositAmount = 0;
        const r = reviewReplacementSnapshot(s, catalog()); expect(r.errors).toEqual([]);
        expect(r.importReady).toBe(false);
    });
});
