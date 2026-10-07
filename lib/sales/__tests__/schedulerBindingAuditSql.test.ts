// @vitest-environment node
// Source invariants only. Native fixture catalog probes are separate from real
// Supabase owner/role/Cron binding verification and deployment authorization.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/15_scheduler_binding_audit_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const audit = code.split('AS $binding_audit$')[1].split('$binding_audit$;')[0];
const scenario = readFileSync(resolve(process.cwd(), 'sql/sales/runtime/scenarios/scheduler-binding-audit.sql'), 'utf8');
const entryNames = ['worker_cycle', 'worker_receipt', 'dispatch_prepare', 'dispatch_execute', 'dispatch_status', 'worker_tick'];

describe('withheld operator-only scheduler binding audit', () => {
    it('guards installation and rolls back without any scheduler or role mutation', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code).toContain("RAISE EXCEPTION 'DESIGN ONLY: scheduler binding audit is not authorized for database execution'");
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('CREATE FUNCTION'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(source).toContain('NEVER RUN ON SUPABASE');
        const statements = code.replace(/'(?:''|[^'])*'/g, '');
        expect(statements).not.toMatch(/\b(?:COMMIT|GRANT|CALL|DROP|TRUNCATE|COPY|ALTER)\b|CREATE (?:SCHEMA|TABLE|ROLE|USER|POLICY|EXTENSION)/);
    });

    it('creates only one private stable invoker reader with pinned settings and no ordinary caller grant', () => {
        expect(code.match(/CREATE FUNCTION/g)).toHaveLength(1);
        expect(code).toContain('CREATE FUNCTION sales_private.crm_first_contact_binding_audit()');
        expect(code).toContain("RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(code).toContain('REVOKE ALL ON FUNCTION sales_private.crm_first_contact_binding_audit() FROM PUBLIC, anon, authenticated,');
        expect(code).toContain('buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;');
        expect(code).not.toMatch(/SECURITY DEFINER|CREATE FUNCTION public\./);
    });

    it('has no runtime DDL, writes, lock, business RPC, arbitrary SQL or impersonation', () => {
        expect(audit).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|PERFORM|EXECUTE|CREATE|ALTER|DROP|GRANT|REVOKE)\s+(?:INTO|FROM|TABLE|ROLE|FUNCTION|SCHEMA|sales_private\.|public\.|cron\.)/i);
        expect(audit).not.toMatch(/FOR (?:UPDATE|SHARE)|set_config\(|current_setting\(|auth\.uid|crm_v2_role|request\.jwt|SQLERRM|MESSAGE_TEXT|clock_timestamp|pg_sleep|pg_advisory/);
        expect(audit).not.toMatch(/(?:FROM|JOIN) (?:public|sales_private)\./);
    });

    it('always withholds caller, source, owner and real top-level Cron validation', () => {
        expect(audit).toContain("'contractVersion','first_contact_binding_audit_v1','observedAt',statement_timestamp()");
        for (const key of ['automationReady', 'callerBindingValidated', 'sourceIntegrityValidated', 'completeDatabaseSecurityAudit', 'futureObjectsValidated']) {
            expect(audit).toContain(`'${key}',false`);
            expect(audit).not.toContain(`'${key}',true`);
        }
        for (const blocker of ['CRON_CALLER_BINDING_NOT_VALIDATED', 'SOURCE_INTEGRITY_NOT_VALIDATED',
            'FUNCTION_OWNER_REVIEW_REQUIRED', 'STAGING_TOP_LEVEL_CALL_NOT_VALIDATED', 'KNOWN_CATALOG_SCOPE_ONLY']) {
            expect(audit).toContain(`'${blocker}'`);
        }
        expect(audit).toContain("'functionOwnerReviewRequired',true");
        expect(audit).toContain('NOLOGIN is not a usable Cron connection');
    });
});

