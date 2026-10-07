// Pure review-time assembly, NOT an installer. No IO, network, credentials or DB.
import {createHash} from 'node:crypto';
import {assertPlainSql} from './safety.mjs';
export const crmFoundationCandidatePath='supabase/migrations/20260928090010_crm_sealed_foundation_candidate.sql';
export const crmFoundationParts=Object.freeze([
    'sql/security/crm_identity_foundation_draft.sql','sql/security/role_review_draft.sql',
    'sales_workflow_v2_draft.sql','sql/security/crm_role_alignment_draft.sql',
    'sql/security/crm_auth_revocation_draft.sql','sql/security/account_access_read_draft.sql',
    'sql/security/account_access_restore_draft.sql',
]);
export const crmFoundationHeader='sql/sales/deployment/sealed_foundation_header.sql';
export const crmFoundationFooter='sql/sales/deployment/sealed_foundation_footer.sql';
export function assembleCrmFoundationCandidate(texts) {
    const read=path=>{const s=texts.get(path);assertPlainSql(s);return s.replaceAll('\r\n','\n');};
    const segments=crmFoundationParts.map(path=>{
        const source=read(path);
        const wrapper=/\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: [^'\r\n]+';\s*END;\s*\$draft_only\$;/g;
        if([...source.matchAll(wrapper)].length!==1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('Foundation source wrapper changed');
        let body=source.replace(wrapper,'').replace(/\bROLLBACK;\s*$/,'');
        if(path==='sales_workflow_v2_draft.sql') {
            const index="CREATE UNIQUE INDEX sales_active_plot_booking_idx ON public.sales(plot_id)\n  WHERE plot_id IS NOT NULL\n    AND COALESCE(crm_stage, lower(contract_status), 'unknown') <> 'cancelled';";
            if(body.split(index).length!==2) throw new Error('Active plot predicate needs new review');
            body=body.replace(index,'-- DEFERRED: sales_active_plot_booking_idx belongs to the frozen legacy-write cutover.');
        }
        return `-- Reviewed source: ${path}\n-- LF-normalized SHA256: ${createHash('sha256').update(source).digest('hex')}\n${body.trim()}\n`;
    });
    return read(crmFoundationHeader).trimEnd()+'\n\n'+segments.join('\n')+'\n'+read(crmFoundationFooter).trimEnd()+'\n';
}
