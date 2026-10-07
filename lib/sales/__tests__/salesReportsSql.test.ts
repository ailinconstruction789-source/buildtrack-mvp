// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('sql/sales/20_sales_reports_read_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const snapshot = code.split('AS $snapshot$')[1].split('$snapshot$;')[0];
const capabilities = code.split('AS $capabilities$')[1].split('$capabilities$;')[0];

describe('withheld read-only sales aggregate SQL (source checks, not production certification)', () => {
  it('keeps immediate abort and final rollback without schema or flag mutation', () => {
    expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('CREATE FUNCTION'));
    expect(source).toContain('NEVER RUN ON SUPABASE');
    expect(code).not.toMatch(/ALTER TABLE|CREATE (?:TABLE|POLICY|TRIGGER|ROLE|EXTENSION)|DROP |TRUNCATE|cron\.|pg_net/i);
  });
  it('exposes only two authenticated STABLE RPCs under fixed search path', () => {
    expect(code.match(/CREATE FUNCTION /g)).toHaveLength(2);
    expect(code.match(/STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'/g)).toHaveLength(2);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.crm_v2_sales_reports_capabilities() FROM PUBLIC,anon');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.crm_v2_sales_report(text,text,text) FROM PUBLIC,anon');
    expect(code.match(/GRANT EXECUTE /g)).toHaveLength(2);
    expect(capabilities).toContain('public.crm_v2_project_sales_capabilities()');
    expect(snapshot).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
    expect(snapshot).not.toMatch(/user_metadata|request\.jwt|p_actor|p_owner/);
  });
  it('does not lock rows, dispatch commands, persist receipts or audit when reading', () => {
    for (const body of [snapshot, capabilities]) expect(body).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)|set_config\(/i);
  });
  it('uses original Lead date in Bangkok rather than event date or import time', () => {
    expect(snapshot).toContain("(lead_created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN from_value AND to_value");
    expect(snapshot).toContain('SELECT * FROM scope_customers WHERE from_value IS NULL');
    expect(snapshot).not.toMatch(/booked_at\s+BETWEEN|created_at\s+BETWEEN|COALESCE\([^)]*lead_created_at|CURRENT_DATE|now\(\)/i);
    expect(snapshot).toContain('(p_from_date IS NULL)<>(p_to_date IS NULL)');
    expect(snapshot).toContain("left(p_from_date,4)='0000'");
    expect(snapshot).toContain('IF from_value>to_value');
  });
  it('counts the complete dataset rather than fifty project rows and preserves exact money strings', () => {
    expect(snapshot).not.toMatch(/\bLIMIT\b|\bOFFSET\b|crm_v2_project_sales\(/i);
    expect(snapshot).toContain('JOIN cohort_interests i ON i.id=s.project_interest_id');
    expect(snapshot).toContain("round(COALESCE(sum(sale_price) FILTER(WHERE crm_stage<>'cancelled'),0),2)::text");
    expect(snapshot).toContain("crm_stage<>'cancelled' AND sale_price IS NULL");
    expect(snapshot).toContain("crm_stage IN ('transferred','handover')");
    expect(snapshot).toContain('jsonb_object_agg(stage,');
  });
  it('checks legacy mapping and malformed evidence before cohort selection without returning identities', () => {
    expect(snapshot.indexOf('s.project_interest_id IS NULL')).toBeLessThan(snapshot.indexOf('WITH scope_customers'));
    expect(snapshot.indexOf("s.sale_price::text IN ('NaN','Infinity','-Infinity')")).toBeLessThan(snapshot.indexOf('WITH scope_customers'));
    expect(snapshot).toContain("'unknownLeadDateCustomers',(SELECT count(*) FROM scope_customers WHERE lead_created_at IS NULL)");
    expect(snapshot).not.toMatch(/customer_name|phone|monthly_income|personal_data|ownerName|booking_revision|jsonb_agg\(to_jsonb/i);
  });
  it('requires reviewed legacy identity links and rejects unbooked orphan interests before cohort counts', () => {
    const legacyGuard = snapshot.slice(snapshot.indexOf('IF EXISTS(SELECT 1 FROM public.leads legacy'),
      snapshot.indexOf('IF EXISTS(SELECT 1 FROM public.lead_project_interests i'));
    expect(legacyGuard).toContain('LEFT JOIN public.crm_legacy_lead_links link ON link.legacy_lead_id=legacy.id');
    expect(legacyGuard).toContain('link.legacy_lead_id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL');
    expect(legacyGuard).toContain('i.customer_id IS DISTINCT FROM link.customer_id');
    expect(legacyGuard).not.toMatch(/p_project_name|from_value|to_value|legacy_source_lead_id|phone/);
    expect(snapshot.indexOf('IF EXISTS(SELECT 1 FROM public.lead_project_interests i')).toBeLessThan(snapshot.indexOf('WITH scope_customers'));
    expect(snapshot).toContain('AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL)');
  });
  it('registers focused report runtime mode, full contract parity and unchanged isolation cleanup', () => {
    const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
    expect(runner).toContain("options.at(-1) === '--sales-reports-only'");
    expect(runner).toContain("salesReportsOnly ? 'sales-reports-only'");
    expect(runner).toContain("'lib/sales/salesReportsContracts.ts'");
    expect(runner).toContain('report.results.salesReports.projectionParity = true');
    expect(runner.indexOf('await identity(database)')).toBeLessThan(runner.indexOf('const salesReportOutput'));
    expect(runner).toContain('await stopOwnedCluster()');
    expect(runner).toContain('for (const path of draftPaths)');
  });
  it('synthetic scenarios preserve original constraints and prove read-only aggregate behavior', () => {
    const scenario = readFileSync('sql/sales/runtime/scenarios/sales-reports.sql', 'utf8');
    expect(scenario).toContain('generate_series(1,64)');
    expect(scenario).toContain('SET TRANSACTION READ ONLY;');
    expect(scenario).toContain("current_setting('transaction_read_only')<>'on'");
    expect(scenario).toContain('runtime_sales_reports.business_snapshot()=');
    expect(scenario).toContain('SALES_REPORTS_SNAPSHOT:');
    expect(scenario).toContain('SALES_REPORTS_RUNTIME:');
    expect(scenario).not.toMatch(/DISABLE TRIGGER|session_replication_role|DEFERRED|ALTER (?:TABLE|FUNCTION)|DROP (?:TRIGGER|CONSTRAINT)/i);
  });
});
