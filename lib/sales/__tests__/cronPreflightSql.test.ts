// @vitest-environment node
// Static source invariants only: not pg_cron execution or live Supabase certification.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/12_supabase_cron_preflight_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const inventory = body('inventory');
const preflight = body('preflight');
const functions = [inventory, preflight];
const gates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
    'work_schedule_enabled', 'notifications_enabled', 'sla_preview_enabled',
    'sla_processing_enabled', 'sla_cycle_enabled'];

describe('withheld operator-only Cron preflight (static invariants)', () => {
    it('retains the execution guard before DDL and a final rollback', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code).toContain("RAISE EXCEPTION 'DESIGN ONLY: cron preparation is not authorized for database execution'");
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('CREATE FUNCTION'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(source).toContain('NEVER RUN ON SUPABASE');
        expect(code).not.toMatch(/\b(?:COMMIT|DROP|TRUNCATE|COPY|CALL)\b/);
    });

    it('creates only two private invoker functions, with pinned search paths and no caller grant', () => {
        expect(code.match(/CREATE FUNCTION sales_private\./g)).toHaveLength(2);
        expect(code.match(/STABLE SECURITY INVOKER SET search_path = pg_catalog/g)).toHaveLength(2);
        expect(code).toContain("SET timezone = 'UTC'");
        for (const name of ['crm_first_contact_cron_inventory', 'crm_first_contact_cron_preflight']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION sales_private.${name}() FROM PUBLIC, anon, authenticated;`);
        }
        expect(code).not.toMatch(/SECURITY DEFINER|CREATE FUNCTION public\.|\bGRANT\b|CREATE (?:SCHEMA|TABLE|ROLE|USER|POLICY|EXTENSION)/);
    });

    it('does not impersonate an Admin, change settings or invoke a processor or scheduler', () => {
        expect(code).not.toMatch(/auth\.uid|crm_v2_role\(|request\.jwt|set_config\(|service_role|refresh_token/i);
        expect(code).not.toMatch(/SET (?:ROLE|SESSION AUTHORIZATION)|ALTER (?:ROLE|TABLE|SYSTEM)|\b(?:INSERT|UPDATE|DELETE|MERGE)\b/);
        // Registration identifiers are inspected as catalog strings, never called.
        expect(code).not.toMatch(/(?:SELECT|PERFORM|CALL)\s+cron\./i);
        expect(code).not.toMatch(/(?:SELECT|PERFORM|CALL)\s+(?:public\.)?crm_v2_process_first_contact/i);
        expect(code).not.toMatch(/\b(?:net\.http|pg_sleep|pg_advisory|pg_try_advisory|gen_random_uuid)/);
        for (const target of functions) expect(target).not.toMatch(/FOR (?:UPDATE|SHARE)|clock_timestamp\(/);
    });

    it('never presents an inventory snapshot or enabled flags as activation approval', () => {
        expect(preflight).toContain("'contractVersion','first_contact_cron_preflight_v1'");
        expect(preflight).toContain("'observedAt',statement_timestamp()");
        expect(preflight).toContain("'automationReady',false,'blockingReason','CRON_BINDING_NOT_VALIDATED'");
        expect(preflight).not.toMatch(/'automationReady'\s*,\s*(?:true|[a-z_]+\s*(?:AND|OR))/);
        expect(preflight).toContain('No latency or activation approval.');
        expect(preflight).toContain('Visible catalog is not verified extension ownership.');
    });
});

describe('Cron inventory visibility, authenticity and privacy (static invariants)', () => {
    it('requires an ordinary table and every expected catalog column type', () => {
        expect(inventory).toContain("relname='job'");
        expect(inventory).toContain("oid=relation_id AND relkind='r'");
        for (const [name, type] of [['jobid', 'bigint'], ['jobname', 'text'], ['command', 'text'],
            ['schedule', 'text'], ['database', 'text'], ['username', 'text'], ['active', 'boolean']]) {
            expect(inventory).toContain(`('${name}','${type}'::regtype)`);
        }
        expect(inventory).toContain('attrelid=relation_id AND attname=expected.column_name');
        expect(inventory).toContain('atttypid=expected.column_type AND attnum>0 AND NOT attisdropped');
        expect(inventory).toContain("state_value:='unexpected_catalog'");
    });

    it('distinguishes unknown counts from zero and checks current-role privileges before scanning', () => {
        expect(inventory).toContain('total_count bigint; reserved_count bigint');
        expect(inventory).toContain('active_reserved_count bigint; direct_count bigint');
        expect(inventory).toContain('rolsuper OR rolbypassrls');
        expect(inventory).toContain('FROM pg_roles WHERE rolname=current_user');
        expect(inventory).toContain("has_schema_privilege(current_user,schema_id,'USAGE')");
        expect(inventory).toContain("has_table_privilege(current_user,relation_id,'SELECT')");
        expect(inventory).toContain('bypasses_rls IS DISTINCT FROM true');
        for (const state of ['missing_catalog', 'unexpected_catalog', 'insufficient_privilege', 'partial_visibility']) {
            expect(inventory).toContain(`state_value:='${state}'`);
            expect(inventory.indexOf(`state_value:='${state}'`)).toBeLessThan(inventory.indexOf('EXECUTE $scan$'));
        }
        expect(inventory).toContain("'inventoryComplete',state_value='visible'");
        expect(inventory).not.toMatch(/COALESCE|session_user|:=\s*0/);
    });

    it('scans every owner/database and includes inactive reserved-name collisions without returning commands', () => {
        const scan = inventory.split('EXECUTE $scan$')[1].split('$scan$')[0];
        expect(scan).toContain("count(*) FILTER (WHERE jobname='buildtrack-sales-first-contact-v1')");
        expect(scan).toContain("count(*) FILTER (WHERE jobname='buildtrack-sales-first-contact-v1' AND active)");
        expect(scan).toMatch(/FROM cron\.job\s*$/);
        expect(scan).not.toMatch(/current_database|current_user|username\s*=|database\s*=|FROM cron\.job\s+WHERE/i);
        const response = inventory.split('RETURN jsonb_build_object')[1];
        for (const key of ['jobCount', 'reservedNameCount', 'activeReservedNameCount', 'knownCommandCount']) {
            expect(response).toContain(`'${key}'`);
        }
        expect(response).not.toMatch(/'command'|'username'|'database'|'schedule'|'jobid'|jsonb_agg|to_jsonb/);
    });

    it('labels textual command detection as known-only rather than proof of no competing scheduler', () => {
        expect(inventory).toContain("position('crm_v2_process_first_contact' IN lower(command))>0");
        expect(inventory).toContain("position('crm_first_contact_worker_cycle' IN lower(command))>0");
        expect(inventory).toContain("position('crm_first_contact_dispatch_prepare' IN lower(command))>0");
        expect(inventory).toContain("position('crm_first_contact_dispatch_execute' IN lower(command))>0");
        expect(inventory).toContain("position('crm_first_contact_worker_tick' IN lower(command))>0");
        expect(inventory).toContain("'commandScanCoverage','known_direct_calls_only'");
        expect(code).not.toMatch(/SQLERRM|MESSAGE_TEXT|RETURNED_SQLSTATE/);
        expect(code).not.toMatch(/'noConflicts'|'safeToRegister'|'safeToActivate'/);
    });

    it('verifies catalog and registration APIs belong to pg_cron, not just lookalike object names', () => {
        expect(preflight).toContain("FROM pg_extension WHERE extname='pg_cron'");
        expect(preflight).toContain('IF extension_id IS NOT NULL THEN');
        expect(preflight).toContain("classid='pg_class'::regclass AND objid=relation_id");
        expect(preflight).toContain("refclassid='pg_extension'::regclass AND refobjid=extension_id AND deptype='e'");
        expect(preflight).toContain("register_id:=to_regprocedure('cron.schedule_in_database(text,text,text,text,text,boolean)')");
        expect(preflight).toContain("alter_id:=to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)')");
        expect(preflight).toContain('register_id IS NOT NULL AND alter_id IS NOT NULL');
        expect(preflight).toContain("count(DISTINCT objid)=2 FROM pg_depend WHERE classid='pg_proc'::regclass");
        expect(preflight).toContain('objid IN (register_id,alter_id)');
        expect(preflight).toContain("'catalogOwnedByExtension',relation_owned,'registrationApiOwnedByExtension',api_owned");
        expect(preflight).toContain("relation_owned boolean:=false; api_owned boolean:=false");
    });
});

describe('existing flags and bounded candidate counts (static invariants)', () => {
    it('keeps missing or RLS-filtered settings/candidates unknown and never changes flags', () => {
        expect(preflight).toContain('settings_value jsonb:=NULL');
        expect(preflight).toContain('settings_visible boolean:=false; candidates_visible boolean:=false');
        expect(preflight).toContain('candidate_count integer:=NULL; minimum_cycles integer:=NULL; exact_count boolean:=NULL');
        expect(preflight).toContain("IF bypasses_rls AND has_schema_privilege(current_user,'public','USAGE') THEN");
        expect(preflight).toContain("has_table_privilege(current_user,'public.crm_settings','SELECT')");
        expect(preflight).toContain("has_table_privilege(current_user,'public.crm_sla_tasks','SELECT')");
        expect(preflight).toContain('settings_visible:=FOUND');
        expect(preflight).toContain("'allExistingGatesEnabled',CASE WHEN settings_visible THEN");
        expect(preflight).toContain('ELSE NULL END');
        for (const gate of gates) expect(preflight).toContain(`settings_row.${gate}`);
        expect(preflight).not.toMatch(/COALESCE|(?:enabled\s*=\s*true)/);
    });

    it('matches only SQL11 central open source-free candidates with a 901-row lower-bound sample', () => {
        expect(preflight).toContain("task_type='first_contact' AND project_interest_id IS NULL");
        expect(preflight).toContain("source_activity_id IS NULL AND status='open' ORDER BY created_at,id LIMIT 901");
        expect(preflight).toContain('exact_count:=candidate_count<901');
        expect(preflight).toContain('minimum_cycles:=(candidate_count+9)/10');
        expect(preflight).toContain("'cycleCandidates',jsonb_build_object('known',candidates_visible,'sampleCount',candidate_count");
        expect(preflight).toContain("'countIsExact',exact_count,'sampleLimit',901");
        expect(preflight).toContain("'minimumCyclesAtCurrentCap',minimum_cycles,'maxItemsPerCycle',10");
        expect(preflight).toContain('Candidate tasks include held and not-due work.');
        expect(preflight).not.toMatch(/'eligible(?:Count|Notifications|Tasks)'|staff_due_at\s*[<>]|notify_at\s*[<>]|crm_first_contact_clock\(/i);
    });

    it('does not read customer PII, calendars, raw receipts or move the processing cursor', () => {
        expect(code).not.toMatch(/sales_customers|crm_work_calendars|crm_work_periods|crm_first_contact_cycle_cursor/);
        expect(code).not.toMatch(/crm_first_contact_processing_requests|crm_first_contact_cycle_requests|crm_notifications|crm_audit_events/);
        expect(code).not.toMatch(/\b(?:phone|income|customer_name|request_payload|evaluation_snapshot|contact_notes)\b/);
    });
});
