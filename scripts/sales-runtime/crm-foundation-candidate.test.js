// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {assembleCrmFoundationCandidate,crmFoundationCandidatePath,crmFoundationParts,crmFoundationHeader,crmFoundationFooter} from './crm-foundation-candidate.mjs';
import {runCrmFoundationCutover} from './crm-foundation-cutover.mjs';
const paths=[...crmFoundationParts,crmFoundationHeader,crmFoundationFooter];
const texts=new Map(paths.map(p=>[p,readFileSync(p,'utf8')]));
const source=readFileSync(crmFoundationCandidatePath,'utf8').replaceAll('\r\n','\n');
describe('sealed foundation candidate assembly and boundaries',()=>{
    it('checked-in candidate equals exact reviewed sources plus explicit seals',()=>{
        expect(source).toBe(assembleCrmFoundationCandidate(texts));
        expect(source.trim()).toMatch(/^-- LOCAL CANDIDATE/);
        expect(source.trim()).toMatch(/COMMIT;$/);
    });
    it('does not activate roles or rewrite existing account commands',()=>{
        expect(source).not.toMatch(/CREATE OR REPLACE FUNCTION (?:public\.update_user_last_seen|account_security_private\.execute_account_command)/);
        expect(source).not.toContain('CREATE UNIQUE INDEX sales_active_plot_booking_idx');
        expect(source).toContain('CRM_FOUNDATION_MUST_REMAIN_EMPTY_SEALED');
        expect(crmFoundationParts).not.toContain('sql/security/trusted_actor_draft.sql');
        expect(crmFoundationParts.some(p=>/cron|dispatcher|worker/.test(p))).toBe(false);
        expect(source).not.toMatch(/cron\.schedule|INSERT INTO public\.crm_settings/);
    });
    it.each(['release','project','backup','auth_compatibility','legacy_clients_reviewed','mode','counts'])('requires %s attestation',k=>{
        expect(source).toContain(`current_setting('buildtrack.crm_foundation_${k}',true)`);
    });
    it('checks legacy data and shared catalog before committing',()=>{
        for(const value of ['CRM_FOUNDATION_LEGACY_DATA_CHANGED','CRM_FOUNDATION_SHARED_OBJECT_CHANGED',
            'CRM_FOUNDATION_COLUMNS_SEALED','CRM_FOUNDATION_UNEXPECTED_CLIENT_ACCESS',
            'crm_legacy_snapshot_append_only',"lock_timeout='2s'","transaction_timeout='30s'",'aclexplode']) expect(source).toContain(value);
    });
    it.each([
        ['sales_workflow_v2_draft.sql',s=>s.replace('ROLLBACK;','COMMIT;')],
        ['sales_workflow_v2_draft.sql',s=>s.replace("'unknown') <> 'cancelled'","'unknown') = 'cancelled'")],
        ['sql/security/crm_identity_foundation_draft.sql',s=>s.replace('DESIGN ONLY:','APPROVED:')],
        ['sql/security/role_review_draft.sql',s=>s+'\n\\connect production'],
    ])('rejects unexpected source edits %s',(p,change)=>{
        const altered=new Map(texts);altered.set(p,change(altered.get(p)));
        expect(()=>assembleCrmFoundationCandidate(altered)).toThrow();
    });
    it('does not run against an unverified database',async()=>{
        const calls=[];
        await expect(runCrmFoundationCutover({query:async q=>{calls.push(q);return 'f';},source,plotSyncSource:''})).rejects.toThrow();
        expect(calls).toHaveLength(1);expect(calls[0]).toContain('buildtrack.synthetic_runtime');
    });
});
