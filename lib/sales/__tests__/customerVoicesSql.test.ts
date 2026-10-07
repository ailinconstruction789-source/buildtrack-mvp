// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VOICE_SCORES, VOICE_OPTIONAL_TEXT, VOICE_CHOICES } from '../customerVoicesTemplate';
const source = readFileSync('sql/sales/26_customer_voices_draft.sql', 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const command = body('command'), submit = body('submit'), context = body('context');
describe('withheld per-Visit Customer Voices SQL (source checks only)', () => {
 it('is guarded rollback-only and default off with configurable bounded TTL', () => {
  expect(code.trim()).toMatch(/^BEGIN;/); expect(code.trim()).toMatch(/ROLLBACK;$/);
  expect(source).toContain('NEVER RUN ON SUPABASE');
  expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
  expect(code).toContain('customer_voices_enabled boolean NOT NULL DEFAULT false');
  expect(code).toContain('voice_token_ttl_hours integer NOT NULL DEFAULT 24 CHECK(voice_token_ttl_hours BETWEEN 1 AND 168)');
  expect(body('capabilities')).toContain('central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled');
  expect(code).not.toMatch(/cron\.|pg_net|ALTER SYSTEM|DISABLE TRIGGER|TRUNCATE|DROP TABLE/);
 });
 it('validates all exact eight scores plus bounded typed optional fields', () => {
  for (const [key] of [...VOICE_SCORES, ...VOICE_OPTIONAL_TEXT, ...Object.values(VOICE_CHOICES).flat()]) expect(body('answers')).toContain(`'${key}'`);
  expect(VOICE_SCORES).toHaveLength(8); expect(body('answers')).toContain('NOT(p_answers ?& scores)');
  expect(body('answers')).toContain('n<>trunc(n) OR n NOT BETWEEN 1 AND 5');
  expect(body('answers')).toContain("jsonb_typeof(p_answers->k) IS DISTINCT FROM 'boolean'");
  expect(body('answers')).toContain('sales_private.crm_work_text(p_answers->>k,500)');
  expect(body('answers')).toContain('n NOT BETWEEN 0 AND 9999999.99 OR n<>round(n,2)');
  expect(body('answers')).toContain('octet_length(p_answers::text)>16384');
 });
 it('checks current owner or Admin before staff replay and optimistic token rotation', () => {
  expect(command).toContain("actor_role='sales' AND actor_id<>i.owner_user_id");
  expect(command.indexOf('OR NOT owner_active')).toBeLessThan(command.indexOf("RETURN receipt.response||jsonb_build_object('replayed',true)"));
  expect(command).toContain('i.lifecycle_revision IS DISTINCT FROM expected_interest');
  expect(command).toContain('v.revision IS DISTINCT FROM expected_visit');
  expect(command).toContain('expected_token IS DISTINCT FROM (CASE WHEN t.expires_at>server_now THEN t.id ELSE NULL END)');
  expect(command).toContain('UPDATE sales_private.visit_submission_tokens SET revoked_at=server_now');
  expect(code).toContain('CREATE UNIQUE INDEX voice_one_active_token_idx');
  expect(command).not.toMatch(/user_metadata|p_actor|p_owner/);
 });
 it('stores only hashes with no plaintext QR and keeps immutable private receipts', () => {
  expect(command).toContain("hash_value !~ '^[a-f0-9]{64}$'");
  expect(command).toContain('INSERT INTO sales_private.visit_submission_tokens(visit_id,token_hash,expires_at,created_at)');
  for (const rpc of [body('open'), submit]) {
   expect(rpc).toContain("token_hash_value:=encode(sha256(convert_to(p_token,'UTF8')),'hex')");
   expect(rpc).not.toContain('p_token_hash');
   expect(rpc).not.toMatch(/(?:INSERT|UPDATE)[^;]*\bp_token\b/);
  }
  expect(body('open')).toContain('t.token_hash=token_hash_value');
  expect(submit).toContain('WHERE token_hash=token_hash_value');
  expect(source).toContain('request/statement log redaction before activation');
  expect(code).not.toMatch(/(?:ADD COLUMN|CREATE TABLE)[^;]*(?:plaintext|token_secret)/);
  expect(body('history')).toContain("IF TG_OP<>'INSERT'");
  expect(body('token_guard')).toContain('OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL');
  expect(code).toContain('REVOKE ALL ON sales_private.voice_write_permits');
 });
 it('locks scope before token consistently with cancellation and uses post-lock time', () => {
  const positions = ['FROM public.sales_customers WHERE id=c.id FOR UPDATE', 'FROM public.lead_project_interests WHERE id=i.id AND customer_id=c.id FOR UPDATE',
   "FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id FOR SHARE", 'FROM public.lead_appointments WHERE id=a.id FOR UPDATE',
   'FROM public.lead_visits WHERE id=token_hint.visit_id AND project_interest_id=i.id FOR UPDATE',
   'FROM sales_private.visit_submission_tokens WHERE id=token_hint.id FOR UPDATE', 'server_now:=clock_timestamp()'].map(x => submit.indexOf(x));
  expect(positions.every(p => p >= 0)).toBe(true); expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(submit).toContain('t.expires_at<=server_now');
 });
 it('returns a privacy-minimal public form and generic exact retry acknowledgements', () => {
  expect(body('open')).toContain("RETURN jsonb_build_object('formVersion','customer_voices_v1','expiresAt',expiry)");
  expect(body('open')).not.toContain('crm_answers');
  expect(submit).toContain('receipt.request_id IS DISTINCT FROM p_request_id');
  expect(submit).toContain('receipt.answers IS DISTINCT FROM answers_value');
  expect(submit).toContain("RETURN jsonb_build_object('submitted',true,'replayed',true)");
  expect(submit).toContain("RETURN jsonb_build_object('submitted',true,'replayed',false)");
  expect(submit).not.toMatch(/RETURN.*(?:customerId|customer_name|phone|answers_value|voice_id)/);
  expect(code).toContain('GRANT EXECUTE ON FUNCTION public.crm_v2_customer_voice_submit(text,uuid,text,jsonb) TO anon,authenticated');
 });
 it('atomically inserts response completes same Visit consumes token and receipts it', () => {
  for (const fragment of ['INSERT INTO public.customer_voices', "UPDATE public.lead_visits SET status='completed'", 'UPDATE sales_private.visit_submission_tokens SET consumed_at=server_now',
   'INSERT INTO sales_private.voice_submissions', 'INSERT INTO sales_private.voice_events', 'INSERT INTO public.crm_audit_events']) expect(submit).toContain(fragment);
  expect(submit).toContain('VALUES(voice_id_value,NULL,v.id,server_now,c.customer_name');
  expect(submit).toContain('completion_evidence_state=\'submitted\',revision=gen_random_uuid()');
  expect(submit).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:sales_customers|lead_project_interests|lead_appointments|sales|plots|leads|house_visit_checklist_runs|house_visit_checklist_items|crm_next_actions|crm_sla_tasks)\b/);
 });
 it('adds a narrow completion permit and leaves SQL23 cancellation permit insufficient', () => {
  expect(body('protect_visit')).toContain('visit_id=OLD.id AND voice_id=NEW.completed_voice_id');
  expect(body('protect_visit')).toContain("OLD.status<>'awaiting_voice' OR NEW.status<>'completed'");
  expect(body('protect_visit')).toContain("WHERE id=NEW.completed_voice_id AND visit_id=NEW.id AND crm_submission_state='submitted'");
  expect(body('protect_visit')).toContain('NEW.completed_at IS NOT NULL OR NEW.completed_voice_id IS NOT NULL');
  expect(body('row_guard')).toContain('OLD.visit_id IS NOT NULL OR NEW.visit_id IS NOT NULL');
 });
 it('intersects legacy allow-all RLS without changing NULL-linked legacy workflows', () => {
  expect(code).toContain('AS RESTRICTIVE FOR SELECT TO authenticated,anon');
  expect(code).toContain('USING(visit_id IS NULL OR public.crm_v2_voice_row_readable(visit_id))');
  expect(code).toContain('AS RESTRICTIVE FOR INSERT TO authenticated,anon WITH CHECK(visit_id IS NULL)');
  expect(body('row_guard')).toContain('IF NEW.visit_id IS NULL THEN RETURN NEW; END IF');
  expect(context).toContain("CASE WHEN actor_role IN ('admin','owner') OR actor_id=i.owner_user_id THEN voice.crm_answers ELSE NULL END");
  expect(context).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|LOCK)\b|FOR (?:SHARE|UPDATE)|token_hash/i);
 });
 it('ships isolated rollback, privacy, atomic failure and observed-lock concurrency checks', () => {
  const scenario = readFileSync('sql/sales/runtime/scenarios/customer-voices.sql', 'utf8');
  expect(scenario).toContain("current_setting('buildtrack.synthetic_runtime',true)"); expect(scenario).toContain('SET TRANSACTION READ ONLY;');
  expect(scenario).toContain('runtime_voice_legacy_allow_all'); expect(scenario).toContain('SYNTHETIC RECEIPT FAILURE');
  expect(scenario).toContain('stored hash cannot be reused as public bearer for open');
  expect(scenario).toContain('stored hash cannot be reused as public bearer for submit');
  expect(scenario).toContain('raw QR is never persisted in token storage or staff receipt');
  for (const marker of ['VOICE_RUNTIME:', 'VOICE_SNAPSHOT:', 'VOICE_RESULT:', 'VOICE_INPUT:', 'VOICE_PUBLIC_INPUT:', 'VOICE_PUBLIC_RESULT:']) expect(scenario).toContain(marker);
  const race = readFileSync('scripts/sales-runtime/customer-voices-concurrency.mjs', 'utf8');
  expect(race).toContain('export async function runCustomerVoicesConcurrency'); expect(race).toContain("wait_event_type='Lock'");
  expect(race).toContain("wait_event='PgSleep'"); expect(race).toContain('expiry is checked after waiting');
  expect(race).not.toMatch(/process\.env|createClient|fetch\(/);
 });
});
