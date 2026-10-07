// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareCrmStagedIntegration, verifyCrmStagedIntegration, stagedAdminMembershipSnapshotSql, assertStagedAdminMembershipsUnchanged } from './crm-staged-integration.mjs';

describe('staged CRM integration runner safety',()=>{
    it.each([prepareCrmStagedIntegration,verifyCrmStagedIntegration])('refuses unverified target before any writes',async run=>{
        const calls=[];
        await expect(run({query:async sql=>{calls.push(sql);return 'f';},source:'',baseline:{}})).rejects.toThrow('Owned local database required');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain("current_setting('buildtrack.synthetic_runtime',true)='on'");
        expect(calls[0]).not.toMatch(/CREATE|INSERT|UPDATE/);
    });
    it('selects staged identity instead of installing the global actor replacement',()=>{
        const suite=readFileSync('scripts/sales-runtime/account-security.mjs','utf8');
        expect(suite).toContain('stagedCrm ? null : await runTrustedActor');
        expect(suite).toContain('await prepareCrmStagedIntegration');
        for(const part of ['runRoleReview','runCrmRoleAlignment','runCrmWorkflowIntegration','runCrmAuthRevocation','runAccountAccessRead','runAccountAccessRestore']) {
            expect(suite).toContain(`await ${part}`);
        }
        expect(suite.indexOf('await verifyCrmStagedIntegration')).toBeGreaterThan(suite.indexOf('await runAccountAccessRestore'));
        expect(suite).toContain('assertStagedAdminMembershipsUnchanged(adminBeforeRestore,await query(stagedAdminMembershipSnapshotSql))');
    });
    it('retains the old mode and only allows an explicit isolated new mode',()=>{
        const runner=readFileSync('scripts/sales-runtime/run.mjs','utf8');
        expect(runner).toContain("options.at(-1) === '--crm-staged-security-only'");
        expect(runner).toContain("stagedCrm || options.at(-1) === '--account-security-only'");
        expect(runner.indexOf('await identity(database)')).toBeLessThan(runner.indexOf('await runAccountSecurity'));
        expect(runner).toContain('runAccountSecurity({ query, root, report, stagedCrm, sealedFoundation })');
    });
    it('never opens connections, reads app environment, or seeds real accounts',()=>{
        const source=readFileSync('scripts/sales-runtime/crm-staged-integration.mjs','utf8');
        expect(source).not.toMatch(/process\.env|dotenv|supabase-js|https?:\/\/|postgres:\/\/|kbthmdedilswdmmczfay/);
        expect(source).toContain('SYNTHETIC staged compatibility fixture');
        expect(source).toContain('globalTrustedActorInstalled:false');
        expect(source).not.toContain('CREATE OR REPLACE FUNCTION');
    });
    it('checks the absent global presence facade only in staged mode',()=>{
        const source=readFileSync('scripts/sales-runtime/account-preflight.mjs','utf8');
        expect(source).toContain("stage==='crm_staged' && row.name==='app_touch_current_user'");
        expect(source).toContain('!row.matchingSignatureExists && row.overloadCount===0');
    });
    const snapshot = {memberships:[{authUserId:'synthetic-admin',legacyUserId:1,enabled:true},
        {authUserId:'synthetic-sales',legacyUserId:2,enabled:false}],
    activeRecords:[{auth_user_id:'synthetic-admin',legacy_user_id:1,enabled:true,review_reference:'original',reviewed_at:'original'}]};
    it('compares permissions for all bindings and full records for active managers',()=>{
        expect(()=>assertStagedAdminMembershipsUnchanged(JSON.stringify(snapshot),JSON.stringify(structuredClone(snapshot)))).not.toThrow();
        expect(stagedAdminMembershipSnapshotSql).toContain("'enabled',enabled");
        expect(stagedAdminMembershipSnapshotSql).toContain('to_jsonb(a)');
        expect(stagedAdminMembershipSnapshotSql).toContain('WHERE enabled');
    });
    it.each([
        s=>{s.memberships[1].enabled=true;},s=>{s.memberships[0].enabled=false;},
        s=>{s.memberships[0].authUserId='other';},s=>{s.memberships[1].legacyUserId=99;},
        s=>{s.memberships.pop();},s=>{s.activeRecords[0].review_reference='changed';},
        s=>{s.activeRecords[0].reviewed_at='changed';},
    ])('detects privilege/binding drift or active manager metadata changes',change=>{
        const after=structuredClone(snapshot);change(after);
        expect(()=>assertStagedAdminMembershipsUnchanged(JSON.stringify(snapshot),JSON.stringify(after))).toThrow();
    });
});
