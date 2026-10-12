-- Not installed: permanent native-compatibility changes require the approval requested after auto-review rejection.
BEGIN;
CREATE OR REPLACE FUNCTION crm_external_private.guard_cutover_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE permit crm_external_private.sales_cutover_permits%ROWTYPE;
  source crm_external_private.prepared_booking_sales%ROWTYPE; baseline jsonb; allowed boolean:=false;
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  SELECT * INTO permit FROM crm_external_private.sales_cutover_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN'; END IF;
  IF permit.transaction_id IS NULL THEN
    IF sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND to_regprocedure('sales_private.crm_post_booking_external_sale_allowed(jsonb,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT sales_private.crm_post_booking_external_sale_allowed($1,$2)' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF to_regprocedure('crm_external_private.booking_sale_allowed(text,jsonb,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.booking_sale_allowed($1,$2,$3)' INTO allowed
        USING TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts c
      WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=c.batch_id)) THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALES_SEALED';
    END IF;
    -- Native editor remains available only while canonical writing is disabled.
    -- Imported/canonical identities and source markers remain sealed.
    IF TG_OP IN ('INSERT','UPDATE') AND TG_NARGS>0
      AND NEW.lead_id IS NOT NULL AND NEW.project_interest_id IS NULL
      AND NEW.external_booking_id IS NULL AND NEW.external_source_stage IS NULL
      AND (TG_OP='INSERT' OR (OLD.project_interest_id IS NULL AND OLD.external_booking_id IS NULL AND OLD.external_source_stage IS NULL))
      AND public.crm_v2_role() IN ('sales','admin')
      AND NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled)
      THEN RETURN NEW; END IF;
    IF TG_OP<>'DELETE' AND (NEW.external_booking_id IS NOT NULL OR NEW.external_source_stage IS NOT NULL OR
      (TG_NARGS>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) k
        WHERE to_jsonb(NEW)->k IS DISTINCT FROM 'null'::jsonb))) THEN
      RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_UPDATE_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF permit.operation='rollback' THEN
    SELECT row_value INTO baseline FROM crm_external_private.sales_cutover_receipts r,
      LATERAL jsonb_array_elements(r.before_sales) row_value
      WHERE r.batch_id=permit.batch_id AND row_value->>'id'=NEW.id::text;
    IF baseline IS NULL OR baseline IS DISTINCT FROM to_jsonb(NEW) THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_RESTORE_EVIDENCE_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source FROM crm_external_private.prepared_booking_sales
    WHERE id=NEW.external_booking_id AND batch_id=permit.batch_id;
  IF source.id IS NULL OR (source.payload->>'eligible_for_release_review')::boolean IS DISTINCT FROM true
    OR NEW.id IS DISTINCT FROM source.id OR NEW.external_source_stage IS DISTINCT FROM source.stage OR NEW.lead_id IS NOT NULL
    OR NEW.project_interest_id IS DISTINCT FROM (source.payload->>'interest_id')::uuid
    OR NEW.plot_id IS DISTINCT FROM source.plot_id OR NEW.crm_stage IS DISTINCT FROM source.stage
    OR NEW.sale_price IS DISTINCT FROM (source.payload->>'sale_price')::numeric
    OR NEW.booking_amount IS DISTINCT FROM (source.payload->>'deposit_amount')::numeric
    OR NEW.closing_sales_user_id IS DISTINCT FROM (source.payload->>'closing_sales_user_id')::uuid
    OR NEW.payment_method IS DISTINCT FROM (source.payload->>'payment_method')
    OR NEW.cancellation_reason IS DISTINCT FROM (source.payload->>'cancellation_reason')
    OR NEW.contract_status IS DISTINCT FROM (CASE source.stage WHEN 'booked' THEN 'Reserved' WHEN 'transferred' THEN 'Transferred' ELSE 'Cancelled' END)
    OR NEW.booking_route IS DISTINCT FROM 'legacy_import'
    OR NEW.booking_route_reason IS DISTINCT FROM 'External snapshot: '||source.booking_key
    OR NEW.booking_round IS NOT NULL OR NEW.previous_sale_id IS NOT NULL
    OR NEW.booked_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
    OR NEW.contracted_at IS NOT NULL OR NEW.crm_handover_at IS NOT NULL
    OR NEW.list_price IS NOT NULL OR NEW.discount_amount IS NOT NULL
    OR NEW.bank_status IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.land_office_price IS NOT NULL
    OR NEW.transferred_at IS NOT NULL OR NEW.expected_transfer_date IS NOT NULL
    OR NEW.legacy_cancellation_batch_id IS NOT NULL OR NEW.cancellation_category IS NOT NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALE_EVIDENCE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$function$
;
ALTER POLICY "Allow write access to leads" ON public.leads USING ((SELECT public.crm_v2_role()) IN ('sales','admin')) WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin'));
ALTER POLICY "Allow write access to sales" ON public.sales USING ((SELECT public.crm_v2_role()) IN ('sales','admin')) WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin'));
ALTER POLICY "Allow write access to status_history" ON public.status_history WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin'));
GRANT INSERT, UPDATE ON public.sales TO authenticated;
-- Restore the native Lead history used by the original follow-up/booking popup.
-- Canonical commands are disabled above; a native activity cannot reference CRM objects.
ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_customer_id_fkey;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.leads(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_activities ALTER COLUMN recorded_by_user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS native_lead_activity_insert ON public.lead_activities;
CREATE POLICY native_lead_activity_insert ON public.lead_activities FOR INSERT TO authenticated
 WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin') AND recorded_by_user_id=(SELECT auth.uid())
   AND project_interest_id IS NULL AND sale_id IS NULL AND related_next_action_id IS NULL);
GRANT SELECT, INSERT ON public.lead_activities TO authenticated;

COMMIT;
