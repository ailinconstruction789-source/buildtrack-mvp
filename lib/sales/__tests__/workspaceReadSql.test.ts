// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync('sql/sales/34_canonical_workspace_read_draft.sql', 'utf8');
describe('canonical workspace read-only draft', () => {
  it('keeps original31/33 hashed readers untouched and reuses their role/scope/page validation', () => {
    expect(sql).toContain('snapshot:=public.crm_v2_project_sales(p_project_name,p_tab,p_query,p_page)');
    expect(sql).toContain('snapshot:=public.crm_v2_central_search(p_filters,p_page)');
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.crm_v2_(?:central_search\(|project_sales\()/);
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|ALTER TABLE|DROP TABLE)\s+(?:public\.|auth\.|customer_source_membership_private\.)/i);
  });
  it('enriches exact sale rows with corrected null-preserving bank and reviewed columnP day', () => {
    expect(sql).toContain('ELSE dc.bank_name END'); expect(sql).toContain('sales_import_private.expected_transfer_date(s.id,s.expected_transfer_date::text)');
    expect(sql).toContain("'leadId',s.lead_id"); expect(sql).toContain('JOIN customer_source_membership_private.sales');
    expect(sql).toContain("jsonb_array_length(rows_json)<>jsonb_array_length(snapshot->'rows')");
  });
  it('returns explicit frozen legacy IDs only after authoritative activation; no inferred relationships', () => {
    expect(sql).toContain('customer_source_membership_private.scope_leads'); expect(sql).toContain("CASE WHEN revision IS NULL OR NOT p_include_legacy_scope THEN '[]'::jsonb");
    expect(sql).toContain('membership_metadata(p_page=0)');
    expect(sql).toContain("metadata->>'active'"); expect(sql).toContain('CRM_SETUP_REQUIRED');
    expect(sql).not.toMatch(/(?:name|phone)\s*=\s*(?:c\.|s\.)/);
  });
  it('uses known visited days with perInterest bindings, preserving unknown dates', () => {
    expect(sql).toContain("e->>'kind'='visited' AND e->>'precision'='day'"); expect(sql).toContain('m.interest_id=p_interest');
    expect(sql).not.toMatch(/visitHistoryDate[^\n]*(?:created_at|recorded_at|now\()/i);
  });
  it('exposes only authenticated read wrappers, preserves draft guard and prohibits public helper grants', () => {
    expect(sql).toContain('auth.uid() IS NULL'); expect(sql).toContain("NOT IN('sales','admin','owner')");
    expect(sql).toContain('FROM PUBLIC,anon,authenticated,service_role'); expect(sql).toContain('TO authenticated');
    expect(sql).not.toMatch(/GRANT.*sales_workspace_read_private/); expect(sql).toMatch(/ROLLBACK;\s*$/);
  });
});
