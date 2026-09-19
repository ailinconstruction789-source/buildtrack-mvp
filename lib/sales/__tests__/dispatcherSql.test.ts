// @vitest-environment node
// STATIC source assertions only. They do not execute SQL, certify production
// pg_cron transaction behavior or authorize a job/role/feature deployment.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/14_first_contact_dispatcher_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const compact = code.replace(/\s+/g, ' ');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const prepare = body('dispatch_prepare');
const execute = body('dispatch_execute');
const status = body('dispatch_status');
const projection = body('dispatch_projection');
const historyGuard = body('history_guard');
const tick = body('worker_tick');
const readGates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
    'work_schedule_enabled', 'notifications_enabled', 'sla_preview_enabled'];
const writeGates = ['sla_processing_enabled', 'sla_cycle_enabled', 'sla_worker_enabled', 'sla_dispatcher_enabled'];
const assertOrder = (value: string, fragments: string[]) => {
    const positions = fragments.map(fragment => value.indexOf(fragment));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
};

describe('withheld dispatcher capability and state (static only)', () => {
    it('raises before role/table changes, defaults off and retains the draft rollback', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        assertOrder(code, ["RAISE EXCEPTION 'DESIGN ONLY:", 'CREATE ROLE ', 'ALTER TABLE public.crm_settings']);
        expect(code).toContain('ADD COLUMN sla_dispatcher_enabled boolean NOT NULL DEFAULT false');
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).not.toMatch(/\b(?:DROP|TRUNCATE|COPY|CREATE EXTENSION)\b|sla_dispatcher_enabled\s*=\s*true|cron\.|pg_net|net\.http/i);
        expect(source).toContain('NEVER RUN ON SUPABASE');
        expect(source).toContain('LOCAL DRAFT TEST POLICY');
    });

    it('creates only a fresh least-privilege NOLOGIN role and never binds a caller or credentials', () => {
        assertOrder(code, ["IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buildtrack_sales_sla_dispatcher')",
            "RAISE EXCEPTION 'CRM_SLA_DISPATCH_ROLE_COLLISION'", 'CREATE ROLE buildtrack_sales_sla_dispatcher']);
        expect(compact).toContain('CREATE ROLE buildtrack_sales_sla_dispatcher NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
        expect(code).not.toMatch(/ALTER ROLE|GRANT\s+buildtrack_sales_sla_dispatcher|GRANT\s+authenticated|PASSWORD|auth\.uid|crm_v2_role|request\.jwt|service_role|service[_-]?key|set_config\(|SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION/i);
    });

    it('grants only schema usage and prepare/execute/status/procedure capabilities', () => {
        const grants = code.match(/\bGRANT\s+[\s\S]*?;/g)?.map(statement => statement.replace(/\s+/g, ' '));
        expect(grants).toEqual([
            'GRANT USAGE ON SCHEMA sales_private TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_status(uuid) TO buildtrack_sales_sla_dispatcher;',
            'GRANT EXECUTE ON PROCEDURE sales_private.crm_first_contact_worker_tick() TO buildtrack_sales_sla_dispatcher;',
        ]);
        expect(code).not.toMatch(/CREATE POLICY|ALTER DEFAULT PRIVILEGES|CREATE FUNCTION public\./);
        for (const signature of ['crm_first_contact_dispatch_prepare()', 'crm_first_contact_dispatch_execute(uuid,uuid)',
            'crm_first_contact_dispatch_status(uuid)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION sales_private.${signature} FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;`);
        }
        expect(code).toContain('REVOKE ALL ON PROCEDURE sales_private.crm_first_contact_worker_tick() FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;');
        expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION sales_private\.crm_first_contact_(?:apply|worker_cycle|worker_receipt)/);
    });

    it('requires ten processing gates and retains six-gate read-only historical status', () => {
        for (const gate of readGates) {
            expect(prepare).toContain(`settings_row.${gate}`);
            expect(execute).toContain(`settings_row.${gate}`);
            expect(status).toContain(gate);
        }
        for (const gate of writeGates) {
            expect(prepare).toContain(`settings_row.${gate}`);
            expect(execute).toContain(`settings_row.${gate}`);
            expect(status).not.toContain(gate);
        }
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'/g)).toHaveLength(3);
    });

    it('protects all three private dispatcher tables with RLS and no direct role grants', () => {
        for (const table of ['crm_first_contact_dispatch_control', 'crm_first_contact_dispatch_requests', 'crm_first_contact_dispatch_attempts']) {
            expect(code).toContain(`CREATE TABLE sales_private.${table}`);
            expect(code).toContain(`ALTER TABLE sales_private.${table} ENABLE ROW LEVEL SECURITY;`);
        }
        expect(compact).toContain('REVOKE ALL ON sales_private.crm_first_contact_dispatch_control, sales_private.crm_first_contact_dispatch_requests, sales_private.crm_first_contact_dispatch_attempts FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;');
        expect(code).toContain('id boolean PRIMARY KEY DEFAULT true CHECK (id)');
        expect(code).toContain('INSERT INTO sales_private.crm_first_contact_dispatch_control(id) VALUES(true)');
    });

    it('retains immutable request identity, terminal history and immutable fenced attempts', () => {
        expect(historyGuard).toContain("IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT'");
        expect(historyGuard).toContain("OLD.status IN ('completed','review')");
        expect(historyGuard).toContain('NEW.request_id IS DISTINCT FROM OLD.request_id');
        expect(historyGuard).toContain('NEW.created_at IS DISTINCT FROM OLD.created_at');
        expect(code).toContain('BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_dispatch_requests');
        expect(code).toContain('BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_dispatch_attempts');
        expect(code).toContain('EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable()');
        expect(code).toContain('prepared_xid xid8 NOT NULL');
        expect(code).toContain('UNIQUE(request_id,attempt_no)');
        expect(code).toContain('DEFERRABLE INITIALLY DEFERRED');
        expect(code).toContain('FOREIGN KEY (current_attempt_id) REFERENCES sales_private.crm_first_contact_dispatch_attempts(attempt_id)');
        expect(code).toContain("CHECK ((status='completed')=(completed_at IS NOT NULL))");
    });
});

