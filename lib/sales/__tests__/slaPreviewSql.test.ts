// @vitest-environment node
// STATIC design checks only. Never execute SQL or claim PostgreSQL/RLS/concurrency validation.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/08_sla_preview_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const capability = code.split('AS $capabilities$')[1].split('$capabilities$;')[0];
const preview = code.split('AS $source$')[1].split('$source$;')[0];
const queue = preview.split('FOR task_row IN')[1].split('LOOP')[0];
const proof = preview.split('SELECT count(*),count(*) FILTER')[1].split('pending_lifecycle:=')[0];
const taskProjection = preview.split('task_json:=task_json ||')[1].split('END LOOP;')[0];
const gates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
    'work_schedule_enabled', 'notifications_enabled', 'sla_preview_enabled'];

describe('SLA preview draft safety (static only)', () => {
    it('aborts before DDL and ends in rollback, leaving its feature disabled', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).toContain('ADD COLUMN sla_preview_enabled boolean NOT NULL DEFAULT false');
        expect(code).not.toMatch(/\b(?:COMMIT|TRUNCATE|DROP|COPY|CALL)\b|sla_preview_enabled\s*=\s*true/i);
    });
    it('contains no data write, backfill, deadline calculation, notification creation or scheduler', () => {
        expect(code).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+public\.|UPDATE\s+sales_private\.|DELETE\s+FROM|MERGE\s+INTO|CREATE\s+TABLE)\b/);
        expect(code).not.toMatch(/cron\.|net\.|http_|dblink|set_config\(|make_interval\(|\binterval\b|gen_random_uuid/);
        expect(code).not.toMatch(/notificationBinding|staff_due_at|notify_at|read_at|last_seen/);
        expect(source).toContain('Static checks do not validate PostgreSQL');
        expect(source).toContain('Raw calendars/evidence must remain server-side');
    });
    it('reads one stable snapshot without row/advisory locks or hidden mutations', () => {
        expect(code).toContain("RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(preview).not.toMatch(/FOR UPDATE|FOR SHARE|pg_advisory|\b(?:PERFORM|EXECUTE|CALL)\b/);
        expect(preview).toContain('as_of:=clock_timestamp()');
        expect(preview.indexOf('as_of:=clock_timestamp()')).toBeLessThan(preview.indexOf('FOR task_row IN'));
    });
    it('reuses existing settings/tasks/audit/calendars without new ledgers or table grants', () => {
        expect(code.match(/ALTER TABLE/g)).toHaveLength(1);
        expect(code).not.toMatch(/CREATE TABLE|CREATE POLICY|GRANT (?:ALL|SELECT|UPDATE|INSERT|DELETE)|ALTER TABLE public\.(?!crm_settings)/);
        expect(preview).toContain('FROM public.crm_sla_tasks t');
        expect(preview).toContain('FROM public.crm_audit_events a');
        expect(preview).toContain('FROM sales_private.crm_work_calendars');
    });
});

