// Offline candidate assembly. Contains PII in memory; output summarizeSheetSnapshotPlan only.
// Keys are scoped to an exact source snapshot, NOT permanent IDs across file revisions.
import { createHash } from 'node:crypto';
import { centralRosterApproval } from './central-roster.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ensure = (ok, code = 'SNAPSHOT_PLAN_INPUT_INVALID') => { if (!ok) throw new Error(code); };
const sorted = values => [...values].sort((a, b) => a - b);
const sameRows = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
// Retained evidence/unknowns, not a claim that these historical issues are resolved.
const retainedIssues = new Set(['CUSTOMER_IDENTITY_REVIEW', 'CUSTOMER_NAME_MISSING', 'SALES_OWNER_MISSING',
    'BOOKING_PLOT_MISSING', 'BOOKING_DATE_UNKNOWN', 'SALE_PRICE_UNKNOWN', 'TRANSFER_DATE_UNKNOWN',
    'CANCELLATION_DATE_UNKNOWN', 'BOOKING_BEFORE_RECORDED_VISIT_REVIEW',
    'CANCELLATION_BEFORE_RECORDED_VISIT_REVIEW', 'PAYMENT_METHOD_REVIEW']);

export function prepareSheetSnapshotPlan(draft, reviewed, pendingPolicy) {
    ensure(draft?.version === 'customer-sheet-review-draft-v1' && hex(draft.sha256) && hex(draft.inputDigest)
        && Array.isArray(draft.entries) && draft.entries.length > 0 && Array.isArray(draft.repeatedNameRows)
        && reviewed?.version === 'sheet-relationship-review-v1' && reviewed.sourceSha256 === draft.sha256
        && reviewed.inputDigest === draft.inputDigest && hex(reviewed.identityDecisionDigest) && hex(reviewed.catalogDigest)
        && reviewed.aliasStatus === 'user_confirmed_labels_only' && Array.isArray(reviewed.identity?.groups)
        && Array.isArray(reviewed.projects) && Array.isArray(reviewed.plots?.reviews)
        && Array.isArray(reviewed.plots.activeCandidateCollisions) && !reviewed.plots.activeCandidateCollisions.length);
    const entries = [...draft.entries].sort((a, b) => a.sourceRow - b.sourceRow);
    const byRow = new Map(entries.map(e => [e.sourceRow, e]));
    ensure(byRow.size === entries.length && new Set(entries.map(e => e.sourceKey)).size === entries.length
        && entries.every(e => Number.isSafeInteger(e.sourceRow) && e.sourceRow >= 2 && hex(e.sourceKey)
            && hex(e.rowDigest) && Array.isArray(e.rawValues) && Array.isArray(e.issues) && e.proposal));
    ensure(entries.every(e => e.issues.every(issue => retainedIssues.has(issue))), 'SOURCE_ISSUES_REQUIRE_REVIEW');
    ensure(pendingPolicy?.sourceSha256 === draft.sha256 && typeof pendingPolicy.decisionRef === 'string'
        && pendingPolicy.decisionRef.trim() && Array.isArray(pendingPolicy.rows), 'PENDING_ROWS_REVIEW_INVALID');
    const held = new Map();
    for (const h of pendingPolicy.rows) {
        const e = byRow.get(h?.row);
        ensure(e && !held.has(h.row) && (h.reason === 'NAME_REQUIRED' ? !e.proposal.customerName
            : h.reason === 'OWNER_REQUIRED' && !e.proposal.ownerLogin), 'PENDING_ROWS_REVIEW_INVALID');
        held.set(h.row, h.reason);
    }
    ensure(entries.every(e => (e.proposal.customerName && e.proposal.ownerLogin) || held.has(e.sourceRow)), 'PENDING_ROWS_REVIEW_REQUIRED');
    const sales = new Set(centralRosterApproval.filter(a => a.role === 'Sales').map(a => a.username));
    ensure(entries.every(e => e.proposal.ownerLogin === null || sales.has(e.proposal.ownerLogin)));
    const partitions = [], grouped = new Set();
    ensure(reviewed.identity.groups.length === draft.repeatedNameRows.length, 'IDENTITY_COVERAGE_INVALID');
    for (const group of reviewed.identity.groups) {
        ensure(Array.isArray(group.rows) && group.rows.length > 1
            && draft.repeatedNameRows.some(rows => sameRows(rows, group.rows))
            && group.rows.every(row => byRow.has(row) && !grouped.has(row))
            && new Set(group.rows).size === group.rows.length, 'IDENTITY_COVERAGE_INVALID');
        const expected = group.identityDecision === 'same_person' ? [sorted(group.rows)]
            : group.identityDecision === 'distinct_people' ? sorted(group.rows).map(row => [row]) : null;
        ensure(expected && JSON.stringify(expected) === JSON.stringify(group.customerPartitions), 'IDENTITY_DECISION_REQUIRED');
        for (const rows of expected) partitions.push({ rows, owner: rows.length > 1 ? group.centralOwnerLogin : byRow.get(rows[0]).proposal.ownerLogin });
        group.rows.forEach(row => grouped.add(row));
    }
    for (const e of entries) if (!grouped.has(e.sourceRow)) partitions.push({ rows: [e.sourceRow], owner: e.proposal.ownerLogin });
    partitions.sort((a, b) => a.rows[0] - b.rows[0]);
    const entityKey = (kind, membership) => hash([draft.sha256, kind, membership]);
    const customerByRow = new Map(), customers = [], interests = [], bookings = [], sourceRecords = [], holds = [];
    for (const part of partitions) {
        const records = part.rows.map(row => byRow.get(row));
        if (records.some(e => !e.proposal.customerName)) {
            ensure(records.length === 1 && held.get(part.rows[0]) === 'NAME_REQUIRED');
            continue;
        }
        ensure(new Set(records.map(e => e.proposal.customerName)).size === 1, 'CUSTOMER_NAME_REVIEW_REQUIRED');
        ensure(part.owner === null || sales.has(part.owner));
        const reasons = [...new Set(part.rows.filter(row => held.has(row)).map(row => held.get(row)))];
        if (!part.owner && !reasons.includes('OWNER_REQUIRED')) reasons.push('CENTRAL_OWNER_REQUIRED');
        const c = { sourceEntityKey: entityKey('customer', part.rows), sourceRows: part.rows,
            name: records[0].proposal.customerName, ownerLogin: part.owner, phone: null, phoneStatus: 'unknown',
            leadDate: null, intakeStatus: 'legacy_unclassified', reviewHolds: reasons };
        customers.push(c); part.rows.forEach(row => customerByRow.set(row, c));
    }
    const projectMap = new Map();
    for (const project of reviewed.projects) {
        ensure(typeof project.sourceLabel === 'string' && !projectMap.has(project.sourceLabel)
            && typeof project.proposedProject === 'string' && project.catalogMatches === 1, 'PROJECT_MAPPING_REQUIRED');
        projectMap.set(project.sourceLabel, project.proposedProject);
    }
    const plots = new Map(reviewed.plots.reviews.map(p => [p.row, p]));
    ensure(plots.size === reviewed.plots.reviews.length);
    const interestMap = new Map();
    for (const e of entries) {
        const customer = customerByRow.get(e.sourceRow), p = e.proposal;
        if (customer) for (const label of p.projectLabels) {
            const project = projectMap.get(label); ensure(project, 'PROJECT_MAPPING_REQUIRED');
            const key = entityKey('interest', [customer.sourceEntityKey, project]);
            let interest = interestMap.get(key);
            if (!interest) {
                interest = { sourceEntityKey: key, customerKey: customer.sourceEntityKey, project,
                    sourceRows: [], sourceOwners: [], ownerLogin: null, status: null,
                    classification: 'legacy_unclassified', reviewHolds: [...customer.reviewHolds] };
                interestMap.set(key, interest); interests.push(interest);
            }
            interest.sourceRows.push(e.sourceRow);
            if (!interest.sourceOwners.includes(p.ownerLogin)) interest.sourceOwners.push(p.ownerLogin);
        }
        const plot = plots.get(e.sourceRow);
        if (p.booking || p.targetPlotLabel) ensure(plot, 'PLOT_REVIEW_REQUIRED');
        if (plot) ensure(JSON.stringify(plot.sourceProjectLabels) === JSON.stringify(p.projectLabels)
            && plot.sourcePlot === p.targetPlotLabel && plot.kind === (p.booking ? 'booking_history' : 'target_only')
            && (plot.candidateId ? ['EXACT_LABEL_CANDIDATE', 'REVIEWED_LEADING_ZERO', 'REVIEWED_TARGET_CORRECTION'].includes(plot.reason)
                : plot.reason === 'PLOT_UNKNOWN' && !p.targetPlotLabel), 'PLOT_REVIEW_REQUIRED');
        if (plot?.reason.startsWith('REVIEWED_')) ensure(hex(reviewed.plotDecisionDigest), 'PLOT_REVIEW_REQUIRED');
        if (p.booking) {
            const project = projectMap.get(p.booking.projectLabel);
            const interestKey = customer && project ? entityKey('interest', [customer.sourceEntityKey, project]) : null;
            const reasons = [...(customer?.reviewHolds ?? ['CUSTOMER_REQUIRED'])];
            if (!interestKey || !interestMap.has(interestKey)) reasons.push('INTEREST_REQUIRED');
            if (!plot.candidateId) reasons.push('PLOT_UNKNOWN');
            bookings.push({ sourceEntityKey: entityKey('booking', [e.sourceRow]), sourceRow: e.sourceRow,
                customerKey: customer?.sourceEntityKey ?? null, interestKey, plotId: plot.candidateId,
                ...structuredClone(p.booking), reviewHolds: [...new Set(reasons)] });
        }
        sourceRecords.push({ sourceEntityKey: entityKey('source', [e.sourceRow]), sourceRow: e.sourceRow,
            originalSourceKey: e.sourceKey, rowDigest: e.rowDigest, hidden: e.hidden,
            customerKey: customer?.sourceEntityKey ?? null,
            disposition: held.has(e.sourceRow) ? 'admin_review' : 'mapped_for_review',
            sourceIssues: [...e.issues],
            rawValues: structuredClone(e.rawValues), correctedDates: structuredClone(e.appliedCorrections),
            reviewedHistory: structuredClone(p), reviewedPlot: plot ? structuredClone(plot) : null });
        if (held.has(e.sourceRow)) holds.push({ row: e.sourceRow, reason: held.get(e.sourceRow), scope: 'source' });
    }
    for (const interest of interests) {
        if (interest.sourceOwners.length === 1) interest.ownerLogin = interest.sourceOwners[0];
        else interest.reviewHolds.push('INTEREST_OWNER_REVIEW');
    }
    for (const booking of bookings) if (booking.reviewHolds.includes('PLOT_UNKNOWN')) {
        holds.push({ row: booking.sourceRow, reason: 'PLOT_UNKNOWN', scope: 'booking' });
    }
    const body = { version: 'sheet-snapshot-plan-v1', sourceSha256: draft.sha256, snapshotDate: draft.snapshotDate,
        skippedSourceRows: sorted(draft.skippedRows), inputDigest: draft.inputDigest,
        identityDecisionDigest: reviewed.identityDecisionDigest, plotDecisionDigest: reviewed.plotDecisionDigest,
        catalogDigest: reviewed.catalogDigest, pendingDecisionRef: pendingPolicy.decisionRef,
        customers, interests, bookings, sourceRecords, holds };
    return { ...body, planDigest: hash(body), importReady: false, productionChanged: false, deletionAuthorized: false,
        globalPending: ['EXTERNAL_SOURCE_SCHEMA_REVIEW', 'LEGACY_INTEREST_STATUS_CONTRACT', 'FRESH_ACCOUNT_BINDINGS',
            'SOURCE_HISTORY_COMPLETENESS', 'LATEST_SNAPSHOT_RECONCILIATION', 'DATABASE_REPLAY_AND_ROLLBACK_TEST', 'APPROVED_CUTOVER_PLAN'] };
}

