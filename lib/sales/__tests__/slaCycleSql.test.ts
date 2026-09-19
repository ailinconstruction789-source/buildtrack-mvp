// @vitest-environment node
// STATIC source invariants, not SQL execution or live Supabase/RLS certification.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/11_first_contact_cycle_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('cycle');
const lookup = body('receipt');
const capability = body('capabilities');
const projection = body('projection');
const gates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
    'work_schedule_enabled', 'notifications_enabled', 'sla_preview_enabled'];
const scenario = readFileSync(resolve(process.cwd(), 'sql/sales/runtime/scenarios/cycle.sql'), 'utf8');

describe('withheld bounded cycle authority and receipts (static only)', () => {
    it('raises before all DDL, defaults disabled and ends in rollback', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeGreaterThanOrEqual(0);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
        expect(code).toContain('ADD COLUMN sla_cycle_enabled boolean NOT NULL DEFAULT false');
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).not.toMatch(/\b(?:COMMIT|DROP|TRUNCATE|COPY|CALL)\b|sla_cycle_enabled\s*=\s*true/);
        expect(source).toContain('NEVER RUN ON SUPABASE');
    });

    it('requires current trusted Admin and eight write gates versus six read gates', () => {
        for (const target of [command, lookup]) {
            expect(target).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
            expect(target).toContain("actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin'");
            expect(target.indexOf('CRM_SLA_CYCLE_FORBIDDEN')).toBeLessThan(target.indexOf('CRM_SLA_CYCLE_SETUP_REQUIRED'));
            expect(target.indexOf('CRM_SLA_CYCLE_SETUP_REQUIRED')).toBeLessThan(target.indexOf('CRM_SLA_CYCLE_INVALID_INPUT'));
        }
        for (const gate of gates) {
            expect(capability).toContain(gate);
            expect(command).toContain(`settings_row.${gate}`);
            expect(lookup).toContain(gate);
        }
        for (const gate of ['sla_processing_enabled', 'sla_cycle_enabled']) {
            expect(command).toContain(`settings_row.${gate}`);
            expect(capability).toContain(gate);
            expect(lookup).not.toContain(gate);
        }
        expect(capability).toContain("'contract_version','first_contact_cycle_v1'");
        expect(capability).toContain("'processing_enabled',enabled AND processing");
        expect(code).not.toMatch(/user_metadata|app_metadata|request\.jwt/);
    });

    it('accepts only one bounded UUID requestId, never client-selected actors/tasks/clocks/limits', () => {
        for (const target of [command, lookup]) {
            expect(target).toContain("jsonb_typeof(p_request) IS DISTINCT FROM 'object'");
            expect(target).toContain('octet_length(p_request::text)>1024');
            expect(target).toContain("NOT (p_request ? 'requestId')");
            expect(target).toContain("jsonb_object_keys(p_request) k WHERE k<>'requestId'");
            expect(target).toContain("jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string'");
            expect(target).toContain("length(p_request->>'requestId')<>36 OR (p_request->>'requestId') !~ uuid_pattern");
            expect(target).toContain("request_id_value:=(p_request->>'requestId')::uuid");
            expect(target).not.toMatch(/p_request\s*->>?\s*'(?:task|taskId|taskIds|actor|limit|clock|startedAt)'/);
        }
    });

    it('keeps a single global cursor and a private immutable per-Admin ledger', () => {
        expect(code).toContain('CREATE TABLE sales_private.crm_first_contact_cycle_cursor');
        expect(code).toContain('id boolean PRIMARY KEY DEFAULT true CHECK (id)');
        expect(code).toContain('CHECK ((after_created_at IS NULL)=(after_task_id IS NULL))');
        expect(code).toContain('INSERT INTO sales_private.crm_first_contact_cycle_cursor(id) VALUES(true)');
        expect(code).toContain('PRIMARY KEY (actor_user_id,request_id)');
        for (const table of ['crm_first_contact_cycle_cursor', 'crm_first_contact_cycle_requests']) {
            expect(code).toContain(`ALTER TABLE sales_private.${table} ENABLE ROW LEVEL SECURITY`);
            expect(code).toContain(`REVOKE ALL ON sales_private.${table} FROM PUBLIC, anon, authenticated`);
        }
        expect(code).toContain('BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_cycle_requests');
        expect(code).toContain('EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable()');
        expect(code).not.toMatch(/CREATE POLICY|GRANT (?:ALL|SELECT|INSERT|UPDATE|DELETE)/);
    });

    it('pins public definers and grants only authenticated RPC execution', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(3);
        for (const signature of ['crm_v2_sla_cycle_capabilities()', 'crm_v2_process_first_contact_cycle(jsonb)',
            'crm_v2_first_contact_cycle_receipt(jsonb)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`);
        }
        expect(code).toContain('REVOKE ALL ON FUNCTION sales_private.crm_first_contact_cycle_projection(jsonb) FROM PUBLIC, anon, authenticated');
    });

    it('uses own historical receipts without running children or toggling lookup replayed', () => {
        expect(lookup).toContain('WHERE actor_user_id=actor_id AND request_id=request_id_value');
        expect(lookup).toContain('found_receipt:=FOUND');
        expect(lookup).toContain('projected_receipt jsonb:=NULL');
        expect(lookup).toContain("'requestId',request_id_value,'found',found_receipt,'receipt',projected_receipt");
        expect(lookup).not.toMatch(/crm_v2_process_first_contact|FOR (?:UPDATE|SHARE)|clock_timestamp|\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE)\b/);
        expect(lookup).not.toContain("'replayed',true");
        expect(source).toContain('found=false is not proof of noncommit');
    });

    it('whitelists parent children and both nested actors while retaining original JSON times and replay flags', () => {
        for (const field of ['requestId', 'startedAt', 'finishedAt', 'replayed', 'maxItems', 'processedCount', 'sweepFinished']) {
            expect(projection).toContain(`'${field}',p_response->'${field}'`);
        }
        for (const field of ['requestId', 'taskId', 'processedAt', 'replayed', 'outcome', 'reason', 'serviceDueAt', 'staffDueAt',
            'notificationId', 'notificationType', 'completedByActivityId', 'completedAt', 'withdrawnCount']) {
            expect(projection).toContain(`'${field}',child->'${field}'`);
        }
        expect(projection).toContain("'actor',jsonb_build_object('userId',p_response#>'{actor,userId}','role',p_response#>'{actor,role}')");
        expect(projection).toContain("'actor',jsonb_build_object('userId',child#>'{actor,userId}','role',child#>'{actor,role}')");
        expect(projection).toContain('ORDER BY ordinal');
        expect(projection).not.toMatch(/->'actor'|request_payload|evaluation_snapshot|phone|income|notes|\|\|/);
    });
});

