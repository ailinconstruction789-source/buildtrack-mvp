// Offline, explicit identity/central-owner decisions. No database merge or inferred ownership.
import { createHash } from 'node:crypto';
import { centralRosterApproval } from './central-roster.mjs';

const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validRows = rows => Array.isArray(rows) && rows.length >= 2
    && rows.every(n => Number.isSafeInteger(n) && n >= 2) && new Set(rows).size === rows.length;
const sorted = rows => [...rows].sort((a, b) => a - b);

export function reviewSheetIdentityDecisions(report, approval) {
    if (report?.version !== 'sheet-relationship-review-v1' || !Array.isArray(report.identity?.groups)
        || !/^[a-f0-9]{64}$/.test(report.sourceSha256 ?? '') || !/^[a-f0-9]{64}$/.test(report.inputDigest ?? '')
        || approval?.sourceSha256 !== report.sourceSha256 || approval.reviewInputDigest !== report.inputDigest
        || typeof approval.decisionRef !== 'string' || !approval.decisionRef.trim()
        || !Array.isArray(approval.decisions) || !approval.decisions.length) throw new Error('IDENTITY_DECISION_REVIEW_INVALID');
    const groups = new Map(), allRows = new Set();
    for (const group of report.identity.groups) {
        if (typeof group?.group !== 'string' || !/^N\d{3}$/.test(group.group) || groups.has(group.group)
            || !validRows(group.rows) || group.rows.some(n => allRows.has(n))
            || !Array.isArray(group.history) || group.history.length !== group.rows.length
            || JSON.stringify(sorted(group.history.map(h => h.row))) !== JSON.stringify(sorted(group.rows))) {
            throw new Error('IDENTITY_DECISION_REVIEW_INVALID');
        }
        groups.set(group.group, group); group.rows.forEach(n => allRows.add(n));
    }
    const decisions = new Map();
    const salesLogins = new Set(centralRosterApproval.filter(a => a.role === 'Sales').map(a => a.username));
    for (const decision of approval.decisions) {
        const group = groups.get(decision?.group);
        if (!group || decisions.has(decision.group) || !validRows(decision.rows)
            || JSON.stringify(sorted(decision.rows)) !== JSON.stringify(sorted(group.rows))
            || !['same_person', 'distinct_people'].includes(decision.kind)) throw new Error('IDENTITY_DECISION_REVIEW_INVALID');
        if ('centralOwnerLogin' in decision || 'centralOwnerDecisionRef' in decision) {
            if (decision.kind !== 'same_person' || !salesLogins.has(decision.centralOwnerLogin)
                || typeof decision.centralOwnerDecisionRef !== 'string' || !decision.centralOwnerDecisionRef.trim()) {
                throw new Error('IDENTITY_CENTRAL_OWNER_REVIEW_INVALID');
            }
        }
        decisions.set(decision.group, decision);
    }
    const result = structuredClone(report);
    const summary = { samePersonGroups: 0, distinctPeopleGroups: 0, pendingGroups: [],
        reviewedRows: 0, reviewedCustomerUnits: 0 };
    for (const group of result.identity.groups) {
        const decision = decisions.get(group.group);
        group.identityDecision = decision?.kind ?? 'pending';
        group.samePersonConfirmed = decision?.kind === 'same_person';
        delete group.centralOwnerLogin;
        delete group.centralOwnerDecisionRef;
        if (group.samePersonConfirmed) {
            group.centralOwnerLogin = decision.centralOwnerLogin ?? null;
            group.centralOwnerDecisionRef = decision.centralOwnerDecisionRef ?? null;
        }
        // Partitions express confirmed source-row membership, never permanent IDs.
        group.customerPartitions = !decision ? null : decision.kind === 'same_person'
            ? [sorted(group.rows)] : sorted(group.rows).map(row => [row]);
        if (!decision) summary.pendingGroups.push(group.group);
        else {
            summary.reviewedRows += group.rows.length;
            summary.reviewedCustomerUnits += group.customerPartitions.length;
            if (decision.kind === 'same_person') summary.samePersonGroups++;
            else summary.distinctPeopleGroups++;
        }
    }
    result.identity.decisions = summary;
    result.identityDecisionRef = approval.decisionRef;
    result.identityDecisionDigest = hash({ sourceSha256: approval.sourceSha256, reviewInputDigest: approval.reviewInputDigest,
        decisionRef: approval.decisionRef, decisions: [...decisions.values()].map(d => ({ group: d.group,
            kind: d.kind, rows: sorted(d.rows), ...(d.centralOwnerLogin ? { centralOwnerLogin: d.centralOwnerLogin,
                centralOwnerDecisionRef: d.centralOwnerDecisionRef } : {}) })).sort((a, b) => a.group.localeCompare(b.group)) });
    result.importReady = false; result.mergeAuthorized = false; result.productionChanged = false;
    return result;
}