export function summarizeSheetSnapshotPlan(plan) {
    return { version: plan.version, sourceSha256: plan.sourceSha256, planDigest: plan.planDigest,
        counts: { preservedSourceRows: plan.sourceRecords.length, customerCandidates: plan.customers.length,
            customerCandidatesOnHold: plan.customers.filter(c => c.reviewHolds.length).length,
            sourceRowsWithoutCustomer: plan.sourceRecords.filter(s => !s.customerKey).length,
            interestCandidates: plan.interests.length, interestCandidatesOnHold: plan.interests.filter(i => i.reviewHolds.length).length,
            bookingHistoryRows: plan.bookings.length, bookingHistoryOnHold: plan.bookings.filter(b => b.reviewHolds.length).length,
            bookingHistoryWithoutPlot: plan.bookings.filter(b => !b.plotId).length,
            sourceRowsAwaitingAdmin: plan.sourceRecords.filter(s => s.disposition === 'admin_review').length },
        bookingStages: Object.fromEntries([...new Set(plan.bookings.map(b => b.stage))].map(stage => [stage, plan.bookings.filter(b => b.stage === stage).length])),
        holds: structuredClone(plan.holds), globalPending: [...plan.globalPending],
        importReady: false, productionChanged: false, deletionAuthorized: false };
}

// Review fingerprint only: not a database idempotency guarantee or cross-revision ID registry.
export function assertSameSheetSnapshotPlan(plan, expectedDigest) {
    ensure(plan && hex(expectedDigest) && plan.planDigest === expectedDigest
        && plan.importReady === false && plan.productionChanged === false && plan.deletionAuthorized === false, 'SNAPSHOT_PLAN_CHANGED');
    const body = { ...plan };
    for (const key of ['planDigest', 'importReady', 'productionChanged', 'deletionAuthorized', 'globalPending']) delete body[key];
    ensure(hash(body) === expectedDigest, 'SNAPSHOT_PLAN_CHANGED');
}
