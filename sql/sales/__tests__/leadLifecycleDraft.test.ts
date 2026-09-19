// @vitest-environment node
// STATIC contracts only. Does not execute SQL or prove real RLS/locking behavior.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const code = read('sql/sales/05_lead_lifecycle_draft.sql');
const base = read('sql/sales/04_lead_work_foundation_draft.sql');
const command = code.split('AS $lifecycle$')[1].split('$lifecycle$;')[0];
const context = code.split('AS $context$')[1].split('$context$;')[0];
const afterClock = command.split('server_now:=clock_timestamp();')[1];
const beforeClock = command.split('server_now:=clock_timestamp();')[0];
const position = (value: string) => {
    const index = command.indexOf(value);
    expect(index, value).toBeGreaterThanOrEqual(0);
    return index;
};

describe('lifecycle draft safety gates (static, not PostgreSQL)', () => {
    it('aborts before DDL, stays disabled and ends in rollback', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).toContain('ADD COLUMN lead_lifecycle_enabled boolean NOT NULL DEFAULT false');
        expect(code).not.toMatch(/\b(?:COMMIT|TRUNCATE|DROP|COPY|CALL)\b|\bDELETE\s+FROM\b|lead_lifecycle_enabled\s*=\s*true/i);
    });
    it('reuses receipts, actions, audit and SLA instead of creating shadow tables', () => {
        expect(code).not.toMatch(/CREATE TABLE/i);
        expect(command).toContain('sales_private.lead_work_command_requests');
        expect(command).toContain("hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0)");
        expect(base).toContain("hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0)");
    });
    it('pins definer paths, restricts execution and adds no direct mutation permissions', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(3);
        for (const name of ['crm_v2_lead_lifecycle_capabilities()', 'crm_v2_change_lead_lifecycle(uuid,jsonb)', 'crm_v2_lead_lifecycle_context(uuid,uuid)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${name} TO authenticated;`);
        }
        expect(code).not.toMatch(/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)|CREATE POLICY/i);
    });
    it('requires all three DB gates even for direct RPCs', () => {
        expect(code.match(/central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled/g)).toHaveLength(3);
        expect(position('CRM_LIFECYCLE_SETUP_REQUIRED')).toBeLessThan(position('SELECT * INTO customer_row'));
        expect(command).toContain('FROM public.crm_settings WHERE id FOR SHARE');
    });
    it('has no legacy/sale/plot writes, scheduling or external calls', () => {
        expect(code).not.toMatch(/(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:leads|sales|plots|customer_voices)\b/);
        expect(code).not.toMatch(/cron\.|net\.|dblink|http_|user_metadata|app_metadata/);
        expect(afterClock).not.toMatch(/first_contacted_at\s*=|lead_created_at\s*=|service_due_at\s*=|obligation_started_at\s*=/);
    });
});

describe('lifecycle review projection (static only)', () => {
    it('is read-only and independently gated before scoped reads', () => {
        expect(code).toContain('RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER');
        expect(context).toContain('central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled');
        expect(context.indexOf('CRM_LIFECYCLE_SETUP_REQUIRED')).toBeLessThan(context.indexOf('work_json:='));
        expect(context).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE|CALL)\b|FOR SHARE|FOR UPDATE|pg_advisory|last_seen/);
        expect(context).toContain('public.crm_v2_lead_work_snapshot(p_customer_id,p_interest_id)');
    });
    it('exposes active Sales choices only to Admin, bounds the list and projects no role/HR payloads', () => {
        expect(context).toContain("IF actor_role='admin' THEN");
        expect(context).toContain("WHERE role='sales' AND is_active ORDER BY user_id LIMIT 201");
        expect(context).toContain('FILTER (WHERE n.rn<=200)');
        expect(context).toContain('count(*)>200');
        expect(context).toContain("'userId',n.user_id,'displayName',n.display_name");
        expect(context).not.toMatch(/to_jsonb\(|row_to_json\(|monthly_income|personal_data|evaluation_snapshot|crm_work_periods|request_payload/);
    });
    it('mirrors booking/open-interest blockers, without treating cancelled bookings as never booked', () => {
        expect(context).toContain('(p_interest_id IS NULL OR i.id=p_interest_id)');
        expect(context).toContain('s.lead_id=source_lead_id AND s.project_interest_id IS NULL');
        expect(context).toContain('IF p_interest_id IS NULL THEN');
        expect(context).toContain("engagement_status<>'lost'");
        expect(context).not.toMatch(/s\.(?:crm_stage|contract_status)/);
        expect(context).toContain("'canReassign',NOT closed AND actor_role='admin'");
        expect(context).toContain('AND NOT has_bookings AND NOT has_open_interests');
    });
    it('counts only affected open obligations and their unwithdrawn notices in the exact scope', () => {
        expect(context.match(/t\.customer_id=p_customer_id AND t\.project_interest_id IS NOT DISTINCT FROM p_interest_id/g)).toHaveLength(2);
        expect(context).toContain("t.status='open' AND n.withdrawn_at IS NULL");
        expect(context).not.toContain('n.read_at');
        expect(context).toContain("'impact',jsonb_build_object('openSlaCount',open_tasks,'pendingNotificationCount',pending_notices)");
    });
});

