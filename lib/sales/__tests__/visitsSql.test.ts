// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('sql/sales/23_visits_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('command'), context = body('context');

describe('withheld appointment and Visit foundation SQL (source checks only)', () => {
  it('is guarded, rolled back, disabled and dependent on central work capabilities', () => {
    expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
    expect(source).toContain('NEVER RUN ON SUPABASE');
    expect(code).toContain('visits_enabled boolean NOT NULL DEFAULT false');
    expect(body('capabilities')).toContain("'contract_version','visits_v1'");
    expect(body('capabilities')).toContain('central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled');
    expect(code).not.toMatch(/cron\.|pg_net|ALTER SYSTEM|DISABLE TRIGGER|TRUNCATE|DROP TABLE/);
  });
  it('reuses base Visit/appointment identities without a parallel ledger for customers', () => {
    expect(code).toContain('ALTER TABLE public.lead_appointments ADD COLUMN revision uuid');
    expect(code).toContain('ALTER TABLE public.lead_visits ADD COLUMN revision uuid');
    expect(command).toContain('INSERT INTO public.lead_appointments');
    expect(command).toContain('INSERT INTO public.lead_visits');
    expect(code).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:sales_customers|lead_project_interests|sales|plots|crm_next_actions|customer_voices|crm_sla_tasks)\b/);
    expect(command).not.toMatch(/workspace_state|activated_at|lead_created_at\s*=|booking_revision\s*=/);
  });
  it('checks exact bounded inputs and validates reason timestamps and paired nullable appointment references', () => {
    expect(command).toContain('octet_length(p_payload::text)>16384');
    expect(command).toContain('jsonb_object_keys(p_payload)');
    expect(command).toContain("sales_private.crm_work_text(p_payload->>'reason',1000)");
    expect(command).toContain("sales_private.crm_work_timestamp(p_payload->>'occurredAt')");
    expect(command).toContain('(appointment_id_value IS NULL)<>(expected_appointment IS NULL)');
    expect(command).toContain("command_name NOT IN ('schedule','reschedule','cancel_appointment','no_show','check_in','cancel_visit')");
    for (const boundary of ['occurred_value>server_now', 'occurred_value<c.lead_created_at', 'occurred_value<latest_event_time', 'occurred_value<a.created_at', 'occurred_value<v.checked_in_at', 'occurred_value<v.created_at', 'occurred_value<a.starts_at', 'starts_value<server_now', 'ends_value<=starts_value']) {
      expect(command).toContain(boundary);
    }
  });
  it('locks scope then ordered roles then appointment/Visit and rechecks rights before replay', () => {
    expect(command).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
    const customer = command.indexOf('FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE');
    const interest = command.indexOf('FROM public.lead_project_interests WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE');
    const roles = command.indexOf('ORDER BY user_id FOR SHARE');
    const appointment = command.indexOf('FROM public.lead_appointments WHERE id=appointment_id_value AND project_interest_id=i.id FOR UPDATE');
    const visit = command.indexOf('FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id FOR UPDATE');
    expect(customer).toBeLessThan(interest); expect(interest).toBeLessThan(roles); expect(roles).toBeLessThan(appointment); expect(appointment).toBeLessThan(visit);
    expect(command.indexOf("actor_id<>i.owner_user_id) OR NOT owner_active")).toBeLessThan(command.indexOf("RETURN receipt.response||jsonb_build_object('replayed',true)"));
    expect(command.indexOf("RETURN receipt.response||jsonb_build_object('replayed',true)")).toBeLessThan(command.indexOf("i.engagement_status='lost'"));
    expect(command).toContain('i.lifecycle_revision IS DISTINCT FROM expected_interest');
    expect(command).toContain('a.revision IS DISTINCT FROM expected_appointment');
    expect(command).toContain('v.revision IS DISTINCT FROM expected_visit');
    expect(command).not.toMatch(/user_metadata|request\.jwt|p_owner|p_actor/);
  });
  it('guards active-only transitions, no duplicate attendance and never completes a Visit', () => {
    expect(command).toContain("a.status NOT IN ('scheduled','rescheduled')");
    expect(command).toContain("IF v.status<>'awaiting_voice'");
    expect(command).toContain('EXISTS(SELECT 1 FROM public.lead_visits WHERE appointment_id=appointment_id_value)');
    expect(command).toContain("status='attended',revision=gen_random_uuid()");
    expect(command).not.toMatch(/status\s*=\s*'completed'|completed_at\s*=|completed_voice_id\s*=/);
    const visitGuard = body('protect_visit');
    expect(visitGuard).toContain("TG_OP='INSERT' AND NEW.status<>'awaiting_voice'");
    expect(visitGuard).toContain("OLD.status<>'awaiting_voice' OR NEW.status<>'cancelled'");
    expect(visitGuard).toContain('NEW.completed_voice_id IS NOT NULL');
    expect(body('protect_appointment')).toContain("OLD.status NOT IN ('scheduled','rescheduled')");
    expect(body('protect_history')).toContain("IF TG_OP<>'INSERT'");
  });
  it('keeps history/receipts private and commits every event with one cleanup permit', () => {
    expect(code).toContain('FROM PUBLIC,anon,authenticated;');
    expect(command).toContain('INSERT INTO sales_private.visits_write_permits VALUES(txid_current(),pg_backend_pid())');
    expect(command).toContain('INSERT INTO sales_private.visits_events');
    expect(command).toContain('INSERT INTO public.crm_audit_events');
    expect(command).toContain('INSERT INTO sales_private.visits_command_requests');
    expect(command).toContain('DELETE FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()');
    expect(command).not.toMatch(/set_config\(|\bCOMMIT\b|\bROLLBACK\b/);
  });
  it('offers minimal read-only all-project scope and independent fifty-row pages', () => {
    expect(code).toContain('RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER');
    expect(context).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)/i);
    for (const page of ['p_appointment_page', 'p_visit_page', 'p_event_page']) expect(context).toContain(`LIMIT 51 OFFSET ${page}*50`);
    expect(context).toContain("NOT IN ('sales','admin','owner')");
    expect(context).toContain("'canEdit',(actor_role='admin'");
    expect(context).not.toMatch(/monthly_income|personal_data|phone|crm_answers|token_hash|notes/);
  });
  it('has isolated synthetic runtime coverage and independent-session lock tests', () => {
    const scenario = readFileSync('sql/sales/runtime/scenarios/visits.sql', 'utf8');
    expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true)");
    expect(scenario).toContain('SET TRANSACTION READ ONLY;');
    expect(scenario).toContain('SYNTHETIC_INJECTED_FAILURE');
    expect(scenario).toContain('FOR n IN 1..51 LOOP');
    expect(scenario).toContain('VISITS_SNAPSHOT:');
    expect(scenario).not.toMatch(/DISABLE TRIGGER|session_replication_role|DROP CONSTRAINT/);
    const races = readFileSync('scripts/sales-runtime/visits-concurrency.mjs', 'utf8');
    expect(races).toContain("wait_event_type='Lock'");
    expect(races).toContain('identical check-in retry creates one Visit');
    expect(races).toContain('lifecycle owner reassignment wins before stale appointment command');
    expect(races).toContain('lost closure wins before a waiting walk-in');
    expect(races).not.toMatch(/process\.env|dotenv|supabase-js|DISABLE TRIGGER/);
  });
  it('installs the Visit guard after historical fixtures without weakening it and labels focused runs', () => {
    const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
    expect(runner).toContain("options.at(-1) === '--visits-only'");
    expect(runner).toContain("if (path === 'sql/sales/23_visits_draft.sql') continue;");
    const guardedInstall = runner.indexOf("const path = 'sql/sales/23_visits_draft.sql'");
    expect(guardedInstall).toBeGreaterThan(runner.indexOf('await runPostBookingConcurrency'));
    expect(guardedInstall).toBeLessThan(runner.indexOf("scenarios/visits.sql"));
    expect(runner).toContain('report.results.visits.projectionParity = true');
    expect(runner).not.toMatch(/DISABLE TRIGGER|session_replication_role/);
  });
});
