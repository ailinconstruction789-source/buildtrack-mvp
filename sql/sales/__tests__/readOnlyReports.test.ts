// @vitest-environment node
// Static regression checks only. This suite NEVER executes SQL or opens a DB.
// It is not a PostgreSQL parser or evidence that the reports execute successfully.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const reports = ['01_read_only_preflight.sql', '02_read_only_data_audit.sql', '03_read_only_migration_review.sql'];
// These authored scripts have standard single-quoted literals and line comments.
// Removing them prevents instructions in comments from masquerading as SQL verbs.
const executableTokens = (sql: string) => sql.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'/g, ' ');

describe('manually run read-only report files', () => {
  it.each(reports)('%s remains one SELECT/CTE without mutation statements or RPCs', file => {
    const tokens = executableTokens(read(`sql/sales/${file}`));
    expect(tokens.trim()).toMatch(/^WITH\b/i);
    expect(tokens.match(/;/g)).toHaveLength(1);
    expect(tokens.trim()).toMatch(/;$/);
    expect(tokens).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO|CALL|COPY|INTO)\b/i);
    expect(tokens).not.toMatch(/\b(?:crm_v2_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|set_config|pg_advisory\w*)\s*\(/i);
  });

  it.each(reports)('%s has balanced parentheses outside its literals/comments', file => {
    let depth = 0;
    for (const token of executableTokens(read(`sql/sales/${file}`))) {
      if (token === '(') depth++;
      if (token === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('limits auth projection to staff hints, never secrets or a complete auth record', () => {
    const sql = read('sql/sales/03_read_only_migration_review.sql');
    const authSection = sql.split('), auth_hints AS (')[1].split('), auth_names AS (')[0];
    expect(authSection).toContain('a.id AS auth_user_id');
    expect([...authSection.matchAll(/raw_user_meta_data->>'([^']+)'/g)].map(match => match[1])).toEqual(['username', 'name', 'role']);
    const tokens = executableTokens(authSection);
    expect(tokens).not.toMatch(/a\.\*|to_jsonb\(a\)|encrypted_password|confirmation_token|recovery_token|\bemail\b|\bpin\b/);
  });

  it('does not put raw customer identity fields in output keys or duplicate preview', () => {
    const sql = read('sql/sales/03_read_only_migration_review.sql');
    const preview = sql.split('), duplicate_preview AS (')[1].split('), auth_hints AS (')[0];
    expect(preview).not.toMatch(/'customer_name'|'phone'|'phone_key'|'phone_digits'|to_jsonb\([glr]\)/);
    expect(preview).toContain('right(g.phone_key,4)');
    expect(preview).toContain('[masked invalid phone]');
    expect(preview).toContain('rows_truncated');
    expect(preview).toContain('LIMIT 20');
    expect(preview).toContain('LIMIT 50');
  });

  it('retains interpretation safeguards for owner matches, money and result limits', () => {
    const sql = read('sql/sales/03_read_only_migration_review.sql');
    for (const marker of ['admin_verification_required', 'candidate_requires_admin_verification',
      'comparable_lead_and_sale_booking_pairs', 'lead_booking_field_null_or_lead_missing',
      'lead_booking_field_nonfinite', 'common_amounts_10000_or_50000_not_proof_of_default',
      'groups_truncated', 'labels_truncated', 'candidates_truncated', 'crm_staff_hints_truncated',
      'stored_sale_statuses_truncated', 'stored_lead_statuses_truncated']) expect(sql).toContain(marker);
    expect(sql).toContain("AT TIME ZONE 'Asia/Bangkok'");
    expect(sql).not.toMatch(/COALESCE\(sum\(/i);
  });

  it('uses catalog ACLs including PUBLIC and reports RLS visibility instead of assuming complete reads', () => {
    const sql = read('sql/sales/03_read_only_migration_review.sql');
    expect(executableTokens(sql)).not.toContain('information_schema.role_table_grants');
    expect(sql).toContain('pg_catalog.aclexplode');
    expect(sql).toContain("a.grantee=0 THEN 'PUBLIC'");
    expect(sql).toContain('row_security_active(c.oid)');
    expect(sql).toContain('all_expected_tables_readable_without_rls');
    expect(sql).toContain('count(*)=5 AND bool_and');
  });

  it('keeps the separate design draft blocked before DDL and never commits it', () => {
    const sql = read('sales_workflow_v2_draft.sql');
    const guard = sql.indexOf("RAISE EXCEPTION 'DESIGN ONLY:");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(sql.indexOf('CREATE SCHEMA'));
    expect(sql.trim()).toMatch(/ROLLBACK;$/);
    expect(executableTokens(sql)).not.toMatch(/\bCOMMIT\b/i);
    expect(sql).toContain('central_intake_enabled boolean NOT NULL DEFAULT false');
  });
});

describe('historical import design guards (static only, not DB execution)', () => {
  const sql = read('sales_workflow_v2_draft.sql');
  const customers = sql.split('CREATE TABLE public.sales_customers (')[1].split('CREATE TABLE public.crm_duplicate_reviews (')[0];
  const snapshots = sql.split('CREATE TABLE sales_private.crm_legacy_source_snapshots (')[1].split('CREATE TABLE public.crm_legacy_lead_links (')[0];

  it('keeps live defaults and allows unknown phone only with historical provenance', () => {
    expect(customers).toContain("record_origin text NOT NULL DEFAULT 'live'");
    expect(customers).toContain('legacy_source_lead_id uuid UNIQUE REFERENCES public.leads(id) ON DELETE RESTRICT');
    expect(customers).toContain("phone_data_status text NOT NULL DEFAULT 'provided'");
    expect(customers).toContain('CASE WHEN phone IS NULL THEN NULL ELSE public.crm_v2_normalize_phone(phone) END');
    expect(customers).toContain("record_origin='live' AND legacy_source_lead_id IS NULL AND lead_created_at IS NOT NULL");
    expect(customers).toContain("intake_status<>'legacy_unclassified'");
    expect(customers).toContain("record_origin='legacy_import' AND legacy_source_lead_id IS NOT NULL");
    expect(customers).toContain("phone_data_status='unknown_legacy' AND record_origin='legacy_import' AND phone IS NULL");
    expect(customers).toContain("phone_data_status='provided' AND phone IS NOT NULL");
    expect(customers).toContain("length(regexp_replace(phone,'[^0-9]','','g')) BETWEEN 7 AND 15");
  });

  it('keeps raw legacy snapshots private, source-linked, and unique within their batch', () => {
    expect(snapshots).toContain('legacy_lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT');
    expect(snapshots).toContain('legacy_sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT');
    expect(snapshots).toContain("source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload)='object')");
    expect(snapshots).toContain('legacy_lead_id IS NOT NULL AND legacy_sale_id IS NULL');
    expect(snapshots).toContain('legacy_lead_id IS NULL AND legacy_sale_id IS NOT NULL');
    expect(snapshots).toContain('UNIQUE (import_batch_id,legacy_lead_id)');
    expect(snapshots).toContain('UNIQUE (import_batch_id,legacy_sale_id)');
    expect(snapshots).toContain('ALTER TABLE sales_private.crm_legacy_source_snapshots ENABLE ROW LEVEL SECURITY;');
    expect(snapshots).toContain('REVOKE ALL ON sales_private.crm_legacy_source_snapshots FROM PUBLIC, anon, authenticated;');
    expect(executableTokens(sql)).not.toMatch(/GRANT\s+[\s\S]*?ON\s+(?:TABLE\s+)?sales_private\.crm_legacy_source_snapshots\s+TO\s+(?:PUBLIC|anon|authenticated)/i);
    expect(read('sql/sales/01_read_only_preflight.sql')).toContain("'crm_legacy_source_snapshots'");
  });

  it('requires same-sale already-cancelled source proof rather than exempting every imported booking', () => {
    const cancellation = sql.split('ADD CONSTRAINT sales_v2_cancellation_check CHECK (')[1].split('ADD CONSTRAINT sales_v2_not_own_predecessor_check')[0];
    expect(cancellation).toContain("COALESCE(booking_route = 'legacy_import', false) AND legacy_cancellation_batch_id IS NOT NULL");
    expect(cancellation).toContain('cancelled_at IS NOT NULL AND cancellation_category IS NOT NULL');
    expect(cancellation).toContain("cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> ''");
    expect(cancellation).toContain("booking_route_reason IS NOT NULL AND btrim(booking_route_reason) <> ''");
    expect(cancellation).toContain("COALESCE(crm_stage = 'cancelled', false)");
    expect(snapshots).toContain('legacy_cancelled_sale_id uuid GENERATED ALWAYS AS (');
    expect(snapshots).toContain("source_payload->>'id'=legacy_sale_id::text");
    expect(snapshots).toContain("source_payload->>'contract_status'='Cancelled'");
    expect(snapshots).toContain('THEN legacy_sale_id ELSE NULL END');
    expect(snapshots).toContain('UNIQUE (import_batch_id,legacy_cancelled_sale_id)');
    expect(snapshots).toContain('FOREIGN KEY (legacy_cancellation_batch_id,id)');
    expect(snapshots).toContain('REFERENCES sales_private.crm_legacy_source_snapshots(import_batch_id,legacy_cancelled_sale_id)');
  });

  it('checks canonical phones while excluding already-mapped raw legacy phones', () => {
    const duplicate = sql.split("hashtextextended('central-phone:'||normalized_phone,0)")[1].split("RAISE EXCEPTION 'CRM_DUPLICATE_REVIEW_REQUIRED'")[0];
    expect(duplicate).toContain('FROM public.sales_customers WHERE phone_normalized=normalized_phone');
    expect(duplicate).toContain('public.crm_v2_normalize_phone(l.phone)=normalized_phone');
    expect(duplicate).toContain('AND NOT EXISTS (SELECT 1 FROM public.crm_legacy_lead_links k WHERE k.legacy_lead_id=l.id)');
  });
});
