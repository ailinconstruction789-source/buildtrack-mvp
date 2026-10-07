// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('sql/sales/19_project_sales_read_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const snapshot = code.split('AS $snapshot$')[1].split('$snapshot$;')[0];
const capabilities = code.split('AS $capabilities$')[1].split('$capabilities$;')[0];
describe('withheld read-only project sales SQL (source checks, not production certification)', () => {
  it('keeps abort and rollback guards and never changes tables, policies, stock or flags', () => {
    expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('CREATE FUNCTION'));
    expect(source).toContain('NEVER RUN ON SUPABASE');
    expect(code).not.toMatch(/ALTER TABLE|CREATE (?:TABLE|POLICY|TRIGGER|ROLE|EXTENSION)|DROP |TRUNCATE|cron\.|pg_net/i);
  });
  it('only exposes authenticated STABLE RPCs with fixed search path', () => {
    expect(code.match(/CREATE FUNCTION /g)).toHaveLength(2);
    expect(code.match(/STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'/g)).toHaveLength(2);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.crm_v2_project_sales_capabilities() FROM PUBLIC,anon');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.crm_v2_project_sales(text,text,text,integer) FROM PUBLIC,anon');
    expect(code.match(/GRANT EXECUTE /g)).toHaveLength(2);
  });
  it('takes identity from auth/role and checks existing booking readiness', () => {
    expect(snapshot).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
    expect(snapshot).toContain("NOT IN ('sales','admin','owner')");
    expect(capabilities).toContain('public.crm_v2_booking_capabilities()');
    expect(snapshot).not.toMatch(/user_metadata|request\.jwt|p_actor|p_owner/);
  });
  it('does not acquire locks, call commands or write audit/receipt records when reading', () => {
    for (const body of [snapshot, capabilities]) expect(body).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)|set_config\(/i);
  });
  it('reads actual sale identity and preserves null evidence instead of using legacy lead/name joins', () => {
    expect(snapshot).toContain('JOIN public.lead_project_interests i ON i.id=s.project_interest_id');
    expect(snapshot).toContain('JOIN public.sales_customers c ON c.id=i.customer_id');
    expect(snapshot).toContain("'saleId',s.id,'customerId',s.customer_id");
    expect(snapshot).toContain("'salePrice',s.sale_price,'depositAmount',s.booking_amount");
    expect(snapshot).not.toMatch(/DISTINCT ON|JOIN public\.leads|COALESCE\(s\.(?:sale_price|booking_amount|booked_at)/i);
  });
  it('checks unlinked legacy records before filtering and uses bounded deterministic literal search', () => {
    expect(snapshot.indexOf('s.project_interest_id IS NULL')).toBeLessThan(snapshot.indexOf('WITH page_rows'));
    expect(snapshot).toContain('LIMIT 51 OFFSET p_page*50');
    expect(snapshot).toContain('ORDER BY s.booked_at DESC NULLS LAST,s.id');
    expect(snapshot).toContain('strpos(lower(c.customer_name),lower(search_value))>0');
    expect(snapshot).not.toMatch(/\bILIKE\b|\bLIKE\b/);
  });
  it('the isolated harness registers19, supports focused reads, validates SQL/TS parity and cleans up', () => {
    const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
    expect(runner).toContain("options.at(-1) === '--project-sales-only'");
    expect(runner).toContain("projectSalesOnly ? 'project-sales-only'");
    expect(runner).toContain("centralSearchOnly ? 'central-search-only'");
    expect(runner).toContain("visitsOnly ? 'visits-only'");
    expect(runner).toContain('report.results.projectSales.projectionParity = true');
    expect(runner.indexOf('await identity(database)')).toBeLessThan(runner.indexOf('const projectOutput'));
    expect(runner).toContain('await stopOwnedCluster()');
  });
});