describe('known routine identity and role-boundary catalog inspection', () => {
    it('matches exact catalog argument names without fragile missing-composite regprocedure casts', () => {
        expect(audit).toContain('unnest(p.proargtypes::oid[]) WITH ORDINALITY');
        expect(audit).toContain("n.nspname::text||'.'||t.typname::text");
        expect(audit).toContain('ORDER BY a.position)=expected.args');
        expect(audit).not.toMatch(/to_regprocedure|::regprocedure|::regtype|pg_get_functiondef|prosrc|probin|rolpassword/);
        expect(audit).toContain('IF matching_count<>1 THEN');
        expect(audit).toContain("'known',false");
        expect(audit).toContain("'metadataMatches',NULL,'expectedRoleDirectExecute',NULL,'expectedRoleEffectiveExecute',NULL");
    });

    it('covers all six actual worker and dispatcher entry signatures plus core and private projections', () => {
        for (const key of entryNames) expect(audit).toContain(`('${key}','crm_first_contact_${key}'`);
        expect(audit).toContain("('worker_tick','crm_first_contact_worker_tick',ARRAY[]::text[],'p',false,'dispatcher')");
        expect(audit).toContain("('shared_core','crm_first_contact_apply',ARRAY['public.crm_settings','public.sales_customers','public.crm_sla_tasks'");
        expect(audit).toContain("'sales_private.crm_work_calendars','pg_catalog.bool','pg_catalog.uuid','pg_catalog.text','pg_catalog.text','pg_catalog.uuid'");
        for (const key of ['worker_child_projection', 'worker_cycle_projection', 'dispatch_projection', 'dispatch_history_guard', 'history_immutable']) {
            expect(audit).toContain(`('${key}','crm_first_contact_${key}'`);
        }
        expect(audit).toContain("'expectedRoutines',12");
    });

    it('checks routine kind, definer mode, exact path, entry UTC and no procedure SET clause', () => {
        expect(audit).toContain('routine_row.prokind::text=expected.kind AND routine_row.prosecdef=expected.definer');
        expect(audit).toContain("WHEN expected.kind='p' THEN routine_row.proconfig IS NULL");
        expect(audit).toContain("'search_path=pg_catalog'=ANY(routine_row.proconfig)");
        expect(audit).toContain("lower(c.value)='timezone=utc'");
        expect(audit).toContain('IF NOT metadata_matches OR named_count<>1');
        expect(audit).toContain("'ownerReviewRequired',true");
        expect(audit).not.toMatch(/'ownerTrusted'|'bodyVerified'|'safeToRun'/);
    });

    it('separates direct ACL grants, effective EXECUTE and schema access instead of accepting dormant exposure', () => {
        expect(audit).toContain("aclexplode(COALESCE(routine_row.proacl,acldefault('f',routine_owner)))");
        expect(audit).toContain("a.grantee=principal_id AND a.privilege_type='EXECUTE'");
        expect(audit).toContain("effective_allowed:=has_function_privilege(principal_id,object_id,'EXECUTE')");
        expect(audit).toContain("has_schema_privilege(principal_id,private_schema,'USAGE')");
        expect(audit).toContain("has_schema_privilege(principal_id,private_schema,'CREATE')");
        expect(audit).toContain('IF NOT direct_allowed OR NOT effective_allowed');
        expect(audit).toContain('IF schema_usage IS DISTINCT FROM true');
    });

    it('inspects PUBLIC and all three app principals including inherited or settable membership', () => {
        expect(audit).toContain("ARRAY['public','anon','authenticated','service_role']");
        expect(audit).toContain('a.grantee=COALESCE(principal_id,0::oid)');
        expect(audit).toContain("pg_has_role(principal_id,worker_id,'MEMBER')");
        expect(audit).toContain("pg_has_role(principal_id,dispatcher_id,'MEMBER')");
        expect(audit).toContain("has_function_privilege(principal_id,p.oid,'EXECUTE')");
        expect(audit).toContain("'directRoutineExecuteCount',NULL,'effectiveRoutineExecuteCount',NULL");
        expect(audit).toContain("'unknownUntrustedPrincipals',4-known_principals");
    });

    it('requires dormant least-privilege roles and reports membership in both directions', () => {
        for (const attribute of ['rolcanlogin', 'rolinherit', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) {
            expect(audit).toContain(`role_row.${attribute}`);
        }
        expect(audit).toContain('FROM pg_auth_members WHERE roleid=principal_id');
        expect(audit).toContain('FROM pg_auth_members WHERE member=principal_id');
        expect(audit).toContain('IF NOT metadata_matches OR member_count>0 OR parent_count>0');
        expect(audit).toContain("'connectionBindingEstablished',false");
        expect(audit).toContain("'attributesMatch',NULL");
    });

    it('detects worker or dispatcher execution outside their own known entry allowlist', () => {
        expect(audit).toContain("expected.allowed_role IS DISTINCT FROM 'worker' AND has_function_privilege(worker_id,object_id,'EXECUTE')");
        expect(audit).toContain("expected.allowed_role IS DISTINCT FROM 'dispatcher' AND has_function_privilege(dispatcher_id,object_id,'EXECUTE')");
        expect(audit).toContain("'unexpectedWorkerExecute',worker_leak,'unexpectedDispatcherExecute',dispatcher_leak");
    });

    it('detects role grants with propagation authority rather than accepting EXECUTE with grant option', () => {
        expect(audit).toContain('SELECT a.is_grantable FROM pg_proc p');
        expect(audit).toContain('SELECT a.is_grantable FROM pg_namespace n');
        expect(audit).toContain('grants WHERE is_grantable');
        expect(audit).toContain("'directRoutineOrSchemaGrantOptionCount',grant_option_count");
    });
});

describe('bounded table and default privilege risk signals', () => {
    it('checks known business, receipt and control tables without reading any rows', () => {
        expect(audit).toContain("'expectedTables',18");
        for (const name of ['crm_settings', 'sales_customers', 'crm_sla_tasks', 'crm_notifications', 'crm_audit_events',
            'lead_activities', 'crm_work_periods', 'crm_user_roles', 'crm_work_calendars', 'crm_work_calendar_versions',
            'crm_first_contact_processing_requests', 'crm_first_contact_cycle_requests', 'crm_first_contact_cycle_cursor',
            'crm_first_contact_worker_requests', 'crm_first_contact_worker_cycles', 'crm_first_contact_dispatch_requests',
            'crm_first_contact_dispatch_attempts', 'crm_first_contact_dispatch_control']) {
            expect(audit).toContain(`'${name}'`);
        }
        expect(audit).toContain("c.relkind IN ('r','p')");
        expect(audit).not.toMatch(/SELECT \* FROM (?:public|sales_private)\./);
    });

    it('detects both table-wide and column-only exposure while absent objects remain null', () => {
        for (const role of ['worker_id', 'dispatcher_id']) {
            expect(audit).toContain(`has_table_privilege(${role},object_id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`);
            expect(audit).toContain(`has_any_column_privilege(${role},object_id,'SELECT,INSERT,UPDATE,REFERENCES')`);
            expect(audit).toContain(`CASE WHEN object_id IS NULL OR ${role} IS NULL THEN NULL`);
        }
    });

    it('labels relevant explicit default ACL risks and implicit future function PUBLIC defaults conservatively', () => {
        expect(audit).toContain('d.defaclrole=ANY(owner_ids)');
        expect(audit).toContain('d.defaclnamespace=0 OR d.defaclnamespace IN (private_schema,public_schema)');
        expect(audit).toContain("d.defaclobjtype IN ('f','r','S','n')");
        expect(audit).toContain("pg_has_role(r.oid,a.grantee,'MEMBER')");
        expect(audit).toContain("'ownerScopeComplete',missing_routines=0");
        expect(audit).toContain("'functionCreationRequiresExplicitRevoke',true,'futureObjectsValidated',false");
        expect(audit).toContain('CASE WHEN cardinality(owner_ids)>0 THEN default_acl_hazards ELSE NULL END');
        expect(source).toContain('Default PUBLIC function EXECUTE also exists implicitly');
    });

    it('never exposes identifiers, raw definitions, passwords, source rows or command text', () => {
        expect(audit).not.toMatch(/to_jsonb\(|pg_get_functiondef|prosrc|probin|rolpassword|SQLERRM|MESSAGE_TEXT/);
        expect(audit).not.toMatch(/'ownerId'|'ownerName'|'roleOid'|'command'|'body'|'password'|'customerName'|'phone'|'income'/);
        expect(audit).toContain('Findings never change permissions.');
        expect(audit).toContain("'scope','observed_routine_owners_global_and_known_schemas'");
    });
});

describe('isolated native catalog scenario contract', () => {
    it('guards database prefix marker and loopback before creating disposable fixtures', () => {
        expect(scenario.trim()).toMatch(/^--/);
        expect(scenario).toContain("current_database() !~ '^buildtrack_sales_runtime_'");
        expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'");
        expect(scenario).toContain("inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet");
        expect(scenario.indexOf('REFUSED:')).toBeLessThan(scenario.indexOf('CREATE SCHEMA'));
        expect(scenario.trim()).toMatch(/ROLLBACK;$/);
    });

    it('rolls every unsafe probe back and compares original business and catalog snapshots', () => {
        expect(scenario).toContain("RAISE SQLSTATE 'ZB001'");
        expect(scenario).toContain("EXCEPTION WHEN SQLSTATE 'ZB001' THEN NULL");
        expect(scenario).toContain('runtime_binding.business_snapshot()=(SELECT value');
        expect(scenario).toContain('runtime_binding.catalog_snapshot()=(SELECT value');
        expect(scenario).toContain("(sales_private.crm_first_contact_binding_audit()-'observedAt')");
        expect(scenario).toContain('SCHEDULER_BINDING_AUDIT_RUNTIME:');
        expect(scenario).toContain("'realCronBindingTested',false,'sourceIntegrityValidated',false");
    });

    it('exercises denied callers, bad grants, memberships, metadata and incomplete installations', () => {
        for (const probe of ['public_execute', 'app_execute', 'membership', 'inherited', 'service', 'missing_usage',
            'missing_execute', 'schema_create', 'role_attributes', 'table_access', 'column_access', 'core_access',
            'worker_bypass', 'path', 'timezone', 'definer', 'tick_set', 'tick_definer', 'wrong_kind', 'overload',
            'missing_routine', 'missing_type', 'missing_role', 'default_acl']) {
            expect(scenario).toContain(`VALUES('${probe}',runtime_binding.probe(`);
        }
        for (const role of ['anon', 'authenticated', 'buildtrack_sales_sla_worker', 'buildtrack_sales_sla_dispatcher']) {
            expect(scenario).toContain(`SET LOCAL ROLE ${role};`);
        }
    });
});