describe('Admin-only preview source contract (static only)', () => {
    it('requires trusted active Admin identity and has no arbitrary actor or customer parameters', () => {
        expect(capability).toContain("public.crm_v2_role()='admin'");
        expect(preview).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
        expect(preview).toContain("actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin'");
        expect(code).toContain('crm_v2_sla_preview_source(p_page integer DEFAULT 0)');
        expect(code).not.toMatch(/p_actor|p_owner|p_customer|p_role|p_payload|user_metadata|app_metadata|request\.jwt/);
    });
    it('requires six disabled-until-ready DB gates on both capability and source', () => {
        for (const gate of gates) {
            expect(capability).toContain(gate);
            expect(preview).toContain(`settings_row.${gate}`);
        }
        expect(capability).toContain("'contract_version','first_contact_preview_v1'");
        expect(preview).toContain('IS DISTINCT FROM true');
        expect(preview.indexOf('CRM_SLA_PREVIEW_SETUP_REQUIRED')).toBeLessThan(preview.indexOf('FOR task_row IN'));
    });
    it('pins search paths and exposes only authenticated gated functions, no private helper', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(2);
        for (const signature of ['crm_v2_sla_preview_capabilities()', 'crm_v2_sla_preview_source(integer)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`);
        }
    });
    it('provides bounded page20 pagination with honest lookahead in oldest-task order', () => {
        expect(preview).toContain('p_page IS NULL OR p_page<0 OR p_page>1000');
        expect(queue).toContain('ORDER BY t.created_at ASC,t.id ASC LIMIT 21 OFFSET p_page*20');
        expect(preview).toContain('IF page_count>20 THEN has_more:=true; EXIT; END IF');
        expect(preview).toContain("'page',p_page,'pageSize',20,'hasMore',has_more");
        expect(preview).toContain("task_json jsonb:='[]'::jsonb");
    });
    it('returns all source fields explicitly and binds identity/settings/asOf to trusted rows', () => {
        expect(preview).toContain("'actor',jsonb_build_object('userId',actor_id,'role','admin'),'asOf',as_of");
        expect(preview).toContain("'version',settings_row.version,'initialContactHours',settings_row.initial_contact_hours");
        expect(preview).toContain("'nextShiftResponseMinutes',settings_row.next_shift_response_minutes");
        for (const field of ['id', 'customerId', 'customerName', 'ownerUserId', 'ownerName', 'scopeOwnerUserId',
            'ownerIsActiveSales', 'lifecycleRevision', 'scopeClosed', 'recordOrigin', 'leadCreatedAt',
            'obligationStartedAt', 'serviceDueAt', 'taskCreatedAt', 'initialContactHours', 'creationProven',
            'ownerHistoryUnchanged', 'lifecycleReviewPending', 'hasContactEvidence', 'hasCustomerPostponement',
            'hasExceptions', 'calendar']) expect(taskProjection).toContain(`'${field}'`);
        expect(taskProjection).not.toMatch(/to_jsonb|row_to_json|SELECT \*/);
    });
});

