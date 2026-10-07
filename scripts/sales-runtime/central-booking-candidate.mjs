// Pure local assembler. No credentials, network, database, or file writes.
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
export const centralBookingCandidatePath = 'supabase/migrations/20260929080153_central_booking_commands_candidate.sql';
export const centralBookingHeader = 'sql/sales/deployment/central_booking_commands_header.sql';
export const centralBookingFooter = 'sql/sales/deployment/central_booking_commands_footer.sql';
const reviewedParts = [
    ['sql/sales/04_lead_work_foundation_draft.sql', 'lead-work foundation is not authorized for database execution'],
    ['sql/sales/05_lead_lifecycle_draft.sql', 'lifecycle draft is not authorized for database execution'],
    ['sql/sales/18_booking_history_draft.sql', 'booking history is not authorized for database execution'],
    ['sql/sales/19_project_sales_read_draft.sql', 'project sales reader is not authorized for database execution'],
    ['sql/sales/22_central_search_draft.sql', 'central search is not authorized for database execution'],
    ['sql/sales/external_booking_writer_draft.sql', 'external booking writer requires isolated composed verification'],
];
export const centralBookingParts = Object.freeze(reviewedParts.map(([path]) => path));
export function assembleCentralBookingCandidate(texts) {
    const read = path => { const source = texts.get(path); assertPlainSql(source); return source.replaceAll('\r\n', '\n'); };
    const parts = reviewedParts.map(([path, message]) => {
        const source = read(path);
        const wrapper = `BEGIN;\nDO $draft_only$\nBEGIN\n  RAISE EXCEPTION 'DESIGN ONLY: ${message}';\nEND;\n$draft_only$;`;
        if (source.split(wrapper).length !== 2 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('CENTRAL_BOOKING_SOURCE_GUARD_CHANGED');
        const body = source.replace(wrapper, '').replace(/\bROLLBACK;\s*$/, '').trim();
        return `-- Reviewed source: ${path}\n-- LF-normalized SHA256: ${createHash('sha256').update(source).digest('hex')}\n${body}\n`;
    });
    return read(centralBookingHeader).trimEnd() + '\n\n' + parts.join('\n') + '\n' + read(centralBookingFooter).trimEnd() + '\n';
}
