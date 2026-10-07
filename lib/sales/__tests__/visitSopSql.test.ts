// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISIT_SOP_TEMPLATE } from '../visitSopTemplate';

const source = readFileSync('sql/sales/25_visit_sop_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('command'), context = body('context');

describe('withheld Visit SOP SQL (source checks only)', () => {
 it('is guarded, rollback-only and default-disabled behind central work plus Visit gates', () => {
  expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
  expect(source).toContain('NEVER RUN ON SUPABASE');
  expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
  expect(code).toContain('visit_sop_enabled boolean NOT NULL DEFAULT false');
  expect(body('capabilities')).toContain("'contract_version','visit_sop_v1'");
  expect(body('capabilities')).toContain('central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND visit_sop_enabled');
  expect(code).not.toMatch(/cron\.|pg_net|ALTER SYSTEM|DISABLE TRIGGER|TRUNCATE|DROP TABLE/);
 });
 it('uses all twenty-nine agreed versioned item keys and exact label snapshots', () => {
  for (const [stage, items] of Object.entries(VISIT_SOP_TEMPLATE)) {
   for (const [key, label] of items) expect(body('template')).toContain(`('${stage}','${key}','${label}',`);
  }
  expect(body('template').match(/\('stage_[ac]'/g)).toHaveLength(29);
  expect(command).toContain("'house_visit_v1','stage_a'");
  expect(command).toContain("jsonb_array_length(p_payload->'answers')<>(CASE stage_value WHEN 'stage_a' THEN 16 ELSE 13 END)");
  expect(command).toContain("count(DISTINCT value->>'key')");
  expect(command).not.toMatch(/p_payload->>'(?:template|label|actor|owner)/);
 });
 it('never substitutes SOP for actual Visit, Customer Voices, stock or followup completion', () => {
  expect(command).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:sales_customers|lead_project_interests|lead_appointments|lead_visits|customer_voices|sales|plots|leads|crm_next_actions|crm_sla_tasks|crm_notifications)\b/);
  expect(command).toContain('INSERT INTO public.house_visit_checklist_runs');
  expect(command).toContain('INSERT INTO public.house_visit_checklist_items');
  expect(command).toContain('FROM public.plots WHERE id=plot_value AND project_name=i.project_name FOR SHARE');
  expect(command).not.toMatch(/has_customer|sale_status|booking_revision/);
 });
 it('restricts all SOP mutation to the current active Sales owner, even on retries', () => {
  expect(command).toContain("actor_role IS DISTINCT FROM 'sales'");
  expect(command).toContain('actor_id<>i.owner_user_id OR NOT owner_active');
  expect(command.indexOf('actor_id<>i.owner_user_id OR NOT owner_active')).toBeLessThan(command.indexOf("RETURN receipt.response||jsonb_build_object('replayed',true)"));
  expect(command.indexOf("RETURN receipt.response||jsonb_build_object('replayed',true)")).toBeLessThan(command.indexOf("i.engagement_status='lost'"));
  expect(command).not.toMatch(/user_metadata|request\.jwt|p_actor|p_owner/);
  expect(context).toContain("'canWrite',actor_role='sales' AND actor_id=i.owner_user_id");
 });
 it('locks customer interest roles appointment Visit run in compatible order', () => {
  const positions = [
   'FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE',
   'FROM public.lead_project_interests WHERE id=interest_id_value AND customer_id=c.id FOR UPDATE',
   'ORDER BY user_id FOR SHARE',
   'FROM public.lead_appointments WHERE id=appointment_value AND project_interest_id=i.id FOR UPDATE',
   'FROM public.lead_visits WHERE id=visit_value AND project_interest_id=i.id FOR UPDATE',
   "IF command_name='start' THEN\n   IF r.id IS NOT NULL",
  ].map(fragment => command.indexOf(fragment));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(command).toContain('(appointment_input IS NULL)=(visit_input IS NULL)');
  expect(command).toContain('v.appointment_id IS DISTINCT FROM a.id');
  expect(code).toContain('checklist_run_per_appointment_idx');
 });
 it('requires exact current template set, stage progress, actual check-in and real next action', () => {
  expect(command).toContain('r.current_stage<>stage_value'); expect(command).toContain("r.current_stage<>'stage_b'");
  expect(command).toContain("v.id IS NULL OR v.checked_in_at>occurred_value");
  expect(command).toContain("x->>'result'='pending'");
  expect(command).toContain("project_interest_id=i.id AND status='open' FOR SHARE");
  expect(command).toContain('NOT isfinite(next_row.due_at)'); expect(command).toContain('next_row.owner_user_id IS DISTINCT FROM i.owner_user_id');
  expect(command).toContain("next_row.scope_key IS DISTINCT FROM 'interest:'||i.id::text");
  expect(command).toContain("length(btrim(next_row.action_text)) NOT BETWEEN 1 AND 500");
  expect(command).toContain("next_action_id=CASE WHEN command_name='complete_stage' AND stage_value='stage_c' THEN next_row.id");
 });
 it('keeps actual timestamps ordered without inferring KPI or rewriting completed stages', () => {
  for (const boundary of ['occurred_value>server_now', 'occurred_value<c.lead_created_at', 'occurred_value<latest_time', 'departed_value>occurred_value',
   'departed_value<v.checked_in_at', 'departed_value<r.stage_b_started_at', 'departed_value<r.departed_at']) expect(command).toContain(boundary);
  expect(body('protect_run')).toContain("OLD.current_stage='completed'");
  expect(body('protect_run')).toContain('NEW.stage_a_completed_at IS DISTINCT FROM OLD.stage_a_completed_at');
  expect(body('protect_item')).toContain('run_stage<>NEW.stage');
  expect(command).toContain("result IS DISTINCT FROM answer->>'result' OR reason IS DISTINCT FROM answer->>'reason'");
  expect(command).toContain("answered_by_user_id=CASE WHEN answer->>'result'='pending' THEN NULL ELSE actor_id END");
 });
 it('preserves answer provenance and appends immutable audit plus receipt atomically', () => {
  expect(command).toContain("'beforeItems',old_items,'afterItems',new_items");
  expect(command).toContain("'previousResponsibleSalesUserId',old_run->'responsible_sales_user_id'");
  expect(command).toContain('INSERT INTO sales_private.visit_sop_write_permits VALUES(txid_current(),pg_backend_pid())');
  expect(command).toContain('INSERT INTO sales_private.visit_sop_events'); expect(command).toContain('INSERT INTO public.crm_audit_events');
  expect(command).toContain('INSERT INTO sales_private.visit_sop_command_requests');
  expect(command).toContain('DELETE FROM sales_private.visit_sop_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()');
  expect(body('protect_history')).toContain("IF TG_OP<>'INSERT'");
  expect(command).not.toMatch(/set_config\(|\bCOMMIT\b|\bROLLBACK\b/);
 });
 it('keeps context read-only with bounded plots and event pages and private history detail', () => {
  expect(context).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)/i);
  expect(context).toContain('LIMIT 201'); expect(context).toContain('LIMIT 51 OFFSET p_event_page*50');
  expect(context).toContain("'plotsHasMore',plots_more"); expect(context).toContain("'eventsHasMore',events_more");
  expect(context).not.toMatch(/monthly_income|personal_data|phone|crm_answers|token_hash|beforeItems|afterItems/);
 });
 it('ships isolated rollback, read-only and actual independent-backend lock checks', () => {
  const scenario = readFileSync('sql/sales/runtime/scenarios/visit-sop.sql', 'utf8');
  expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true)"); expect(scenario).toContain('SET TRANSACTION READ ONLY;');
  expect(scenario).toContain('SYNTHETIC_INJECTED_FAILURE'); expect(scenario).toContain('FOR n IN 1..50 LOOP');
  for (const marker of ['SOP_RUNTIME:', 'SOP_SNAPSHOT:', 'SOP_RESULT:', 'SOP_INPUT:']) expect(scenario).toContain(marker);
  expect(scenario).not.toMatch(/DISABLE TRIGGER|session_replication_role|DROP CONSTRAINT/);
  const races = readFileSync('scripts/sales-runtime/visit-sop-concurrency.mjs', 'utf8');
  expect(races).toContain("wait_event_type='Lock'"); expect(races).toContain('concurrent draft tabs compare run revisions');
  expect(races).toContain('interest reassignment wins before old Sales SOP save'); expect(races).toContain('Visit cancellation wins before waiting tour start');
  expect(races).not.toMatch(/process\.env|dotenv|supabase-js|DISABLE TRIGGER/);
 });
});
