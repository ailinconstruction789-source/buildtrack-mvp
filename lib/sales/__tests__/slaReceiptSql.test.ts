// @vitest-environment node
// STATIC source guards only. Native PostgreSQL scenarios are a separate local-only check.
// These checks do not execute SQL or establish live Supabase/RLS compatibility.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/10_first_contact_receipt_review_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const capability = code.split('AS $capabilities$')[1].split('$capabilities$;')[0];
const lookup = code.split('AS $receipt$')[1].split('$receipt$;')[0];
const projection = lookup.split('projected_receipt:=jsonb_build_object(')[1].split('END IF;')[0];
const scenario = readFileSync(resolve(process.cwd(), 'sql/sales/runtime/scenarios/receipt-review.sql'), 'utf8');
const gates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
    'work_schedule_enabled', 'notifications_enabled', 'sla_preview_enabled'];

describe('withheld read-only receipt SQL (static only)', () => {
    it('aborts before its first DDL and ends in rollback', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeGreaterThanOrEqual(0);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('CREATE FUNCTION'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).not.toMatch(/\b(?:COMMIT|ALTER|DROP|TRUNCATE|COPY|CALL)\b/);
        expect(source).toContain('NEVER RUN ON SUPABASE');
    });

    it('adds only two stable functions, no table, flag, policy, grant or data mutation', () => {
        expect(code.match(/CREATE FUNCTION/g)).toHaveLength(2);
        expect(code.match(/STABLE SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(2);
        expect(code).not.toMatch(/CREATE (?:TABLE|POLICY|TRIGGER)|GRANT (?:ALL|SELECT|INSERT|UPDATE|DELETE)/);
        expect(code).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+INTO)\b/);
        expect(code).not.toMatch(/crm_v2_process_first_contact|crm_first_contact_clock|cron\.|dblink|http_|set_config\(/);
        expect(lookup).not.toMatch(/FOR (?:UPDATE|SHARE)|pg_advisory|clock_timestamp|\b(?:PERFORM|EXECUTE|CALL)\b/);
    });

    it('exposes only authenticated execution with pinned search paths', () => {
        for (const signature of ['crm_v2_sla_receipt_capabilities()', 'crm_v2_first_contact_receipt(jsonb)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`);
        }
        expect(code).toContain("RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'");
    });

    it('authenticates the current trusted Admin before flags, parsing and ledger access', () => {
        expect(lookup).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
        expect(lookup).toContain("actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin'");
        const positions = ['CRM_SLA_RECEIPT_FORBIDDEN', 'CRM_SLA_RECEIPT_SETUP_REQUIRED',
            'CRM_SLA_RECEIPT_INVALID_INPUT', 'SELECT r.response INTO receipt_response'].map((text) => lookup.indexOf(text));
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(code).not.toMatch(/user_metadata|app_metadata|request\.jwt|p_actor|p_owner|p_role/);
    });

    it('requires six base read gates but permits recovery while processing is disabled', () => {
        for (const gate of gates) {
            expect(capability).toContain(gate);
            expect(lookup).toContain(gate);
        }
        expect(capability).toContain("'contract_version','first_contact_receipt_review_v1'");
        expect(capability).toContain("public.crm_v2_role()='admin'");
        expect(capability).toContain('SELECT sla_processing_enabled FROM public.crm_settings');
        expect(capability).toContain("'processing_enabled',enabled AND processing");
        expect(lookup).not.toContain('sla_processing_enabled');
        expect(lookup).toContain('IF NOT COALESCE((SELECT central_intake_enabled');
    });

    it('accepts exactly two UUID strings with a bounded input and typed normalization', () => {
        expect(code).toContain('crm_v2_first_contact_receipt(p_request jsonb)');
        expect(lookup).toContain("jsonb_typeof(p_request) IS DISTINCT FROM 'object'");
        expect(lookup).toContain('octet_length(p_request::text)>1024');
        expect(lookup.indexOf("jsonb_typeof(p_request) IS DISTINCT FROM 'object'")).toBeLessThan(lookup.indexOf('jsonb_object_keys(p_request)'));
        expect(lookup).toContain("NOT (p_request ?& ARRAY['requestId','taskId'])");
        expect(lookup).toContain("jsonb_object_keys(p_request) k WHERE k NOT IN ('requestId','taskId')");
        for (const key of ['requestId', 'taskId']) {
            expect(lookup).toContain(`jsonb_typeof(p_request->'${key}') IS DISTINCT FROM 'string'`);
            expect(lookup).toContain(`length(p_request->>'${key}')<>36`);
            expect(lookup).toContain(`(p_request->>'${key}') !~ uuid_pattern`);
            expect(lookup).toContain(`(p_request->>'${key}')::uuid`);
        }
    });

    it('reads only the existing own actor/request/task receipt and returns opaque not-found', () => {
        expect(lookup).toContain('SELECT r.response INTO receipt_response FROM sales_private.crm_first_contact_processing_requests r');
        expect(lookup).toContain('WHERE r.actor_user_id=actor_id AND r.request_id=request_id_value AND r.task_id=task_id_value');
        expect(lookup).toContain('projected_receipt jsonb:=NULL');
        expect(lookup).toContain('found_receipt:=FOUND;');
        expect(lookup).toContain('IF found_receipt THEN');
        expect(lookup).toContain("'requestId',request_id_value,'taskId',task_id_value,'found',found_receipt,'receipt',projected_receipt");
        expect(lookup).not.toMatch(/FROM public\.(?:crm_sla_tasks|crm_notifications|sales_customers)|r\.request_payload/);
        expect(source).toContain('found=false is not proof that a command never committed');
    });

    it('projects every public receipt field and no future private surplus', () => {
        const fields = ['requestId', 'taskId', 'processedAt', 'replayed', 'outcome', 'reason', 'serviceDueAt',
            'staffDueAt', 'notificationId', 'notificationType', 'completedByActivityId', 'completedAt', 'withdrawnCount'];
        const projectedFields = Array.from(projection.matchAll(/'([^']+)',receipt_response->'([^']+)'/g), (match) => {
            expect(match[1]).toBe(match[2]);
            return match[1];
        });
        expect(projectedFields).toEqual(fields);
        expect(projection).toContain("'actor',jsonb_build_object('userId',receipt_response#>'{actor,userId}','role',receipt_response#>'{actor,role}')");
        expect(projection).not.toContain("receipt_response->'actor'");
        expect(projection).not.toMatch(/request_payload|evaluation_snapshot|phone|income|notes|\|\|/);
    });

    it('preserves historical JSON values without replay, current-time or delivery claims', () => {
        expect(projection).toContain("'processedAt',receipt_response->'processedAt','replayed',receipt_response->'replayed'");
        expect(lookup).not.toMatch(/jsonb_set|jsonb_strip_nulls|now\(|CURRENT_TIMESTAMP|last_seen|read_at/);
        expect(lookup).not.toContain("'replayed',true");
        expect(source).toContain('lookup is NOT a command replay');
        expect(source).toContain('the receipt is a historical result');
    });
});

describe('isolated receipt runtime coverage source (not execution)', () => {
    it('requires the synthetic database, opt-in GUC and loopback and rolls back', () => {
        expect(scenario).toContain("current_database() !~ '^buildtrack_sales_runtime_'");
        expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'");
        expect(scenario).toContain("inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet");
        expect(scenario.trim()).toMatch(/ROLLBACK;$/);
        expect(scenario).toContain('RECEIPT_REVIEW_RUNTIME:');
        expect(scenario).toContain("'suite','first_contact_receipt_review'");
    });

    it('uses actual synthetic intake/schedule/processor receipts and a separately labeled surplus fixture', () => {
        for (const rpc of ['crm_v2_create_customer', 'crm_v2_publish_work_schedule', 'crm_v2_process_first_contact']) {
            expect(scenario).toContain(`public.${rpc}(`);
        }
        expect(scenario).toContain('deliberately fabricated receipt with surplus synthetic private fields');
        expect(scenario).toContain('own lookup returns exact historical receipt without replaying');
        expect(scenario).toContain('receipt projection strips extra top-level and nested actor fields');
    });

    it('covers opaque cross-Admin/task misses, disabled processing, all read gates and input authority', () => {
        for (const label of ['Admin A cannot see Admin B receipt', 'Admin B cannot see Admin A receipt',
            'wrong existing task gives opaque not-found', 'absent request gives opaque not-found',
            'processing kill switch does not disable receipt recovery', 'exact receipt readable with processing disabled',
            'invalid receipt payload ', 'SQL NULL request rejected', 'revoked original Admin cannot recover old receipt',
            'anon cannot call receipt lookup even with Admin sub']) {
            expect(scenario).toContain(label);
        }
        for (const gate of gates) expect(scenario).toContain(`'${gate}'`);
        expect(scenario).toContain("'read capability honors '||gate");
        expect(scenario).toContain("'receipt read honors '||gate");
    });

    it('compares full business state for all reads and historical reads after real closure', () => {
        for (const table of ['public.sales_customers', 'public.crm_sla_tasks', 'public.crm_notifications',
            'public.crm_audit_events', 'sales_private.crm_first_contact_processing_requests']) {
            expect(scenario).toContain(`FROM ${table}`);
        }
        expect(scenario).toContain('REVOKE ALL ON FUNCTION runtime_receipt_review.business_snapshot() FROM PUBLIC,anon,authenticated');
        expect(scenario).toContain('found absent forbidden invalid and kill-switch reads mutate no customer task notice audit or receipt');
        expect(scenario).toContain('public.crm_v2_change_lead_lifecycle(');
        expect(scenario).toContain('closed task still has exact historical notified receipt');
        expect(scenario).toContain('historical lookup does not reopen task revive notice reset read state or insert receipt');
    });
});
