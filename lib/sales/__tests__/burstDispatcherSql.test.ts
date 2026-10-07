// @vitest-environment node
// Static source checks only: native synthetic execution is a separate harness.
// These assertions do not authorize SQL installation, Cron or feature activation.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/16_bounded_burst_dispatcher_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const compact = code.replace(/\s+/g, ' ');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const prepare = body('burst_prepare');
const prepareWrapper = body('prepare_wrapper');
const executeWrapper = body('execute_wrapper');
const continuation = body('burst_continue');
const projection = body('burst_projection');
const tick = body('burst_tick');
const gates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled', 'work_schedule_enabled',
    'notifications_enabled', 'sla_preview_enabled', 'sla_processing_enabled', 'sla_cycle_enabled',
    'sla_worker_enabled', 'sla_dispatcher_enabled'];
const assertOrder = (value: string, fragments: string[]) => {
    const positions = fragments.map(fragment => value.indexOf(fragment));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
};

describe('withheld optional bounded burst draft (static only)', () => {
    it('retains the guard and rollback, defaults the new gate off and never installs a scheduler', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        assertOrder(code, ["RAISE EXCEPTION 'DESIGN ONLY:", 'ALTER TABLE public.crm_settings']);
        expect(code).toContain('ADD COLUMN sla_burst_enabled boolean NOT NULL DEFAULT false');
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).not.toMatch(/\b(?:DROP|TRUNCATE|COPY|CREATE EXTENSION|CREATE ROLE|ALTER ROLE)\b|sla_burst_enabled\s*=\s*true|cron\.|pg_net|net\.http/i);
        expect(source).toContain('NEVER RUN ON SUPABASE');
        expect(source).toContain('five-minute delivery guarantee');
    });

    it('adds a fixed per-request policy snapshot and an additional immutable-policy guard', () => {
        expect(compact).toContain("ADD COLUMN policy_version text NOT NULL DEFAULT 'completion_spacing_v1' CHECK (policy_version IN ('completion_spacing_v1','bounded_burst_v2'))");
        expect(body('policy_guard')).toContain('NEW.policy_version IS DISTINCT FROM OLD.policy_version');
        expect(code).toContain('BEFORE UPDATE ON sales_private.crm_first_contact_dispatch_requests');
        expect(code).not.toMatch(/(?:DISABLE|DROP) TRIGGER|CREATE OR REPLACE FUNCTION sales_private\.crm_first_contact_dispatch_history_guard/);
        expect(prepare).not.toMatch(/SET\s+policy_version\s*=/);
    });

    it('retains old implementation under owner-only helper names instead of copying execution logic', () => {
        expect(code).toContain('ALTER FUNCTION sales_private.crm_first_contact_dispatch_prepare() RENAME TO crm_first_contact_dispatch_prepare_legacy;');
        expect(code).toContain('ALTER FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) RENAME TO crm_first_contact_dispatch_execute_legacy;');
        for (const signature of ['crm_first_contact_dispatch_prepare_legacy()', 'crm_first_contact_dispatch_execute_legacy(uuid,uuid)']) {
            expect(compact).toContain(`REVOKE ALL ON FUNCTION sales_private.${signature} FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;`);
        }
        expect(code).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION sales_private\.crm_first_contact_dispatch_(?:prepare|execute)_legacy/);
        expect(code).not.toMatch(/crm_first_contact_worker_cycle\(|crm_first_contact_apply\(|crm_first_contact_clock\(|crm_v2_process_first_contact\(/);
        expect(code).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\.|UPDATE sales_private\.crm_first_contact_cycle_cursor/);
    });

    it('keeps admissions private, immutable and linked to a durable attempt', () => {
        expect(code).toContain('attempt_id uuid PRIMARY KEY REFERENCES sales_private.crm_first_contact_dispatch_attempts(attempt_id) ON DELETE RESTRICT');
        expect(code).toContain('ON sales_private.crm_first_contact_dispatch_admissions(admitted_at DESC,attempt_id)');
        expect(code).toContain('ALTER TABLE sales_private.crm_first_contact_dispatch_admissions ENABLE ROW LEVEL SECURITY;');
        expect(compact).toContain('REVOKE ALL ON sales_private.crm_first_contact_dispatch_admissions FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;');
        expect(code).toContain('BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_dispatch_admissions');
        expect(code).toContain('EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable()');
        expect(code).toContain('admitted_at timestamptz NOT NULL CHECK (isfinite(admitted_at)');
        expect(code).not.toMatch(/CREATE POLICY|ALTER DEFAULT PRIVILEGES/);
    });

    it('grants only five narrow routines and no tables, underlying worker, legacy helpers or identity', () => {
        const grants = code.match(/\bGRANT\s+[\s\S]*?;/g)?.map(statement => statement.replace(/\s+/g, ' '));
        expect(grants).toEqual([
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_burst_prepare() TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_burst_continue(uuid) TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON PROCEDURE sales_private.crm_first_contact_worker_burst_tick() TO buildtrack_sales_sla_dispatcher;',
        ]);
        expect(code).not.toMatch(/GRANT USAGE|GRANT\s+buildtrack|PASSWORD|auth\.uid|request\.jwt|set_config\(|SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION/i);
        for (const signature of ['crm_first_contact_dispatch_prepare()', 'crm_first_contact_dispatch_execute(uuid,uuid)',
            'crm_first_contact_dispatch_burst_prepare()', 'crm_first_contact_dispatch_burst_continue(uuid)']) {
            expect(compact).toContain(`REVOKE ALL ON FUNCTION sales_private.${signature} FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;`);
        }
    });

    it('pins definer functions to catalog/UTC and bounds lock waits independently from total time', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'/g)).toHaveLength(4);
        expect(code.match(/SET lock_timeout = '500ms'/g)).toHaveLength(3);
        expect(code).not.toMatch(/SET statement_timeout|pg_sleep|SKIP LOCKED/);
    });
});

