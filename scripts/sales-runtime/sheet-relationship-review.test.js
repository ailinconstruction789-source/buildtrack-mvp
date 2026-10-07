// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reviewSheetRelationships } from './sheet-relationship-review.mjs';
import { reviewedSheetProjects } from './sheet-project-review-20260929.mjs';
import { reviewedSheetPlots } from './sheet-plot-review-20260929.mjs';
import { createHash } from 'node:crypto';

const entry = (sourceRow, overrides = {}) => ({ sourceRow,
    rawValues: [null, null, 'PRIVATE CUSTOMER', null, null, null, null, 'เยียมชม'],
    proposal: { customerName: 'PRIVATE CUSTOMER', sourceOwnerLabel: 'PRIVATE STAFF', projectLabels: ['P'],
        targetPlotLabel: '01', ownerLogin: 'BELL', visitHistoryDate: '2026-01-01', booking: null, ...overrides } });
const draft = (entries = [entry(2), entry(3)]) => ({ version: 'customer-sheet-review-draft-v1',
    sha256: 'a'.repeat(64), inputDigest: 'b'.repeat(64), entries, repeatedNameRows: [[2, 3]] });
const catalog = () => ({ version: 'sales-plot-catalog-read-only-v1', projectRef: 'kbthmdedilswdmmczfay',
    generatedAt: '2026-09-29T03:00:00Z', projectCount: 1, plotCount: 1,
    projects: [{ name: 'PROJECT', isClosed: true }], plots: [{ id: 'plot-01', projectName: 'PROJECT', plotName: '01' }] });
const aliases = [['P', 'PROJECT']];
const booking = stage => ({ stage, bookedDate: '2026-02-01', cancelledDate: null, transferredDate: null });

