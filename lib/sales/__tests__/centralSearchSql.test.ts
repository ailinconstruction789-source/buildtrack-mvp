// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync('sql/sales/22_central_search_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const snapshot = code.split('AS $snapshot$')[1].split('$snapshot$;')[0];
const capabilities = code.split('AS $capabilities$')[1].split('$capabilities$;')[0];
describe('withheld central registry search SQL (not production certification)', () => {
  it('retains abort/rollback and never changes schema tables, flags or business data', () => {
    expect(source).toContain('NEVER RUN ON SUPABASE');
    expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('CREATE FUNCTION'));
    expect(code).not.toMatch(/ALTER TABLE|CREATE (?:TABLE|POLICY|TRIGGER)|DROP |TRUNCATE|cron\.|pg_net/i);
    for (const body of [snapshot, capabilities]) expect(body).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|advisory|set_config\(/i);
  });
  it('exposes only authenticated STABLE RPCs and trusted caller roles', () => {
    expect(code.match(/STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'/g)).toHaveLength(2);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.crm_v2_central_search(jsonb,integer) FROM PUBLIC,anon');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.crm_v2_central_search_capabilities() FROM PUBLIC,anon');
    expect(snapshot).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
    expect(snapshot).toContain("COALESCE(actor_role,'') NOT IN ('sales','admin','owner')");
    expect(capabilities).toContain('public.crm_v2_capabilities()');
    expect(capabilities).toContain('central_search_v1');
  });
  it('filters before limit, keeps identity and scopes project/owner/status to the same interest', () => {
    expect(snapshot.indexOf('c.intake_channel=channel_value')).toBeLessThan(snapshot.indexOf('LIMIT 51 OFFSET p_page*50'));
    expect(snapshot).toContain("AND (project_value='' OR i.project_name=project_value)\n          AND (owner_value IS NULL OR i.owner_user_id=owner_value)\n          AND (status_value='' OR i.engagement_status=status_value)");
    expect(snapshot).toContain('ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50');
    expect(snapshot).toContain('c.merged_into_customer_id IS NULL');
    expect(snapshot).not.toMatch(/DISTINCT ON|JOIN public\.leads|\bILIKE\b|\bLIKE\b/);
    expect(snapshot).toContain('strpos(lower(c.customer_name),lower(search_value))>0');
  });
  it('echoes exact filters and bounds globally discovered channel suggestions separately from the page', () => {
    expect(snapshot).toContain("'filters',filters_json");
    expect(snapshot).toContain('SELECT DISTINCT intake_channel FROM public.sales_customers');
    expect(snapshot).toContain('ORDER BY intake_channel LIMIT 201');
    expect(snapshot).toContain('FILTER(WHERE rn<=200)');
    expect(snapshot).toContain("'hasMoreChannels',more_channels");
    expect(snapshot).not.toContain("'total'");
  });
});
