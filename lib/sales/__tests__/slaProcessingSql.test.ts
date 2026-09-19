// @vitest-environment node
// STATIC contract/design checks ONLY. Do not execute SQL or claim PostgreSQL/RLS/clock/concurrency parity.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/09_first_contact_processing_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const clock = body('clock');
const completion = body('completion');
const timeMatches = body('time_matches');
const capability = body('capabilities');
const adminCommand = body('process');
const application = body('apply');
const delegation = "response_value:=sales_private.crm_first_contact_apply(settings_row,customer_row,task_row,head_row,\n    owner_active,actor_id,actor_name,'staff',request_id_value);";
// Follow the exact private call site for the existing end-to-end source-order
// assertions. Separate binding/ACL checks below prevent substituting another
// helper or passing untrusted snapshots/identity. Native tests execute both.
const command = adminCommand.replace(delegation, () => application);
const afterClock = command.split('server_now:=clock_timestamp();')[1];
const beforeClock = command.split('server_now:=clock_timestamp();')[0];
const audit = command.split('INSERT INTO public.crm_audit_events')[1].split('IF outcome_value=\'completed\' THEN')[0];
const withdraw = command.split('UPDATE public.crm_notifications')[1].split('GET DIAGNOSTICS')[0];
const position = (value: string) => {
    const result = command.indexOf(value);
    expect(result, value).toBeGreaterThanOrEqual(0);
    return result;
};

