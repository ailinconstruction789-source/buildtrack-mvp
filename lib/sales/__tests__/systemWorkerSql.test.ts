// @vitest-environment node
// STATIC source invariants only: not PostgreSQL execution, pg_cron compatibility,
// production RLS certification or permission to activate an automated worker.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/13_first_contact_system_worker_draft.sql'), 'utf8');
const stripComments = (value: string) => value.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const code = stripComments(source);
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('worker_cycle');
const lookup = body('worker_receipt');
const childProjection = body('child_projection');
const cycleProjection = body('cycle_projection');
const processingCode = stripComments(readFileSync(resolve(process.cwd(), 'sql/sales/09_first_contact_processing_draft.sql'), 'utf8'));
const sharedCore = processingCode.split('AS $apply$')[1].split('$apply$;')[0];
const adminCommand = processingCode.split('AS $process$')[1].split('$process$;')[0];
const readGates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
    'work_schedule_enabled', 'notifications_enabled', 'sla_preview_enabled'];
const writeGates = ['sla_processing_enabled', 'sla_cycle_enabled', 'sla_worker_enabled'];
const assertOrder = (value: string, fragments: string[]) => {
    const positions = fragments.map(fragment => value.indexOf(fragment));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
};

describe('withheld system worker authority (static only)', () => {
    it('raises before role or table changes, defaults disabled and ends in rollback', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        assertOrder(code, ["RAISE EXCEPTION 'DESIGN ONLY:", 'CREATE ROLE ', 'ALTER TABLE public.crm_settings']);
        expect(code).toContain('ADD COLUMN sla_worker_enabled boolean NOT NULL DEFAULT false');
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).not.toMatch(/\b(?:COMMIT|DROP|TRUNCATE|COPY|CALL)\b|sla_worker_enabled\s*=\s*true/);
        expect(source).toContain('NEVER RUN ON SUPABASE');
    });

    it('refuses an existing role rather than silently granting or reusing identity', () => {
        assertOrder(code, ["IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buildtrack_sales_sla_worker')",
            "RAISE EXCEPTION 'CRM_SLA_WORKER_ROLE_COLLISION'", 'CREATE ROLE buildtrack_sales_sla_worker']);
        expect(code).toMatch(/CREATE ROLE buildtrack_sales_sla_worker NOLOGIN NOINHERIT NOSUPERUSER\s+NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
        expect(code).not.toMatch(/ALTER ROLE|GRANT\s+buildtrack_sales_sla_worker|GRANT\s+authenticated|PASSWORD|CREATE EXTENSION|cron\.|pg_net|net\.http/i);
    });

    it('grants only two private entry points and schema usage to the worker', () => {
        const grants = code.match(/\bGRANT\s+[\s\S]*?;/g)?.map(statement => statement.replace(/\s+/g, ' '));
        expect(grants).toEqual([
            'GRANT USAGE ON SCHEMA sales_private TO buildtrack_sales_sla_worker;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_worker_cycle(uuid) TO buildtrack_sales_sla_worker;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_worker_receipt(uuid) TO buildtrack_sales_sla_worker;',
        ]);
        expect(code).not.toMatch(/CREATE POLICY|ALTER DEFAULT PRIVILEGES|CREATE FUNCTION public\./);
        for (const signature of ['crm_first_contact_worker_cycle(uuid)', 'crm_first_contact_worker_receipt(uuid)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION sales_private.${signature} FROM PUBLIC, anon, authenticated;`);
        }
        for (const signature of ['crm_first_contact_worker_child_projection(jsonb)', 'crm_first_contact_worker_cycle_projection(jsonb)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION sales_private.${signature} FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;`);
        }
    });

    it('uses pinned definer entry points and no JWT, account or service-role impersonation', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'/g)).toHaveLength(2);
        expect(code).not.toMatch(/auth\.uid|crm_v2_role|request\.jwt|user_metadata|app_metadata|service_role|service[_-]?key|set_config\(|SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION/i);
        expect(command).not.toContain('current_user');
        expect(source).toContain('EXECUTE ACL is authority');
    });

    it('requires nine processing gates but only six read gates for recovery', () => {
        for (const gate of readGates) {
            expect(command).toContain(`settings_row.${gate}`);
            expect(lookup).toContain(gate);
        }
        for (const gate of writeGates) {
            expect(command).toContain(`settings_row.${gate}`);
            expect(lookup).not.toContain(gate);
        }
        assertOrder(command, ['FROM public.crm_settings WHERE id FOR SHARE', 'CRM_SLA_WORKER_SETUP_REQUIRED',
            'FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=p_request_id']);
    });

    it('accepts only a typed request UUID, never caller-selected task, actor, policy or clock', () => {
        for (const name of ['cycle', 'receipt']) {
            expect(code).toContain(`CREATE FUNCTION sales_private.crm_first_contact_worker_${name}(p_request_id uuid)`);
        }
        for (const target of [command, lookup]) {
            expect(target).toContain("IF p_request_id IS NULL THEN RAISE EXCEPTION 'CRM_SLA_WORKER_INVALID_INPUT'");
            expect(target).not.toMatch(/p_request\s*->|p_actor|p_task|p_clock|p_limit|p_now/);
        }
    });

    it('uses immutable private system ledgers without borrowing an Admin or auth.users actor', () => {
        for (const name of ['crm_first_contact_worker_requests', 'crm_first_contact_worker_cycles']) {
            expect(code).toContain(`CREATE TABLE sales_private.${name}`);
            expect(code).toContain(`ALTER TABLE sales_private.${name} ENABLE ROW LEVEL SECURITY`);
            expect(code).toContain(`REVOKE ALL ON sales_private.${name} FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;`);
            expect(code).toContain(`BEFORE UPDATE OR DELETE ON sales_private.${name}`);
        }
        expect(code.match(/request_id uuid PRIMARY KEY/g)).toHaveLength(2);
        expect(code.match(/EXECUTE FUNCTION sales_private\.crm_first_contact_history_immutable\(\)/g)).toHaveLength(2);
        expect(code).not.toMatch(/REFERENCES auth\.users|actor_user_id|crm_first_contact_processing_requests|crm_first_contact_cycle_requests/);
        expect(command).toContain("owner_active,NULL,'First-contact system worker','system',child_request_id");
    });
});

describe('bounded atomic system work with shared locks (static only)', () => {
    it('uses the existing global lane and cursor after its separate request lock', () => {
        assertOrder(command, ['FROM public.crm_settings WHERE id FOR SHARE',
            "hashtextextended('sla-worker-cycle-request:'", "pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-cycle:global'",
            'FROM sales_private.crm_first_contact_cycle_cursor WHERE id FOR UPDATE']);
        expect(command).toContain("RAISE EXCEPTION 'CRM_SLA_WORKER_BUSY'");
        expect(code).not.toMatch(/CREATE TABLE sales_private\.\w*cursor/);
        expect(code).toContain("SET lock_timeout = '500ms'");
        expect(code).not.toMatch(/SET statement_timeout|pg_sleep|SKIP LOCKED/);
    });

    it('selects at most ten central open first-contact tasks plus one keyset lookahead', () => {
        expect(command).toContain("WHERE task_type='first_contact' AND project_interest_id IS NULL AND source_activity_id IS NULL AND status='open'");
        expect(command).toContain('(created_at,id)>(cursor_row.after_created_at,cursor_row.after_task_id)');
        expect(command).toContain('ORDER BY created_at,id LIMIT 11');
        expect(command).toContain('processed_count:=LEAST(selected_count,10); sweep_finished:=selected_count<=10');
        expect(command).not.toMatch(/OFFSET|intake_status|record_origin|evaluation_snapshot/);
    });

    it('prelocks all customers, owner advisories, calendar heads, roles and tasks before applying a child', () => {
        assertOrder(command, ['FOR customer_id_value IN SELECT id FROM public.sales_customers',
            'selected_owners:=array_append', "hashtextextended('work-schedule-sales:'",
            'PERFORM id FROM sales_private.crm_work_calendars', 'FOR role_row IN SELECT * FROM sales_private.crm_user_roles',
            'PERFORM id FROM public.crm_sla_tasks', 'child_response:=sales_private.crm_first_contact_apply']);
        expect(command).toContain('WHERE id=ANY(selected_customers[1:processed_count]) ORDER BY id FOR UPDATE');
        expect(command).toContain('FROM unnest(selected_owners) AS owners(id) WHERE id IS NOT NULL ORDER BY id');
        expect(command).toContain('WHERE sales_user_id=ANY(selected_owners) ORDER BY sales_user_id FOR SHARE');
        expect(command).toContain('WHERE user_id=ANY(selected_owners) ORDER BY user_id FOR SHARE');
        expect(command).toContain('WHERE id=ANY(selected_ids[1:processed_count]) ORDER BY id FOR UPDATE');
        expect(command).toContain('locked_customer_count<>(SELECT count(DISTINCT id) FROM unnest(selected_customers[1:processed_count])');
    });

    it('revalidates scope and parent bindings after task locks instead of acquiring new parents', () => {
        const recheck = command.split('ORDER BY id FOR UPDATE;')[1].split('child_request_id:=')[0];
        for (const predicate of ['selected_task.customer_id IS DISTINCT FROM selected_customers[item]',
            'selected_task.owner_user_id IS DISTINCT FROM selected_owners[item]',
            'selected_task.created_at IS DISTINCT FROM selected_times[item]', "selected_task.task_type<>'first_contact'",
            'selected_task.project_interest_id IS NOT NULL', 'selected_task.source_activity_id IS NOT NULL']) {
            expect(recheck).toContain(predicate);
        }
        expect(recheck).toContain("RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED'");
        expect(recheck).not.toMatch(/FOR (?:UPDATE|SHARE)|pg_advisory/);
        expect(recheck).not.toContain("selected_task.status<>'open'");
    });

    it('refreshes trusted snapshots per child and delegates business behavior to the shared core only', () => {
        const perChild = command.split('FOR item IN 1..processed_count LOOP').at(-1)!;
        assertOrder(perChild, ['SELECT * INTO selected_task FROM public.crm_sla_tasks',
            'SELECT * INTO customer_row FROM public.sales_customers',
            'SELECT * INTO head_row FROM sales_private.crm_work_calendars',
            'owner_active:=COALESCE(selected_task.owner_user_id=ANY(active_owner_ids),false)', 'child_request_id:=gen_random_uuid()',
            'child_response:=sales_private.crm_first_contact_apply']);
        expect(command.match(/crm_first_contact_apply\(/g)).toHaveLength(1);
        expect(command).toContain('crm_first_contact_apply(settings_row,customer_row,selected_task,head_row,');
        expect(command).not.toMatch(/crm_v2_process_first_contact|crm_first_contact_clock|crm_first_contact_completion|\b(?:UPDATE|INSERT INTO|DELETE FROM) public\./);
    });

    it('retains owner eligibility from actually locked role rows rather than a fresh unlocked role lookup', () => {
        const capturedRoles = command.split('FOR role_row IN SELECT * FROM sales_private.crm_user_roles')[1]
            .split('PERFORM id FROM public.crm_sla_tasks')[0];
        expect(capturedRoles).toContain('WHERE user_id=ANY(selected_owners) ORDER BY user_id FOR SHARE');
        expect(capturedRoles).toContain("role_row.role='sales' AND role_row.is_active");
        expect(capturedRoles).toContain('active_owner_ids:=array_append(active_owner_ids,role_row.user_id)');
        const perChild = command.split('FOR item IN 1..processed_count LOOP').at(-1)!;
        expect(perChild).not.toContain('FROM sales_private.crm_user_roles');
        expect(perChild).toContain('owner_active:=COALESCE(selected_task.owner_user_id=ANY(active_owner_ids),false)');
    });

    it('keeps server-generated child identities distinct and binds each returned receipt to the selected task', () => {
        expect(command).toContain('child_request_id:=gen_random_uuid()');
        expect(command).toContain('child_request_id=p_request_id OR EXISTS');
        expect(command).toContain('FROM sales_private.crm_first_contact_worker_requests');
        expect(command).toContain('WHERE request_id=child_request_id');
        for (const binding of ["child_response->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')",
            "child_response->>'requestId' IS DISTINCT FROM child_request_id::text",
            "child_response->>'taskId' IS DISTINCT FROM selected_ids[item]::text",
            "child_response->'replayed' IS DISTINCT FROM 'false'::jsonb"]) {
            expect(command).toContain(binding);
        }
        assertOrder(command, ['child_response:=sales_private.crm_first_contact_worker_child_projection(child_response)',
            'INSERT INTO sales_private.crm_first_contact_worker_requests', 'children:=children||jsonb_build_array(child_response)']);
    });

    it('fails on malformed or backwards times before persisting unreadable parent history', () => {
        for (const condition of ['NOT isfinite(started_at_value)', 'started_at_value<minimum_at', 'started_at_value>maximum_at',
            'NOT isfinite(child_processed_at)', 'child_processed_at<started_at_value', 'child_processed_at>maximum_at',
            'NOT isfinite(finished_at_value)', 'finished_at_value<started_at_value', 'finished_at_value>maximum_at',
            'finished_at_value<latest_child_at']) {
            expect(command).toContain(condition);
        }
        expect(command).toContain("jsonb_typeof(child_response->'processedAt') IS DISTINCT FROM 'string'");
        assertOrder(command, ['finished_at_value<latest_child_at', 'INSERT INTO sales_private.crm_first_contact_worker_cycles']);
    });

    it('propagates child failures and commits business effects, ledgers and cursor only as one transaction', () => {
        expect(command.match(/EXCEPTION WHEN/g)).toHaveLength(1);
        expect(command).toMatch(/BEGIN\s+child_processed_at:=sales_private\.crm_work_timestamp\(child_response->>'processedAt'\);\s+EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';/);
        expect(command).not.toMatch(/\bCONTINUE\b|SAVEPOINT|WHEN OTHERS THEN\s+(?:NULL|RETURN)|ON CONFLICT/);
        assertOrder(command, ['child_response:=sales_private.crm_first_contact_apply',
            'INSERT INTO sales_private.crm_first_contact_worker_requests',
            'UPDATE sales_private.crm_first_contact_cycle_cursor', 'INSERT INTO sales_private.crm_first_contact_worker_cycles']);
        expect(command).toContain('after_created_at=CASE WHEN sweep_finished THEN NULL ELSE selected_times[10] END');
        expect(command).toContain('after_task_id=CASE WHEN sweep_finished THEN NULL ELSE selected_ids[10] END WHERE id');
        expect(source).toContain('A poison child rolls back');
        expect(source).toContain('500ms bounds EACH lock wait, not runtime');
    });
});

describe('shared business core preserves the Admin boundary (static only)', () => {
    it('is a pinned private invoker helper with no ordinary or worker execute grant', () => {
        expect(processingCode).toContain('CREATE FUNCTION sales_private.crm_first_contact_apply(');
        expect(processingCode).toContain("RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(processingCode).toContain('REVOKE ALL ON FUNCTION sales_private.crm_first_contact_apply(public.crm_settings,public.sales_customers,public.crm_sla_tasks,sales_private.crm_work_calendars,boolean,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;');
        expect(`${processingCode}\n${code}`).not.toMatch(/GRANT EXECUTE ON FUNCTION sales_private\.crm_first_contact_apply/);
        expect(sharedCore).not.toMatch(/auth\.uid|crm_v2_role|request\.jwt|current_setting|set_config/);
    });

    it('requires coherent trusted composites and staff/system actor bindings before taking notice locks', () => {
        for (const condition of ["actor_kind_value NOT IN ('staff','system')", "actor_kind_value='staff' AND actor_id IS NULL",
            "actor_kind_value='system' AND actor_id IS NOT NULL", 'request_id_value IS NULL',
            'settings_row.id IS DISTINCT FROM true', 'customer_row.id IS NULL', 'task_row.id IS NULL',
            'task_row.customer_id IS DISTINCT FROM customer_row.id', "task_row.task_type IS DISTINCT FROM 'first_contact'",
            'task_row.project_interest_id IS NOT NULL', 'task_row.source_activity_id IS NOT NULL',
            'head_row.sales_user_id IS DISTINCT FROM task_row.owner_user_id']) {
            expect(sharedCore).toContain(condition);
        }
        assertOrder(sharedCore, ['CRM_SLA_PROCESS_INVALID_INPUT', 'FROM public.crm_notifications WHERE task_id=task_row.id ORDER BY id FOR UPDATE',
            'server_now:=clock_timestamp()']);
    });

    it('retains one clock/completion/dedupe implementation and no receipt ledger in the shared core', () => {
        expect(sharedCore).toContain('completion_json:=sales_private.crm_first_contact_completion(');
        expect(sharedCore).toContain('clock_json:=sales_private.crm_first_contact_clock(');
        expect(sharedCore).toContain('ON CONFLICT (recipient_user_id,dedupe_key) DO NOTHING');
        expect(sharedCore).toContain('INSERT INTO public.crm_audit_events(');
        expect(sharedCore).toContain("reason_value,actor_id,actor_kind_value,actor_name,");
        expect(sharedCore).not.toMatch(/crm_first_contact_processing_requests|crm_first_contact_worker_requests|crm_first_contact_worker_cycles/);
        expect(adminCommand).not.toMatch(/crm_first_contact_clock|crm_first_contact_completion|ON CONFLICT/);
    });

    it('keeps Admin authentication, role recheck, locks and its immutable request ledger in the wrapper', () => {
        expect(adminCommand).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
        expect(adminCommand).toContain("IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin'");
        assertOrder(adminCommand, ['FROM public.crm_settings WHERE id FOR SHARE', "hashtextextended('sla-processing-request:'",
            'FROM public.sales_customers WHERE id=initial_task.customer_id FOR UPDATE', "hashtextextended('work-schedule-sales:'",
            'FOR role_row IN SELECT * FROM sales_private.crm_user_roles',
            "IF actor_role IS DISTINCT FROM 'admin'", 'FROM public.crm_sla_tasks WHERE id=task_id_value FOR UPDATE',
            'response_value:=sales_private.crm_first_contact_apply', 'INSERT INTO sales_private.crm_first_contact_processing_requests']);
        expect(adminCommand).toContain("owner_active,actor_id,actor_name,'staff',request_id_value");
        expect(adminCommand).toContain('receipt_row.request_payload IS DISTINCT FROM canonical_request');
    });

    it('preserves the Admin response shape and uses a separate nonhuman actor for system processing', () => {
        expect(sharedCore).toContain("CASE WHEN actor_kind_value='system'");
        expect(sharedCore).toContain("THEN jsonb_build_object('kind','system','name','first_contact_worker_v1')");
        expect(sharedCore).toContain("ELSE jsonb_build_object('userId',actor_id,'role','admin') END");
        expect(sharedCore).toContain("'requestId',request_id_value,'taskId',task_row.id,'processedAt',server_now,'replayed',false");
        expect(command).toContain("owner_active,NULL,'First-contact system worker','system',child_request_id");
    });
});

describe('system receipt recovery and privacy (static only)', () => {
    it('replays only its existing system parent with no child execution or cursor changes', () => {
        const replay = command.split('IF FOUND THEN')[1].split('END IF;')[0];
        expect(replay).toContain("RETURN sales_private.crm_first_contact_worker_cycle_projection(cached_response)||jsonb_build_object('replayed',true)");
        expect(replay).not.toMatch(/crm_first_contact_apply|\b(?:INSERT|UPDATE|DELETE|PERFORM)\b/);
        expect(command).toContain('FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=p_request_id');
    });

    it('keeps recovery read-only with found=false semantics and unchanged historical replay flags', () => {
        expect(lookup).toContain('FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=p_request_id');
        expect(lookup).toContain('found_receipt:=FOUND');
        expect(lookup).toContain('projected_receipt jsonb:=NULL');
        expect(lookup).toContain("'requestId',p_request_id,'found',found_receipt,'receipt',projected_receipt");
        expect(lookup).not.toMatch(/crm_first_contact_apply|crm_first_contact_worker_cycle\(|clock_timestamp|FOR (?:UPDATE|SHARE)|\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE)\b/);
        expect(lookup).not.toContain("'replayed',true");
        expect(source).toContain('found=false never proves noncommit');
        expect(source).toContain('exact request ID BEFORE invoking a cycle');
    });

    it('whitelists system actors and every child field instead of exposing raw snapshots', () => {
        for (const field of ['requestId', 'taskId', 'processedAt', 'replayed', 'outcome', 'reason', 'serviceDueAt', 'staffDueAt',
            'notificationId', 'notificationType', 'completedByActivityId', 'completedAt', 'withdrawnCount']) {
            expect(childProjection).toContain(`'${field}',p_response->'${field}'`);
        }
        for (const target of [childProjection, cycleProjection]) {
            expect(target).toContain("'actor',jsonb_build_object('kind',p_response#>'{actor,kind}','name',p_response#>'{actor,name}')");
            expect(target).not.toMatch(/->'actor'|request_payload|evaluation_snapshot|phone|income|notes|\|\||userId/);
        }
    });

    it('whitelists parent fields and projects every child in retained order', () => {
        for (const field of ['requestId', 'startedAt', 'finishedAt', 'replayed', 'maxItems', 'processedCount', 'sweepFinished']) {
            expect(cycleProjection).toContain(`'${field}',p_response->'${field}'`);
        }
        expect(cycleProjection).toContain('jsonb_agg(sales_private.crm_first_contact_worker_child_projection(child) ORDER BY ordinal)');
        expect(cycleProjection).toContain("jsonb_array_elements(p_response->'receipts') WITH ORDINALITY");
        expect(cycleProjection).toContain("'[]'::jsonb");
        expect(command).toContain('RETURN sales_private.crm_first_contact_worker_cycle_projection(response_value)');
        expect(lookup).toContain('projected_receipt:=sales_private.crm_first_contact_worker_cycle_projection(stored_response)');
    });
});
