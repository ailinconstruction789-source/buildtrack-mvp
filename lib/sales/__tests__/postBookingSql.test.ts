// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('sql/sales/21_post_booking_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('command'), context = body('context'), loanGuard = body('protect_loan');

describe('withheld post-booking SQL design (source checks only)', () => {
  it('preserves draft safeguards and starts new database capability disabled', () => {
    expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
    expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
    expect(code).toContain('post_booking_enabled boolean NOT NULL DEFAULT false');
    expect(source).toContain('NEVER RUN ON SUPABASE');
    expect(body('capabilities')).toContain('public.crm_v2_booking_capabilities()');
    expect(body('capabilities')).toContain("'contract_version','post_booking_v2'");
    expect(code).not.toMatch(/cron\.|pg_net|ALTER SYSTEM|DISABLE TRIGGER|DROP TABLE|TRUNCATE/i);
  });
  it('uses verified identity, existing shared lock and ordered ownership/revision checks', () => {
    expect(command).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
    expect(command).toContain("pg_advisory_xact_lock(hashtextextended('crm-booking-command',0))");
    expect(command.indexOf('FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE')).toBeLessThan(command.indexOf('FOR UPDATE OF i'));
    expect(command.indexOf('FOR UPDATE OF i')).toBeLessThan(command.indexOf('ORDER BY user_id FOR SHARE'));
    expect(command.indexOf('ORDER BY user_id FOR SHARE')).toBeLessThan(command.indexOf('project_interest_id=interest_row.id FOR UPDATE'));
    expect(command).toContain('interest_row.lifecycle_revision IS DISTINCT FROM expected_interest');
    expect(command.indexOf('IF NOT actor_active OR NOT owner_active')).toBeLessThan(command.indexOf("RETURN request_row.response||jsonb_build_object('replayed',true)"));
    expect(command).not.toMatch(/user_metadata|request\.jwt|p_actor|p_owner/);
  });
  it('requires exact bounded declaration and explicit RFC3339 event timing', () => {
    expect(command).toContain('octet_length(p_payload::text)>16384');
    expect(command).toContain('jsonb_object_keys(p_payload)');
    expect(command).toContain("sales_private.crm_work_text(p_payload->>'evidenceNote',1000)");
    expect(command).toContain("sales_private.crm_work_timestamp(p_payload->>'occurredAt')");
    expect(command).toContain('occurred_value>server_now');
    for (const bound of ['sale_row.booked_at', 'sale_row.contracted_at', 'latest_event_time', 'latest_attempt.submitted_at', 'latest_attempt.result_at']) {
      expect(command).toContain(`occurred_value<${bound}`);
    }
  });
  it('keeps ordinary prepared stage paths separate from explicit transfer and never creates fake cash loan', () => {
    expect(command).toContain("NOT IN ('contracted','downpayment','document_prep','transfer_pending')");
    expect(command).toContain("sale_row.payment_method='cash' AND sale_row.crm_stage IN ('contracted','downpayment','document_prep')");
    expect(command).toContain("sale_row.payment_method='mortgage' AND sale_row.crm_stage='loan_approved'");
    expect(command).toContain("sale_row.payment_method<>'mortgage' OR sale_row.crm_stage NOT IN ('document_prep','loan_rejected')");
    expect(command).not.toMatch(/UPDATE public\.plots|bank_status|SET payment_method|SET sale_price|UPDATE public\.sales_customers|UPDATE public\.lead_project_interests/i);
  });
  it('confirms only civil transfer dates without inventing timestamp or declaration evidence', () => {
    expect(code).toContain('ADD COLUMN crm_transfer_date date NULL');
    expect(command).toContain("WHEN command_name='confirm_transfer' THEN ARRAY['transferDate']");
    expect(command).toContain("IF command_name<>'confirm_transfer' THEN");
    expect(command).toContain("!~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(command).toContain("transfer_value<DATE '0001-01-01'");
    expect(command).toContain("transfer_value>=DATE '10000-01-01'");
    expect(command).toContain("transfer_value>(server_now AT TIME ZONE 'Asia/Bangkok')::date");
    for (const field of ['sale_row.booked_at', 'sale_row.contracted_at', 'latest_event_time', 'latest_loan_time']) {
      expect(command).toContain(`transfer_value<(${field} AT TIME ZONE 'Asia/Bangkok')::date`);
    }
    expect(command).toContain("sale_row.crm_stage<>'transfer_pending' OR sale_row.crm_transfer_date IS NOT NULL");
    expect(command).toContain('SELECT * INTO plot_row FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE');
    expect(command).toContain('plot_row.has_customer IS DISTINCT FROM true');
    expect(command).toContain("contract_status=CASE WHEN command_name='confirm_transfer' THEN 'Transferred' ELSE contract_status END");
    expect(command).not.toMatch(/transferred_at\s*=|transfer_value\s*::\s*(?:timestamp|timestamptz)|UPDATE public\.plots/i);
    expect(code).toContain("transfer_date IS NOT NULL AND occurred_at IS NULL AND evidence_note IS NULL");
    expect(command).toContain("'transferDate',transfer_value");
  });
  it('guards terminal transfer date and status even with legacy booking permit', () => {
    const transferGuard = body('protect_transfer');
    expect(transferGuard).toContain("OLD.crm_stage IN ('transferred','handover')");
    for (const field of ['crm_transfer_date', 'crm_stage', 'contract_status']) {
      expect(transferGuard).toContain(`NEW.${field} IS DISTINCT FROM OLD.${field}`);
    }
    expect(transferGuard).toContain('sales_private.post_booking_write_permits');
    expect(transferGuard).toContain("RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'");
  });
  it('requires actual scoped latest loan evidence and fresh numbered application', () => {
    expect(command).toContain("sale_id=sale_row.id AND kind='purchase'");
    expect(command).toContain('ORDER BY attempt_number DESC,id LIMIT 1 FOR UPDATE');
    expect(command).toContain('latest_attempt.id IS DISTINCT FROM loan_id_value');
    expect(command).toContain("latest_attempt.result_status NOT IN ('submitted','pending')");
    expect(command).toContain("latest_attempt.result_status<>'rejected'");
    expect(command).toContain('COALESCE(max(attempt_number),0)+1');
    expect(command).toContain('latest_attempt.approved_amount<=0');
    expect(command).toContain('INSERT INTO public.loan_attempts');
    expect(command).not.toMatch(/UPDATE public\.loan_attempts SET (?:attempt_number|submitted_at|bank_name)/);
  });
  it('guards purchase identity and terminal outcomes without capturing preapproval', () => {
    expect(loanGuard).toContain("OLD.kind='purchase' OR NEW.kind='purchase'");
    expect(loanGuard).toContain('IF NOT protected THEN RETURN');
    expect(loanGuard).toContain("TG_OP='DELETE'");
    expect(loanGuard).toContain("OLD.result_status IN ('approved','rejected','withdrawn')");
    for (const key of ['sale_id', 'project_interest_id', 'attempt_number', 'kind', 'bank_name', 'submitted_at', 'recorded_by_user_id']) {
      expect(loanGuard).toContain(`NEW.${key} IS DISTINCT FROM OLD.${key}`);
    }
    expect(body('protect_event')).toContain("IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'");
    expect(code).toContain('FROM PUBLIC,anon,authenticated;');
  });
  it('appends atomic audit and receipt and removes both private transaction permits', () => {
    expect(command).toContain('INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid())');
    expect(command).toContain('INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid())');
    expect(command).toContain('INSERT INTO sales_private.post_booking_events');
    expect(command).toContain('INSERT INTO public.crm_audit_events');
    expect(command).toContain('INSERT INTO sales_private.post_booking_command_requests');
    expect(command).toContain('DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current()');
    expect(command).toContain('DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current()');
    expect(command).not.toMatch(/set_config\(|\bCOMMIT\b|\bROLLBACK\b/);
  });
  it('keeps context STABLE read-only with separate fifty-row histories and latest purchase outside pagination', () => {
    expect(code).toContain('RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog');
    expect(context).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COMMIT|ROLLBACK|EXECUTE|LOCK)\b|pg_.*advisory|FOR (?:SHARE|UPDATE)/i);
    expect(context).toContain('LIMIT 51 OFFSET p_attempt_page*50'); expect(context).toContain('LIMIT 51 OFFSET p_event_page*50');
    expect(context).toContain('ORDER BY a.attempt_number DESC,a.id LIMIT 1');
    expect(context).toContain("'canEdit',(actor_role='admin'");
    expect(context).toContain("NOT IN ('cancelled','transferred','handover')");
    expect(context).toContain("'transferDate',sale_row.crm_transfer_date");
    expect(context).toContain("'transferDate',transfer_date");
    expect(context).not.toMatch(/monthly_income|personal_data|booking_amount|sale_price/);
  });
  it('harness compiles21 and checks real synthetic snapshots results and independent sessions', () => {
    const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
    expect(runner).toContain("options.at(-1) === '--post-booking-only'");
    expect(runner).toContain('report.results.postBooking.projectionParity = true');
    expect(runner).toContain('report.results.postBooking.transferProjectionParity = true');
    expect(runner).toContain('parsePostBookingResult(');
    expect(runner).toContain('await runPostBookingConcurrency({ query })');
    const races = readFileSync('scripts/sales-runtime/post-booking-concurrency.mjs', 'utf8');
    expect(races).toContain("current_setting('buildtrack.synthetic_runtime',true)");
    expect(races).toContain("wait_event_type='Lock'");
    expect(races).toContain('booking18 cancellation blocks waiting loan result');
    expect(races).toContain('booking18 cancellation wins before waiting transfer');
    expect(races).toContain('transfer wins before waiting booking18 cancellation');
    expect(races).toContain('identical transfer retry commits one civil date and event');
    expect(races).not.toMatch(/process\.env|dotenv|supabase-js|DISABLE TRIGGER/);
    const scenario = readFileSync('sql/sales/runtime/scenarios/post-booking.sql', 'utf8');
    expect(scenario).toContain('SET TRANSACTION READ ONLY;');
    expect(scenario).toContain('FOR n IN 1..51 LOOP');
    expect(scenario).toContain('SYNTHETIC_INJECTED_FAILURE');
    expect(scenario).not.toMatch(/DISABLE TRIGGER|session_replication_role|ALTER TABLE|DROP CONSTRAINT/);
  });
});