describe('withheld processing design and narrow authority (static only)', () => {
    it('delegates once with locked trusted rows and staff identity, preserving the Admin wire contract', () => {
        expect(adminCommand.split(delegation)).toHaveLength(2);
        expect(adminCommand).not.toMatch(/crm_first_contact_clock\(|crm_first_contact_completion\(|INSERT INTO public\.|UPDATE public\./);
        expect(application).not.toMatch(/auth\.uid|crm_v2_role\(|p_request->|request_payload|canonical_request|crm_first_contact_processing_requests/);
        expect(code).toContain("VOLATILE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(code).toContain('REVOKE ALL ON FUNCTION sales_private.crm_first_contact_apply(public.crm_settings,public.sales_customers,public.crm_sla_tasks,sales_private.crm_work_calendars,boolean,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated');
        expect(adminCommand).toContain("server_now:=(response_value->>'processedAt')::timestamptz");
        expect(application).toContain("ELSE jsonb_build_object('userId',actor_id,'role','admin') END");
        expect(application).toContain("reason_value,actor_id,actor_kind_value,actor_name");
    });
    it('raises before DDL and ends with rollback, not deployment or enablement', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).not.toMatch(/\b(?:COMMIT|TRUNCATE|DROP|COPY|CALL)\b|sla_processing_enabled\s*=\s*true/i);
        expect(source).toContain('Separate isolated runtime tests are mandatory');
    });
    it('adds disabled processing and bounded future warning configuration while enforcing the approved30 policy', () => {
        expect(code).toContain('ADD COLUMN sla_processing_enabled boolean NOT NULL DEFAULT false');
        expect(code).toContain('ADD COLUMN sla_due_soon_minutes integer NOT NULL DEFAULT 30 CHECK (sla_due_soon_minutes BETWEEN 0 AND 1440)');
        expect(command).toContain('original_hours IS DISTINCT FROM 24 OR settings_row.initial_contact_hours<>24 OR settings_row.next_shift_response_minutes<>120');
        expect(command).toContain("settings_row.sla_due_soon_minutes<>30 THEN reason_value:='POLICY_REVIEW'");
    });
    it('requires current trusted Admin and all seven gates on capability and command', () => {
        expect(capability).toContain("'contract_version','first_contact_processing_v1'");
        expect(capability).toContain("public.crm_v2_role()='admin'");
        expect(command).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
        expect(command).toContain("actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin'");
        for (const gate of ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled', 'work_schedule_enabled',
            'notifications_enabled', 'sla_preview_enabled', 'sla_processing_enabled']) {
            expect(capability).toContain(gate);
            expect(command).toContain(`settings_row.${gate}`);
        }
        expect(position('CRM_SLA_PROCESS_SETUP_REQUIRED')).toBeLessThan(position('PERFORM pg_advisory_xact_lock'));
    });
    it('accepts only requestId/taskId, canonicalizes UUIDs and rejects client clocks/owners/proof', () => {
        expect(code).toContain('crm_v2_process_first_contact(p_request jsonb)');
        expect(command).toContain("NOT (p_request ?& ARRAY['requestId','taskId'])");
        expect(command).toContain("jsonb_object_keys(p_request) k WHERE k NOT IN ('requestId','taskId')");
        expect(command).toContain('octet_length(p_request::text)>1024');
        for (const key of ['requestId', 'taskId']) {
            expect(command).toContain(`jsonb_typeof(p_request->'${key}') IS DISTINCT FROM 'string'`);
            expect(command).toContain(`length(p_request->>'${key}')<>36`);
            expect(command).toContain(`(p_request->>'${key}') !~ uuid_pattern`);
        }
        expect(command).toContain("canonical_request:=jsonb_build_object('requestId',request_id_value,'taskId',task_id_value)");
        expect(command).not.toMatch(/p_request->>'(?:owner|calendar|clock|staffDueAt|serviceDueAt|actor|preview|completedAt)'/);
    });
    it('adds only one private per-Admin receipt ledger with RLS and no direct grants', () => {
        expect(code.match(/CREATE TABLE/g)).toHaveLength(1);
        expect(code).toContain('PRIMARY KEY (actor_user_id,request_id)');
        expect(code).toContain('task_id uuid NOT NULL REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT');
        expect(code).toContain('ALTER TABLE sales_private.crm_first_contact_processing_requests ENABLE ROW LEVEL SECURITY');
        expect(code).toContain('REVOKE ALL ON sales_private.crm_first_contact_processing_requests FROM PUBLIC, anon, authenticated');
        expect(code).not.toMatch(/GRANT (?:ALL|SELECT|UPDATE|INSERT|DELETE)|CREATE POLICY/);
    });
    it('pins public definers, makes pure/read helpers inaccessible to browser roles and protects history', () => {
        expect(code).toContain("LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'");
        for (const signature of ['crm_v2_sla_processing_capabilities()', 'crm_v2_process_first_contact(jsonb)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`);
        }
        expect(code).not.toContain('GRANT EXECUTE ON FUNCTION sales_private.');
        expect(code).toContain('CREATE TRIGGER crm_first_contact_receipt_immutable BEFORE UPDATE OR DELETE');
        expect(code).toContain("WHEN (OLD.entity_type='crm_sla_task' AND OLD.event_type='first_contact_processed')");
    });
    it('does not schedule, bulk-process, import, follow up, score, change stage or alter original service/cohort clocks', () => {
        expect(code).not.toMatch(/cron\.|net\.|http_|dblink|user_metadata|app_metadata|\bDELETE FROM\b|\bMERGE INTO\b/);
        const assignments = Array.from(command.matchAll(/UPDATE public\.\w+(?:\s+[a-z_]+)?\s+SET\s+([\s\S]*?)\bWHERE\b/g), (match) => match[1]);
        expect(assignments.length).toBeGreaterThan(0);
        expect(assignments.join('\n')).not.toMatch(/(?:lead_created_at|service_due_at|obligation_started_at|engagement_status|intake_status|owner_user_id|lifecycle_revision)\s*=/);
        expect(command).not.toMatch(/UPDATE public\.(?:crm_next_actions|lead_activities|lead_project_interests|sales|plots)\b|INSERT INTO public\.(?:leads|sales|plots)\b/);
        expect(command).toContain("task_row.task_type<>'first_contact' OR task_row.project_interest_id IS NOT NULL OR task_row.source_activity_id IS NOT NULL");
    });
});

describe('lock order and durable replay (static only)', () => {
    it('uses settings/request/customer/Sales advisory/head/orderedroles/task/orderednotice serialization', () => {
        const order = ['FROM public.crm_settings WHERE id FOR SHARE', "hashtextextended('sla-processing-request:'",
            'SELECT * INTO customer_row', "hashtextextended('work-schedule-sales:'", 'SELECT * INTO head_row',
            'FOR role_row IN SELECT * FROM sales_private.crm_user_roles', 'SELECT * INTO task_row',
            'FOR notice_row IN SELECT * FROM public.crm_notifications', 'server_now:=clock_timestamp()'];
        const positions = order.map(position);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(command).toContain('WHERE id=initial_task.customer_id FOR UPDATE');
        expect(command).toContain('WHERE sales_user_id=initial_task.owner_user_id FOR SHARE');
        expect(command).toContain('WHERE user_id IN (actor_id,initial_task.owner_user_id) ORDER BY user_id FOR SHARE');
        expect(command).toContain('WHERE task_id=task_row.id ORDER BY id FOR UPDATE');
        const schedule = readFileSync(resolve(process.cwd(), 'sql/sales/06_work_schedule_draft.sql'), 'utf8');
        expect(schedule).toContain("hashtextextended('work-schedule-sales:'");
        expect(command).not.toContain('crm-work-schedule-sales:');
    });
    it('locks missing-head creation through the same advisory and rechecks initial targets after task lock', () => {
        expect(position("hashtextextended('work-schedule-sales:'")).toBeLessThan(position('SELECT * INTO head_row'));
        expect(command).toContain('task_row.customer_id IS DISTINCT FROM initial_task.customer_id');
        expect(command).toContain('task_row.owner_user_id IS DISTINCT FROM initial_task.owner_user_id');
        expect(command).toContain('owner_active boolean:=false');
        expect(command).toContain("owner_active:=role_row.role='sales' AND role_row.is_active");
    });
    it('authorizes from actual locked Admin role before replay, conflicts before returning cached result', () => {
        expect(command).toContain('actor_role:=NULL');
        expect(command).toContain('IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role');
        expect(command).toContain('WHERE actor_user_id=actor_id AND request_id=request_id_value');
        const replay = position("RETURN receipt_row.response || jsonb_build_object('replayed',true)");
        expect(position('actor_role:=role_row.role')).toBeLessThan(replay);
        expect(position('receipt_row.request_payload IS DISTINCT FROM canonical_request')).toBeLessThan(replay);
        expect(replay).toBeLessThan(position('SELECT * INTO task_row'));
        expect(replay).toBeLessThan(position('server_now:=clock_timestamp()'));
        expect(command).toContain('lock_task_id:=CASE WHEN receipt_found THEN receipt_row.task_id ELSE task_id_value END');
    });
    it('records the complete minimal response atomically after mutations and never swallows processing failures', () => {
        expect(afterClock).not.toMatch(/EXCEPTION WHEN|\bCOMMIT\b/);
        expect(beforeClock).not.toMatch(/INSERT INTO|UPDATE public\./);
        expect(command).toContain('VALUES(actor_id,request_id_value,task_row.id,canonical_request,response_value,server_now)');
        expect(position('INSERT INTO sales_private.crm_first_contact_processing_requests')).toBeGreaterThan(position('INSERT INTO public.crm_notifications'));
        for (const key of ['actor', 'requestId', 'taskId', 'processedAt', 'replayed', 'outcome', 'reason', 'serviceDueAt',
            'staffDueAt', 'notificationId', 'notificationType', 'completedByActivityId', 'completedAt', 'withdrawnCount']) {
            expect(command.split('response_value:=')[1]).toContain(`'${key}'`);
        }
    });
});

describe('original source, ownership and held reviews (static only)', () => {
    it('preserves closed task status while withdrawing notices, and holds a closed Lead without inventing cancellation', () => {
        expect(command).toContain("IF task_row.status<>'open' THEN outcome_value:='closed'; reason_value:='TASK_CLOSED'");
        expect(command).toContain("customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status='lost' THEN reason_value:='SCOPE_CLOSED'");
        expect(command).toContain("ELSIF outcome_value<>'closed' THEN");
        expect(command).not.toMatch(/SET status='cancelled'|cancelled_at\s*=/);
    });
    it('holds legacy, inactive/mismatched owners and any pending/malformed lifecycle evidence', () => {
        expect(command).toContain("customer_row.record_origin<>'live' THEN reason_value:='LEGACY_REVIEW'");
        expect(command).toContain('task_row.owner_user_id IS DISTINCT FROM customer_row.owner_user_id');
        expect(command).toContain('owner_active IS DISTINCT FROM true');
        expect(command).toContain("jsonb_typeof(task_row.evaluation_snapshot) IS DISTINCT FROM 'object' OR task_row.evaluation_snapshot ? 'lifecycleReview'");
    });
    it('requires one exact original customer creation audit, not duplicate/malformed/corrected evidence', () => {
        expect(command).toContain("WHERE entity_type='customer' AND entity_id=customer_row.id AND event_type='created' LIMIT 2");
        expect(command).toContain('creation_proven:=creation_count=1 AND valid_creation_count=1');
        expect(command).toContain("a.actor_kind='staff' AND a.actor_user_id=customer_row.created_by_user_id AND a.correction_of_event_id IS NULL");
        expect(command).toContain('a.occurred_at=customer_row.lead_created_at AND a.occurred_at=task_row.obligation_started_at');
        expect(command).toContain('a.recorded_at>=a.occurred_at AND a.recorded_at<=server_now');
        expect(command).toContain("a.new_values->>'ownerUserId'=customer_row.owner_user_id::text");
        expect(command).toContain('correction.correction_of_event_id=a.id');
    });
    it('rejects owner ABA and corrections while preserving original numeric policy evidence with safe nested guards', () => {
        expect(command).toContain('customer_row.owner_assigned_at=customer_row.lead_created_at');
        expect(command).toContain("a.entity_type IN ('sales_customer','customer') AND a.event_type='reassign_owner'");
        expect(command).toContain("original.entity_id=customer_row.id AND original.entity_type IN ('customer','sales_customer')");
        expect(command).toContain("CASE WHEN jsonb_typeof(task_row.evaluation_snapshot->'initialContactHours')='number' THEN");
        expect(command).toContain("CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours') ~ '^[1-9][0-9]{0,9}$' THEN");
        expect(command).toContain("CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours')::bigint<=2147483647");
    });
    it('validates exact original24 elapsed hours and source dates without replacing stored deadlines', () => {
        expect(command).toContain("customer_row.lead_created_at>maximum_at-interval '86400 seconds'");
        expect(command).toContain('task_row.obligation_started_at IS DISTINCT FROM customer_row.lead_created_at');
        expect(command).toContain('task_row.created_at<customer_row.lead_created_at OR task_row.created_at>server_now');
        expect(command).toContain("task_row.service_due_at IS DISTINCT FROM customer_row.lead_created_at+interval '86400 seconds'");
        expect(command).not.toMatch(/SET service_due_at|SET obligation_started_at|SET lead_created_at|interval '1 day'/);
    });
    it('holds contradictory completion/cancellation metadata, explicit exception state and postponements', () => {
        expect(command).toContain('task_row.completed_at IS NOT NULL OR task_row.completed_by_activity_id IS NOT NULL');
        expect(command).toContain("task_row.accountability_state='exception' OR task_row.cancelled_at IS NOT NULL OR task_row.cancelled_by_user_id IS NOT NULL");
        expect(command).toContain('task_row.cancellation_reason IS NOT NULL');
        expect(command).toContain("a.customer_id=customer_row.id AND a.result='customer_requested_later'");
        expect(command).toContain("e.task_id=task_row.id AND e.exception_type='customer_requested_later'");
        expect(command).toContain('EXISTS (SELECT 1 FROM public.crm_sla_exceptions e WHERE e.task_id=task_row.id)');
    });
    it('clears only readiness on holds without making every corrected-calendar retry permanently exceptional', () => {
        expect(command).toContain("WHEN task_row.accountability_state='exception' THEN 'exception'");
        expect(command).toContain("WHEN reason_value='OWNER_NOT_READY' THEN 'needs_owner' ELSE 'needs_schedule' END");
        expect(command).toContain("next_evaluation:=(next_evaluation-'notificationBinding') || jsonb_build_object('processingReview'");
        expect(command).not.toContain('INSERT INTO public.crm_sla_exceptions');
    });
});

describe('completion requires durable04 evidence, not flags or browser claims (static only)', () => {
    it('holds unresolved correction edges across all contact results before the success-only scan', () => {
        const precheck = completion.split('FOR activity_row IN')[0];
        expect(precheck).toContain('original.id=correction.correction_of_event_id');
        expect(precheck).toContain("original.customer_id=p_customer AND original.entity_type IN ('crm_next_action','lead_activity','lead_activities','activity')");
        expect(precheck).toContain("correction.customer_id=p_customer AND correction.entity_type IN ('crm_next_action','lead_activity','lead_activities','activity')");
        expect(precheck).toContain('original.entity_id=n.id');
        expect(precheck).toContain('correction.entity_id=a.id');
        expect(precheck).not.toMatch(/original\.new_values->>'result'|original\.event_type='record_attempt'/);
    });
    it('holds an original receipt success that was removed or changed out of the success queue', () => {
        const precheck = completion.split('FOR activity_row IN')[0];
        expect(precheck).toContain("r.request_payload#>>'{attempt,result}'='contact_success'");
        expect(precheck).toContain("LEFT JOIN public.lead_activities a ON a.id::text=r.response->>'activityId'");
        expect(precheck).toContain("a.id IS NULL OR a.customer_id IS DISTINCT FROM p_customer OR a.result IS DISTINCT FROM 'contact_success'");
    });
    it('scans all customer successes up to101 and holds instead of truncating or silently ignoring project success', () => {
        expect(completion).toContain("WHERE customer_id=p_customer AND result='contact_success'");
        expect(completion).toContain('ORDER BY occurred_at,recorded_at,id LIMIT 101');
        expect(completion).toContain("IF scanned>100 THEN RETURN jsonb_build_object('state','review')");
        expect(completion).toContain('activity_row.project_interest_id IS NOT NULL OR activity_row.sale_id IS NOT NULL');
        expect(completion).toContain("activity_row.activity_type<>'follow_up'");
    });
    it('requires04 attribution/channel/action and bounded chronological event/record/next-plan times', () => {
        expect(completion).toContain('activity_row.performed_by_user_id IS DISTINCT FROM activity_row.recorded_by_user_id');
        expect(completion).toContain("activity_row.contact_channel NOT IN ('phone','chat','email','in_person','other')");
        expect(completion).toContain('length(btrim(activity_row.action_text)) NOT BETWEEN 1 AND 500');
        expect(completion).toContain('activity_row.occurred_at<p_anchor OR activity_row.occurred_at>activity_row.recorded_at OR activity_row.recorded_at>p_now');
        expect(completion).toContain('activity_row.next_follow_up_at IS NULL OR NOT isfinite(activity_row.next_follow_up_at)');
        expect(completion).toContain('activity_row.next_follow_up_at<=activity_row.recorded_at');
    });
    it('requires exactly one matching04 audit and rejects duplicate/malformed/corrected references', () => {
        expect(completion).toContain("a.customer_id=p_customer AND a.entity_type='crm_next_action'");
        expect(completion).toContain("a.event_type='record_attempt' AND a.actor_kind='staff' AND a.correction_of_event_id IS NULL");
        expect(completion).toContain('a.actor_user_id=activity_row.recorded_by_user_id AND a.actor_user_id=activity_row.performed_by_user_id');
        expect(completion).toContain('a.occurred_at=activity_row.recorded_at AND a.recorded_at=activity_row.recorded_at');
        expect(completion).toContain("WHERE new_values->>'activityId'=activity_row.id::text LIMIT 2");
        expect(completion).toContain('evidence_count<>1 OR valid_count<>1');
        expect(completion).toContain('correction.correction_of_event_id=a.id');
        expect(completion).toContain("a.entity_type IN ('lead_activity','lead_activities','activity')");
    });
    it('binds the successor scope/owner/source/prior/recorder/times without requiring its current state open', () => {
        for (const fragment of ['next_action.customer_id=p_customer AND next_action.project_interest_id IS NULL',
            'next_action.owner_user_id=p_owner AND next_action.source_activity_id=activity_row.id',
            'next_action.recorded_by_user_id=a.actor_user_id AND next_action.recorded_at=activity_row.recorded_at',
            'next_action.plan_started_at=activity_row.recorded_at', 'next_action.due_at=activity_row.next_follow_up_at',
            'next_action.previous_action_id IS NOT DISTINCT FROM activity_row.related_next_action_id']) expect(completion).toContain(fragment);
        expect(completion).toContain("a.new_values->>'action'=next_action.action_text");
        expect(completion).toContain("sales_private.crm_first_contact_time_matches(a.new_values->'dueAt',next_action.due_at)");
        expect(completion).not.toMatch(/next_action.status|UPDATE public\.crm_next_actions/);
    });
    it('requires one private original04 receipt binding actor/task response and central request scope', () => {
        expect(completion).toContain("r.response->>'activityId'=activity_row.id::text LIMIT 2");
        expect(completion).toContain("IF request_count<>1 THEN RETURN jsonb_build_object('state','review')");
        expect(completion).toContain('original_request.actor_user_id IS DISTINCT FROM activity_row.recorded_by_user_id');
        expect(completion).toContain('original_request.created_at IS DISTINCT FROM activity_row.recorded_at');
        expect(completion).toContain("original_request.request_payload->>'command' IS DISTINCT FROM 'record_attempt'");
        expect(completion).toContain("lower(original_request.request_payload->>'customerId') IS DISTINCT FROM p_customer::text");
        expect(completion).toContain("original_request.request_payload->'interestId' IS DISTINCT FROM 'null'::jsonb");
        expect(completion).toContain("original_request.response->>'nextActionId' IS DISTINCT FROM proof_next_id::text");
        expect(completion).toContain("original_request.response->'replayed' IS DISTINCT FROM 'false'::jsonb");
    });
    it('compares original attempt result/channel/action/event time and next-plan text/time with04 validators', () => {
        expect(completion).toContain("original_request.request_payload#>>'{attempt,result}' IS DISTINCT FROM activity_row.result");
        expect(completion).toContain("original_request.request_payload#>>'{attempt,channel}' IS DISTINCT FROM activity_row.contact_channel");
        expect(completion).toContain("sales_private.crm_work_text(original_request.request_payload#>>'{attempt,action}',500) IS DISTINCT FROM activity_row.action_text");
        expect(completion).toContain("sales_private.crm_work_timestamp(original_request.request_payload#>>'{attempt,occurredAt}') IS DISTINCT FROM activity_row.occurred_at");
        expect(completion).toContain("sales_private.crm_work_text(original_request.request_payload#>>'{nextAction,action}',500) IS DISTINCT FROM next_action_row.action_text");
        expect(completion).toContain("sales_private.crm_work_timestamp(original_request.request_payload#>>'{nextAction,dueAt}') IS DISTINCT FROM next_action_row.due_at");
        expect(completion).toContain('EXCEPTION WHEN raise_exception OR invalid_text_representation OR datetime_field_overflow THEN');
        expect(completion).not.toMatch(/UPDATE |INSERT INTO|DELETE FROM/);
    });
    it('compares equivalent-offset JSON timestamps by validated instant, not raw text or unchecked casts', () => {
        expect(timeMatches).toContain("jsonb_typeof(p_value) IS DISTINCT FROM 'string'");
        expect(timeMatches).toContain("sales_private.crm_work_timestamp(p_value#>>'{}')=p_expected");
        expect(timeMatches).toContain('EXCEPTION WHEN raise_exception OR invalid_text_representation OR datetime_field_overflow THEN');
        expect(completion).not.toMatch(/::timestamptz|::uuid|to_jsonb\(next_action.due_at\)/);
    });
    it('selects earliest proven success and holds an unproven/conflicting first-contact flag', () => {
        expect(completion).toContain('IF first_id IS NULL THEN first_id:=activity_row.id; first_at:=activity_row.occurred_at');
        expect(completion).toContain('p_first_contacted IS NOT NULL AND (first_at IS NULL OR p_first_contacted IS DISTINCT FROM first_at)');
        expect(completion).toContain("IF first_id IS NULL THEN RETURN jsonb_build_object('state','none')");
        expect(completion).toContain("'activityId',first_id,'occurredAt',first_at");
    });
    it('completes before calendar calculation, records effective event time, and fills only a missing customer milestone', () => {
        expect(position('completion_json:=sales_private.crm_first_contact_completion')).toBeLessThan(position("IF head_row.id IS NULL THEN reason_value:='MISSING_CALENDAR'"));
        expect(command).toContain("complete_at:=(completion_json->>'occurredAt')::timestamptz");
        expect(command).toContain("UPDATE public.crm_sla_tasks SET status='done',completed_by_activity_id=complete_id,completed_at=complete_at");
        expect(command).toContain('UPDATE public.sales_customers SET first_contacted_at=complete_at\n      WHERE id=customer_row.id AND first_contacted_at IS NULL');
        expect(command).not.toMatch(/completed_at=server_now|first_contacted_at=server_now/);
    });
});

describe('pure exact clock and current calendar (static only)', () => {
    it('accepts only typed private clock inputs and validates finite/year bounds and complete366-day coverage', () => {
        expect(code).toContain('RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog');
        expect(clock).toContain('p_complete IS DISTINCT FROM true');
        expect(clock).toContain("p_through-p_from>interval '31622400 seconds'");
        expect(clock).toContain("TIMESTAMPTZ '0001-01-01 00:00:00+00'");
        expect(clock).toContain("TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'");
        expect(clock).not.toMatch(/clock_timestamp|now\(\)|FROM public\.|FROM sales_private\.|UPDATE |INSERT INTO|DELETE FROM/);
    });
    it('validates400 aligned one-dimensional arrays, IDs, owner, intervals, types and unclipped work', () => {
        for (const fragment of ['size>400', 'cardinality(p_owners)<>size', 'cardinality(p_types)<>size',
            'cardinality(p_starts)<>size', 'cardinality(p_ends)<>size', 'array_ndims(p_ids)', 'array_lower(p_ids,1)<>1',
            'p.owner_id IS DISTINCT FROM p_owner', "p.kind NOT IN ('work','leave','break')", 'p.starts_at>=p.ends_at',
            "p.kind='work' AND (p.starts_at<p_from OR p.ends_at>p_through)", 'count(DISTINCT id)']) expect(clock).toContain(fragment);
    });
    it('rejects overlapping work and subtracts unioned leave/breaks by exact half-open boundary partition', () => {
        expect(clock).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
        expect(clock).toContain('checked WHERE starts_at<prior_end');
        expect(clock).toContain('UNION SELECT least(ends_at,p_through)');
        expect(clock).toContain('lead(boundary) OVER (ORDER BY boundary)');
        expect(clock).toContain("w.kind='work' AND w.starts_at<=s.starts_at AND w.ends_at>=s.ends_at");
        expect(clock).toContain("x.kind IN ('leave','break') AND x.starts_at<s.ends_at AND x.ends_at>s.starts_at");
        expect(clock).not.toMatch(/date_trunc|extract\(|double precision|round\(|AT TIME ZONE/);
    });
    it('implements all three approved branches and120 actual working minutes across slices', () => {
        expect(clock).toContain("remaining interval:=interval '7200 seconds'");
        expect(clock).toContain("staff_due:=p_service; rule_value:='service_deadline'");
        expect(clock).toContain("count_from:=p_service; rule_value:='off_shift_service_deadline'");
        expect(clock).toContain("count_from:=p_anchor; rule_value:='out_of_hours'");
        expect(clock).toContain('duration_value:=segment_ends[idx]-segment_starts[idx]');
        expect(clock).toContain('staff_due:=segment_starts[idx]+remaining');
        expect(clock).toContain('remaining:=remaining-duration_value');
        expect(clock).toContain("IF rule_value='out_of_hours' THEN notify_at_value:=first_work");
    });
    it('holds missing coverage/work, permits due at final shift end, and requires asOf inside coverage', () => {
        expect(clock).toContain('p_anchor<p_from OR p_anchor>=p_through OR p_now<p_from OR p_now>=p_through');
        expect(clock).toContain('p_service<p_from OR p_service>=p_through');
        expect(clock).toContain("IF staff_due IS NULL THEN RETURN jsonb_build_object('ready',false,'reason','INSUFFICIENT_COVERAGE')");
        expect(clock).toContain('staff_due<p_from OR staff_due>p_through OR notify_at_value>staff_due');
    });
    it('only delivers in actual work after notify threshold, strictly overdue one microsecond after due', () => {
        expect(clock).toContain('starts_at<=p_now AND p_now<ends_at');
        expect(clock).toContain("'reason','OUTSIDE_WORKING_HOURS'");
        expect(clock).toContain("CASE WHEN p_now>staff_due THEN 'overdue' ELSE 'due_soon' END");
        expect(clock).toContain("staff_due+interval '0.000001 seconds'");
        expect(clock).toContain("staff_due-(interval '60 seconds'*p_due_soon)");
        expect(clock).toContain('eligible_from:=greatest(notify_at_value,threshold_at)');
        expect(clock).toContain('SELECT greatest(starts_at,eligible_from) INTO available_value');
    });
    it('resolves a finite already-published current head version and all periods without silently dropping bad owners', () => {
        expect(command).toContain('WHERE id=head_row.current_version_id AND calendar_id=head_row.id AND sales_user_id=task_row.owner_user_id');
        expect(command).toContain('version_row.published_at IS NULL OR NOT isfinite(version_row.published_at) OR version_row.published_at>server_now');
        expect(command).toContain('WHERE calendar_version_id=version_row.id ORDER BY starts_at,id LIMIT 401');
        expect(command).not.toContain('calendar_version_id=version_row.id AND sales_user_id');
        expect(command).not.toMatch(/calendar_version_id IS NULL|LIMIT 400/);
    });
});

describe('calculation history, delivery idempotency and inbox proof (static only)', () => {
    it('appends explicit calculation history before changing task readiness or contact milestones', () => {
        expect(position('INSERT INTO public.crm_audit_events')).toBeLessThan(position('UPDATE public.crm_sla_tasks'));
        expect(position('INSERT INTO public.crm_audit_events')).toBeLessThan(position('UPDATE public.sales_customers'));
        expect(audit).toContain("'crm_sla_task',task_row.id,'first_contact_processed'");
        expect(audit).toContain("'firstContactedAt',customer_row.first_contacted_at");
        expect(audit).toContain("'firstContactedAt',CASE WHEN outcome_value='completed' THEN complete_at ELSE customer_row.first_contacted_at END");
        expect(audit).not.toMatch(/to_jsonb\(task_row|to_jsonb\(customer_row|period_starts|period_ends|request_payload|\.note\b|\.reason\b/);
    });
    it('audits actual preserved deadlines on completed/closed tasks instead of falsely saying they were cleared', () => {
        expect(audit).toContain("'staffDueAt',CASE WHEN outcome_value IN ('completed','closed') THEN task_row.staff_due_at ELSE staff_due END");
        expect(audit).toContain("'notifyAt',CASE WHEN outcome_value IN ('completed','closed') THEN task_row.notify_at ELSE notify_value END");
        expect(audit).toContain("'calendarVersion',next_evaluation#>>'{notificationBinding,calendarVersion}'");
        expect(audit).toContain("'completedAt',CASE WHEN outcome_value='completed' THEN complete_at ELSE task_row.completed_at END");
    });
    it('writes ready binding matching07 owner/lifecycle/calendar contract and keeps source policy/history', () => {
        expect(command).toContain("binding_json:=jsonb_build_object('state','ready','ownerUserId',task_row.owner_user_id");
        expect(command).toContain("'lifecycleRevision',customer_row.lifecycle_revision,'calendarId',head_row.id,'calendarVersion',version_row.id");
        expect(command).toContain("'policyVersion',policy_version,'settingsVersion',settings_row.version,'dueSoonMinutes',settings_row.sla_due_soon_minutes");
        expect(command).toContain("next_evaluation || jsonb_build_object('notificationBinding',binding_json)");
        expect(command).toContain('accountability_state=next_accountability,staff_due_at=staff_due');
    });
    it('uses a new stable dedupe namespace including both calendar IDs, deadline, settings and policy', () => {
        expect(command.match(/first_contact_delivery_v1:/g)).toHaveLength(2);
        expect(command).toContain('jsonb_build_array(task_row.id,task_row.owner_user_id,customer_row.lifecycle_revision');
        expect(command).toContain("head_row.id,version_row.id,staff_due,policy_version,settings_row.version,settings_row.sla_due_soon_minutes,'due_soon'");
        expect(command).toContain("head_row.id,version_row.id,staff_due,policy_version,settings_row.version,settings_row.sla_due_soon_minutes,'overdue'");
        const keys = command.split('due_key:=')[1].split('IF notice_type')[0];
        expect(keys).not.toMatch(/server_now|request_id_value|available_value/);
    });
    it('withdraws stale/held/closed/completed notices without touching recipients or read receipts or reviving withdrawals', () => {
        expect(withdraw).toContain('WHERE n.task_id=task_row.id AND n.withdrawn_at IS NULL');
        expect(withdraw).toContain("outcome_value IN ('held','completed','closed')");
        expect(withdraw).toContain("n.notification_type='due_soon' AND (n.dedupe_key IS DISTINCT FROM due_key OR server_now>staff_due)");
        expect(withdraw).toContain("n.notification_type='overdue' AND n.dedupe_key IS DISTINCT FROM overdue_key");
        expect(withdraw).toContain('sales_private.crm_visible_sla_notifications(task_row.owner_user_id,server_now)');
        expect(command).not.toMatch(/SET read_at|read_at\s*=|SET recipient_user_id|withdrawn_at\s*=\s*NULL|ON CONFLICT[^;]*DO UPDATE/);
    });
    it('creates a single notice with server creation time and matching provenance, not a backdated creation', () => {
        expect(command).toContain('available_at,created_at,lifecycle_revision,calendar_id,calendar_version_id,staff_due_at_snapshot,service_due_at_snapshot');
        expect(command).toContain('available_value,server_now,customer_row.lifecycle_revision,head_row.id,version_row.id,staff_due,task_row.service_due_at');
        expect(command).toContain('ON CONFLICT (recipient_user_id,dedupe_key) DO NOTHING RETURNING id INTO notice_id');
        expect(command.match(/INSERT INTO public.crm_notifications/g)).toHaveLength(1);
    });
    it('keeps exact current duplicate notice/read state, and suppresses a withdrawn or invalid collision', () => {
        expect(command).toContain('notice_row.task_id=task_row.id AND notice_row.withdrawn_at IS NULL');
        expect(command).toContain('WHERE visible.id=notice_row.id');
        expect(command).toContain("outcome_value:='already_notified'; notice_id:=notice_row.id");
        expect(command).toContain("outcome_value:='suppressed'; reason_value:='WITHDRAWN_NOTIFICATION'; notice_type:=NULL");
        expect(command).not.toMatch(/UPDATE public.crm_notifications.*dedupe_key|UPDATE public.crm_notifications.*available_at/);
    });
});