describe('lifecycle authorization and concurrency contract (static)', () => {
    it('requires exact fields and strict UUIDs with no implicit scope/defaults', () => {
        expect(command).toContain("ARRAY['command','customerId','interestId','expectedRevision','expectedActionId','reason']");
        expect(command).toContain("command_name='close_lost' AND p_payload ? 'newOwnerUserId'");
        expect(command).toContain("command_name='reassign_owner' AND NOT (p_payload ? 'newOwnerUserId')");
        expect(command).toContain('octet_length(p_payload::text)>16384');
        expect(command).toContain("crm_work_text(p_payload->>'reason',1000)");
        for (const field of ['customerId', 'interestId', 'expectedRevision', 'expectedActionId', 'newOwnerUserId']) {
            expect(command).toContain(`length(p_payload->>'${field}')<>36`);
            expect(command).toContain(`(p_payload->>'${field}') !~ uuid_pattern`);
        }
    });
    it('uses the same serialization order as ordinary lead-work commands', () => {
        const order = ['FROM public.crm_settings WHERE id FOR SHARE', 'PERFORM pg_advisory_xact_lock',
            'SELECT * INTO customer_row', 'SELECT * INTO interest_row', 'FOR role_row IN SELECT * FROM sales_private.crm_user_roles',
            'SELECT * INTO prior_action', 'FOR task_row IN SELECT * FROM public.crm_sla_tasks', 'server_now:=clock_timestamp()'];
        const indices = order.map(position);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
        expect(command).toContain('WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE');
        expect(command).toContain('ORDER BY user_id FOR SHARE');
    });
    it('restricts reassignment to active Admin and close to owning Sales or Admin', () => {
        expect(command).toContain('actor_id uuid:=auth.uid()');
        expect(command).toContain('IF role_row.user_id=actor_id AND role_row.is_active THEN');
        expect(command).toContain("command_name='reassign_owner' AND actor_role<>'admin'");
        expect(command).toContain("command_name='close_lost' AND actor_role='sales' AND actor_id<>scope_owner");
        expect(command).toContain("actor_role IS NULL OR actor_role NOT IN ('sales','admin')");
        expect(position('actor_role:=role_row.role')).toBeLessThan(position('SELECT * INTO request_row'));
    });
    it('supports Admin recovery from an inactive old owner but checks the new Sales', () => {
        expect(command).toContain("target_active:=role_row.role='sales' AND role_row.is_active");
        expect(command).toContain('target_active IS DISTINCT FROM true');
        expect(command).not.toContain("WHERE user_id=scope_owner AND role='sales' AND is_active");
        expect(command).toContain("new_owner=scope_owner THEN RAISE EXCEPTION 'CRM_LIFECYCLE_UNCHANGED_OWNER'");
    });
    it('does not authorize a target/actor role inserted after the ordered lock snapshot', () => {
        const lockedRoles = command.split('FOR role_row IN SELECT * FROM sales_private.crm_user_roles')[1].split('END LOOP;')[0];
        expect(command).toContain('target_active boolean:=false');
        expect(position('actor_role:=NULL')).toBeLessThan(position('FOR role_row IN SELECT * FROM sales_private.crm_user_roles'));
        expect(lockedRoles).toContain('ORDER BY user_id FOR SHARE');
        expect(lockedRoles).toContain('actor_role:=role_row.role');
        expect(lockedRoles).toContain('IF role_row.user_id=new_owner THEN');
        expect(command.match(/FROM sales_private\.crm_user_roles/g)).toHaveLength(1);
    });
    it('authorizes before receipt replay, and replays before state/version/target checks', () => {
        const replay = position("RETURN request_row.response || jsonb_build_object('replayed',true)");
        expect(position('actor_role:=role_row.role')).toBeLessThan(replay);
        expect(position('request_row.request_payload IS DISTINCT FROM p_payload')).toBeLessThan(replay);
        for (const marker of ['CRM_LIFECYCLE_SCOPE_CLOSED', 'CRM_LIFECYCLE_STALE_SCOPE', 'CRM_LIFECYCLE_STALE_ACTION', 'CRM_LIFECYCLE_INACTIVE_TARGET']) {
            expect(replay).toBeLessThan(position(marker));
        }
        expect(command).toContain('WHERE actor_user_id=actor_id AND request_id=p_request_id');
    });
    it('uses opaque scope revision and expected open action, not just owner identity', () => {
        expect(base.match(/ADD COLUMN lifecycle_revision uuid NOT NULL DEFAULT gen_random_uuid\(\)/g)).toHaveLength(2);
        expect(command).toContain('scope_revision IS DISTINCT FROM expected_revision');
        expect(command).toContain('prior_action.id IS DISTINCT FROM expected_action');
        expect(command.match(/lifecycle_revision=next_revision/g)).toHaveLength(2);
        expect(base).toContain("'lifecycleRevision',scope_revision");
        expect(base).toContain("'read_contract_version','lead_work_read_v2'");
    });
    it('keeps central/project updates mutually exclusive and forbids merged/lost writes', () => {
        const branch = afterClock.split('IF interest_id_value IS NULL THEN')[1].split('END IF;')[0];
        expect(branch).toMatch(/UPDATE public\.sales_customers[\s\S]*ELSE\s+UPDATE public\.lead_project_interests/);
        expect(branch).toContain('WHERE id=interest_id_value AND customer_id=customer_id_value');
        expect(command).toContain("customer_row.merged_into_customer_id IS NOT NULL OR scope_status='lost'");
    });
    it('blocks Lost after any booking history and unmapped legacy sales, not just active bookings', () => {
        const guard = beforeClock;
        expect(guard).toContain('JOIN public.lead_project_interests i ON i.id=s.project_interest_id');
        expect(guard).toContain('(interest_id_value IS NULL OR i.id=interest_id_value)');
        expect(guard).toContain('s.lead_id=customer_row.legacy_source_lead_id AND s.project_interest_id IS NULL');
        expect(guard).not.toMatch(/s\.(?:contract_status|crm_stage)\s*(?:=|<>)/);
        expect(position('CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS')).toBeLessThan(position('server_now:=clock_timestamp()'));
    });
    it('does not close intake while another project remains open', () => {
        expect(command).toContain("interest_id_value IS NULL AND EXISTS (SELECT 1 FROM public.lead_project_interests");
        expect(command).toContain("WHERE customer_id=customer_id_value AND engagement_status<>'lost'");
        expect(command).toContain('CRM_LIFECYCLE_OPEN_INTERESTS');
    });
});

