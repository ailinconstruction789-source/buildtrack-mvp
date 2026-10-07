// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { syntheticExternalSnapshot } from './external-snapshot-fixture.mjs';
import { reviewBookingInventory } from './booking-inventory-review.mjs';

function inventory() {
    return { projectRef: 'kbthmdedilswdmmczfay', generatedAt: '2026-09-29T00:00:00Z',
        plots: [
            { id: 'K-9', projectName: 'PROJECT K', plotName: '9', hasCustomer: true, saleStatus: 'transferred' },
            { id: 'A-53', projectName: 'PROJECT A', plotName: '53', hasCustomer: false, saleStatus: 'available' },
        ], sales: [
            { id: 'sale1', plotId: 'K-9', status: 'Transferred', bookedDate: '2026-08-01', transferredDate: '2026-09-01' },
            { id: 'sale2', plotId: 'A-53', status: 'Cancelled', bookedDate: '2026-08-02', transferredDate: null },
        ] };
}
describe('read-only booking inventory comparison', () => {
    it('does not mutate inputs, infer identity, leak names or return reuse instructions', () => {
        const plan = syntheticExternalSnapshot(), data = inventory(), before = structuredClone({ plan, data });
        const report = reviewBookingInventory(plan, data);
        expect({ plan, data }).toEqual(before);
        expect(report.counts).toMatchObject({ sourceBookings: 3, legacySales: 2, sourceUnknownPlot: 1,
            sourceRowsWithOneDateCandidate: 2, plotClassifications: { same_stage: 1, no_active_sale: 1 } });
        expect(report.rows.every(r => r.identityConfirmed === false && r.reuseSaleId === null)).toBe(true);
        expect(JSON.stringify(report)).not.toMatch(/SYNTHETIC SAME|SYNTHETIC CANCELLED|sale1|sale2/);
        expect(report).toMatchObject({ productionChanged: false, deletionAuthorized: false, activationReady: false });
    });
    it('compares active holdings separately from cancelled histories', () => {
        const data = inventory(); data.sales[1].status = 'Reserved'; data.plots[1].hasCustomer = true;
        const report = reviewBookingInventory(syntheticExternalSnapshot(), data);
        expect(report.plotReview.find(p => p.plotId === 'A-53')).toMatchObject({ classification: 'occupied_only_in_legacy', after: [] });
    });
    it('reports source-only active plots without calling them new customers', () => {
        const data = inventory(); data.sales.shift(); data.plots[0].hasCustomer = false;
        const report = reviewBookingInventory(syntheticExternalSnapshot(), data);
        expect(report.counts.plotClassifications.occupied_only_in_source).toBe(1);
        expect(report.counts.transferredFlagsWithoutLegacyTransfer).toBe(1);
    });
    it('does not silently downgrade contracted to booked', () => {
        const data = inventory(); data.sales[0].status = 'Contracted';
        expect(reviewBookingInventory(syntheticExternalSnapshot(), data).counts.plotClassifications.stage_changed).toBe(1);
    });
    it('reports duplicate active sales and ambiguous date matches', () => {
        const data = inventory(); data.sales.push({ ...data.sales[0], id: 'sale3' });
        const report = reviewBookingInventory(syntheticExternalSnapshot(), data);
        expect(report.counts.plotClassifications.active_collision).toBe(1);
        expect(report.counts.sourceRowsWithMultipleDateCandidates).toBe(1);
    });
    it('unknown dates and null plots cannot be matching evidence', () => {
        const data = inventory(); data.sales[0].bookedDate = null;
        data.sales.push({ id: 'sale3', plotId: null, status: 'Cancelled', bookedDate: null, transferredDate: null });
        const report = reviewBookingInventory(syntheticExternalSnapshot(), data);
        expect(report.rows[0].knownDateCandidateCount).toBe(0);
        expect(report.rows.find(r => r.plotId === null).samePlotCount).toBe(0);
        expect(report.counts.legacyUnknownPlot).toBe(1);
    });
    it('reports flags inconsistent with current sales independently', () => {
        const data = inventory(); data.plots[0].hasCustomer = false;
        expect(reviewBookingInventory(syntheticExternalSnapshot(), data).counts.occupancyFlagMismatches).toBe(1);
    });
    it.each([
        data => { data.sales[0].status = null; },
        data => { data.sales[0].plotId = 'missing'; },
        data => { data.sales[0].bookedDate = '2026-02-30'; },
        data => { data.plots[0].projectName = 'WRONG'; },
        data => { data.plots.push(data.plots[0]); },
        data => { data.sales.push(data.sales[0]); },
        data => { data.projectRef = 'other'; },
    ])('rejects invalid or changed catalog input', mutate => {
        const data = inventory(); mutate(data);
        expect(() => reviewBookingInventory(syntheticExternalSnapshot(), data)).toThrow('BOOKING_INVENTORY_INPUT_INVALID');
    });
    it('rejects changed snapshot content even with the original digest', () => {
        const plan = syntheticExternalSnapshot(); plan.bookings[0].plotId = 'A-53';
        expect(() => reviewBookingInventory(plan, inventory())).toThrow('SNAPSHOT_PLAN_CHANGED');
    });
});
