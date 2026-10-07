// Pure preparation only: no connection, credentials, network or file writes.
import { createHash } from 'node:crypto';
import { assembleCentralVisitsCandidate, centralVisitsHeader, centralVisitsFooter, centralVisitsParts } from './central-visits-candidate.mjs';
export const reviewedVisitMigration = 'supabase/migrations/20260930042013_central_visits_sealed_reviewed.sql';
export const reviewedVisitPreflight = 'sql/sales/deployment/central_visits_reviewed_preflight_readonly.sql';
export const reviewedVisitHeader = 'sql/sales/deployment/central_visits_reviewed_header.sql';
export const reviewedVisitReceipt = 'sql/sales/deployment/central_visits_reviewed_receipt.sql';
export const reviewedVisitSources = [centralVisitsHeader, ...centralVisitsParts, centralVisitsFooter, reviewedVisitPreflight, reviewedVisitHeader, reviewedVisitReceipt];
export function assembleReviewedVisits(texts) {
    const read = path => { const text = texts.get(path); if (typeof text !== 'string') throw new Error(`VISIT_REVIEW_SOURCE_MISSING: ${path}`); return text.replaceAll('\r\n', '\n'); };
    const local = assembleCentralVisitsCandidate(texts);
    const header = read(centralVisitsHeader).trimEnd();
    const footer = read(centralVisitsFooter).trimEnd();
    if (!local.startsWith(header) || !local.trimEnd().endsWith(footer)) throw new Error('VISIT_REVIEW_LOCAL_ENVELOPE_CHANGED');
    const body = local.slice(header.length, local.lastIndexOf(footer)).trim();
    // Keep the activation helper LOCAL ONLY and sealed. This artifact installs,
    // but deliberately provides no production activation command.
    const functionNames = [...new Set([...body.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\(/gm)].map(m => m[1]))];
    const newFunctions = functionNames.filter(name => name !== 'crm_external_private.reject_unreviewed_activation');
    if (newFunctions.length < 20) throw new Error('VISIT_REVIEW_FUNCTION_MANIFEST_INCOMPLETE');
    const tableNames = [...body.matchAll(/^CREATE TABLE ([\w.]+)\s*\(/gm)].map(m => m[1]);
    const q = value => `'${value.replaceAll("'", "''")}'`;
    const list = values => values.map(q).join(',');
    const preflight = read(reviewedVisitPreflight);
    const start = preflight.indexOf('SELECT jsonb_build_object(');
    const end = preflight.lastIndexOf('\nROLLBACK;');
    if (start < 0 || end < start) throw new Error('VISIT_REVIEW_PREFLIGHT_CHANGED');
    const metadata = preflight.slice(start, end).trim();
    const releaseDigest = createHash('sha256').update(reviewedVisitSources.map(path => `${path}\n${read(path)}`).join('\n')).digest('hex');
    let begin = read(reviewedVisitHeader)
        .replaceAll('__RELEASE_DIGEST__', releaseDigest)
        .replace('__NEW_FUNCTIONS__', list(newFunctions))
        .replace('__NEW_TABLES__', list([...tableNames, 'crm_external_private.visit_workflow_operations']))
        .replace('__PREFLIGHT_SELECT__', metadata);
    if (/__[A-Z_]+__/.test(begin)) throw new Error('VISIT_REVIEW_UNRESOLVED_MARKER');
    // Reuse the reviewed seal, but do NOT touch unrelated concurrently created
    // functions/tables merely because their OIDs are new to this transaction.
    let seal = footer.slice(0, footer.indexOf('DO $visits_after$'));
    seal = seal.replace("AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid) LOOP",
        `AND n.nspname||'.'||p.proname IN (${list(newFunctions)})\n      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid) LOOP`);
    seal = seal.replace("AND NOT EXISTS(SELECT 1 FROM central_visits_existing_relations old WHERE old.oid=c.oid) LOOP",
        `AND n.nspname||'.'||c.relname IN (${list([...tableNames, 'crm_external_private.visit_workflow_operations'])})\n      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_relations old WHERE old.oid=c.oid) LOOP`);
    const receipt = read(reviewedVisitReceipt).replaceAll('__RELEASE_DIGEST__', releaseDigest)
        .replaceAll('__NEW_FUNCTIONS__', list(newFunctions))
        .replaceAll('__NEW_TABLES__', list([...tableNames, 'crm_external_private.visit_workflow_operations']));
    return { sql: `${begin.trimEnd()}\n\n${body}\n\n${receipt.split('-- POST INSTALL CHECKS')[0]}\n${seal}\n-- POST INSTALL CHECKS${receipt.split('-- POST INSTALL CHECKS')[1]}`, releaseDigest, functionNames: newFunctions, tableNames };
}