describe('preservation of late work and fairness (static)', () => {
    it('versions transferred work with original due/plan clock and old owner intact', () => {
        const closing = afterClock.split('UPDATE public.crm_next_actions')[1].split(';')[0];
        expect(closing).not.toMatch(/owner_user_id\s*=|due_at\s*=|recorded_at\s*=|plan_started_at\s*=/);
        expect(closing).toContain("THEN 'superseded' ELSE 'cancelled'");
        expect(afterClock).toContain('prior_action.due_at,prior_action.plan_started_at,prior_action.id,prior_action.source_activity_id');
        expect(base).toContain('plan_started_at <= recorded_at AND due_at > plan_started_at');
        expect(command).not.toMatch(/due_at\s*>\s*server_now/);
        expect(afterClock).toContain('to_jsonb(prior_action)');
        expect(afterClock).toContain('prior_action.due_at<server_now');
    });
    it('selects only open SLA tasks in the exact scope, never completed or sibling tasks', () => {
        const selected = beforeClock.split('FOR task_row IN SELECT * FROM public.crm_sla_tasks')[1];
        expect(selected).toContain('customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value');
        expect(selected).toContain("AND status='open' ORDER BY id FOR UPDATE");
        expect(afterClock.match(/WHERE id=ANY\(affected_tasks\)/g)).toHaveLength(2);
    });
    it('invalidates the new owner staff clock without rewriting service dates or old evidence', () => {
        expect(afterClock).toContain('owner_user_id=new_owner,staff_due_at=NULL,notify_at=NULL');
        expect(afterClock).toContain("accountability_state='needs_schedule'");
        expect(afterClock).toContain("'state','owner_change_pending_review'");
        expect(afterClock).toContain("SELECT task_id,'owner_change',reason_value,actor_id,server_now");
        expect(beforeClock).toContain("'staffDueAt',task_row.staff_due_at");
        expect(beforeClock).not.toContain('to_jsonb(task_row)');
        expect(beforeClock).not.toContain('task_row.evaluation_snapshot');
    });
    it('cancels with evidence instead of completion or manufactured contact', () => {
        expect(afterClock).toContain("status='cancelled',cancelled_at=server_now");
        expect(afterClock).toContain('cancelled_by_user_id=actor_id,cancellation_reason=reason_value');
        expect(afterClock).not.toMatch(/status='done'|completed_at\s*=|completed_by_activity_id\s*=|INSERT INTO public\.lead_activities/);
    });
    it('withdraws scoped notices without changing recipients, read receipts or sending new ones', () => {
        const notification = afterClock.split('UPDATE public.crm_notifications')[1].split(';')[0];
        expect(notification).toContain('withdrawn_at=server_now,withdrawal_reason=reason_value');
        expect(notification).toContain('task_id=ANY(affected_tasks) AND withdrawn_at IS NULL');
        expect(notification).not.toMatch(/recipient_user_id\s*=|read_at\s*=/);
        expect(command).not.toContain('INSERT INTO public.crm_notifications');
    });
    it('appends audit and receipt after all mutations and never suppresses a partial failure', () => {
        const order = ['UPDATE public.crm_notifications', 'INSERT INTO public.crm_audit_events',
            'INSERT INTO sales_private.lead_work_command_requests', 'RETURN response_value'];
        const indices = order.map(position);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
        expect(afterClock).not.toMatch(/EXCEPTION WHEN|\bCOMMIT\b/);
        expect(afterClock).toContain("'revision',next_revision,'nextActionId',next_action_id,'replayed',false");
    });
});
