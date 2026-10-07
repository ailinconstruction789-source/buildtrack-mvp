// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reviewSheetIdentityDecisions } from './sheet-identity-decisions.mjs';
import { reviewedSheetIdentities } from './sheet-identity-review-20260929.mjs';

const report = () => ({ version: 'sheet-relationship-review-v1', sourceSha256: 'a'.repeat(64), inputDigest: 'b'.repeat(64),
    importReady: false, mergeAuthorized: false, productionChanged: false,
    identity: { groups: [
        { group: 'N001', rows: [3, 193], samePersonConfirmed: false,
            history: [{ row: 3, stage: 'transferred', owner: 'JEEJEE', projects: ['K4'] },
                { row: 193, stage: 'cancelled', owner: 'PIEW', projects: ['AL3'] }] },
        { group: 'N002', rows: [112, 790], samePersonConfirmed: false,
            history: [{ row: 112, stage: 'transferred', owner: 'BELL' }, { row: 790, stage: 'visit_history', owner: 'BELL' }] },
    ] } });
const approval = () => ({ sourceSha256: 'a'.repeat(64), reviewInputDigest: 'b'.repeat(64), decisionRef: 'SYNTHETIC',
    decisions: [{ group: 'N001', rows: [3, 193], kind: 'same_person' },
        { group: 'N002', rows: [112, 790], kind: 'distinct_people' }] });