describe('sheet identity and plot comparison only', () => {
    it('groups history without exposing names, inferring identity, or mutating source', () => {
        const d = draft(), c = catalog(), before = structuredClone({ d, c });
        const r = reviewSheetRelationships(d, c, aliases);
        expect(r.identity).toMatchObject({ groupCount: 1, rowCount: 2, categories: { visit_history_only: 1 } });
        expect(r.identity.groups[0].samePersonConfirmed).toBe(false);
        expect(r).toMatchObject({ importReady: false, mergeAuthorized: false, productionChanged: false });
        expect({ d, c }).toEqual(before); expect(JSON.stringify(r)).not.toMatch(/PRIVATE CUSTOMER|PRIVATE STAFF/);
    });
    it('flags multiple booking events, different owners/projects and cancellation plus active booking', () => {
        const d = draft([entry(2, { booking: booking('cancelled') }),
            entry(3, { booking: booking('transferred'), ownerLogin: 'FIELD', projectLabels: ['Q'] })]);
        const r = reviewSheetRelationships(d, catalog(), aliases);
        expect(r.identity.groups[0]).toMatchObject({ category: 'multiple_booking_rows', multipleSales: true,
            multipleProjects: true, cancellationAndActiveBooking: true, samePersonConfirmed: false });
        expect(r.identity.groups[0].history).toHaveLength(2);
    });
    it('separates one booking plus visits and retains missing owner/project evidence', () => {
        const d = draft([entry(2, { booking: booking('booked') }), entry(3, { projectLabels: [], ownerLogin: null })]);
        const r = reviewSheetRelationships(d, catalog(), aliases);
        expect(r.identity.groups[0]).toMatchObject({ category: 'one_booking_with_other_history', hasMissingOwner: true });
        expect(r.noProjectRows).toEqual([3]);
        expect(r.plots.reviews[1].reason).toBe('PROJECT_REVIEW');
    });
    it('matches plot labels only, never strips leading zeros or guesses from plot IDs', () => {
        const d = draft([entry(2), entry(3, { targetPlotLabel: '1' })]);
        const r = reviewSheetRelationships(d, catalog(), aliases);
        expect(r.plots.matchedTargetOnlyRows).toBe(1);
        expect(r.plots.matchedBookingRows).toBe(0);
        expect(r.plots.reviews.map(p => p.reason)).toEqual(['EXACT_LABEL_CANDIDATE', 'PLOT_LABEL_NOT_FOUND']);
        expect(r.projects[0].isClosed).toBe(true); // Historical matches never reopen projects.
    });
    it('does not select ambiguous plots and detects active candidate collisions', () => {
        const d = draft([entry(2, { booking: booking('booked') }), entry(3, { booking: booking('transferred') })]);
        const c = catalog();
        expect(reviewSheetRelationships(d, c, aliases).plots.activeCandidateCollisions).toEqual([{ id: 'plot-01', rows: [2, 3] }]);
        c.plots.push({ ...c.plots[0], id: 'plot-02' }); c.plotCount++;
        expect(reviewSheetRelationships(d, c, aliases).plots.reviews.every(p => p.reason === 'PLOT_LABEL_AMBIGUOUS')).toBe(true);
    });
    it('does not count cancelled rows as active collisions or invent missing plot identity', () => {
        const d = draft([entry(2, { booking: booking('cancelled') }), entry(3, { booking: booking('booked'), targetPlotLabel: null })]);
        const r = reviewSheetRelationships(d, catalog(), aliases);
        expect(r.plots.activeCandidateCollisions).toEqual([]);
        expect(r.plots.reviews[1].reason).toBe('PLOT_UNKNOWN');
    });
    it('binds user-approved project labels to the source and catalog target, not import authority', () => {
        const d = draft(), c = catalog(), approval = { sourceSha256: d.sha256, projectRef: c.projectRef,
            decisionRef: 'SYNTHETIC CONFIRMATION', aliases };
        expect(reviewSheetRelationships(d, c, aliases).aliasStatus).toBe('proposed_not_import_authority');
        expect(reviewSheetRelationships(d, c, aliases, approval).aliasStatus).toBe('user_confirmed_labels_only');
        approval.sourceSha256 = 'c'.repeat(64);
        expect(() => reviewSheetRelationships(d, c, aliases, approval)).toThrow('PROJECT_ALIAS_REVIEW_INVALID');
    });
    it.each([
        c => { c.projectRef = 'wrong'; }, c => { c.plotCount = 2; },
        c => { c.generatedAt = 'invalid'; }, c => { c.plots.push({ ...c.plots[0] }); c.plotCount++; },
    ])('rejects wrong target or malformed catalog %#', mutate => {
        const c = catalog(); mutate(c); expect(() => reviewSheetRelationships(draft(), c, aliases)).toThrow();
    });
    it('records the exact seven user-confirmed aliases', () => {
        expect(reviewedSheetProjects.aliases).toEqual([['AL2', 'ไอลิน 2'], ['AL3', 'ไอลิน 3'],
            ['AL4', 'ไอลิน 4'], ['AL6', 'ไอลิน6'], ['K4', 'กานต์รวี4'], ['K2พิเศษ', 'กานต์รวี2'], ['YR', 'โยริว']]);
    });
    const plotFixture = () => {
        const d = draft(), c = catalog(); c.plots[0].plotName = '1';
        const project = { sourceSha256: d.sha256, projectRef: c.projectRef, decisionRef: 'SYNTHETIC', aliases };
        const plot = { sourceSha256: d.sha256, catalogDigest: createHash('sha256').update(JSON.stringify(c)).digest('hex'),
            decisionRef: 'SYNTHETIC PLOT', mappings: [{ row: 2, sourceProject: 'P', sourcePlot: '01',
                targetLabel: '1', candidateId: 'plot-01', kind: 'leading_zero' }] };
        return { d, c, project, plot };
    };
    it('applies only reviewed zero-prefix rows, retaining original labels and unreviewed rows', () => {
        const { d, c, project, plot } = plotFixture(), before = structuredClone(d);
        const r = reviewSheetRelationships(d, c, aliases, project, plot);
        expect(r.approvedPlotMappings).toBe(1);
        expect(r.plots.reviews[0]).toMatchObject({ sourcePlot: '01', reviewedPlotLabel: '1', candidateId: 'plot-01', reason: 'REVIEWED_LEADING_ZERO' });
        expect(r.plots.reviews[1].reason).toBe('PLOT_LABEL_NOT_FOUND');
        expect(d).toEqual(before); expect(r.importReady).toBe(false);
    });
    it('records an explicitly corrected target without changing source and never treats it as booking', () => {
        const { d, c, project, plot } = plotFixture();
        d.entries[0].proposal.targetPlotLabel = '97';
        Object.assign(plot.mappings[0], { sourcePlot: '97', kind: 'corrected_target' });
        const r = reviewSheetRelationships(d, c, aliases, project, plot);
        expect(r.plots.reviews[0]).toMatchObject({ kind: 'target_only', sourcePlot: '97', reviewedPlotLabel: '1', reason: 'REVIEWED_TARGET_CORRECTION' });
        expect(d.entries[0].proposal.targetPlotLabel).toBe('97');
    });
    it.each([
        f => { f.plot.sourceSha256 = 'c'.repeat(64); }, f => { f.plot.catalogDigest = 'c'.repeat(64); },
        f => { f.plot.mappings[0].row = 999; }, f => { f.plot.mappings[0].sourceProject = 'wrong'; },
        f => { f.plot.mappings[0].sourcePlot = '02'; }, f => { f.plot.mappings[0].candidateId = 'wrong'; },
        f => { f.plot.mappings[0].targetLabel = '2'; }, f => { f.plot.mappings.push({ ...f.plot.mappings[0] }); },
        f => { f.project = null; },
    ])('rejects stale, mismatched or duplicate per-row plot decisions %#', mutate => {
        const f = plotFixture(); mutate(f);
        expect(() => reviewSheetRelationships(f.d, f.c, aliases, f.project, f.plot)).toThrow('PLOT_REVIEW_INVALID');
    });
    it('keeps actual approval limited to 53 zero-prefix rows and corrected target row 642', () => {
        expect(reviewedSheetPlots.mappings.filter(m => m.kind === 'leading_zero')).toHaveLength(53);
        expect(reviewedSheetPlots.mappings.filter(m => m.kind === 'corrected_target')).toEqual([
            { row: 642, sourceProject: 'AL4', sourcePlot: '97', targetLabel: '67', candidateId: 'ไอลิน 4-67', kind: 'corrected_target' },
        ]);
    });
});
