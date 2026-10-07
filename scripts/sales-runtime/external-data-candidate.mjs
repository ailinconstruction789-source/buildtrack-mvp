// Pure assembler only. No network, credentials, database calls, or file writes.
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
export const externalDataCandidatePath = 'supabase/migrations/20260929082516_central_booking_external_data_candidate.sql';
export const externalDataHeader = 'sql/sales/deployment/external_data_header.sql';
export const externalDataFooter = 'sql/sales/deployment/external_data_footer.sql';
const reviewedParts = [
    ['sql/sales/external_snapshot_staging_draft.sql', 'external snapshot staging requires isolated tests and separate deployment review'],
    ['sql/sales/external_crm_bridge_draft.sql', 'external CRM bridge requires isolated verification and separate cutover review'],
    ['sql/sales/external_booking_bridge_draft.sql', 'external booking bridge requires isolated verification and separate cutover review'],
    ['sql/sales/external_sales_cutover_draft.sql', 'external sales cutover requires isolated verification and operational integration'],
    ['sql/sales/external_sale_evidence_draft.sql', 'external sale evidence requires isolated verification and operational integration'],
];
export const externalDataParts = Object.freeze(reviewedParts.map(([path]) => path));
export function assembleExternalDataCandidate(texts) {
    const read = path => { const source = texts.get(path); assertPlainSql(source); return source.replaceAll('\r\n', '\n'); };
    const parts = reviewedParts.map(([path, message]) => {
        const source = read(path);
        const wrapper = `BEGIN;\nDO $draft_only$\nBEGIN\n  RAISE EXCEPTION 'DESIGN ONLY: ${message}';\nEND;\n$draft_only$;`;
        if (source.split(wrapper).length !== 2 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_DATA_SOURCE_GUARD_CHANGED');
        const body = source.replace(wrapper, '').replace(/\bROLLBACK;\s*$/, '').trim();
        return `-- Reviewed source: ${path}\n-- LF-normalized SHA256: ${createHash('sha256').update(source).digest('hex')}\n${body}\n`;
    });
    return read(externalDataHeader).trimEnd() + '\n\n' + parts.join('\n') + '\n' + read(externalDataFooter).trimEnd() + '\n';
}
