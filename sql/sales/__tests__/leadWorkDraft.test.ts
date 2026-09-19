// @vitest-environment node
// Static contract/regression checks ONLY: no database connection or SQL execution.
// These do not prove PostgreSQL syntax, RLS enforcement or concurrent correctness.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const sql = read('sql/sales/04_lead_work_foundation_draft.sql');
const base = read('sales_workflow_v2_draft.sql');
const withoutComments = (value: string) => value.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const code = withoutComments(sql);
const command = code.split('AS $command$')[1].split('$command$;')[0];
const actions = code.split('CREATE TABLE public.crm_next_actions (')[1].split('CREATE UNIQUE INDEX')[0];
const snapshot = code.split('AS $snapshot$')[1].split('$snapshot$;')[0];

describe('disabled lead-work SQL companion draft (static only)', () => {
  it('aborts before DDL and rolls back, never commits or enables itself', () => {
    expect(code.trim()).toMatch(/^BEGIN;/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
    expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code).not.toMatch(/\bCOMMIT\b|\bSET\s+lead_work_enabled\s*=\s*true/i);
    expect(code).toContain('ADD COLUMN lead_work_enabled boolean NOT NULL DEFAULT false');
  });

  it('only creates two new tables, reusing existing activity/audit ledgers', () => {
    expect([...code.matchAll(/CREATE TABLE ([\w.]+)/g)].map(match => match[1])).toEqual([
      'public.crm_next_actions', 'sales_private.lead_work_command_requests',
    ]);
    expect(command).toContain('INSERT INTO public.lead_activities');
    expect(command).toContain('INSERT INTO public.crm_audit_events');
    expect(code).not.toMatch(/CREATE TABLE.*(?:contact|attempt|audit)/i);
    expect(code).toContain('ALTER TABLE public.lead_activities');
  });

  it('adds no data migration, legacy mutation, destructive operation or external call', () => {
    expect(code).not.toMatch(/\b(?:DROP|TRUNCATE|COPY|CALL|COMMIT)\b|\bDELETE\s+FROM\b/i);
    const mutationTargets = [...code.matchAll(/(?:INSERT INTO|UPDATE|ALTER TABLE) (\w+\.\w+)/g)].map(match => match[1]);
    expect(new Set(mutationTargets)).toEqual(new Set([
      'public.crm_settings', 'public.crm_next_actions', 'public.lead_activities',
      'sales_private.lead_work_command_requests', 'public.crm_audit_events',
      'public.sales_customers', 'public.lead_project_interests',
    ]));
    expect(command).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:leads|sales|plots|sales_customers|lead_project_interests|crm_sla_tasks)\b/);
    expect(command).not.toMatch(/\b(?:dblink|http_|net\.)|user_metadata|app_metadata/);
  });

  it('keeps every new table behind RLS and disallows all direct mutations', () => {
    for (const table of ['public.crm_next_actions', 'sales_private.lead_work_command_requests']) {
      expect(code).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(code).toContain(`REVOKE ALL ON ${table} FROM PUBLIC, anon, authenticated`);
    }
    expect(code).toContain('GRANT SELECT ON public.crm_next_actions TO authenticated');
    expect(code).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b|FOR\s+(?:ALL|INSERT|UPDATE|DELETE)\s+TO/i);
    expect(code).not.toMatch(/GRANT\s+SELECT\s+ON\s+sales_private\./i);
  });

  it('restricts function execution and pins security-definer search paths', () => {
    expect((code.match(/SECURITY DEFINER SET search_path = pg_catalog/g) ?? [])).toHaveLength(3);
    for (const signature of ['crm_v2_lead_work_capabilities()', 'crm_v2_record_lead_work(uuid,jsonb)', 'crm_v2_lead_work_snapshot(uuid,uuid)']) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`);
    }
    for (const signature of ['crm_work_timestamp(text)', 'crm_work_text(text,integer)']) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION sales_private.${signature} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it('requires both database switches even for direct RPCs', () => {
    expect(code.match(/central_intake_enabled AND lead_work_enabled/g)).toHaveLength(3);
    expect(command).toContain('FROM public.crm_settings WHERE id FOR SHARE;');
    expect(command).toContain("IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'");
    expect(command.indexOf('CRM_WORK_SETUP_REQUIRED')).toBeLessThan(command.indexOf('INSERT INTO'));
  });

  it('uses non-null scope keys in both directions of activity/action references', () => {
    expect(code.match(/\) STORED NOT NULL/g)).toHaveLength(2);
    expect(actions).toContain('UNIQUE (id,customer_id,scope_key)');
    expect(actions).toContain('FOREIGN KEY (project_interest_id,customer_id)');
    expect(actions).toContain('FOREIGN KEY (previous_action_id,customer_id,scope_key)');
    expect(code).toContain('FOREIGN KEY (related_next_action_id,customer_id,crm_scope_key)');
    expect(code).toContain('FOREIGN KEY (source_activity_id,customer_id,scope_key)');
    expect(code).toContain('REFERENCES public.lead_activities(id,customer_id,crm_scope_key)');
    expect(code).toContain("CASE WHEN project_interest_id IS NULL THEN 'customer:'||customer_id::text");
  });

  it('retains one open version per scope and rejects incomplete closed versions', () => {
    expect(code).toContain("ON public.crm_next_actions(customer_id,scope_key)\n  WHERE status='open'");
    expect(actions).toContain("status IN ('open','superseded','cancelled')");
    expect(actions).toContain('closed_at >= recorded_at');
    expect(actions).toContain('closed_by_user_id IS NOT NULL AND close_reason IS NOT NULL');
    expect(actions).toContain('plan_started_at <= recorded_at AND due_at > plan_started_at');
    expect(actions).not.toContain("'done'");
  });
});

describe('scoped read projection (static only, not PostgreSQL execution)', () => {
  it('is independently feature-gated and never writes or acquires mutation locks', () => {
    expect(code).toContain('RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER');
    expect(snapshot).toContain('central_intake_enabled AND lead_work_enabled');
    expect(snapshot).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE|CALL)\b/);
    expect(snapshot).not.toMatch(/FOR SHARE|FOR UPDATE|pg_advisory|last_seen|crm_v2_record/);
    expect(snapshot.indexOf('CRM_WORK_SETUP_REQUIRED')).toBeLessThan(snapshot.indexOf('SELECT * INTO customer_row'));
  });
  it('allows active Owner/Sales/Admin reads while keeping Owner writes forbidden', () => {
    expect(snapshot).toContain("actor_role text:=public.crm_v2_role()");
    expect(snapshot).toContain("actor_role NOT IN ('sales','admin','owner')");
    expect(snapshot).toContain('actor_id IS NULL OR actor_role IS NULL');
    expect(command).toContain("public.crm_v2_role() NOT IN ('sales','admin')");
    expect(code).toContain("'read_contract_version','lead_work_read_v2'");
    expect(snapshot).toContain("'canWrite',NOT closed AND owner_active AND (actor_role='admin' OR (actor_role='sales' AND actor_id=scope_owner))");
  });
  it('looks up interests by both IDs and scopes current action and both histories', () => {
    expect(snapshot).toContain('WHERE id=p_interest_id AND customer_id=p_customer_id');
    expect(snapshot).toContain('scope_owner:=interest_row.owner_user_id');
    expect(snapshot).toContain("scope_key_value:='customer:'||p_customer_id::text");
    expect(snapshot).toContain("scope_key_value:='interest:'||p_interest_id::text");
    expect(snapshot).toContain("WHERE customer_id=p_customer_id AND scope_key=scope_key_value AND status='open'");
    expect(snapshot).toContain('a.customer_id=p_customer_id AND a.scope_key=scope_key_value');
    expect(snapshot).toContain('a.customer_id=p_customer_id AND a.crm_scope_key=scope_key_value');
  });
  it('bounds both histories at 20 and explicitly signals an older unread tail', () => {
    expect(snapshot.match(/LIMIT 21/g)).toHaveLength(2);
    expect(snapshot.match(/FILTER \(WHERE a.rn<=20\)/g)).toHaveLength(2);
    expect(snapshot.match(/count\(\*\)>20/g)).toHaveLength(2);
    expect(snapshot).toContain("'history',jsonb_build_object('limit',20,'actionsHasMore',more_actions,'activitiesHasMore',more_activities)");
    expect(snapshot.match(/ORDER BY a.recorded_at DESC,a.id DESC/g)).toHaveLength(4);
  });
  it('uses explicit projected fields, not unrestricted row JSON or private command receipts', () => {
    expect(snapshot).not.toMatch(/to_jsonb\(|row_to_json\(|lead_work_command_requests|request_payload|monthly_income|personal_data/);
    expect(snapshot).toContain("'performedByUserId',a.performed_by_user_id,'recordedByUserId',a.recorded_by_user_id");
    expect(snapshot).toContain("'phone',customer_row.phone,'leadCreatedAt',customer_row.lead_created_at");
    expect(snapshot).toContain("'asOf',statement_timestamp()");
    expect(snapshot).not.toContain('clock_timestamp()');
  });
  it('does not grant a write hint for inactive owners or closed/merged scopes', () => {
    expect(snapshot).toContain("(role='sales' AND is_active)");
    expect(snapshot).toContain('owner_active:=COALESCE(owner_active,false)');
    expect(snapshot).toContain("closed:=customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status='lost'");
    expect(snapshot).toContain("closed:=customer_row.merged_into_customer_id IS NOT NULL OR interest_row.engagement_status='lost'");
  });
});

describe('lead-work command boundary (static only)', () => {
  it('derives actor and current-owner authority only from the role rows actually locked', () => {
    const roles = command.split('FOR role_row IN SELECT * FROM sales_private.crm_user_roles')[1].split('END LOOP;')[0];
    expect(command).toContain('scope_owner_active boolean:=false');
    expect(roles).toContain('ORDER BY user_id FOR SHARE');
    expect(roles).toContain('IF role_row.user_id=actor_id AND role_row.is_active THEN');
    expect(roles).toContain('actor_role:=role_row.role');
    expect(roles).toContain('IF role_row.user_id=scope_owner THEN');
    expect(command.match(/FROM sales_private\.crm_user_roles/g)).toHaveLength(1);
  });
  it('requires exact top-level and nested shapes, rejecting owner/role/status injection', () => {
    expect(command).toContain("jsonb_typeof(p_payload) IS DISTINCT FROM 'object'");
    expect(command).toContain("ARRAY['command','customerId','interestId','expectedActionId','nextAction','reason']");
    expect(command).toContain("command_name='set_next_action' AND p_payload ? 'attempt'");
    expect(command).toContain("command_name='record_attempt' AND NOT (p_payload ? 'attempt')");
    expect(command.match(/jsonb_object_keys\(/g)).toHaveLength(3);
    expect(command).toContain("ARRAY['action','dueAt']");
    expect(command).toContain("ARRAY['action','channel','result','occurredAt']");
    expect(command).not.toMatch(/p_payload(?:->>|#>>)\s*'(?:owner|role|status|recordedAt|performedBy|actor)/);
  });

  it('bounds payload/texts and requires all nullable IDs to be present', () => {
    expect(command).toContain('octet_length(p_payload::text)>16384');
    expect(command).toContain("crm_work_text(p_payload->>'reason',1000)");
    expect(command).toContain("crm_work_text(p_payload#>>'{nextAction,action}',500)");
    expect(command).toContain("crm_work_text(p_payload#>>'{attempt,action}',500)");
    expect(command).toContain("jsonb_typeof(p_payload->'interestId') NOT IN ('string','null')");
    expect(command).toContain("jsonb_typeof(p_payload->'expectedActionId') NOT IN ('string','null')");
    expect(command.match(/!~ uuid_pattern/g)).toHaveLength(3);
    for (const field of ['customerId', 'interestId', 'expectedActionId']) {
      expect(command).toContain(`length(p_payload->>'${field}')<>36`);
    }
    expect(code).toContain("U&'[\\0001-\\001F\\007F-\\009F\\2028\\2029]'");
  });

  it('preserves strict timestamp precision and explicit calendar/offset validation', () => {
    const timestamp = code.split('AS $timestamp$')[1].split('$timestamp$;')[0];
    expect(timestamp).toContain('[.][0-9]{1,6}');
    expect(timestamp).toContain("p_value ~ '[^0-9TZ:+.-]'");
    expect(timestamp).toContain("parts[8]='-00:00'");
    expect(timestamp).toContain('yyyy<1 OR hh>23 OR mi>59 OR ss>59');
    expect(timestamp).toContain('offset_hours>23 OR offset_minutes>59');
    expect(timestamp).toContain('make_date(yyyy,mm,dd)');
    expect(timestamp).toContain("interval '1 microsecond'");
    expect(timestamp).toContain("AT TIME ZONE 'UTC'");
    expect(timestamp).toContain('datetime_field_overflow OR invalid_datetime_format');
    expect(timestamp).not.toMatch(/date_trunc|p_value::(?:timestamp|date)/);
  });

  it('derives central or interest ownership from locked trusted rows, not the request', () => {
    expect(command).toContain('WHERE id=customer_id_value FOR UPDATE');
    expect(command).toContain('WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE');
    expect(command).toContain('scope_owner:=customer_row.owner_user_id');
    expect(command).toContain('scope_owner:=interest_row.owner_user_id');
    expect(command).toContain("actor_role='sales' AND actor_id<>scope_owner");
    expect(command).toContain("actor_role NOT IN ('sales','admin')");
    expect(command).toContain("scope_owner_active:=role_row.role='sales' AND role_row.is_active");
    expect(command).toContain('scope_owner_active IS DISTINCT FROM true');
    expect(command).toContain('ORDER BY user_id FOR SHARE');
  });

  it('checks present ownership before replay and makes request-key reuse payload-specific', () => {
    const cache = command.indexOf('SELECT * INTO request_row');
    expect(command.indexOf('CRM_WORK_FORBIDDEN', command.indexOf('actor_role:=role_row.role'))).toBeLessThan(cache);
    expect(command.indexOf('CRM_WORK_INACTIVE_OWNER')).toBeLessThan(cache);
    expect(command).toContain('WHERE actor_user_id=actor_id AND request_id=p_request_id');
    expect(command).toContain('request_row.request_payload IS DISTINCT FROM p_payload');
    expect(command).toContain("request_row.response || jsonb_build_object('replayed',true)");
    expect(command.indexOf("jsonb_build_object('replayed',true)")).toBeLessThan(command.indexOf('due_value<=server_now'));
  });

  it('serializes same-request and same-scope mutations before checking expected version', () => {
    const requestLock = command.indexOf('PERFORM pg_advisory_xact_lock');
    const customerLock = command.indexOf('SELECT * INTO customer_row');
    const interestLock = command.indexOf('SELECT * INTO interest_row');
    const currentLock = command.indexOf('SELECT * INTO prior_action');
    const stale = command.indexOf('prior_action.id IS DISTINCT FROM expected_id');
    expect(requestLock).toBeLessThan(customerLock);
    expect(customerLock).toBeLessThan(interestLock);
    expect(interestLock).toBeLessThan(currentLock);
    expect(currentLock).toBeLessThan(stale);
    expect(stale).toBeLessThan(command.indexOf('INSERT INTO'));
    expect(command).toContain('project_interest_id IS NOT DISTINCT FROM interest_id_value');
  });

  it('blocks new work for merged/closed scope without treating another scope as lost', () => {
    expect(command).toContain('customer_row.merged_into_customer_id IS NOT NULL');
    expect(command).toContain("interest_id_value IS NULL AND customer_row.intake_status='lost'");
    expect(command).toContain("interest_id_value IS NOT NULL AND interest_row.engagement_status='lost'");
  });

  it('uses fresh server time after locks, retains actual occurrence and real actor', () => {
    expect(command.indexOf('server_now:=clock_timestamp()')).toBeGreaterThan(command.indexOf('CRM_WORK_STALE_ACTION'));
    expect(command).toContain("command_name='record_attempt' AND occurred_value>server_now");
    expect(command).toContain('occurred_value,server_now,actor_id,actor_id');
    expect(command).toContain('scope_owner,action_value,due_value');
    expect(command).not.toMatch(/actor_id\s*:=\s*p_payload|scope_owner\s*:=\s*p_payload/);
  });

  it('atomically records effort, replaces plan, appends audit and writes receipt last', () => {
    const order = ['INSERT INTO public.lead_activities', 'UPDATE public.crm_next_actions',
      'INSERT INTO public.crm_next_actions', 'INSERT INTO public.crm_audit_events',
      'INSERT INTO sales_private.lead_work_command_requests', 'RETURN response_value'];
    const positions = order.map(marker => command.indexOf(marker));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(command).not.toMatch(/EXCEPTION\s+WHEN|\bCOMMIT\b/);
  });

  it('rejects a historical attempt that would replace a newer open plan', () => {
    const guard = command.indexOf('AND occurred_value<prior_action.recorded_at');
    expect(command).toContain("command_name='record_attempt' AND prior_action.id IS NOT NULL");
    expect(guard).toBeGreaterThan(command.indexOf('SELECT * INTO prior_action'));
    expect(guard).toBeLessThan(command.indexOf('INSERT INTO public.lead_activities'));
    expect(command.slice(guard, command.indexOf('INSERT INTO public.lead_activities'))).toContain('CRM_WORK_TIME_INVALID');
  });

  it('does not erase due dates, mark done, grant qualification or complete SLA', () => {
    const update = command.split('UPDATE public.crm_next_actions')[1].split(';')[0];
    expect(update).toContain("status='superseded'");
    expect(update).not.toMatch(/due_at\s*=|owner_user_id\s*=|action_text\s*=/);
    expect(command).toContain('to_jsonb(prior_action)');
    expect(command).toContain('prior_action.due_at<server_now');
    expect(command).not.toMatch(/SET\s+(?:first_contacted_at|lead_created_at|staff_due_at|service_due_at|intake_status)/);
    expect(command).not.toContain("status='done'");
    expect(command).not.toMatch(/INSERT INTO public\.(?:crm_sla|.*qualified|.*kpi)/);
  });

  it('depends on existing foundation IDs/roles and never guesses project or plot IDs', () => {
    expect(base).toContain('CREATE TABLE public.lead_activities');
    expect(base).toContain('UNIQUE (id,customer_id)');
    expect(base).toContain('CREATE TABLE public.crm_audit_events');
    expect(base).toContain('CREATE TABLE sales_private.crm_user_roles');
    expect(code).not.toMatch(/project_id|plot_id|TAEW|PIEW|Piwe/);
  });
});