describe('durable reservation and bounded crash recovery (static only)', () => {
    it('takes settings, shared dispatcher lane and singleton locks in the same order in both phases', () => {
        for (const target of [prepare, execute]) {
            assertOrder(target, ['FROM public.crm_settings WHERE id FOR SHARE', 'CRM_SLA_DISPATCH_SETUP_REQUIRED',
                "pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global'",
                'FROM sales_private.crm_first_contact_dispatch_control WHERE id FOR UPDATE']);
            expect(target).toContain("IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global',0)) THEN RETURN NULL; END IF");
        }
        expect(code.match(/SET lock_timeout = '500ms'/g)).toHaveLength(2);
        expect(code).not.toMatch(/SET statement_timeout|SKIP LOCKED|pg_sleep/);
    });

    it('has no caller-supplied reservation clock or request identity and never works during prepare', () => {
        expect(code).toContain('CREATE FUNCTION sales_private.crm_first_contact_dispatch_prepare()');
        expect(prepare).toContain('now_value:=clock_timestamp()');
        expect(prepare).toContain('attempt_id_value:=gen_random_uuid()');
        expect(prepare).toContain('request_id_value:=gen_random_uuid(); attempt_number:=1');
        expect(prepare).not.toMatch(/crm_first_contact_worker_cycle\(|crm_first_contact_apply\(|p_request|p_now|p_clock|p_limit/);
    });

    it('holds review, completed spacing, unexpired reservations and backoff before creating new attempts', () => {
        assertOrder(prepare, ["IF request_row.status='review' THEN RETURN NULL", "ELSIF request_row.status='completed'",
            "IF now_value<request_row.completed_at+interval '60 seconds' THEN RETURN NULL", 'IF now_value<request_row.next_attempt_at THEN RETURN NULL',
            'IF request_row.attempt_count>=5', 'attempt_id_value:=gen_random_uuid()']);
        expect(prepare).toContain("SET status='review',last_error_code='RETRY_LIMIT'");
        expect(prepare).toContain('next_attempt_at=now_value WHERE request_id=current_id');
        expect(prepare).not.toMatch(/status='review'[\s\S]*?SET status='completed'/);
    });

    it('creates a new request only initially or after completion spacing and rejects retained receipt collisions', () => {
        expect(prepare).toContain('IF current_id IS NULL THEN create_request:=true');
        expect(prepare.match(/create_request:=true/g)).toHaveLength(2);
        assertOrder(prepare, ['request_id_value:=gen_random_uuid(); attempt_number:=1',
            'FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=request_id_value',
            'FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=request_id_value',
            "RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT'", 'INSERT INTO sales_private.crm_first_contact_dispatch_requests']);
        expect(prepare).toContain('UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=request_id_value WHERE id');
        expect(prepare).not.toMatch(/\bLOOP\b|\bCONTINUE\b/);
    });

    it('counts every committed reservation before work and fences retries using a new attempt with the same request', () => {
        expect(prepare).toContain('request_id_value:=current_id; attempt_number:=request_row.attempt_count+1');
        expect(prepare).toContain("SET status='reserved',attempt_count=attempt_number");
        expect(prepare).toContain("current_attempt_id=attempt_id_value,next_attempt_at=now_value+interval '60 seconds',last_error_code=NULL");
        expect(prepare).toContain('INSERT INTO sales_private.crm_first_contact_dispatch_attempts(attempt_id,request_id,attempt_no,prepared_at,prepared_xid)');
        expect(prepare).toContain('VALUES(attempt_id_value,request_id_value,attempt_number,now_value,pg_current_xact_id())');
        expect(prepare).toContain("RETURN jsonb_build_object('requestId',request_id_value,'attemptId',attempt_id_value,'attemptNumber',attempt_number)");
    });

    it('requires finite server time and rejects backwards time rather than resetting request age', () => {
        for (const target of [prepare, execute]) {
            expect(target).toContain('NOT isfinite(now_value)');
            expect(target).toContain('now_value<minimum_at');
            expect(target).toContain('now_value<request_row.created_at');
        }
        expect(prepare).toContain("now_value>maximum_at-interval '60 seconds'");
        expect(execute).toContain('now_value<attempt_row.prepared_at');
        expect(execute).toContain("now_value>maximum_at-interval '480 seconds'");
    });
});

describe('fenced execution and transaction boundaries (static only)', () => {
    it('requires exact current request and retained attempt from a different committed top-level transaction', () => {
        expect(execute).toContain("IF p_request_id IS NULL OR p_attempt_id IS NULL THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT'");
        assertOrder(execute, ['current_id IS DISTINCT FROM p_request_id',
            'request_row.current_attempt_id IS DISTINCT FROM p_attempt_id',
            'FROM sales_private.crm_first_contact_dispatch_attempts WHERE attempt_id=p_attempt_id',
            'attempt_row.request_id IS DISTINCT FROM current_id',
            'attempt_row.prepared_xid=pg_current_xact_id()', "IF request_row.status IN ('completed','review')",
            'receipt_value:=sales_private.crm_first_contact_worker_cycle(current_id)']);
        expect(execute).toContain('attempt_row.attempt_no IS DISTINCT FROM request_row.attempt_count');
        expect(execute).toContain("RAISE EXCEPTION 'CRM_SLA_DISPATCH_STALE_ATTEMPT'");
        expect(execute).toContain("RAISE EXCEPTION 'CRM_SLA_DISPATCH_NOT_COMMITTED'");
    });

    it('checks lease and state before work so direct calls cannot bypass prepare holds', () => {
        assertOrder(execute, ["IF request_row.status IN ('completed','review')",
            "IF request_row.status<>'reserved' OR now_value>=request_row.next_attempt_at", 'receipt_value:=sales_private.crm_first_contact_worker_cycle(current_id)']);
        const held = execute.split("IF request_row.status<>'reserved'")[1].split('END IF;')[0];
        expect(held).toContain('RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id)');
        expect(held).not.toMatch(/worker_cycle|\bUPDATE\b|\bINSERT\b/);
        const afterWorker = execute.split('receipt_value:=sales_private.crm_first_contact_worker_cycle(current_id)')[1];
        expect(afterWorker).not.toContain('now_value>=request_row.next_attempt_at');
    });

    it('invokes one existing system cycle with the same request and does not duplicate business processing', () => {
        expect(execute.match(/crm_first_contact_worker_cycle\(/g)).toHaveLength(1);
        expect(execute).toContain('receipt_value:=sales_private.crm_first_contact_worker_cycle(current_id)');
        expect(execute).not.toMatch(/gen_random_uuid|crm_first_contact_apply|crm_first_contact_clock|crm_first_contact_completion|crm_v2_process_first_contact/);
        expect(code).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\./);
        expect(code).not.toMatch(/UPDATE sales_private\.crm_first_contact_cycle_cursor|INSERT INTO sales_private\.crm_first_contact_worker_cycles/);
    });

    it('validates receipt identity and atomically completes with post-work spacing inside the exception block', () => {
        expect(execute).toContain("receipt_value->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')");
        expect(execute).toContain("receipt_value->>'requestId' IS DISTINCT FROM current_id::text");
        expect(execute).toContain('NOT isfinite(completed_value) OR completed_value<now_value');
        expect(execute).toContain("completed_value>maximum_at-interval '60 seconds'");
        const operation = execute.split('  BEGIN')[1].split('  EXCEPTION')[0];
        assertOrder(operation, ['receipt_value:=sales_private.crm_first_contact_worker_cycle(current_id)',
            'completed_value:=clock_timestamp()', "SET status='completed',completed_at=completed_value",
            "next_attempt_at=completed_value+interval '60 seconds',last_error_code=NULL WHERE request_id=current_id"]);
        expect(execute).not.toMatch(/\bCOMMIT\b|\bROLLBACK\b|\bSAVEPOINT\b/);
    });

    it('propagates cancellation and connection uncertainty instead of falsely recording known failure', () => {
        expect(execute).toMatch(/WHEN query_canceled OR assert_failure OR SQLSTATE '08000'/);
        for (const state of ['08003', '08006', '57P01', '57P02', '57P03', '57P04']) {
            expect(execute).toContain(`SQLSTATE '${state}'`);
        }
        assertOrder(execute, ['WHEN query_canceled', "SQLSTATE '57P04' THEN RAISE", 'WHEN OTHERS THEN']);
        expect(execute.match(/EXCEPTION\s+WHEN/g)).toHaveLength(1);
    });

    it('retries only known transient faults with bounded backoff and never stores raw diagnostics', () => {
        expect(execute).toContain("transient_failure:=SQLSTATE IN ('55P03','40P01','40001')");
        expect(execute).toContain("OR (SQLSTATE='P0001' AND message_value='CRM_SLA_WORKER_BUSY')");
        expect(execute).toContain('IF transient_failure AND request_row.attempt_count<5 THEN');
        expect(execute).toContain('backoff_seconds:=LEAST(480,60*(2^(request_row.attempt_count-1))::integer)');
        expect(execute).toContain("SET status='retry_wait',last_error_code='TRANSIENT_RETRY'");
        expect(execute).toContain("last_error_code=CASE WHEN transient_failure THEN 'RETRY_LIMIT' ELSE 'PROCESSING_REVIEW' END");
        expect(execute).not.toMatch(/SQLERRM|PG_EXCEPTION_DETAIL|PG_EXCEPTION_CONTEXT|last_error_code\s*=\s*message_value|RETURN\s+message_value/);
        expect(execute.match(/message_value/g)).toHaveLength(3);
        expect(execute).not.toMatch(/\bCONTINUE\b|\bLOOP\b|attempt_count\s*=|current_request_id\s*=/);
    });

    it('projects the newly read execution state instead of using a STABLE nested lookup snapshot', () => {
        expect(execute).not.toContain('crm_first_contact_dispatch_status(');
        const tail = execute.slice(execute.lastIndexOf('  END;'));
        assertOrder(tail, ['SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests',
            'RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id)']);
    });

    it('uses an invoker procedure without SET or exception blocks and commits reservation before executing once', () => {
        const procedure = code.split('CREATE PROCEDURE sales_private.crm_first_contact_worker_tick()')[1].split('$worker_tick$;')[0];
        expect(procedure).toMatch(/^\s*LANGUAGE plpgsql SECURITY INVOKER\s+AS \$worker_tick\$/);
        expect(procedure).not.toMatch(/SECURITY DEFINER|\bSET\b|\bEXCEPTION\b|\bLOOP\b|\bWHILE\b|pg_sleep/);
        expect(tick.match(/\bCOMMIT;/g)).toHaveLength(2);
        expect(tick.match(/crm_first_contact_dispatch_execute\(/g)).toHaveLength(1);
        assertOrder(tick, ['reservation_value:=sales_private.crm_first_contact_dispatch_prepare()', 'COMMIT;',
            'IF reservation_value IS NOT NULL THEN', 'PERFORM sales_private.crm_first_contact_dispatch_execute(']);
        expect(tick.lastIndexOf('COMMIT;')).toBeGreaterThan(tick.indexOf('crm_first_contact_dispatch_execute('));
        expect(tick).toContain("pg_catalog.jsonb_extract_path_text(reservation_value,'requestId')::pg_catalog.uuid");
        expect(tick).toContain("pg_catalog.jsonb_extract_path_text(reservation_value,'attemptId')::pg_catalog.uuid");
        expect(tick).not.toMatch(/crm_first_contact_worker_cycle\(|gen_random_uuid/);
        expect(source).toContain('TOP-LEVEL CALL ONLY');
    });
});

describe('status recovery privacy (static only)', () => {
    it('is read-only and does not infer noncommit from an absent request', () => {
        expect(status).toContain('selected_id:=COALESCE(p_request_id,current_id)');
        expect(status).toContain('IF selected_id IS NULL THEN RETURN NULL');
        expect(status).toContain('IF NOT FOUND THEN RETURN NULL');
        expect(status).toContain('RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id)');
        expect(status).not.toMatch(/FOR (?:UPDATE|SHARE)|\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE)\b|clock_timestamp|worker_cycle|dispatch_prepare\(|dispatch_execute\(/);
        expect(source).toContain('NOT proof that work cannot commit');
    });

    it('returns only dispatcher status and explicit draft policy without raw worker receipts or diagnostic data', () => {
        for (const [field, column] of [['requestId', 'request_id'], ['createdAt', 'created_at'], ['status', 'status'], ['attemptCount', 'attempt_count'],
            ['attemptId', 'current_attempt_id'], ['nextAttemptAt', 'next_attempt_at'], ['completedAt', 'completed_at'], ['lastErrorCode', 'last_error_code']]) {
            expect(projection).toContain(`'${field}',p_request.${column}`);
        }
        expect(projection).toContain("'current',COALESCE(p_request.request_id=p_current,false)");
        expect(projection).toContain("'maxItemsPerCycle',10,'maxAttempts',5,'reservationSeconds',60,'minimumSpacingSeconds',60");
        expect(projection).not.toMatch(/to_json|row_to_json|receipt|phone|income|evaluation_snapshot|message_value|prepared_xid|\|\|/);
        expect(compact).toContain('REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_projection(sales_private.crm_first_contact_dispatch_requests,uuid) FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;');
    });

    it('pins timestamp rendering to UTC and exposes stable creation time for age monitoring', () => {
        const header = code.split('CREATE FUNCTION sales_private.crm_first_contact_dispatch_projection(')[1]
            .split('AS $dispatch_projection$')[0];
        expect(header).toContain("IMMUTABLE SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(projection).toContain("'createdAt',p_request.created_at");
        expect(projection).not.toMatch(/clock_timestamp|statement_timestamp|current_timestamp|observedAt|\bnow\(/i);
        expect(historyGuard).toContain('NEW.created_at IS DISTINCT FROM OLD.created_at');
    });
});
