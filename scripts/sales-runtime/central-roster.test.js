// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { centralRosterApproval, centralRosterPreflightPath, prepareCentralRoster, summarizeCentralRoster, assertCentralRosterUnchanged } from './central-roster.mjs';

const now = new Date('2026-09-28T07:00:00Z');
const context = { verifiedProjectRef: 'kbthmdedilswdmmczfay', now };
const uid = n => `f0280000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
    return { reportVersion: 'central-roster-preflight-v1', generatedAt: now.toISOString(), readOnly: true,
        staff: centralRosterApproval.map((row, i) => ({ username: row.username, expectedRole: row.role,
            displayName: row.displayName, directoryMatches: 1, loginKeyMatches: 1,
            directory: [{ legacyUserId: i + 1, legacyRole: row.role }],
            authBindings: [{ authUserId: uid(i + 1), deleted: false, banned: false, anonymous: false }] })),
        reviewedAdmins: [{ legacyUserId: 1, authUserId: uid(1) }],
        legacyAgents: [['BELL',253],['FIELD',118],['JEEJEE',18],['NOOK',106],['PIEW',254],['TAEW',10],['YING',136]]
            .map(([sourceLabel, leadCount]) => ({ sourceLabel, leadCount, loginName: sourceLabel === 'TAEW' ? 'TEAW' : sourceLabel })),
        counts: { leads: 895, sales: 289, plots: 306 }, salesSchemaExists: false, anonymousFullDirectoryRead: true };
}

describe('approved central CRM roster preparation (offline; never installs)', () => {
    it('binds nine identities and seven Sales; keeps approved aliases without granting permissions', () => {
        const report = fixture(); const before = structuredClone(report);
        const result = prepareCentralRoster(report, context);
        expect(result.bindings.find(row => row.username === 'TEAW').displayName).toBe('TAEW');
        expect(result.bindings.filter(row => row.canManageAccounts).map(row => row.username)).toEqual(['Admin']);
        expect(summarizeCentralRoster(result)).toMatchObject({ staff: 9, sales: 7, owner: 1, admin: 1,
            legacyLeadsMapped: 895, deploymentReady: false, productionChanged: false,
            requiresLoginClientCutoverForExistingSecurityDrafts: true });
        expect(report).toEqual(before);
    });
    const invalid = [
        ['report version', r => { r.reportVersion = 'other'; }],
        ['writable report', r => { r.readOnly = false; }],
        ['stale report', r => { r.generatedAt = '2026-09-27T07:00:00Z'; }],
        ['future report', r => { r.generatedAt = '2026-09-29T07:00:00Z'; }],
        ['invalid date', r => { r.generatedAt = 'bad'; }],
        ['existing CRM requires upgrade review', r => { r.salesSchemaExists = true; }],
        ['lead count drift', r => { r.counts.leads++; }],
        ['sale count drift', r => { r.counts.sales--; }],
        ['plot count drift', r => { r.counts.plots++; }],
        ['missing staff', r => { r.staff.pop(); }],
        ['extra staff', r => { r.staff.push(structuredClone(r.staff[0])); }],
        ['duplicate approved name', r => { r.staff[1] = structuredClone(r.staff[0]); }],
        ['changed approval role', r => { r.staff[2].expectedRole = 'Admin'; }],
        ['changed alias', r => { r.staff[7].displayName = 'OTHER'; }],
        ['ambiguous directory', r => { r.staff[2].directoryMatches = 2; }],
        ['normalized login name collision', r => { r.staff[2].loginKeyMatches = 2; }],
        ['missing Auth binding', r => { r.staff[2].authBindings = []; }],
        ['multiple Auth bindings', r => { r.staff[2].authBindings.push(structuredClone(r.staff[2].authBindings[0])); }],
        ['legacy role changed', r => { r.staff[2].directory[0].legacyRole = 'Owner'; }],
        ['invalid legacy ID', r => { r.staff[2].directory[0].legacyUserId = '3'; }],
        ['bad UUID', r => { r.staff[2].authBindings[0].authUserId = 'bad'; }],
        ['deleted user', r => { r.staff[2].authBindings[0].deleted = true; }],
        ['banned user', r => { r.staff[2].authBindings[0].banned = true; }],
        ['anonymous user', r => { r.staff[2].authBindings[0].anonymous = true; }],
        ['unknown ban state', r => { delete r.staff[2].authBindings[0].banned; }],
        ['reused Auth ID', r => { r.staff[2].authBindings[0].authUserId = uid(1); }],
        ['reused legacy ID', r => { r.staff[2].directory[0].legacyUserId = 1; }],
        ['missing reviewed Admin', r => { r.reviewedAdmins = []; }],
        ['extra reviewed Admin', r => { r.reviewedAdmins.push({ legacyUserId: 2, authUserId: uid(2) }); }],
        ['different reviewed Admin', r => { r.reviewedAdmins[0].authUserId = uid(2); }],
        ['malformed reviewed Admin', r => { r.reviewedAdmins[0].authUserId = 123; }],
        ['unreviewed legacy agent', r => { r.legacyAgents[0].sourceLabel = 'BELL NEW'; }],
        ['map to Admin', r => { r.legacyAgents[0].sourceLabel = 'Admin'; r.legacyAgents[0].loginName = 'Admin'; }],
        ['wrong alias target', r => { r.legacyAgents[5].loginName = 'BELL'; }],
        ['partial totals', r => { r.legacyAgents[0].leadCount--; }],
        ['duplicate source label', r => { r.legacyAgents[1] = structuredClone(r.legacyAgents[0]); }],
        ['unknown directory compatibility', r => { delete r.anonymousFullDirectoryRead; }],
    ];
    it.each(invalid)('rejects %s', (_label, change) => {
        const report = fixture(); change(report);
        expect(() => prepareCentralRoster(report, context)).toThrow(/CENTRAL_ROSTER_/);
    });
    it('requires independently verified project and explicit clock', () => {
        expect(() => prepareCentralRoster(fixture(), { ...context, verifiedProjectRef: 'other' })).toThrow('TARGET_REQUIRED');
        expect(() => prepareCentralRoster(fixture(), {})).toThrow('TARGET_REQUIRED');
        expect(() => prepareCentralRoster(fixture(), { verifiedProjectRef: context.verifiedProjectRef })).toThrow('REPORT_STALE');
    });
    it('ignores mutable metadata and never includes it in the binding', () => {
        const report = fixture(); report.staff[2].user_metadata = { role: 'Admin', secret: 'must-not-log' };
        report.counts.secret = 'must-not-log';
        const manifest = prepareCentralRoster(report, context);
        expect(manifest.bindings[2].crmRole).toBe('sales');
        expect(JSON.stringify(manifest)).not.toContain('must-not-log');
        expect(JSON.stringify(summarizeCentralRoster(manifest))).not.toContain(uid(1));
    });
    it('detects recreated same-name accounts through identity digest and ignores report ordering', () => {
        const first = fixture(); const second = fixture(); second.staff.reverse(); second.legacyAgents.reverse();
        expect(prepareCentralRoster(first, context).identityDigest).toBe(prepareCentralRoster(second, context).identityDigest);
        second.staff.find(row => row.username === 'BELL').authBindings[0].authUserId = uid(99);
        expect(prepareCentralRoster(first, context).identityDigest).not.toBe(prepareCentralRoster(second, context).identityDigest);
    });
    it('requires the already-reviewed identity digest before a later step may use the binding', () => {
        const report = fixture(); const approvedDigest = prepareCentralRoster(report, context).identityDigest;
        expect(assertCentralRosterUnchanged(report, context, approvedDigest).deploymentReady).toBe(false);
        report.staff[2].authBindings[0].authUserId = uid(99);
        expect(() => assertCentralRosterUnchanged(report, context, approvedDigest)).toThrow('IDENTITY_CHANGED');
        expect(() => assertCentralRosterUnchanged(report, context, undefined)).toThrow('APPROVED_DIGEST_REQUIRED');
    });
    it('uses a bounded read-only report without credentials or mutations', () => {
        const source = readFileSync(centralRosterPreflightPath, 'utf8').replace(/--[^\r\n]*/g, '');
        const tokens = source.replace(/'(?:''|[^'])*'/g, "''");
        expect(source.trim()).toMatch(/^BEGIN READ ONLY;/);
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(source).toContain("SET LOCAL statement_timeout = '15s';");
        expect(tokens).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|COMMIT|COPY|EXECUTE)\b/i);
        expect(source).not.toMatch(/encrypted_password|raw_user_meta_data|refresh_token|auth\.sessions|customer_name|\bphone\b/i);
        for (const row of centralRosterApproval) expect(source).toContain(`('${row.username}','${row.role}','${row.displayName}')`);
    });
});