describe('shared admissions and policy transitions (static only)', () => {
    it('uses all ten existing gates in both wrappers, and all eleven in burst entry and continuation', () => {
        for (const gate of gates) {
            for (const target of [prepare, prepareWrapper, executeWrapper]) expect(target).toContain(`settings_row.${gate}`);
            expect(continuation).toContain(`s.${gate}`);
        }
        expect(prepare).toContain('AND settings_row.sla_burst_enabled) IS DISTINCT FROM true');
        expect(continuation).toContain('AND s.sla_burst_enabled');
    });

    it('serializes admission under settings, shared dispatcher lane and control/request locks', () => {
        for (const target of [prepare, prepareWrapper]) {
            assertOrder(target, ['FROM public.crm_settings WHERE id FOR SHARE',
                "pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global',0))",
                'FROM sales_private.crm_first_contact_dispatch_control WHERE id FOR UPDATE',
                'FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id FOR UPDATE']);
        }
        expect(prepare).toContain("IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global',0)) THEN RETURN NULL; END IF");
        expect(prepare).not.toMatch(/\bCOMMIT\b|\bROLLBACK\b|\bLOOP\b/);
    });

    it('checks only latest five timestamps and enforces the rolling ten-second boundary', () => {
        expect(prepare).toContain('SELECT count(*),min(admitted_at),max(admitted_at) INTO recent_count,oldest_recent,newest_recent FROM (');
        expect(prepare).toContain('SELECT admitted_at FROM sales_private.crm_first_contact_dispatch_admissions ORDER BY admitted_at DESC,attempt_id LIMIT 5');
        expect(prepare).toContain("IF recent_count=5 AND oldest_recent>now_value-interval '10 seconds' THEN RETURN NULL; END IF");
        expect(prepare).not.toMatch(/oldest_recent>=|LIMIT\s+(?:p_|[6-9]|\d{2})/);
        assertOrder(prepare, ['INTO recent_count,oldest_recent,newest_recent', 'now_value<newest_recent', 'IF recent_count=5', 'IF recover_legacy THEN', 'attempt_id_value:=gen_random_uuid()']);
    });

    it('rejects invalid or backwards server time and accepts no caller time, cap or identity input', () => {
        expect(code).toContain('CREATE FUNCTION sales_private.crm_first_contact_dispatch_burst_prepare()');
        expect(prepare).toContain('now_value:=clock_timestamp()');
        expect(prepare).toContain("NOT isfinite(now_value) OR now_value<minimum_at OR now_value>maximum_at-interval '60 seconds'");
        expect(prepare).toContain('now_value<request_row.created_at OR now_value<request_row.completed_at');
        expect(prepare).toContain('newest_recent IS NOT NULL AND now_value<newest_recent');
        expect(prepare).not.toMatch(/p_now|p_clock|p_limit|p_request|date_trunc/);
    });

    it('keeps review, lease, backoff and five-reservation holds before admission or new identity', () => {
        assertOrder(prepare, ["IF request_row.status='review' THEN RETURN NULL", "ELSIF request_row.status='completed'",
            'IF now_value<request_row.next_attempt_at THEN RETURN NULL', 'IF request_row.attempt_count>=5',
            "SET status='review',last_error_code='RETRY_LIMIT'", 'INTO recent_count,oldest_recent,newest_recent', 'attempt_id_value:=gen_random_uuid()']);
        expect(prepare).toContain('request_id_value:=current_id; attempt_number:=request_row.attempt_count+1');
        expect(prepare).toContain("current_attempt_id=attempt_id_value,next_attempt_at=now_value+interval '60 seconds',last_error_code=NULL");
        expect(prepare).toContain('VALUES(attempt_id_value,request_id_value,attempt_number,now_value,pg_current_xact_id())');
    });

    it('honors completed legacy spacing but does not apply that old cooldown to completed burst requests', () => {
        expect(prepare).toContain("IF request_row.policy_version='completion_spacing_v1'");
        expect(prepare).toContain("AND now_value<request_row.completed_at+interval '60 seconds' THEN RETURN NULL");
        expect(prepare).toContain("recover_legacy:=request_row.policy_version='completion_spacing_v1'");
        expect(prepare.match(/create_request:=true/g)).toHaveLength(2);
        expect(prepare).not.toMatch(/status='completed'[^;]*next_attempt_at/);
    });

    it('accounts for a legacy recovery attempt only when unchanged legacy prepare returns a reservation', () => {
        const branch = prepare.split('IF recover_legacy THEN')[1].split('attempt_id_value:=gen_random_uuid()')[0];
        assertOrder(branch, ['reservation_value:=sales_private.crm_first_contact_dispatch_prepare_legacy()',
            'IF reservation_value IS NOT NULL THEN', 'INSERT INTO sales_private.crm_first_contact_dispatch_admissions',
            "VALUES((reservation_value->>'attemptId')::uuid,now_value)", 'RETURN reservation_value']);
        expect(branch).not.toMatch(/UPDATE|gen_random_uuid|worker_cycle/);
    });

    it('atomically appends request, attempt and admission, rejects retained worker identity collisions', () => {
        assertOrder(prepare, ['request_id_value:=gen_random_uuid(); attempt_number:=1',
            'FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=request_id_value',
            'INSERT INTO sales_private.crm_first_contact_dispatch_requests',
            'INSERT INTO sales_private.crm_first_contact_dispatch_attempts',
            'INSERT INTO sales_private.crm_first_contact_dispatch_admissions(attempt_id,admitted_at) VALUES(attempt_id_value,now_value)',
            "RETURN jsonb_build_object('requestId',request_id_value,'attemptId',attempt_id_value,'attemptNumber',attempt_number)"]);
        expect(prepare).toContain("VALUES(request_id_value,now_value,'reserved',attempt_number,attempt_id_value,now_value+interval '60 seconds','bounded_burst_v2')");
    });

    it('routes the existing prepare capability through the same pacer and prevents off-mode v2 recovery bypass', () => {
        expect(prepareWrapper).toContain('IF settings_row.sla_burst_enabled THEN RETURN sales_private.crm_first_contact_dispatch_burst_prepare(); END IF');
        const currentRequestBranch = prepareWrapper.split('IF current_id IS NOT NULL THEN')[1];
        assertOrder(currentRequestBranch, ['FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id FOR UPDATE',
            "request_row.policy_version='bounded_burst_v2' AND request_row.status<>'completed'",
            "RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED'", 'RETURN sales_private.crm_first_contact_dispatch_prepare_legacy()']);
        expect(prepareWrapper).toContain("request_row.policy_version NOT IN ('completion_spacing_v1','bounded_burst_v2')");
    });

    it('locks settings and requires the v2 gate again between committed prepare and unchanged execute', () => {
        assertOrder(executeWrapper, ['FROM public.crm_settings WHERE id FOR SHARE',
            'SELECT policy_version INTO policy_value', "IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_NOT_AVAILABLE'",
            "policy_value='bounded_burst_v2' AND settings_row.sla_burst_enabled IS DISTINCT FROM true",
            'RETURN sales_private.crm_first_contact_dispatch_execute_legacy(p_request_id,p_attempt_id)']);
        expect(executeWrapper).toContain("policy_value NOT IN ('completion_spacing_v1','bounded_burst_v2')");
        expect(executeWrapper).not.toMatch(/WHEN OTHERS|\bCOMMIT\b|\bUPDATE\b|\bINSERT\b|gen_random_uuid|worker_cycle/);
    });
});

