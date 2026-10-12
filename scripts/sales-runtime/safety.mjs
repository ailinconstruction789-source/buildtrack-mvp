// This is a test harness, NOT a migration installer. No existing DB connection is accepted.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const draftPaths = Object.freeze([
    'sales_workflow_v2_draft.sql',
    ...['04_lead_work_foundation', '05_lead_lifecycle', '06_work_schedule',
        '07_notifications', '08_sla_preview', '09_first_contact_processing', '10_first_contact_receipt_review',
        '11_first_contact_cycle', '12_supabase_cron_preflight', '13_first_contact_system_worker', '14_first_contact_dispatcher']
        .map(name => `sql/sales/${name}_draft.sql`),
]);
export const postBookingDraftPaths = Object.freeze([
    'sales_workflow_v2_draft.sql', 'sql/sales/04_lead_work_foundation_draft.sql',
    'sql/sales/05_lead_lifecycle_draft.sql', 'sql/sales/18_booking_history_draft.sql',
    'sql/sales/19_project_sales_read_draft.sql', 'sql/sales/20_sales_reports_read_draft.sql',
    'sql/sales/21_post_booking_draft.sql',
]);

export const customerDealDetailsDraftPath = 'sql/sales/22_customer_deal_details_draft.sql';
export const rentalLifecycleDraftPath = 'sql/sales/23_rental_lifecycle_draft.sql';
export const historicalEvidenceDraftPath = 'sql/sales/24_historical_evidence_ledger_draft.sql';
export const unknownHistoricalEvidenceDraftPath = 'sql/sales/25_unknown_historical_evidence_draft.sql';
export const reviewedImportDetailsDraftPath = 'sql/sales/26_reviewed_import_details_draft.sql';
export const sourceBoundCreationDraftPath = 'sql/sales/27_source_bound_customer_creation_draft.sql';
export const historicalSaleRevisionDraftPath = 'sql/sales/28_historical_sale_revision_draft.sql';
export const importedHistoryProjectionDraftPath = 'sql/sales/29_imported_history_projection_draft.sql';
export const rentalSourceRetirementDraftPath = 'sql/sales/30_rental_source_retirement_draft.sql';
export const excelEvidenceDraftPath = 'sql/sales/excel_report_evidence_draft.sql';

export function localConnectionArgs(port, database, user) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535
        || !/^buildtrack_sales_runtime_[a-f0-9]+$/.test(database)
        || !/^runtime_[a-f0-9]+$/.test(user)) throw new Error('Invalid isolated connection identity');
    return ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', database,
        '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'];
}

export function assertLocalDatabaseTarget(target, database) {
    // libpq -d accepts a URI/conninfo and can override even an explicit -h/-p.
    if (!/^buildtrack_sales_runtime_[a-f0-9]+$/.test(database) || (target !== database && target !== 'postgres')) {
        throw new Error('Refusing database override: only the owned DB or bootstrap postgres DB is allowed');
    }
}

/** Reject psql client commands outside SQL literals/comments at EVERY stdin
 * boundary (not just draft wrappers). This is not a sandbox for untrusted SQL:
 * only repository-reviewed fixtures belong in this privileged disposable DB.
 * Connections force standard_conforming_strings=on; E strings are handled too.
 */
export function assertPlainSql(source) {
    if (typeof source !== 'string' || source.includes('\0')) throw new Error('Invalid SQL input');
    for (let index = 0; index < source.length;) {
        if (source.startsWith('--', index)) {
            const end = source.indexOf('\n', index + 2); index = end < 0 ? source.length : end + 1;
        } else if (source.startsWith('/*', index)) {
            let depth = 1; index += 2;
            while (index < source.length && depth) {
                if (source.startsWith('/*', index)) { depth++; index += 2; }
                else if (source.startsWith('*/', index)) { depth--; index += 2; }
                else index++;
            }
            if (depth) throw new Error('Unterminated SQL comment');
        } else if (source[index] === "'" || source[index] === '"') {
            const quote = source[index];
            const escapes = quote === "'" && /[eE]/.test(source[index - 1] ?? '') && !/[a-zA-Z0-9_$]/.test(source[index - 2] ?? '');
            let closed = false; index++;
            while (index < source.length) {
                if (escapes && source[index] === '\\') index += 2;
                else if (source[index] === quote) {
                    if (source[index + 1] === quote) index += 2;
                    else { index++; closed = true; break; }
                } else index++;
            }
            if (!closed) throw new Error('Unterminated SQL quote');
        } else if (source[index] === '$' && /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.test(source.slice(index))) {
            const tag = source.slice(index).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)[0];
            const end = source.indexOf(tag, index + tag.length);
            if (end < 0) throw new Error('Unterminated SQL dollar quote');
            index = end + tag.length;
        } else {
            if (source[index] === '\\') throw new Error('psql metacommands are forbidden in isolated test input');
            index++;
        }
    }
}

export function verifyClusterIdentity(actual, expected) {
    const normalized = value => realpathSync(resolve(value)).toLowerCase();
    if (!actual || actual.address !== '127.0.0.1' || actual.port !== expected.port
        || actual.user !== expected.user || actual.database !== expected.database
        || actual.marker !== 'on' || actual.listen !== '127.0.0.1'
        || typeof actual.data !== 'string' || normalized(actual.data) !== normalized(expected.data)) {
        throw new Error('Refusing SQL: server is not the fresh cluster owned by this run');
    }
}

export function syntheticDraftBody(path, source) {
    if (!draftPaths.includes(path) && !postBookingDraftPaths.includes(path) && ![customerDealDetailsDraftPath,rentalLifecycleDraftPath,historicalEvidenceDraftPath,unknownHistoricalEvidenceDraftPath,reviewedImportDetailsDraftPath,sourceBoundCreationDraftPath,historicalSaleRevisionDraftPath,importedHistoryProjectionDraftPath,rentalSourceRetirementDraftPath,excelEvidenceDraftPath,'sql/sales/31_customer_source_membership_draft.sql','sql/sales/32_customer_replacement_recovery_draft.sql','sql/sales/33_customer_replacement_operator_draft.sql','sql/sales/34_canonical_workspace_read_draft.sql','sql/sales/35_reviewed_post_booking_activation_draft.sql'].includes(path)) throw new Error('Draft is not allowlisted');
    assertPlainSql(source);
    // Only the known single guard wrapper is omitted IN MEMORY, never in source files.
    // The caller must verify its newly-created cluster before loading this body.
    const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: [^'\r\n]+';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(wrapper)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)
        || /(?:^|;)\s*\\/m.test(source) || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) {
        throw new Error('Unexpected draft safety wrapper or unsafe local-test statement');
    }
    return source.replace(wrapper, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}

export function cleanProcessEnvironment(source) {
    // Never inherit DATABASE_URL, PG*, SUPABASE*, dotenv or a user's psql configuration.
    const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'temp', 'tmp', 'pathext', 'lang', 'lc_all']);
    return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
}
