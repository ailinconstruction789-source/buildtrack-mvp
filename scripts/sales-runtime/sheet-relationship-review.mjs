// Read-only analysis. Never merge customers, issue identities or update plot status.
import { createHash } from 'node:crypto';

export const proposedProjectAliases = Object.freeze([
    ['AL2', 'ไอลิน 2'], ['AL3', 'ไอลิน 3'], ['AL4', 'ไอลิน 4'], ['AL6', 'ไอลิน6'],
    ['K4', 'กานต์รวี4'], ['K2พิเศษ', 'กานต์รวี2'], ['YR', 'โยริว'],
].map(pair => Object.freeze(pair)));
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const unique = values => [...new Set(values)];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stage = entry => entry.proposal.booking?.stage
    ?? (clean(entry.rawValues[7]) === 'เยียมชม' ? 'visit_history' : 'unclassified');

export function reviewSheetRelationships(draft, catalog, aliases = proposedProjectAliases, projectReview = null, plotApproval = null) {
    if (draft?.version !== 'customer-sheet-review-draft-v1' || !Array.isArray(draft.entries)
        || !Array.isArray(draft.repeatedNameRows) || catalog?.version !== 'sales-plot-catalog-read-only-v1'
        || catalog.projectRef !== 'kbthmdedilswdmmczfay' || !Number.isFinite(Date.parse(catalog.generatedAt))
        || !Array.isArray(catalog.projects) || !Array.isArray(catalog.plots)
        || catalog.projects.length !== catalog.projectCount || catalog.plots.length !== catalog.plotCount
        || !catalog.projects.every(p => typeof p?.name === 'string' && clean(p.name))
        || !catalog.plots.every(p => typeof p?.id === 'string' && p.id && typeof p.projectName === 'string'
            && (p.plotName === null || typeof p.plotName === 'string'))
        || new Set(catalog.plots.map(p => p.id)).size !== catalog.plots.length
        || !Array.isArray(aliases) || !aliases.every(p => Array.isArray(p) && p.length === 2
            && p.every(v => typeof v === 'string' && clean(v)))
        || new Set(aliases.map(p => clean(p[0]))).size !== aliases.length) throw new Error('RELATIONSHIP_REVIEW_INPUT_INVALID');
    if (projectReview !== null && (projectReview?.sourceSha256 !== draft.sha256
        || projectReview.projectRef !== catalog.projectRef || typeof projectReview.decisionRef !== 'string'
        || !clean(projectReview.decisionRef) || JSON.stringify(projectReview.aliases) !== JSON.stringify(aliases))) {
        throw new Error('PROJECT_ALIAS_REVIEW_INVALID');
    }
    const plotDecisions = new Map();
    if (plotApproval !== null) {
        if (!projectReview || plotApproval?.sourceSha256 !== draft.sha256 || plotApproval.catalogDigest !== hash(catalog)
            || typeof plotApproval.decisionRef !== 'string' || !clean(plotApproval.decisionRef)
            || !Array.isArray(plotApproval.mappings) || !plotApproval.mappings.length) throw new Error('PLOT_REVIEW_INVALID');
        for (const m of plotApproval.mappings) {
            if (!Number.isSafeInteger(m?.row) || plotDecisions.has(m.row)
                || !['leading_zero', 'corrected_target'].includes(m.kind)
                || ![m.sourceProject, m.sourcePlot, m.targetLabel, m.candidateId].every(v => typeof v === 'string' && clean(v))) {
                throw new Error('PLOT_REVIEW_INVALID');
            }
            plotDecisions.set(m.row, m);
        }
    }
    const byRow = new Map(draft.entries.map(e => [e.sourceRow, e]));
    const categories = { visit_history_only: 0, one_booking_with_other_history: 0, multiple_booking_rows: 0, other: 0 };
    const groups = draft.repeatedNameRows.map((rows, i) => {
        const entries = rows.map(row => byRow.get(row));
        if (entries.some(e => !e)) throw new Error('RELATIONSHIP_REVIEW_INPUT_INVALID');
        const bookings = entries.filter(e => e.proposal.booking);
        const projectLabels = unique(entries.flatMap(e => e.proposal.projectLabels));
        const owners = unique(entries.map(e => e.proposal.ownerLogin).filter(Boolean));
        const category = bookings.length > 1 ? 'multiple_booking_rows' : bookings.length === 1
            ? 'one_booking_with_other_history' : entries.every(e => stage(e) === 'visit_history') ? 'visit_history_only' : 'other';
        categories[category]++;
        return { group: `N${String(i + 1).padStart(3, '0')}`, rows, category, projectLabels, owners,
            multipleProjects: projectLabels.length > 1, multipleSales: owners.length > 1,
            hasMissingOwner: entries.some(e => !e.proposal.ownerLogin),
            cancellationAndActiveBooking: bookings.some(e => e.proposal.booking.stage === 'cancelled')
                && bookings.some(e => e.proposal.booking.stage !== 'cancelled'),
            samePersonConfirmed: false,
            history: entries.map(e => ({ row: e.sourceRow, stage: stage(e), projects: e.proposal.projectLabels,
                plot: e.proposal.targetPlotLabel, owner: e.proposal.ownerLogin,
                visitDate: e.proposal.visitHistoryDate, bookedDate: e.proposal.booking?.bookedDate ?? null,
                cancelledDate: e.proposal.booking?.cancelledDate ?? null, transferredDate: e.proposal.booking?.transferredDate ?? null })) };
    });
    const aliasMap = new Map(aliases.map(([a, b]) => [clean(a), clean(b)]));
    const projectCandidates = unique(draft.entries.flatMap(e => e.proposal.projectLabels)).map(label => {
        const proposed = aliasMap.get(label) ?? null;
        const matches = catalog.projects.filter(p => clean(p.name) === proposed);
        return { sourceLabel: label, proposedProject: proposed, catalogMatches: matches.length,
            isClosed: matches.length === 1 ? matches[0].isClosed : null,
            sourceRowCount: draft.entries.filter(e => e.proposal.projectLabels.includes(label)).length };
    });
    const plotReview = [], activeClaims = new Map(), appliedPlotRows = new Set();
    for (const e of draft.entries) {
        const p = e.proposal, b = p.booking;
        if (!b && !p.targetPlotLabel) continue;
        const project = p.projectLabels.length === 1 ? aliasMap.get(p.projectLabels[0]) : null;
        const validProject = project && catalog.projects.filter(v => clean(v.name) === project).length === 1;
        const matches = validProject && p.targetPlotLabel ? catalog.plots.filter(v => clean(v.projectName) === project
            && v.plotName !== null && clean(v.plotName) === p.targetPlotLabel) : [];
        let reason = !validProject ? 'PROJECT_REVIEW' : !p.targetPlotLabel ? 'PLOT_UNKNOWN'
            : matches.length === 1 ? 'EXACT_LABEL_CANDIDATE' : matches.length ? 'PLOT_LABEL_AMBIGUOUS' : 'PLOT_LABEL_NOT_FOUND';
        let candidateId = matches.length === 1 ? matches[0].id : null;
        const decision = plotDecisions.get(e.sourceRow);
        if (decision) {
            const targets = catalog.plots.filter(v => v.id === decision.candidateId && clean(v.projectName) === project
                && v.plotName === decision.targetLabel);
            const labelMatches = catalog.plots.filter(v => clean(v.projectName) === project && v.plotName === decision.targetLabel);
            if (!validProject || p.projectLabels[0] !== decision.sourceProject || p.targetPlotLabel !== decision.sourcePlot
                || targets.length !== 1 || labelMatches.length !== 1
                || (decision.kind === 'leading_zero' && (!/^0+[1-9]\d*$/.test(decision.sourcePlot)
                    || String(Number(decision.sourcePlot)) !== decision.targetLabel))
                || (decision.kind === 'corrected_target' && b)) throw new Error('PLOT_REVIEW_INVALID');
            candidateId = targets[0].id;
            reason = decision.kind === 'leading_zero' ? 'REVIEWED_LEADING_ZERO' : 'REVIEWED_TARGET_CORRECTION';
            appliedPlotRows.add(e.sourceRow);
        }
        plotReview.push({ row: e.sourceRow, stage: stage(e), kind: b ? 'booking_history' : 'target_only',
            sourceProjectLabels: p.projectLabels, proposedProject: project ?? null,
            sourcePlot: p.targetPlotLabel, reviewedPlotLabel: decision?.targetLabel ?? null, candidateId, reason });
        if (b && b.stage !== 'cancelled' && candidateId) {
            if (!activeClaims.has(candidateId)) activeClaims.set(candidateId, []);
            activeClaims.get(candidateId).push(e.sourceRow);
        }
    }
    if (appliedPlotRows.size !== plotDecisions.size) throw new Error('PLOT_REVIEW_INVALID');
    return { version: 'sheet-relationship-review-v1', sourceSha256: draft.sha256, inputDigest: draft.inputDigest,
        catalogGeneratedAt: catalog.generatedAt, catalogDigest: hash(catalog), aliasDigest: hash(aliases),
        aliasStatus: projectReview ? 'user_confirmed_labels_only' : 'proposed_not_import_authority',
        projectDecisionRef: projectReview?.decisionRef ?? null,
        plotDecisionDigest: plotApproval ? hash(plotApproval) : null, approvedPlotMappings: appliedPlotRows.size,
        importReady: false, mergeAuthorized: false, productionChanged: false,
        identity: { groupCount: groups.length, rowCount: groups.reduce((n, g) => n + g.rows.length, 0), categories,
            multipleProjectGroups: groups.filter(g => g.multipleProjects).length,
            multipleSalesGroups: groups.filter(g => g.multipleSales).length,
            cancellationAndActiveGroups: groups.filter(g => g.cancellationAndActiveBooking).length, groups },
        projects: projectCandidates, noProjectRows: draft.entries.filter(e => !e.proposal.projectLabels.length).map(e => e.sourceRow),
        plots: { counts: Object.fromEntries(unique(plotReview.map(p => p.reason)).map(reason => [reason, plotReview.filter(p => p.reason === reason).length])),
            matchedBookingRows: plotReview.filter(p => p.kind === 'booking_history' && p.candidateId).length,
            matchedTargetOnlyRows: plotReview.filter(p => p.kind === 'target_only' && p.candidateId).length,
            activeCandidateCollisions: [...activeClaims.entries()].filter(([, rows]) => rows.length > 1).map(([id, rows]) => ({ id, rows })),
            reviews: plotReview },
    };
}
