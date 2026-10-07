// Offline preparation only: no database connection, SQL generator, env, or writes.
// A valid manifest is NOT authority to install roles or enable CRM.
import { createHash } from 'node:crypto';

export const centralRosterPreflightPath = 'sql/sales/central_roster_preflight_read_only.sql';
export const centralRosterApproval = Object.freeze([
    ['Admin', 'Admin', 'Admin'], ['Owner', 'Owner', 'Owner'],
    ['BELL', 'Sales', 'BELL'], ['FIELD', 'Sales', 'FIELD'],
    ['JEEJEE', 'Sales', 'JEEJEE'], ['NOOK', 'Sales', 'NOOK'],
    ['PIEW', 'Sales', 'PIEW'], ['TEAW', 'Sales', 'TAEW'], ['YING', 'Sales', 'YING'],
].map(([username, role, displayName]) => Object.freeze({ username, role, displayName })));

const projectRef = 'kbthmdedilswdmmczfay';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
function requireCheck(condition, code) {
    // Never include raw report/identity/secret values in an error.
    if (!condition) throw new Error(code);
}

/** Parse only reports from the separately verified target, not a self-declared SQL field.
 * The calling operator is responsible for checking the MCP project/connection.
 * Returns identity bindings in memory; callers must not log the full manifest.
 */
export function prepareCentralRoster(report, context) {
    requireCheck(context?.verifiedProjectRef === projectRef, 'CENTRAL_ROSTER_TARGET_REQUIRED');
    requireCheck(record(report) && report.reportVersion === 'central-roster-preflight-v1'
        && report.readOnly === true, 'CENTRAL_ROSTER_REPORT_INVALID');
    const generatedAt = typeof report.generatedAt === 'string' ? Date.parse(report.generatedAt) : NaN;
    const now = context.now instanceof Date ? context.now.getTime() : NaN;
    requireCheck(Number.isFinite(now) && Number.isFinite(generatedAt)
        && generatedAt <= now && now - generatedAt <= 60 * 60 * 1000, 'CENTRAL_ROSTER_REPORT_STALE');
    requireCheck(report.salesSchemaExists === false, 'CENTRAL_ROSTER_UPGRADE_REVIEW_REQUIRED');
    requireCheck(record(report.counts) && report.counts.leads === 895 && report.counts.sales === 289
        && report.counts.plots === 306, 'CENTRAL_ROSTER_BASELINE_CHANGED');
    requireCheck(Array.isArray(report.staff) && report.staff.length === centralRosterApproval.length,
        'CENTRAL_ROSTER_STAFF_SET_CHANGED');
    const bindings = centralRosterApproval.map(approved => {
        const matches = report.staff.filter(row => record(row) && row.username === approved.username);
        requireCheck(matches.length === 1, 'CENTRAL_ROSTER_STAFF_SET_CHANGED');
        const row = matches[0];
        requireCheck(row.expectedRole === approved.role && row.displayName === approved.displayName,
            'CENTRAL_ROSTER_APPROVAL_CHANGED');
        requireCheck(row.directoryMatches === 1 && row.loginKeyMatches === 1
            && Array.isArray(row.directory) && row.directory.length === 1
            && Array.isArray(row.authBindings) && row.authBindings.length === 1,
        'CENTRAL_ROSTER_BINDING_AMBIGUOUS');
        const user = row.directory[0];
        const auth = row.authBindings[0];
        requireCheck(record(user) && positiveInteger(user.legacyUserId) && user.legacyRole === approved.role,
            'CENTRAL_ROSTER_DIRECTORY_CHANGED');
        requireCheck(record(auth) && typeof auth.authUserId === 'string' && uuid.test(auth.authUserId)
            && auth.deleted === false && auth.anonymous === false && auth.banned === false,
        'CENTRAL_ROSTER_AUTH_UNAVAILABLE');
        return { ...approved, legacyUserId: user.legacyUserId, authUserId: auth.authUserId.toLowerCase(),
            crmRole: approved.role.toLowerCase(), canManageAccounts: approved.username === 'Admin' };
    });
    requireCheck(new Set(bindings.map(row => row.authUserId)).size === bindings.length
        && new Set(bindings.map(row => row.legacyUserId)).size === bindings.length,
    'CENTRAL_ROSTER_ID_REUSED');
    const admin = bindings.find(row => row.username === 'Admin');
    const reviewedAdmin = report.reviewedAdmins?.[0];
    requireCheck(Array.isArray(report.reviewedAdmins) && report.reviewedAdmins.length === 1
        && record(reviewedAdmin) && reviewedAdmin.legacyUserId === admin.legacyUserId
        && typeof reviewedAdmin.authUserId === 'string' && reviewedAdmin.authUserId.toLowerCase() === admin.authUserId,
    'CENTRAL_ROSTER_ACCOUNT_ADMIN_CHANGED');

    requireCheck(Array.isArray(report.legacyAgents) && report.legacyAgents.length > 0,
        'CENTRAL_ROSTER_LEGACY_MAPPING_INVALID');
    const seenLabels = new Set();
    const legacyAgents = report.legacyAgents.map(row => {
        requireCheck(record(row) && typeof row.sourceLabel === 'string' && positiveInteger(row.leadCount)
            && !seenLabels.has(row.sourceLabel), 'CENTRAL_ROSTER_LEGACY_MAPPING_INVALID');
        seenLabels.add(row.sourceLabel);
        const loginName = row.sourceLabel === 'TAEW' ? 'TEAW' : row.sourceLabel === 'Piwe' ? 'PIEW' : row.sourceLabel;
        requireCheck(row.loginName === loginName && bindings.some(b => b.username === loginName && b.role === 'Sales'),
            'CENTRAL_ROSTER_LEGACY_OWNER_UNREVIEWED');
        return { sourceLabel: row.sourceLabel, loginName, leadCount: row.leadCount };
    }).sort((a, b) => a.sourceLabel < b.sourceLabel ? -1 : a.sourceLabel > b.sourceLabel ? 1 : 0);
    requireCheck(legacyAgents.reduce((sum, row) => sum + row.leadCount, 0) === report.counts.leads,
        'CENTRAL_ROSTER_LEGACY_TOTAL_MISMATCH');
    requireCheck(typeof report.anonymousFullDirectoryRead === 'boolean', 'CENTRAL_ROSTER_DIRECTORY_STATE_REQUIRED');
    const identityDigest = createHash('sha256').update(JSON.stringify(bindings)).digest('hex');
    return {
        contract: 'central-roster-prepared-v1', projectRef, generatedAt: report.generatedAt,
        approvalReference: 'User-confirmed CRM roster 2026-09-28', bindings, legacyAgents, identityDigest,
        counts: { leads: report.counts.leads, sales: report.counts.sales, plots: report.counts.plots },
        deploymentReady: false, productionChanged: false,
        requiresLoginClientCutoverForExistingSecurityDrafts: report.anonymousFullDirectoryRead,
    };
}

