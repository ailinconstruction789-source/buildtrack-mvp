// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { constructionChainFixturePath, constructionTransferMigrationPath,
    prepareConstructionSalesCompatibilityRuntime, runConstructionSalesCompatibilityRuntime } from './construction-sales-compatibility-runtime.mjs';

describe('construction and Sales transfer boundary', () => {
    for (const fn of [prepareConstructionSalesCompatibilityRuntime, runConstructionSalesCompatibilityRuntime]) {
        it(`${fn.name} rejects non-synthetic runtime before any source or write`, async () => {
            const calls = [];
            await expect(fn({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
            expect(calls).toHaveLength(1);
            expect(calls[0]).toContain('buildtrack.synthetic_runtime');
            expect(calls[0]).toContain("inet_server_addr()='127.0.0.1'");
        });
    }
    it('pins every exact reviewed live function, including old auto-transfer bug', () => {
        const fixture = readFileSync(constructionChainFixturePath, 'utf8').replaceAll('\r\n', '\n');
        const expected = {
            update_task_progress_trigger: '6ddcf919811f30c413c0cd39a8b917c7',
            auto_update_plot_sale_status: 'c6630c35e6bfeebf1469ab6136e2a129',
            sync_defect_progress: 'a5689fb42fbe43e8251d7425e26938ad',
        };
        for (const [name, digest] of Object.entries(expected)) {
            const definition = fixture.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?AS \\$function\\$[\\s\\S]*?\\$function\\$\\n`))?.[0];
            expect(definition).toBeDefined();
            expect(createHash('md5').update(definition).digest('hex')).toBe(digest);
        }
        expect(fixture.match(/CREATE TRIGGER /g)).toHaveLength(3);
        expect(fixture).toContain('CONSTRUCTION_SYNTHETIC_RUNTIME_REQUIRED');
        expect(fixture).not.toMatch(/DISABLE TRIGGER|session_replication_role|dblink|COPY.+PROGRAM/i);
    });
    it('minimal repair binds reviewed body and cannot insert or backfill data', () => {
        const sql = readFileSync(constructionTransferMigrationPath, 'utf8');
        expect(sql).toContain("md5(definition)<>'c6630c35e6bfeebf1469ab6136e2a129'");
        expect(sql).toContain('CONSTRUCTION_SALES_REVIEW_REQUIRED');
        expect(sql).toContain('CONSTRUCTION_SALES_POSTCHECK_FAILED');
        expect(sql).toContain("AND sale_status != ''transferred''");
        expect(sql).toContain("NULL; -- Transfer is confirmed by Sales");
        expect(sql).not.toMatch(/^\s*(?:INSERT INTO|UPDATE|DELETE FROM|GRANT|REVOKE|CREATE TRIGGER|DROP TRIGGER)/mi);
    });
});
