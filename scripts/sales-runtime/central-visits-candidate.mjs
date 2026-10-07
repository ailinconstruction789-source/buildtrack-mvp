// Pure LOCAL-ONLY assembler. No credentials, network, database or file writes.
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
export const centralVisitsCandidatePath = 'sql/sales/deployment/central_visits_candidate.sql';
export const centralVisitsHeader = 'sql/sales/deployment/central_visits_header.sql';
export const centralVisitsFooter = 'sql/sales/deployment/central_visits_footer.sql';
export const centralVisitsAdapter = 'sql/sales/deployment/central_visits_adapter.sql';
const guardedParts = [
    ['sql/sales/23_visits_draft.sql', 'visits foundation is not authorized for database execution'],
    ['sql/sales/25_visit_sop_draft.sql', 'visit SOP is not authorized for database execution'],
    ['sql/sales/26_customer_voices_draft.sql', 'customer Voices is not authorized for database execution'],
];
export const centralVisitsParts = Object.freeze([...guardedParts.map(([path]) => path), centralVisitsAdapter]);
export function assembleCentralVisitsCandidate(texts) {
    const read = path => { const value = texts.get(path); assertPlainSql(value); return value.replaceAll('\r\n', '\n'); };
    const parts = guardedParts.map(([path, message]) => {
        const source = read(path);
        const indent = path.includes('26_customer') ? ' ' : '  ';
        const guard = `BEGIN;\nDO $draft_only$\nBEGIN\n${indent}RAISE EXCEPTION 'DESIGN ONLY: ${message}';\nEND;\n$draft_only$;`;
        if (source.split(guard).length !== 2 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('CENTRAL_VISITS_SOURCE_GUARD_CHANGED');
        const body = source.replace(guard, '').replace(/\bROLLBACK;\s*$/, '').trim();
        return `-- Reviewed source: ${path}\n-- LF-normalized SHA256: ${createHash('sha256').update(source).digest('hex')}\n${body}\n`;
    });
    const adapter = read(centralVisitsAdapter);
    return read(centralVisitsHeader).trimEnd() + '\n\n' + parts.join('\n')
        + `\n-- Reviewed source: ${centralVisitsAdapter}\n-- LF-normalized SHA256: ${createHash('sha256').update(adapter).digest('hex')}\n`
        + adapter.trimEnd() + '\n\n' + read(centralVisitsFooter).trimEnd() + '\n';
}
