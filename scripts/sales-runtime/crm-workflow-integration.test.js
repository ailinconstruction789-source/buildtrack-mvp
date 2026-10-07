import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { draftPaths, syntheticDraftBody } from './safety.mjs';
import { crmAlignmentSalesPaths } from './crm-role-alignment.mjs';
import { runCrmWorkflowIntegration, workflowDraftPaths, workflowFacadePath } from './crm-workflow-integration.mjs';

describe('CRM workflow integration harness safety', () => {
    it('extends the exact existing allowlist without recompiling base roles', () => {
        expect(Object.isFrozen(workflowDraftPaths)).toBe(true);
        expect(workflowDraftPaths).toHaveLength(21);
        expect([...crmAlignmentSalesPaths, ...workflowDraftPaths]).toEqual(draftPaths);
        expect(workflowFacadePath).toBe('sql/sales/runtime/fixtures/customer-voices-facade.sql');
    });
    it.each(['f', '', 't\nt'])('rejects non-exact owned cluster proof %j before any DDL', async value => {
        const query = vi.fn().mockResolvedValue(value);
        await expect(runCrmWorkflowIntegration({ query, texts: new Map() })).rejects.toThrow();
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain("current_setting('buildtrack.synthetic_runtime',true)='on'");
        expect(query.mock.calls[0][0]).toContain("inet_server_addr()='127.0.0.1'::inet");
    });
    it('refuses an altered first draft guard before executing it', async () => {
        const query = vi.fn().mockResolvedValue('t');
        const path = workflowDraftPaths[0];
        const text = readFileSync(path, 'utf8').replace('DO $draft_only$', 'DO $altered$');
        await expect(runCrmWorkflowIntegration({ query, texts: new Map([[path, text]]) })).rejects.toThrow();
        expect(query).toHaveBeenCalledTimes(1);
    });
    it('retains guards and rollback in every original SQL source', () => {
        for (const path of workflowDraftPaths) {
            const before = readFileSync(path, 'utf8');
            const transformed = syntheticDraftBody(path, before);
            expect(transformed).not.toContain('DO $draft_only$');
            expect(transformed).toMatch(/COMMIT;\s*$/);
            expect(readFileSync(path, 'utf8')).toBe(before);
            expect(before).toMatch(/ROLLBACK;\s*$/);
        }
    });
    it('new suites cannot discover credentials, open connections or disable guards', () => {
        const sources = ['crm-workflow-integration.mjs', 'crm-workflow-notifications.mjs']
            .map(name => readFileSync(`scripts/sales-runtime/${name}`, 'utf8')).join('\n');
        expect(sources).not.toMatch(/process\.env|dotenv|createClient|child_process|fetch\(|DATABASE_URL|DISABLE TRIGGER|session_replication_role/);
        expect(sources).not.toMatch(/(?:INSERT INTO|UPDATE) sales_private\.crm_user_roles/i);
        expect(sources).toContain('account_security_private.review_account_role');
        expect(sources).toContain("SET LOCAL ROLE buildtrack_sales_sla_worker");
    });
});
