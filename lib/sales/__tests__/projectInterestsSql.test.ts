// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('sql/sales/24_project_interests_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('command'), context = body('context');

describe('withheld add-project-interest SQL (source checks, not live database proof)', () => {
  it('is guarded, rollback-only and default off behind existing central work gates', () => {
    expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
    expect(source).toContain('NEVER RUN ON SUPABASE');
    expect(code).toContain('project_interests_enabled boolean NOT NULL DEFAULT false');
    expect(body('capabilities')).toContain("'contract_version','project_interests_v1'");
    expect(body('capabilities')).toContain('central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND project_interests_enabled');
    expect(code).not.toMatch(/cron\.|pg_net|ALTER SYSTEM|DISABLE TRIGGER|TRUNCATE|DROP TABLE/);
  });
  it('reuses one central identity and changes only interest audit and receipt data', () => {
    expect(command).toContain('INSERT INTO public.lead_project_interests');
    expect(command).toContain('INSERT INTO public.crm_audit_events');
    expect(command).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:sales_customers|sales|plots|leads|lead_visits|lead_appointments|crm_next_actions|crm_sla_tasks|crm_notifications)\b/);
    expect(command).toContain("VALUES(c.id,project_value,c.owner_user_id,actor_id,plot_value,'central_interest','new',server_now,server_now,server_now,server_now)");
    expect(command).not.toMatch(/activated_at\s*=|lead_created_at\s*=|lifecycle_revision\s*=/);
  });
  it('uses exact bounded inputs and preserves existing text primary keys', () => {
    expect(command).toContain('octet_length(p_payload::text)>16384');
    expect(command).toContain("ARRAY['customerId','expectedCustomerRevision','projectName','plotId','reason']");
    expect(command).toContain('jsonb_object_keys(p_payload)');
    expect(command).toContain("sales_private.crm_work_text(p_payload->>'reason',1000)");
    expect(command).toContain("project_value:=p_payload->>'projectName'");
    expect(command).toContain("plot_value:=p_payload->>'plotId'");
    expect(command).not.toMatch(/project_value\s*:=\s*(?:btrim|trim|lower)|plot_value\s*:=\s*(?:btrim|trim|lower)/);
    expect(command).toContain("length(project_value)>200"); expect(command).toContain('length(plot_value)>255');
  });
  it('locks customer then current roles before replay and project/plot validation', () => {
    const customer = command.indexOf('FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE');
    const roles = command.indexOf('ORDER BY user_id FOR SHARE');
    const replay = command.indexOf("RETURN receipt.response||jsonb_build_object('replayed',true)");
    const project = command.indexOf('FROM public.projects WHERE name=project_value AND is_closed IS NOT TRUE FOR SHARE');
    const plot = command.indexOf('FROM public.plots WHERE id=plot_value');
    expect(customer).toBeLessThan(roles); expect(roles).toBeLessThan(replay); expect(replay).toBeLessThan(project); expect(project).toBeLessThan(plot);
    expect(command.indexOf('actor_id<>c.owner_user_id) OR NOT owner_active')).toBeLessThan(replay);
    expect(command).toContain('c.lifecycle_revision IS DISTINCT FROM expected_revision');
    expect(command).toContain("c.merged_into_customer_id IS NOT NULL OR c.intake_status='lost'");
    expect(command).toContain("CRM_INTERESTS_PROJECT_EXISTS");
    expect(command).not.toMatch(/user_metadata|request\.jwt|p_owner|p_actor/);
  });
  it('selects only explicitly vacant matching-project plots without reserving them', () => {
    expect(command).toContain('project_name=project_value AND has_customer IS FALSE');
    expect(command).toContain("COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled'");
    expect(command).toContain("CRM_INTERESTS_PLOT_UNAVAILABLE");
    expect(command).not.toMatch(/UPDATE public\.plots|INSERT INTO public\.sales\b/);
  });
  it('stores immutable private receipts and one auditable reason atomically', () => {
    expect(body('protect_receipt')).toContain("IF TG_OP<>'INSERT'");
    expect(body('protect_receipt')).toContain('transaction_id=txid_current() AND backend_pid=pg_backend_pid()');
    expect(code).toContain('FROM PUBLIC,anon,authenticated;');
    expect(command).toContain("'project_interest_added',reason_value");
    expect(command).toContain('INSERT INTO sales_private.project_interest_write_permits VALUES(txid_current(),pg_backend_pid())');
    expect(command).toContain('INSERT INTO sales_private.project_interest_command_requests');
    expect(command).toContain('DELETE FROM sales_private.project_interest_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()');
    expect(command).not.toMatch(/set_config\(|\bCOMMIT\b|\bROLLBACK\b/);
  });
  it('reads all-project minimal contexts with explicit project and interest truncation', () => {
    expect(context).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)/i);
    expect(context).toContain('LIMIT 201'); expect(context).toContain('LIMIT 51 OFFSET p_page*50');
    expect(context).toContain("'projectsHasMore',projects_more"); expect(context).toContain("'hasMore',interests_more");
    expect(context).toContain("'canAdd',(actor_role='admin'");
    expect(context).toContain("c.intake_status<>'lost'"); expect(context).toContain("role='sales' AND is_active");
    expect(context).not.toMatch(/monthly_income|personal_data|phone|crm_answers|token_hash|notes/);
  });
  it('includes synthetic rollback, read-only and independent-session conflict coverage', () => {
    const scenario = readFileSync('sql/sales/runtime/scenarios/project-interests.sql', 'utf8');
    expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true)");
    expect(scenario).toContain('SET TRANSACTION READ ONLY;'); expect(scenario).toContain('SYNTHETIC_INJECTED_FAILURE');
    for (const marker of ['INTERESTS_RUNTIME:', 'INTERESTS_SNAPSHOT:', 'INTERESTS_INPUT:', 'INTERESTS_RESULT:']) expect(scenario).toContain(marker);
    expect(scenario).not.toMatch(/DISABLE TRIGGER|session_replication_role|DROP CONSTRAINT/);
    const races = readFileSync('scripts/sales-runtime/project-interests-concurrency.mjs', 'utf8');
    expect(races).toContain("wait_event_type='Lock'"); expect(races).toContain('distinct add commands compete for same customer project');
    expect(races).toContain('central owner reassignment wins before waiting add'); expect(races).toContain('central lost closure wins before waiting add');
    expect(races).toContain('booking commits before waiting interested-plot save');
    expect(races).not.toMatch(/process\.env|dotenv|supabase-js|DISABLE TRIGGER/);
  });
  it('registers a focused synthetic run with actual contract projection and cleanup', () => {
    const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
    expect(runner).toContain("options.at(-1) === '--project-interests-only'");
    expect(runner).toContain("projectInterestsOnly ? 'project-interests-only'");
    expect(runner).toContain('if (!centralSearchOnly && !visitsOnly && !projectInterestsOnly && !visitSopOnly && !customerVoicesOnly)');
    expect(runner).toContain('report.results.projectInterests.projectionParity = true');
    expect(runner).toContain('await runProjectInterestsConcurrency({ query })');
    expect(runner.indexOf('await identity(database)')).toBeLessThan(runner.indexOf("const path = 'sql/sales/24_project_interests_draft.sql'"));
    expect(runner).toContain('await stopOwnedCluster()');
  });
});