describe('first-contact queue and held-evidence preservation (static only)', () => {
    it('includes only open central original first-contact tasks, not follow-ups or derived activity obligations', () => {
        expect(queue).toContain("t.task_type='first_contact' AND t.project_interest_id IS NULL");
        expect(queue).toContain("t.status='open' AND t.source_activity_id IS NULL");
        expect(queue).not.toContain('follow_up');
    });
    it('does not filter out legacy, closed, inactive-owner, reviewed, future or missing-evidence queue rows', () => {
        expect(queue).not.toMatch(/record_origin|intake_status|merged_into|accountability_state|owner_user_id|is_active|lead_created_at|as_of|evaluation_snapshot|JOIN/);
        expect(taskProjection).toContain("'scopeClosed',customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status='lost'");
        expect(taskProjection).toContain("'recordOrigin',customer_row.record_origin,'leadCreatedAt',customer_row.lead_created_at");
    });
    it('distinguishes the task owner from the current scope owner and exposes current active Sales readiness', () => {
        expect(preview).toContain('FROM sales_private.crm_user_roles WHERE user_id=task_row.owner_user_id');
        expect(taskProjection).toContain("'ownerUserId',task_row.owner_user_id,'ownerName',NULLIF(btrim(owner_row.display_name),'')");
        expect(taskProjection).toContain("'scopeOwnerUserId',customer_row.owner_user_id");
        expect(taskProjection).toContain("'ownerIsActiveSales',COALESCE(owner_row.role='sales' AND owner_row.is_active,false)");
    });
    it('reads only explicit original numeric integer hours with nested cast guards and no guessed default', () => {
        const hours = preview.split('original_hours:=')[1].split(';')[0];
        expect(hours).toContain("CASE WHEN jsonb_typeof(task_row.evaluation_snapshot->'initialContactHours')='number' THEN");
        expect(hours).toContain("CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours') ~ '^[1-9][0-9]{0,9}$' THEN");
        expect(hours).toContain("CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours')::bigint<=2147483647");
        expect(hours).toContain("THEN (task_row.evaluation_snapshot->>'initialContactHours')::integer ELSE NULL END");
        expect(hours).not.toMatch(/COALESCE|settings_row|24|make_interval/);
    });
    it('requires exactly one original correctly bound creation event, not merely one matching event among duplicates', () => {
        expect(proof).toContain('INTO creation_count,valid_creation_count');
        expect(proof).toContain("WHERE a.entity_type='customer' AND a.entity_id=customer_row.id AND a.event_type='created'");
        expect(proof).toContain('a.customer_id=customer_row.id');
        expect(proof).toContain("a.actor_kind='staff' AND a.actor_user_id IS NOT NULL AND a.correction_of_event_id IS NULL");
        expect(proof).toContain('a.actor_user_id=customer_row.created_by_user_id');
        expect(proof).toContain('creation_proven:=creation_count=1 AND valid_creation_count=1');
        expect(proof).not.toMatch(/LIMIT 1|count\(DISTINCT/);
    });
    it('requires original finite creation timing to match both lead date and obligation start', () => {
        expect(proof).toContain('isfinite(a.occurred_at) AND isfinite(a.recorded_at)');
        expect(proof).toContain('a.occurred_at=customer_row.lead_created_at AND a.occurred_at=task_row.obligation_started_at');
        expect(proof).toContain('a.recorded_at>=a.occurred_at AND a.recorded_at<=as_of');
        expect(taskProjection).toContain("'serviceDueAt',task_row.service_due_at");
        expect(proof).not.toMatch(/date_trunc|extract\(|AT TIME ZONE|make_interval/);
    });
    it('binds the creation owner as safe JSON text, without casting untrusted history to UUID', () => {
        expect(proof).toContain("jsonb_typeof(a.new_values)='object' AND jsonb_typeof(a.new_values->'ownerUserId')='string'");
        expect(proof).toContain("a.new_values->>'ownerUserId'=customer_row.owner_user_id::text");
        expect(proof).not.toContain('::uuid');
    });
    it('holds corrected creation history even if correction carries different customer metadata', () => {
        expect(proof).toContain('NOT EXISTS (SELECT 1 FROM public.crm_audit_events correction WHERE correction.correction_of_event_id=a.id)');
        expect(proof).toContain('LEFT JOIN public.crm_audit_events original ON original.id=correction.correction_of_event_id');
        expect(proof).toContain("original.entity_id=customer_row.id AND original.entity_type IN ('customer','sales_customer')");
    });
    it('rejects owner transfer/ABA history using the actual lifecycle entity name and assignment date', () => {
        expect(proof).toContain('unchanged_owner:=COALESCE(creation_proven');
        expect(proof).toContain('customer_row.owner_assigned_at=customer_row.lead_created_at');
        expect(proof).toContain("a.entity_type IN ('sales_customer','customer') AND a.event_type='reassign_owner'");
        expect(proof).toContain("correction.entity_id=customer_row.id AND correction.entity_type IN ('customer','sales_customer')");
    });
    it('treats any lifecycleReview presence or malformed evaluation container as pending, without invented clear states', () => {
        expect(preview).toContain("pending_lifecycle:=jsonb_typeof(task_row.evaluation_snapshot) IS DISTINCT FROM 'object'");
        expect(preview).toContain("OR task_row.evaluation_snapshot ? 'lifecycleReview'");
        expect(preview).not.toMatch(/'cleared'|'resolved'|lifecycleReview,state/);
    });
    it('holds any customer contact or postponement evidence across projects, and every task exception', () => {
        expect(taskProjection).toContain("'hasContactEvidence',customer_row.first_contacted_at IS NOT NULL");
        expect(taskProjection).toContain("WHERE a.customer_id=customer_row.id AND a.result='contact_success'");
        expect(taskProjection).toContain("WHERE a.customer_id=customer_row.id AND a.result='customer_requested_later'");
        expect(taskProjection).toContain("WHERE e.task_id=task_row.id AND e.exception_type='customer_requested_later'");
        expect(taskProjection).toContain('OR EXISTS (SELECT 1 FROM public.crm_sla_exceptions e WHERE e.task_id=task_row.id)');
        expect(taskProjection).not.toMatch(/a.project_interest_id|a.occurred_at|a.recorded_at|first_contacted_at\s*[<>]/);
    });
    it('holds completion metadata on an open task without inferring contact success or exposing raw fields', () => {
        expect(taskProjection).toContain('OR task_row.completed_at IS NOT NULL OR task_row.completed_by_activity_id IS NOT NULL');
        expect(taskProjection).not.toMatch(/'completedAt'|'completedByActivityId'|'completed_at'|'completed_by_activity_id'/);
        expect(queue).not.toMatch(/completed_at|completed_by_activity_id/);
    });
    it('holds exceptional state or any cancellation metadata even without a task exception row', () => {
        expect(taskProjection).toContain("'hasExceptions',task_row.accountability_state='exception'");
        expect(taskProjection).toContain('OR task_row.cancelled_at IS NOT NULL OR task_row.cancelled_by_user_id IS NOT NULL');
        expect(taskProjection).toContain('OR task_row.cancellation_reason IS NOT NULL');
        expect(taskProjection).not.toMatch(/'accountabilityState'|'cancelledAt'|'cancelledByUserId'|'cancellationReason'/);
        expect(queue).not.toMatch(/accountability_state|cancelled_at|cancelled_by_user_id|cancellation_reason/);
    });
});

describe('current complete raw calendar projection without private details (static only)', () => {
    it('uses only the task owner current head/version with no legacy or alternate-owner fallback', () => {
        expect(preview).toContain('calendar_json:=NULL');
        expect(preview).toContain('FROM sales_private.crm_work_calendars WHERE sales_user_id=task_row.owner_user_id');
        expect(preview).toContain('WHERE id=head_row.current_version_id AND calendar_id=head_row.id AND sales_user_id=task_row.owner_user_id');
        expect(preview).toContain('WHERE calendar_version_id=version_row.id\n');
        expect(preview).not.toMatch(/calendar_version_id IS NULL|COALESCE\(calendar|ORDER BY published_at/);
    });
    it('requires an existing finite nonfuture publication timestamp before reading any calendar periods', () => {
        expect(preview).toContain('IF NOT FOUND OR version_row.published_at IS NULL OR NOT isfinite(version_row.published_at)');
        expect(preview).toContain("OR version_row.published_at>as_of THEN RAISE EXCEPTION 'CRM_SLA_PREVIEW_SETUP_REQUIRED'");
        expect(preview.indexOf('version_row.published_at>as_of')).toBeLessThan(preview.indexOf('WITH bounded AS'));
        expect(preview).not.toMatch(/COALESCE\(version_row\.published_at|published_at:=/);
    });
    it('does not silently drop inconsistent-owner periods even though06 enforces their composite foreign key', () => {
        const periods = preview.split('WITH bounded AS (')[1].split(')\n      SELECT')[0];
        expect(periods).toContain('WHERE calendar_version_id=version_row.id');
        expect(periods).not.toMatch(/sales_user_id\s*=|period_type\s*=|period_type\s+IN/);
        const schedule = readFileSync(resolve(process.cwd(), 'sql/sales/06_work_schedule_draft.sql'), 'utf8');
        expect(schedule).toContain('FOREIGN KEY (calendar_version_id,sales_user_id)');
        expect(schedule).toContain('REFERENCES sales_private.crm_work_calendar_versions(id,sales_user_id)');
        expect(schedule).toContain('UNIQUE (id,sales_user_id)');
    });
    it('projects at most400 periods completely or fails closed instead of quietly truncating', () => {
        expect(preview).toContain('ORDER BY starts_at,id LIMIT 401');
        expect(preview).toContain("IF period_count>400 THEN RAISE EXCEPTION 'CRM_SLA_PREVIEW_SETUP_REQUIRED'");
        expect(preview).not.toMatch(/LIMIT 400|FILTER \(WHERE.*<=400/);
        expect(preview).toContain("'complete',version_row.coverage_complete");
    });
    it('returns raw version and full work/leave/break intervals so the pure engine decides invalid calendar holds', () => {
        expect(preview).toContain("calendar_json:=jsonb_build_object('id',head_row.id,'version',version_row.id,'ownerUserId',task_row.owner_user_id");
        expect(preview).toContain("'coverage',jsonb_build_object('startsAt',version_row.coverage_starts_at,'endsAt',version_row.coverage_ends_at");
        expect(preview).toContain("'type',p.period_type,'startsAt',p.starts_at,'endsAt',p.ends_at");
        expect(preview).not.toMatch(/period_type\s*=|period_type\s+IN|sum\(|range_agg|OVERLAPS/);
    });
    it('never returns notes, phone, income, stored messages, HR reasons or raw audit/evaluation payloads', () => {
        expect(code).not.toMatch(/phone|monthly_income|personal_data|\.note\b|\.reason\b|\.message\b|reason_text|actor_name_snapshot/);
        expect(taskProjection).not.toMatch(/new_values|old_values|evaluation_snapshot|to_jsonb|row_to_json/);
        expect(code).not.toMatch(/'requestPayload'|'changeReason'|'publishedByUserId'|'audit'/);
    });
});
