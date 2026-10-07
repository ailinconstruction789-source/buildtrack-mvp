// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookingEvidenceHelperTestBody, externalSaleEvidenceDraftPath, externalSaleEvidenceTestBody, runExternalSaleEvidenceRuntime } from './external-sale-evidence-runtime.mjs';

describe('private imported operational history evidence', () => {
    it('checks isolated loopback identity before loading files or making changes', async () => {
        const calls = [];
        await expect(runExternalSaleEvidenceRuntime({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('buildtrack.synthetic_runtime');
        expect(calls[0]).toContain("inet_server_addr()='127.0.0.1'");
    });
    it('adapts the exact inert guard only in test memory', () => {
        const sql = readFileSync(externalSaleEvidenceDraftPath, 'utf8');
        expect(sql.trim()).toMatch(/ROLLBACK;$/);
        expect(externalSaleEvidenceTestBody(sql).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(externalSaleEvidenceDraftPath, 'utf8')).toBe(sql);
    });
    it.each([s => s.replace('ROLLBACK;', 'COMMIT;'), s => s.replace("RAISE EXCEPTION 'DESIGN ONLY:", "RAISE EXCEPTION 'APPROVED:"), s => `${s}\n\\connect remote`])('rejects changed guard %#', mutate => {
        expect(() => externalSaleEvidenceTestBody(mutate(readFileSync(externalSaleEvidenceDraftPath, 'utf8')))).toThrow();
    });
    it('neither grants clients nor activates writers or changes stored data', () => {
        const sql = readFileSync(externalSaleEvidenceDraftPath, 'utf8').replace(/--[^\n]*/g, '');
        expect(sql).not.toMatch(/SECURITY DEFINER|\bGRANT\b|DISABLE TRIGGER|session_replication_role|\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/i);
        expect(sql).toContain('sales_rollback_receipts');
        expect(sql).toContain('r.after_sales');
        expect(sql).toContain('SECURITY INVOKER');
        expect(sql).toContain('aclexplode');
    });
    it('operational readers resolve optional evidence without referencing external schema columns directly', () => {
        const booking = readFileSync('sql/sales/18_booking_history_draft.sql', 'utf8');
        const project = readFileSync('sql/sales/19_project_sales_read_draft.sql', 'utf8');
        expect(booking).toContain("to_regprocedure('crm_external_private.sale_history(jsonb)')");
        expect(booking).toContain("EXECUTE 'SELECT crm_external_private.sale_history($1)'");
        for (const sql of [booking, project]) {
            expect(sql).toContain("'importedHistory',sales_private.crm_booking_imported_history(to_jsonb(s))");
            expect(sql).toContain('AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL');
            expect(sql).toContain("OR to_jsonb(s)->>'external_booking_id' IS NOT NULL OR to_jsonb(s)->>'external_source_stage' IS NOT NULL)");
        }
    });
    it('extracts only the exact private SQL18 helper and its ACL sealing block', () => {
        const sql = readFileSync('sql/sales/18_booking_history_draft.sql', 'utf8');
        const extracted = bookingEvidenceHelperTestBody(sql);
        expect(extracted).toContain('aclexplode');
        expect(extracted).not.toMatch(/ALTER TABLE|CREATE TABLE|SECURITY DEFINER|public\.crm_v2_|\bGRANT\b/);
        expect(extracted.match(/CREATE (?:OR REPLACE )?FUNCTION/g)).toHaveLength(1);
        expect(() => bookingEvidenceHelperTestBody(sql.replace('p_sale jsonb)', 'changed jsonb)'))).toThrow();
    });
});
