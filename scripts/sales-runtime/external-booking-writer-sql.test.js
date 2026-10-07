// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const writer = readFileSync('sql/sales/external_booking_writer_draft.sql', 'utf8');
const booking = readFileSync('sql/sales/18_booking_history_draft.sql', 'utf8');
describe('composed external booking writer boundaries', () => {
    it('is an inert draft, not a remote installer', () => {
        expect(writer).toContain('DESIGN ONLY: external booking writer requires isolated composed verification');
        expect(writer.trim()).toMatch(/ROLLBACK;$/);
        expect(writer).not.toMatch(/DISABLE TRIGGER|session_replication_role|ALTER SYSTEM|dblink|COPY.+PROGRAM/i);
    });
    it('uses private exact transaction backend actor and entity permits', () => {
        for (const field of ['transaction_id', 'backend_pid', 'actor_id', 'customer_id', 'interest_id', 'sale_id', 'command']) {
            expect(writer).toContain(field);
        }
        expect(writer).toContain('permit.actor_id IS DISTINCT FROM auth.uid()');
        expect(writer).toContain("p_new->>'id' IS DISTINCT FROM permit.sale_id::text");
        expect(writer).toContain('aclexplode');
        expect(writer.match(/SECURITY DEFINER/g)).toHaveLength(1);
        expect(writer).toMatch(/guard_booking_plot_stock\(\)[\s\S]+RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER/);
    });
    it('preserves history and only permits a narrow cancellation delta', () => {
        expect(writer).toContain('p_old-mutable=p_new-mutable');
        expect(writer).toContain("p_operation NOT IN ('INSERT','UPDATE')");
        expect(writer).toContain("permit.command='cancel'");
        expect(writer).toContain("p_new->>'external_booking_id' IS NULL");
    });
    it('requires operator current identity and cutover source baseline before activation', () => {
        expect(writer).toContain('PERFORM crm_external_private.cutover_operator_check()');
        expect(writer).toContain('PERFORM crm_external_private.revalidate_cutover_identity(p_batch,p_plan_digest)');
        expect(writer).toContain('EXTERNAL_WRITER_SALE_BASELINE_CHANGED');
        expect(writer).toContain('booking_activation_permits');
        expect(writer).toContain('booking_writer_release_immutable');
    });
    it('uses exact legacy-compatible stock uniqueness without changing construction data', () => {
        expect(writer).toContain("COALESCE(crm_stage, lower(contract_status), 'unknown') <> 'cancelled'");
        expect(writer).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+public\.(?:plots|leads|customer_voices)/i);
        expect(writer).toContain('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.sales');
    });
    it('leaves source customer edits sealed and permits only interest updates', () => {
        const bridge = readFileSync('sql/sales/external_crm_bridge_draft.sql', 'utf8');
        expect(bridge).toContain("TG_TABLE_NAME='lead_project_interests' AND TG_OP='UPDATE'");
        expect(bridge).toContain('EXTERNAL_CRM_HISTORY_SEALED');
    });
    it('retains external permits until after interest updates and before audit', () => {
        const end = booking.indexOf("EXECUTE 'SELECT crm_external_private.end_booking_write()'");
        expect(end).toBeGreaterThan(booking.lastIndexOf('UPDATE public.lead_project_interests'));
        expect(end).toBeLessThan(booking.lastIndexOf('INSERT INTO public.crm_audit_events'));
        expect(booking).toContain('sale_id_value:=gen_random_uuid()');
    });
    it('does not reopen unrelated worker feature switches', () => {
        expect(writer).toContain("('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','booking_enabled','booking_cutover_reviewed')");
        expect(writer).not.toMatch(/(?:notifications_enabled|sla_worker_enabled|sla_dispatcher_enabled)\s*=\s*true/);
    });
    it('seals inherited companion command and table grants before activation', () => {
        expect(writer).toContain('DO $companion_seal$');
        expect(writer).toContain("'crm_v2_record_lead_work','crm_v2_lead_lifecycle_capabilities'");
        expect(writer).toContain("'lead_work_command_requests','booking_command_requests','booking_write_permits'");
        expect(writer).toContain("REVOKE ALL (%I) ON %I.%I FROM %s");
    });
    it('closes resume consistently and validates stock at activation and during writes', () => {
        expect(booking).toContain("command_name='resume_follow_up' AND sales_private.crm_booking_external_ready()");
        expect(booking).toContain('AND NOT sales_private.crm_booking_external_ready()');
        expect(writer).toContain('cutover_plot_flags(receipt.after_plot_flags) IS DISTINCT FROM receipt.after_plot_flags');
        expect(writer).toContain('EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED');
        expect(writer).toContain('NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer');
        expect(writer).toContain('NEW.has_customer IS DISTINCT FROM expected_occupied');
    });
    it('preserves construction pause and resume but never manual stock or project reassignment', () => {
        expect(writer).toContain("NEW.sale_status IN ('active','ready_for_sale')");
        expect(writer).toContain('NEW.project_name IS NOT DISTINCT FROM OLD.project_name');
        expect(writer).toContain('NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer');
        expect(writer).toContain('AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id=OLD.id)');
    });
    it('installs, seals and grants the exact central search RPC used by the UI', () => {
        expect(writer).toContain("to_regprocedure('public.crm_v2_central_search(jsonb,integer)')");
        expect(writer).toContain('public.crm_v2_central_search_capabilities(),public.crm_v2_central_search(jsonb,integer)');
        expect(writer).toContain("'crm_v2_central_search_capabilities','crm_v2_central_search'");
    });
});