describe('atomic keyset cycle and prelock order (static only)', () => {
    it('selects only central open source-free first contact with an indexed deterministic10-plus1 keyset', () => {
        expect(code).toContain('CREATE INDEX crm_first_contact_cycle_scan_idx ON public.crm_sla_tasks(created_at,id)');
        expect(command).toContain("WHERE task_type='first_contact' AND project_interest_id IS NULL AND source_activity_id IS NULL AND status='open'");
        expect(command).toContain('(created_at,id)>(cursor_row.after_created_at,cursor_row.after_task_id)');
        expect(command).toContain('ORDER BY created_at,id LIMIT 11');
        expect(command).toContain('processed_count:=LEAST(selected_count,10); sweep_finished:=selected_count<=10');
        expect(command).not.toMatch(/OFFSET|SKIP LOCKED|intake_status|record_origin|evaluation_snapshot/);
    });

    it('advances past held rows only on a committed batch and resets at <=10 including zero', () => {
        expect(command).toContain('after_created_at=CASE WHEN sweep_finished THEN NULL ELSE selected_times[10] END');
        expect(command).toContain('after_task_id=CASE WHEN sweep_finished THEN NULL ELSE selected_ids[10] END WHERE id');
        expect(command.indexOf('UPDATE sales_private.crm_first_contact_cycle_cursor')).toBeGreaterThan(command.indexOf('child_response:=public.crm_v2_process_first_contact'));
        expect(source).toContain('Fairness applies to committed rounds only');
        expect(source).toContain('needs Admin remediation, never silent skipping');
    });

    it('serializes settings and own request while global cycle contention fails fast', () => {
        const order = ['FROM public.crm_settings WHERE id FOR SHARE', "hashtextextended('sla-cycle-request:'",
            "pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-cycle:global'", 'FROM sales_private.crm_first_contact_cycle_cursor WHERE id FOR UPDATE'];
        const positions = order.map((value) => command.indexOf(value));
        expect(positions.every((value) => value >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(command).toContain("RAISE EXCEPTION 'CRM_SLA_CYCLE_BUSY'");
        expect(code).toContain("SET lock_timeout = '500ms'");
        expect(code).not.toMatch(/SET statement_timeout|set_config\(|pg_sleep/);
    });

    it('prelocks ALL selected customers, owners calendars roles and tasks before ANY09 child', () => {
        const order = ['FOR customer_id_value IN SELECT id FROM public.sales_customers', 'selected_owners:=array_append',
            "hashtextextended('work-schedule-sales:'", 'PERFORM id FROM sales_private.crm_work_calendars',
            'FOR role_row IN SELECT * FROM sales_private.crm_user_roles', 'PERFORM id FROM public.crm_sla_tasks',
            'child_response:=public.crm_v2_process_first_contact'];
        const positions = order.map((value) => command.indexOf(value));
        expect(positions.every((value) => value >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(command).toContain('WHERE id=ANY(selected_customers[1:processed_count]) ORDER BY id FOR UPDATE');
        expect(command).toContain('FROM unnest(selected_owners) AS owners(id) WHERE id IS NOT NULL ORDER BY id');
        expect(command).toContain('ORDER BY sales_user_id FOR SHARE');
        expect(command).toContain('WHERE user_id=actor_id OR user_id=ANY(selected_owners) ORDER BY user_id FOR SHARE');
        expect(command).toContain('WHERE id=ANY(selected_ids[1:processed_count]) ORDER BY id FOR UPDATE');
    });

    it('revalidates selected targets after prelocks without introducing new parents', () => {
        const finalCheck = command.split('PERFORM id FROM public.crm_sla_tasks')[1].split('child_request_id:=')[0];
        for (const predicate of ['selected_task.customer_id IS DISTINCT FROM selected_customers[item]',
            'selected_task.owner_user_id IS DISTINCT FROM selected_owners[item]',
            'selected_task.created_at IS DISTINCT FROM selected_times[item]', "selected_task.task_type<>'first_contact'",
            'selected_task.project_interest_id IS NOT NULL', 'selected_task.source_activity_id IS NOT NULL']) {
            expect(finalCheck).toContain(predicate);
        }
        expect(finalCheck).toContain("RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED'");
        expect(finalCheck).not.toContain("selected_task.status<>'open'");
    });

    it('locks current Admin on terminal replay/empty and never invokes new children on replay', () => {
        const replay = command.split('IF FOUND THEN')[1].split('IF NOT pg_try')[0];
        expect(replay).toContain('WHERE user_id=actor_id AND is_active FOR SHARE');
        expect(replay).toContain("actor_role IS DISTINCT FROM 'admin'");
        expect(replay).toContain("RETURN sales_private.crm_first_contact_cycle_projection(cached_response)||jsonb_build_object('replayed',true)");
        expect(replay).not.toContain('crm_v2_process_first_contact(');
        const empty = command.split('IF processed_count=0 THEN')[1].split('ELSE')[0];
        expect(empty).toContain('WHERE user_id=actor_id AND is_active FOR SHARE');
        expect(empty).toContain("actor_role IS DISTINCT FROM 'admin'");
    });

    it('delegates all child work to09 with fresh server UUIDs and no exception-swallowing', () => {
        expect(command).toContain('child_request_id:=gen_random_uuid()');
        expect(command).toContain("child_response:=public.crm_v2_process_first_contact(jsonb_build_object('requestId',child_request_id,'taskId',selected_ids[item]))");
        expect(command).toContain('children:=children||jsonb_build_array(child_response)');
        expect(command).not.toMatch(/\bCONTINUE\b|crm_first_contact_clock|crm_first_contact_completion/);
        const handlers = Array.from(command.matchAll(/BEGIN\s+([\s\S]*?)EXCEPTION WHEN OTHERS THEN/g));
        expect(handlers).toHaveLength(1);
        expect(command).toMatch(/BEGIN\s+child_processed_at:=sales_private\.crm_work_timestamp\(child_response->>'processedAt'\);\s+EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';/);
        expect(command).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM) public\./);
        expect(command).toContain('VALUES(actor_id,request_id_value,response_value,finished_at_value)');
        expect(command).toContain("'maxItems',10,'processedCount',processed_count,'sweepFinished',sweep_finished,'receipts',children");
    });

    it('aborts malformed child identity or backward clocks rather than persisting an unreadable receipt', () => {
        for (const guard of ["child_response->'actor' IS DISTINCT FROM jsonb_build_object('userId',actor_id,'role','admin')",
            "child_response->>'requestId' IS DISTINCT FROM child_request_id::text",
            "child_response->>'taskId' IS DISTINCT FROM selected_ids[item]::text",
            "child_response->'replayed' IS DISTINCT FROM 'false'::jsonb",
            'NOT isfinite(started_at_value)', 'started_at_value<minimum_at', 'started_at_value>maximum_at',
            'NOT isfinite(child_processed_at)', 'child_processed_at<started_at_value',
            'NOT isfinite(finished_at_value)', 'finished_at_value<started_at_value', 'finished_at_value<latest_child_at']) {
            expect(command).toContain(guard);
        }
        expect(command.indexOf('finished_at_value<latest_child_at')).toBeLessThan(command.indexOf('INSERT INTO sales_private.crm_first_contact_cycle_requests'));
    });
});

describe('synthetic cycle native coverage source (not execution)', () => {
    it('guards loopback and synthetic opt-in, rolls back and prints a separate suite marker', () => {
        expect(scenario).toContain("current_database() !~ '^buildtrack_sales_runtime_'");
        expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'");
        expect(scenario).toContain("inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet");
        expect(scenario.trim()).toMatch(/ROLLBACK;$/);
        expect(scenario).toContain("'CYCLE_RUNTIME:'");
        expect(scenario).toContain("'suite','first_contact_cycle'");
    });

    it('covers actual09 rollback, retry, held fairness across Admins and empty reset', () => {
        for (const label of ['child failure is propagated rather than skipped',
            'child failure rolls back every customer task notice audit child receipt cycle receipt and cursor',
            'first successful cycle processes exactly ten with an eleventh lookahead',
            'cursor advances to the tenth selected task even when all ten are held',
            'eleventh held task is reached by next Admin and completes the shared sweep',
            'exact replay changes only parent replayed and preserves children and original cycle timestamps',
            'zero eligible rows finishes sweep without creating child receipts', 'empty tail resets cursor']) {
            expect(scenario).toContain(label);
        }
    });

    it('covers read/write flags, private grants, current authority and non-leaky immutable lookup', () => {
        for (const label of ['lookup remains available with ', 'another Admin cannot discover a private cycle receipt',
            'lookup strips private surplus at parent child and both nested actor levels', 'cached POST replay also strips private fields',
            'revoked Admin cannot replay committed cycle', 'direct shared cursor write denied',
            'cycle receipt immutable against privileged UPDATE', 'cycle receipt immutable against privileged DELETE',
            'all reads denied commands cached replay gates and invalid requests preserve complete business state']) {
            expect(scenario).toContain(label);
        }
    });
});