describe('source-bound identity decisions, not database merges', () => {
    it('keeps both N001 transactions and per-project sales, while N002 stays separate', () => {
        const r = report(), a = approval(), before = structuredClone({ r, a });
        const result = reviewSheetIdentityDecisions(r, a);
        expect(result.identity.groups[0]).toMatchObject({ samePersonConfirmed: true, customerPartitions: [[3, 193]] });
        expect(result.identity.groups[1]).toMatchObject({ samePersonConfirmed: false, customerPartitions: [[112], [790]] });
        expect(result.identity.groups.map(g => g.history)).toEqual(r.identity.groups.map(g => g.history));
        expect(result.identity.decisions).toEqual({ samePersonGroups: 1, distinctPeopleGroups: 1,
            reviewedRows: 4, reviewedCustomerUnits: 3, pendingGroups: [] });
        expect(result).toMatchObject({ importReady: false, mergeAuthorized: false, productionChanged: false });
        expect({ r, a }).toEqual(before);
    });
    it('keeps unconfirmed groups pending rather than assuming same or different people', () => {
        const a = approval(); a.decisions.pop();
        const r = reviewSheetIdentityDecisions(report(), a);
        expect(r.identity.groups[1]).toMatchObject({ identityDecision: 'pending', customerPartitions: null });
        expect(r.identity.decisions.pendingGroups).toEqual(['N002']);
    });
    it.each([
        a => { a.sourceSha256 = 'c'.repeat(64); }, a => { a.reviewInputDigest = 'c'.repeat(64); },
        a => { a.decisionRef = ''; }, a => { a.decisions = []; },
        a => { a.decisions[0].rows = [3, 194]; }, a => { a.decisions[0].rows = [3, 3]; },
        a => { a.decisions[0].group = 'N999'; }, a => { a.decisions[0].kind = 'guess_by_nickname'; },
        a => { a.decisions.push({ ...a.decisions[0] }); },
    ])('rejects altered, stale, conflicting or unsupported approvals %#', mutate => {
        const a = approval(); mutate(a); expect(() => reviewSheetIdentityDecisions(report(), a)).toThrow('IDENTITY_DECISION_REVIEW_INVALID');
    });
    it('rejects reused rows or missing history in the relationship report', () => {
        const r = report(); r.identity.groups[0].history.pop();
        expect(() => reviewSheetIdentityDecisions(r, approval())).toThrow('IDENTITY_DECISION_REVIEW_INVALID');
        const s = report(); s.identity.groups[1].rows = [3, 790];
        expect(() => reviewSheetIdentityDecisions(s, approval())).toThrow('IDENTITY_DECISION_REVIEW_INVALID');
    });
    it('fingerprints decisions deterministically without depending on list order', () => {
        const a = approval(), digest = reviewSheetIdentityDecisions(report(), a).identityDecisionDigest;
        a.decisions.reverse(); a.decisions[0].rows.reverse();
        expect(reviewSheetIdentityDecisions(report(), a).identityDecisionDigest).toBe(digest);
        a.decisions[0].kind = 'same_person';
        expect(reviewSheetIdentityDecisions(report(), a).identityDecisionDigest).not.toBe(digest);
    });
    it('captures all 65 explicit confirmations and only one same-person group', () => {
        expect(reviewedSheetIdentities.decisions).toHaveLength(65);
        expect(reviewedSheetIdentities.decisions.filter(d => d.kind === 'same_person')).toEqual([
            { group: 'N001', rows: [3, 193], kind: 'same_person', centralOwnerLogin: 'JEEJEE',
                centralOwnerDecisionRef: 'user-confirmation-2026-09-29-N001-central-owner-JEEJEE' },
        ]);
        expect(reviewedSheetIdentities.decisions.filter(d => d.kind === 'distinct_people')).toHaveLength(64);
        expect(reviewedSheetIdentities.decisions.reduce((n, d) => n + d.rows.length, 0)).toBe(161);
    });
    it('sets an explicit central owner separately without replacing either project/history owner', () => {
        const r = report(), a = approval(), before = structuredClone(r);
        const oldDigest = reviewSheetIdentityDecisions(r, a).identityDecisionDigest;
        Object.assign(a.decisions[0], { centralOwnerLogin: 'JEEJEE', centralOwnerDecisionRef: 'SYNTHETIC OWNER CONFIRMATION' });
        const result = reviewSheetIdentityDecisions(r, a);
        expect(result.identity.groups[0].centralOwnerLogin).toBe('JEEJEE');
        expect(result.identity.groups[0].history).toEqual(before.identity.groups[0].history);
        expect(result.identity.groups[0].history.map(h => h.owner)).toEqual(['JEEJEE', 'PIEW']);
        expect(result.identity.groups[1]).not.toHaveProperty('centralOwnerLogin');
        expect(result.identityDecisionDigest).not.toBe(oldDigest);
        expect(r).toEqual(before); expect(result.productionChanged).toBe(false);
    });
    it('does not choose the earliest or latest historical owner without confirmation', () => {
        expect(reviewSheetIdentityDecisions(report(), approval()).identity.groups[0].centralOwnerLogin).toBeNull();
    });
    it('does not retain a stale group-wide owner when a reviewed decision changes', () => {
        const a = approval(); Object.assign(a.decisions[0], { centralOwnerLogin: 'JEEJEE', centralOwnerDecisionRef: 'SYNTHETIC' });
        const old = reviewSheetIdentityDecisions(report(), a), revised = approval();
        revised.decisions[0].kind = 'distinct_people';
        const next = reviewSheetIdentityDecisions(old, revised);
        expect(next.identity.groups[0]).not.toHaveProperty('centralOwnerLogin');
        expect(old.identity.groups[0].centralOwnerLogin).toBe('JEEJEE');
    });
    it.each(['Admin', 'Owner', 'UNKNOWN', null])('rejects invalid central Sales owner %s', login => {
        const a = approval(); Object.assign(a.decisions[0], { centralOwnerLogin: login, centralOwnerDecisionRef: 'SYNTHETIC' });
        expect(() => reviewSheetIdentityDecisions(report(), a)).toThrow('IDENTITY_CENTRAL_OWNER_REVIEW_INVALID');
    });
    it('rejects a central owner for a group confirmed as distinct people, or without decision evidence', () => {
        const a = approval(); Object.assign(a.decisions[1], { centralOwnerLogin: 'JEEJEE', centralOwnerDecisionRef: 'SYNTHETIC' });
        expect(() => reviewSheetIdentityDecisions(report(), a)).toThrow('IDENTITY_CENTRAL_OWNER_REVIEW_INVALID');
        const b = approval(); b.decisions[0].centralOwnerLogin = 'JEEJEE';
        expect(() => reviewSheetIdentityDecisions(report(), b)).toThrow('IDENTITY_CENTRAL_OWNER_REVIEW_INVALID');
    });
});