describe('bounded top-level batching and historical projection (static only)', () => {
    it('requires a matching current completed full nonterminal v2 receipt, and returns only a boolean', () => {
        expect(code).toContain('RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER');
        expect(continuation).toContain('SELECT p_request_id IS NOT NULL AND EXISTS (');
        expect(continuation).toContain('r.request_id=c.current_request_id');
        expect(continuation).toContain('w.request_id=r.request_id');
        expect(continuation).toContain("r.request_id=p_request_id AND r.policy_version='bounded_burst_v2' AND r.status='completed'");
        expect(continuation).toContain("w.response->'actor'=jsonb_build_object('kind','system','name','first_contact_worker_v1')");
        expect(continuation).toContain("w.response->>'requestId'=p_request_id::text");
        expect(continuation).toContain("w.response->'maxItems'='10'::jsonb");
        expect(continuation).toContain("w.response->'processedCount'='10'::jsonb AND w.response->'sweepFinished'='false'::jsonb");
        expect(continuation).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|RETURN\s+w\.response/);
    });

    it('preserves the exact legacy nested policy and derives v2 metadata from immutable request policy', () => {
        expect(projection).toContain('CASE p_request.policy_version');
        expect(projection).toContain("WHEN 'completion_spacing_v1' THEN\n        jsonb_build_object('maxItemsPerCycle',10,'maxAttempts',5,'reservationSeconds',60,'minimumSpacingSeconds',60)");
        expect(projection).toContain("'version','bounded_burst_v2','maxItemsPerCycle',10,'maxAttempts',5,'reservationSeconds',60");
        expect(projection).toContain("'minimumSpacingSeconds',0,'maxAdmissionsPerWindow',5,'windowSeconds',10,'maxCyclesPerCall',5,'softBudgetMilliseconds',8000");
        expect(projection).not.toMatch(/crm_settings|clock_timestamp|statement_timestamp|row_to_json|to_jsonb|prepared_xid|phone|income/);
        expect(code).toContain("RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog SET timezone = 'UTC'");
    });

    it('uses a top-level invoker procedure without SET or exception handler', () => {
        const procedure = code.split('CREATE PROCEDURE sales_private.crm_first_contact_worker_burst_tick()')[1].split('$burst_tick$;')[0];
        expect(procedure).toMatch(/^\s*LANGUAGE plpgsql SECURITY INVOKER\s+AS \$burst_tick\$/);
        expect(procedure).not.toMatch(/SECURITY DEFINER|\bSET\b|\bEXCEPTION\b|\bWHILE\b|pg_sleep/);
        expect(tick).toContain('FOR cycle_number IN 1..5 LOOP');
        expect(tick.match(/\bLOOP\b/g)).toHaveLength(2);
    });

    it('checks the soft eight-second budget and backward time before starting another reservation', () => {
        assertOrder(tick, ['started_at_value:=pg_catalog.clock_timestamp()', 'FOR cycle_number IN 1..5 LOOP',
            'now_value:=pg_catalog.clock_timestamp()', 'now_value OPERATOR(pg_catalog.<) previous_at_value',
            "(now_value OPERATOR(pg_catalog.-) started_at_value) OPERATOR(pg_catalog.>=) INTERVAL '8 seconds'", 'previous_at_value:=now_value',
            'reservation_value:=sales_private.crm_first_contact_dispatch_burst_prepare()']);
        expect(tick).toContain('IF NOT pg_catalog.isfinite(started_at_value) THEN RETURN');
        expect(tick).toContain('IF NOT pg_catalog.isfinite(now_value)');
        expect(source).toContain('cannot interrupt one already in flight');
    });

    it('qualifies operators and equality in the no-SET invoker body against hostile caller search paths', () => {
        expect(tick).toContain('OPERATOR(pg_catalog.<)');
        expect(tick).toContain('OPERATOR(pg_catalog.-)');
        expect(tick).toContain('OPERATOR(pg_catalog.>=)');
        expect(tick).toContain("pg_catalog.texteq(pg_catalog.jsonb_extract_path_text(execution_value,'status'),'completed') IS DISTINCT FROM true");
        expect(tick).not.toMatch(/now_value\s*[<>-]|\)\s*>=|IS DISTINCT FROM 'completed'/);
    });

    it('commits durable reservation before execute and each result before continuation or the next iteration', () => {
        expect(tick.match(/\bCOMMIT;/g)).toHaveLength(2);
        assertOrder(tick, ['reservation_value:=sales_private.crm_first_contact_dispatch_burst_prepare()', 'COMMIT;',
            'IF reservation_value IS NULL THEN EXIT', 'execution_value:=sales_private.crm_first_contact_dispatch_execute(']);
        const afterExecution = tick.split('execution_value:=sales_private.crm_first_contact_dispatch_execute(')[1];
        assertOrder(afterExecution, ['COMMIT;', "IF pg_catalog.texteq(pg_catalog.jsonb_extract_path_text(execution_value,'status'),'completed') IS DISTINCT FROM true THEN EXIT",
            'IF NOT sales_private.crm_first_contact_dispatch_burst_continue(request_id_value) THEN EXIT', 'END LOOP']);
        expect(tick).not.toMatch(/worker_cycle|prepare_legacy|execute_legacy|SAVEPOINT|\bROLLBACK\b/);
    });
});
