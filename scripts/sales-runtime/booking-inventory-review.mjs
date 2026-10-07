// Offline comparison only. Same plot/dates NEVER establish customer identity.
import { createHash } from 'node:crypto';
import { assertSameSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';

const ensure = ok => { if (!ok) throw new Error('BOOKING_INVENTORY_INPUT_INVALID'); };
const legacyStages = new Map([['Reserved', 'booked'], ['Contracted', 'contracted'],
    ['Transferred', 'transferred'], ['Cancelled', 'cancelled']]);
const countBy = (rows, key) => Object.fromEntries([...new Set(rows.map(key))].sort()
    .map(value => [value, rows.filter(row => key(row) === value).length]));
const validDate = value => value === null || (typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value);

export function reviewBookingInventory(plan, inventory) {
    assertSameSheetSnapshotPlan(plan, plan?.planDigest);
    ensure(inventory?.projectRef === 'kbthmdedilswdmmczfay' && Array.isArray(inventory.sales)
        && Array.isArray(inventory.plots) && Number.isFinite(Date.parse(inventory.generatedAt)));
    const plots = new Map(inventory.plots.map(p => [p.id, p]));
    ensure(plots.size === inventory.plots.length && inventory.plots.every(p => typeof p.id === 'string'
        && p.id && typeof p.projectName === 'string' && typeof p.hasCustomer === 'boolean'));
    ensure(new Set(inventory.sales.map(s => s.id)).size === inventory.sales.length
        && inventory.sales.every(s => typeof s.id === 'string' && s.id && legacyStages.has(s.status)
            && (s.plotId === null || plots.has(s.plotId)) && validDate(s.bookedDate) && validDate(s.transferredDate)));
    const interests = new Map(plan.interests.map(i => [i.sourceEntityKey, i]));
    ensure(plan.bookings.every(b => ['booked', 'transferred', 'cancelled'].includes(b.stage)
        && (b.plotId === null || (plots.has(b.plotId)
            && interests.get(b.interestKey)?.project === plots.get(b.plotId).projectName))
        && validDate(b.bookedDate) && validDate(b.transferredDate)));
    const rows = plan.bookings.map(b => {
        const samePlot = b.plotId === null ? [] : inventory.sales.filter(s => s.plotId === b.plotId);
        const sameStage = samePlot.filter(s => legacyStages.get(s.status) === b.stage);
        const knownDateCandidates = sameStage.filter(s => b.bookedDate !== null && s.bookedDate !== null
            && b.bookedDate === s.bookedDate && (b.stage !== 'transferred'
                || (b.transferredDate !== null && s.transferredDate !== null && b.transferredDate === s.transferredDate)));
        return { sourceRow: b.sourceRow, plotId: b.plotId, stage: b.stage, reviewHolds: [...b.reviewHolds],
            samePlotCount: samePlot.length, sameStageCount: sameStage.length,
            knownDateCandidateCount: knownDateCandidates.length,
            identityConfirmed: false, reuseSaleId: null };
    });
    const plotReview = inventory.plots.map(p => {
        const oldActive = inventory.sales.filter(s => s.plotId === p.id && s.status !== 'Cancelled');
        const newActive = plan.bookings.filter(b => b.plotId === p.id && b.stage !== 'cancelled');
        const before = oldActive.map(s => legacyStages.get(s.status));
        const after = newActive.map(b => b.stage);
        const classification = before.length > 1 || after.length > 1 ? 'active_collision'
            : before.length && after.length ? before[0] === after[0] ? 'same_stage' : 'stage_changed'
                : before.length ? 'occupied_only_in_legacy' : after.length ? 'occupied_only_in_source' : 'no_active_sale';
        return { plotId: p.id, projectName: p.projectName, plotName: p.plotName,
            before, after, sourceRows: newActive.map(b => b.sourceRow), classification,
            historySourceRows: plan.bookings.filter(b => b.plotId === p.id).map(b => b.sourceRow),
            hasCustomer: p.hasCustomer, saleStatus: p.saleStatus,
            occupancyFlagMismatch: p.hasCustomer !== (before.length > 0),
            // sale_status may control construction workflow; never reset it from booking history.
            transferredFlagWithoutLegacyTransfer: p.saleStatus === 'transferred' && !before.includes('transferred') };
    }).sort((a, b) => a.plotId.localeCompare(b.plotId));
    return { version: 'booking-inventory-read-only-v1', sourceSha256: plan.sourceSha256,
        planDigest: plan.planDigest, sourceSnapshotDate: plan.snapshotDate,
        inventoryGeneratedAt: inventory.generatedAt,
        inventoryDigest: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
        counts: { sourceBookings: rows.length, legacySales: inventory.sales.length, plots: plots.size,
            sourceStages: countBy(plan.bookings, b => b.stage), legacyStatuses: countBy(inventory.sales, s => s.status),
            plotClassifications: countBy(plotReview, p => p.classification),
            sourceUnknownPlot: rows.filter(b => b.plotId === null).length,
            legacyUnknownPlot: inventory.sales.filter(s => s.plotId === null).length,
            occupancyFlagMismatches: plotReview.filter(p => p.occupancyFlagMismatch).length,
            transferredFlagsWithoutLegacyTransfer: plotReview.filter(p => p.transferredFlagWithoutLegacyTransfer).length,
            legacyKnownBookingDates: inventory.sales.filter(s => s.bookedDate !== null).length,
            sourceRowsWithoutSamePlot: rows.filter(b => b.plotId !== null && b.samePlotCount === 0).length,
            sourceRowsWithOneDateCandidate: rows.filter(b => b.knownDateCandidateCount === 1).length,
            sourceRowsWithMultipleDateCandidates: rows.filter(b => b.knownDateCandidateCount > 1).length },
        rows, plotReview,
        limitations: ['PLOT_AND_DATES_ARE_NOT_IDENTITY', 'NO_OLD_SALE_ID_REUSE_APPROVED',
            'SOURCE_NOT_LIVE_REFRESH', 'NOT_A_CUTOVER_MANIFEST', 'NON_FK_DEPENDENCIES_NOT_PROVEN_ABSENT'],
        productionChanged: false, deletionAuthorized: false, activationReady: false };
}