/** A fresh preflight must still match the operator-reviewed identity digest.
 * No role installation or feature activation is performed by this assertion.
 */
export function assertCentralRosterUnchanged(report, context, approvedDigest) {
    requireCheck(typeof approvedDigest === 'string' && /^[a-f0-9]{64}$/.test(approvedDigest),
        'CENTRAL_ROSTER_APPROVED_DIGEST_REQUIRED');
    const manifest = prepareCentralRoster(report, context);
    requireCheck(manifest.identityDigest === approvedDigest, 'CENTRAL_ROSTER_IDENTITY_CHANGED');
    return manifest;
}

/** A redacted summary, not a source for installing roles. */
export function summarizeCentralRoster(manifest) {
    return { contract: manifest.contract, staff: manifest.bindings.length,
        sales: manifest.bindings.filter(row => row.crmRole === 'sales').length,
        admin: manifest.bindings.filter(row => row.crmRole === 'admin').length,
        owner: manifest.bindings.filter(row => row.crmRole === 'owner').length,
        legacyLeadsMapped: manifest.legacyAgents.reduce((sum, row) => sum + row.leadCount, 0),
        identityDigest: manifest.identityDigest, deploymentReady: false, productionChanged: false,
        requiresLoginClientCutoverForExistingSecurityDrafts: manifest.requiresLoginClientCutoverForExistingSecurityDrafts };
}
