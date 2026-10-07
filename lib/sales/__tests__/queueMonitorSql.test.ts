// @vitest-environment node
// Source checks only. Native synthetic execution is separate and never grants
// permission to install SQL, connect Supabase, enable flags or activate Cron.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/17_queue_monitor_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const compact = code.replace(/\s+/g, ' ');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const snapshot = body('snapshot');
const capabilities = body('capabilities');
const readGates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled', 'work_schedule_enabled',
    'notifications_enabled', 'sla_preview_enabled', 'sla_queue_monitor_enabled'];
const writerGates = ['sla_processing_enabled', 'sla_cycle_enabled', 'sla_worker_enabled', 'sla_dispatcher_enabled', 'sla_burst_enabled'];

describe('withheld read-only Admin queue monitor SQL (static only)', () => {
    it('retains execution guard, rollback and a default-off monitor flag', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE public.crm_settings'));
        expect(compact).toContain('ADD COLUMN sla_queue_monitor_enabled boolean NOT NULL DEFAULT false');
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(source).toContain('NEVER RUN ON SUPABASE');
        expect(code).not.toMatch(/CREATE (?:ROLE|EXTENSION|TABLE|INDEX)|ALTER ROLE|ALTER DEFAULT PRIVILEGES|\bDROP\b|\bTRUNCATE\b|\bCOPY\b|cron\.|pg_net|net\.http/i);
    });

    it('exposes only two no-argument authenticated read functions', () => {
        expect(code.match(/CREATE FUNCTION /g)).toHaveLength(2);
        expect(code).toContain('CREATE FUNCTION public.crm_v2_queue_monitor_capabilities()');
        expect(code).toContain('CREATE FUNCTION public.crm_v2_queue_monitor_snapshot()');
        expect(code.match(/STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'/g)).toHaveLength(2);
        expect(code.match(/\bGRANT\s+[\s\S]*?;/g)?.map(value => value.replace(/\s+/g, ' '))).toEqual([
            'GRANT EXECUTE ON FUNCTION public.crm_v2_queue_monitor_capabilities() TO authenticated;',
            'GRANT EXECUTE ON FUNCTION public.crm_v2_queue_monitor_snapshot() TO authenticated;',
        ]);
        for (const name of ['capabilities', 'snapshot']) {
            expect(compact).toContain(`REVOKE ALL ON FUNCTION public.crm_v2_queue_monitor_${name}() FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;`);
        }
        expect(compact).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON FUNCTION public.crm_v2_queue_monitor_capabilities(),public.crm_v2_queue_monitor_snapshot() FROM service_role;");
    });

    it('takes actor identity from auth and active database role, never caller claims', () => {
        expect(snapshot).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
        expect(snapshot).toContain("IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_FORBIDDEN'");
        expect(capabilities).toContain("auth.uid() IS NOT NULL AND public.crm_v2_role()='admin'");
        expect(code).not.toMatch(/request\.jwt|user_metadata|set_config\(|SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION|p_actor|p_user/);
    });

    it('requires every read gate but preserves evidence when writers are off', () => {
        const gateCheck = snapshot.split('SELECT * INTO settings_row')[1].split("IF NOT isfinite(as_of)")[0];
        for (const gate of readGates) {
            expect(capabilities).toContain(gate);
            expect(gateCheck).toContain(`settings_row.${gate}`);
        }
        for (const gate of writerGates) {
            expect(gateCheck).not.toContain(gate);
            expect(capabilities).not.toContain(gate);
            expect(snapshot).toContain(`settings_row.${gate}`);
        }
        expect(gateCheck).toContain('IF NOT FOUND OR');
        expect(gateCheck).toContain("IS DISTINCT FROM true THEN\n    RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'");
    });

    it('does not mutate business state, acquire locks, run workers or recalculate clocks', () => {
        for (const target of [snapshot, capabilities]) {
            expect(target).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)|SET\s+\w+\s*=/);
        }
        expect(code).not.toMatch(/crm_first_contact_(?:dispatch_(?:prepare|execute|status|burst)|worker_(?:cycle|tick|burst_tick)\(|apply\(|clock\()|crm_v2_process_first_contact|crm_visible_sla_notifications\(/);
        expect(code).not.toMatch(/\bGRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|USAGE)|CREATE POLICY|CREATE TRIGGER|DISABLE TRIGGER|pg_sleep/);
        expect(snapshot).not.toContain('clock_timestamp()');
        expect(snapshot).toContain('as_of timestamptz:=statement_timestamp()');
    });

    it('bounds candidate evidence with the existing ordered scan and explicit exactness', () => {
        expect(compact).toContain("FROM public.crm_sla_tasks WHERE task_type='first_contact' AND project_interest_id IS NULL AND source_activity_id IS NULL AND status='open' ORDER BY created_at,id LIMIT 901");
        expect(snapshot).toContain("'sampleCount',sample_count,'exact',sample_count<901,'scanLimit',901");
        expect(snapshot).toContain("count(*) FILTER (WHERE review_state='held')");
        expect(snapshot).toContain("review_state IS NULL OR review_state NOT IN ('ready','held','completed','closed')");
        expect(snapshot).toContain("jsonb_typeof(evaluation_snapshot->'processingReview')='object'");
        expect(snapshot).toContain("jsonb_typeof(evaluation_snapshot#>'{processingReview,state}')='string'");
        expect(snapshot).not.toMatch(/evaluation_snapshot.*::(?:integer|timestamptz)|jsonb_agg\(evaluation_snapshot|withoutStoredReviewCount.*coalesce/i);
    });

    it('uses only current control and exact request/attempt/receipt PK lookups', () => {
        expect(snapshot).toContain('FROM sales_private.crm_first_contact_dispatch_control WHERE id');
        expect(snapshot).toContain('FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id');
        expect(snapshot).toContain('FROM sales_private.crm_first_contact_dispatch_attempts WHERE attempt_id=request_row.current_attempt_id');
        expect(snapshot).toContain('FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=current_id');
        expect(snapshot).not.toMatch(/FROM sales_private\.crm_first_contact_dispatch_admissions|ORDER BY.*(?:completed_at|prepared_at)|jsonb_agg\(|row_to_json\(|to_jsonb\(/);
        expect(snapshot).toContain('attempt_row.request_id IS DISTINCT FROM current_id');
        expect(snapshot).toContain('attempt_row.attempt_no IS DISTINCT FROM request_row.attempt_count');
    });

    it('rejects unavailable or malformed cursor metadata without inventing freshness', () => {
        expect(snapshot).toContain('FROM sales_private.crm_first_contact_cycle_cursor WHERE id');
        expect(snapshot).toContain('(cursor_row.after_created_at IS NULL)<>(cursor_row.after_task_id IS NULL)');
        expect(snapshot).toContain('NOT isfinite(cursor_row.after_created_at)');
        expect(snapshot).toContain("'cursor',jsonb_build_object('afterCreatedAt',cursor_row.after_created_at,'afterTaskId',cursor_row.after_task_id)");
        expect(snapshot).not.toMatch(/cursor.*updated_at|lastSweepAt|elapsedSeconds/);
    });

    it('validates current status, policy and temporal relationships independently of gate state', () => {
        expect(snapshot).toContain("request_row.status NOT IN ('reserved','retry_wait','review','completed')");
        expect(snapshot).toContain("request_row.policy_version NOT IN ('completion_spacing_v1','bounded_burst_v2')");
        expect(snapshot).toContain('attempt_row.prepared_at<request_row.created_at OR attempt_row.prepared_at>as_of');
        expect(snapshot).toContain('request_row.completed_at<attempt_row.prepared_at OR request_row.completed_at>as_of');
        expect(snapshot).toContain("request_row.status='retry_wait' AND request_row.last_error_code IS DISTINCT FROM 'TRANSIENT_RETRY'");
        expect(snapshot).toContain("request_row.status IN ('reserved','completed') AND request_row.last_error_code IS NOT NULL");
        expect(snapshot).not.toContain('next_attempt_at<as_of');
    });

    it('requires a valid committed worker receipt exactly for completed current requests', () => {
        expect(snapshot).toContain("IF (request_row.status='completed') IS DISTINCT FROM FOUND THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'");
        expect(snapshot).toContain("response_value->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')");
        expect(snapshot).toContain("response_value->>'requestId' IS DISTINCT FROM current_id::text");
        expect(snapshot).toContain("response_value->'maxItems' IS DISTINCT FROM '10'::jsonb");
        expect(snapshot).toContain("(response_value->>'processedCount') !~ '^(10|[0-9])$'");
        expect(snapshot).toContain("jsonb_array_length(response_value->'receipts')<>processed_count");
        expect(snapshot).toContain('finished_at_value>request_row.completed_at OR receipt_row.created_at IS DISTINCT FROM finished_at_value');
        expect(snapshot).toContain("RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'");
    });

    it('projects cycle counts not raw child bodies or reasons, counting only new notified outcomes', () => {
        expect(snapshot).toContain("count(*) FILTER (WHERE child->>'outcome'='held'),count(*) FILTER (WHERE child->>'outcome'='notified')");
        expect(snapshot).toContain("'heldCount',receipt_held_count,'notifiedCount',notified_count");
        const projection = snapshot.split('receipt_value:=jsonb_build_object(')[1].split('END IF;')[0];
        expect(projection).not.toMatch(/receipts|reason|notificationId|customer|taskId|phone|income|private/i);
        const requestProjection = snapshot.split('request_value:=jsonb_build_object(')[1].split('END IF;')[0];
        expect(requestProjection).not.toMatch(/response|prepared_xid|request_payload|raw|SQLERRM/);
    });

    it('returns explicit unmeasured latency and target without delivery or activation promises', () => {
        expect(snapshot).toContain("'contractVersion','first_contact_queue_monitor_v1'");
        expect(snapshot).toContain("'asOf',as_of,'readOnly',true");
        expect(snapshot).toContain("'targetSeconds',300,'deliveryLatencySeconds',NULL,'sweepAgeSeconds',NULL");
        expect(snapshot).not.toMatch(/available_at|notify_at|EXTRACT\(|automationReady|activationReady|healthy|delivery.*true/i);
        expect(source).toContain('candidate work is not a delivery');
    });
});
