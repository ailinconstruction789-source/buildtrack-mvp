-- User approved preserving all customers and restoring native sidebar/Lead writes for trusted Sales/Admin.
-- No customer delete/update/backfill; imported Sale identities and historical CRM FKs are preserved.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
DO $preflight$
BEGIN
 -- Hash the complete inspected definitions. Normalize CRLF only; actual code/config changes still fail.
 IF md5(rtrim(replace(pg_get_functiondef('crm_external_private.guard_cutover_sale()'::regprocedure),
   chr(13)||chr(10),chr(10)),chr(10)||chr(13))) IS DISTINCT FROM '37300880f6a542656755f61646a0276a'
   THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_GUARD_SNAPSHOT_CHANGED'; END IF;
 IF md5(rtrim(replace(pg_get_functiondef('crm_external_private.guard_booking_plot_stock()'::regprocedure),
   chr(13)||chr(10),chr(10)),chr(10)||chr(13))) IS DISTINCT FROM 'c92b828658c77308689585f25bc6d9e7'
   THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_STOCK_GUARD_SNAPSHOT_CHANGED'; END IF;
 IF (SELECT count(*) FROM public.crm_settings)<>1 THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_SETTINGS_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['public.leads','public.sales','public.status_history','public.lead_activities']) r
   JOIN pg_class c ON c.oid=r::regclass WHERE NOT c.relrowsecurity) THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_RLS_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
   WHERE has_table_privilege(r,'account_security_private.reviewed_roles','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(r,'account_security_private.reviewed_roles','INSERT,UPDATE'))
   THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_TRUSTED_ROLES_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='lead_activities' AND column_name='native_lead_id') THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_ALREADY_OR_PARTLY_INSTALLED'; END IF;
END; $preflight$;
LOCK TABLE public.leads,public.sales,public.status_history,public.lead_activities,
 public.sales_customers,public.lead_project_interests,public.plots IN SHARE MODE;
CREATE TEMP TABLE native_sidebar_retention(relation text PRIMARY KEY,before_count bigint,before_hash text) ON COMMIT DROP;
DO $snapshot$
DECLARE relation text; n bigint; checksum text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['public.leads','public.sales','public.status_history','public.lead_activities',
   'public.sales_customers','public.lead_project_interests','public.plots'] LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg((to_jsonb(t)-''native_lead_id'')::text,E''\n'' ORDER BY t.id),'''')) FROM %s t',relation)
    INTO n,checksum;
  INSERT INTO native_sidebar_retention VALUES(relation,n,checksum);
 END LOOP;
END; $snapshot$;
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
    -- Native sidebar compatibility: exact Lead/plot identity, no imported fields or bypass permits.
    IF TG_OP IN ('INSERT','UPDATE') AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='sales'
      AND auth.uid() IS NOT NULL AND public.crm_v2_role() IN ('sales','admin')
      AND NEW.lead_id IS NOT NULL AND NEW.plot_id IS NOT NULL
      AND NEW.project_interest_id IS NULL AND NEW.external_booking_id IS NULL AND NEW.external_source_stage IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled)
      AND EXISTS(SELECT 1 FROM public.leads l JOIN public.plots p ON p.id=NEW.plot_id
        WHERE l.id=NEW.lead_id AND l.project_name=p.project_name)
    THEN
      IF TG_OP='UPDATE' THEN
        IF OLD.lead_id IS NOT NULL AND OLD.project_interest_id IS NULL AND OLD.external_booking_id IS NULL
          AND OLD.external_source_stage IS NULL
          AND to_jsonb(OLD)-ARRAY['sale_price','land_office_price','bank_name','payment_method','contract_status','crm_stage',
            'contracted_at','transferred_at','crm_handover_at','cancelled_at','cancellation_reason','cancellation_category',
            'expected_transfer_date','updated_at']
            IS NOT DISTINCT FROM to_jsonb(NEW)-ARRAY['sale_price','land_office_price','bank_name','payment_method','contract_status','crm_stage',
            'contracted_at','transferred_at','crm_handover_at','cancelled_at','cancellation_reason','cancellation_category',
            'expected_transfer_date','updated_at']
        THEN RETURN NEW; END IF;
      ELSE
        -- Serialize new reservations for this exact plot. Historical/imported occupied plots stay protected.
        PERFORM 1 FROM public.plots WHERE id=NEW.plot_id FOR UPDATE;
        IF NEW.contract_status='Reserved' AND NEW.crm_stage='booked'
          AND NEW.payment_method IN ('cash','mortgage') AND NEW.sale_price>=0 AND NEW.booking_amount>=0
          AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=NEW.plot_id
            AND coalesce(s.contract_status,'') NOT IN ('Cancelled','Rejected'))
        THEN RETURN NEW; END IF;
      END IF;
      RAISE EXCEPTION 'NATIVE_SIDEBAR_IDENTITY_OR_FIELDS_FORBIDDEN';
    END IF;
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
$function$;
CREATE OR REPLACE FUNCTION crm_external_private.guard_booking_plot_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE; expected_occupied boolean;
BEGIN
 IF TG_OP='UPDATE' AND sales_recovery_private.stock_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='UPDATE' AND rental_source_retirement_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND sales_revision_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
      AND (NEW.has_customer IS DISTINCT FROM false OR lower(btrim(NEW.sale_status))='transferred') THEN
      RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name)
    AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id=OLD.id) THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;
  -- Existing construction pause/resume is NOT a transfer or occupancy change.
  -- Delegate its authorization to the unchanged plot policies, not CRM roles:
  -- other departments are not required to enroll in the Sales role registry.
  IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
    AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND COALESCE(OLD.sale_status,'') IN ('','active','ready_for_sale')
    AND NEW.sale_status IN ('active','ready_for_sale') THEN RETURN NEW; END IF;
  IF NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND NEW.sale_status IS NOT DISTINCT FROM OLD.sale_status THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases) THEN RETURN NEW; END IF;
  -- Native occupancy is derived from exact sales, not client-supplied customer flags.
  IF TG_OP='UPDATE' AND auth.uid() IS NOT NULL AND public.crm_v2_role() IN ('sales','admin')
    AND NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
    AND to_jsonb(OLD)-ARRAY['has_customer','sale_status'] IS NOT DISTINCT FROM to_jsonb(NEW)-ARRAY['has_customer','sale_status']
    AND NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled)
    AND EXISTS(SELECT 1 FROM public.sales s JOIN public.leads l ON l.id=s.lead_id
      WHERE s.plot_id=NEW.id AND l.project_name=NEW.project_name AND s.project_interest_id IS NULL
        AND s.external_booking_id IS NULL AND s.external_source_stage IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=NEW.id AND coalesce(s.contract_status,'')<>'Cancelled'
      AND (s.project_interest_id IS NOT NULL OR s.external_booking_id IS NOT NULL OR s.external_source_stage IS NOT NULL))
  THEN
    SELECT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=NEW.id AND contract_status<>'Cancelled') INTO expected_occupied;
    IF NEW.has_customer IS NOT DISTINCT FROM expected_occupied
      AND NEW.sale_status IS NOT DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM public.sales
        WHERE plot_id=NEW.id AND contract_status='Transferred') THEN 'transferred' ELSE OLD.sale_status END)
    THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'NATIVE_SIDEBAR_STOCK_EVIDENCE_REQUIRED';
  END IF;
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.transaction_id IS NULL OR permit.actor_id IS DISTINCT FROM auth.uid()
    OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=permit.sale_id
      AND s.project_interest_id=permit.interest_id AND s.plot_id=NEW.id)
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name
    OR NEW.sale_status IS DISTINCT FROM OLD.sale_status THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=NEW.id
    AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') INTO expected_occupied;
  IF NEW.has_customer IS DISTINCT FROM expected_occupied THEN RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END;
$function$;
ALTER POLICY "Allow write access to leads" ON public.leads
 USING ((SELECT public.crm_v2_role()) IN ('sales','admin')) WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin'));
ALTER POLICY "Allow write access to sales" ON public.sales
 USING ((SELECT public.crm_v2_role()) IN ('sales','admin') AND lead_id IS NOT NULL
   AND project_interest_id IS NULL AND external_booking_id IS NULL AND external_source_stage IS NULL)
 WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin') AND lead_id IS NOT NULL
   AND project_interest_id IS NULL AND external_booking_id IS NULL AND external_source_stage IS NULL);
ALTER POLICY "Allow write access to status_history" ON public.status_history
 WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin'));
-- Column grants permit the existing native booking/update payloads, never identity reassignment or delete.
GRANT INSERT(id,lead_id,plot_id,contract_status,crm_stage,payment_method,list_price,discount_amount,
 sale_price,booking_amount,bank_name,booked_at,created_at,updated_at) ON public.sales TO authenticated;
GRANT UPDATE(sale_price,land_office_price,bank_name,payment_method,contract_status,crm_stage,contracted_at,
 transferred_at,crm_handover_at,cancelled_at,cancellation_reason,cancellation_category,expected_transfer_date)
 ON public.sales TO authenticated;
-- Preserve the CRM customer FK and all old history. Only new native history uses this additional FK.
ALTER TABLE public.lead_activities ADD COLUMN native_lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_activities ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.lead_activities ALTER COLUMN crm_scope_key DROP NOT NULL;
ALTER TABLE public.lead_activities ALTER COLUMN recorded_by_user_id SET DEFAULT auth.uid();
ALTER TABLE public.lead_activities ADD CONSTRAINT native_or_crm_activity_parent CHECK (
 (native_lead_id IS NULL AND customer_id IS NOT NULL AND crm_scope_key IS NOT NULL)
 OR (native_lead_id IS NOT NULL AND customer_id IS NULL AND project_interest_id IS NULL AND sale_id IS NULL
   AND related_next_action_id IS NULL AND crm_scope_key IS NULL AND performed_by_user_id IS NULL));
CREATE INDEX native_lead_activity_history_idx ON public.lead_activities(native_lead_id,occurred_at DESC)
 WHERE native_lead_id IS NOT NULL;
CREATE POLICY native_lead_activity_insert ON public.lead_activities FOR INSERT TO authenticated
 WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales','admin') AND recorded_by_user_id=(SELECT auth.uid())
   AND native_lead_id IS NOT NULL AND customer_id IS NULL AND project_interest_id IS NULL AND sale_id IS NULL
   AND related_next_action_id IS NULL AND performed_by_user_id IS NULL
   AND EXISTS(SELECT 1 FROM public.leads l WHERE l.id=native_lead_id));
GRANT SELECT ON public.lead_activities TO authenticated;
GRANT INSERT(native_lead_id,activity_type,result,occurred_at,note,next_follow_up_at) ON public.lead_activities TO authenticated;
UPDATE public.crm_settings SET central_intake_enabled=false,booking_enabled=false,post_booking_enabled=false;
DO $verify_retention$
DECLARE r record; n bigint; checksum text;
BEGIN
 FOR r IN SELECT * FROM native_sidebar_retention LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg((to_jsonb(t)-''native_lead_id'')::text,E''\n'' ORDER BY t.id),'''')) FROM %s t',r.relation)
    INTO n,checksum;
  IF n IS DISTINCT FROM r.before_count OR checksum IS DISTINCT FROM r.before_hash
    THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_BUSINESS_DATA_CHANGED: %',r.relation; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('leads','sales','status_history')
   AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%user_metadata%')
   THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_UNTRUSTED_POLICY_REMAINS'; END IF;
END; $verify_retention$;
SELECT jsonb_build_object('installed',true,'preserved',(SELECT jsonb_agg(to_jsonb(r)) FROM native_sidebar_retention r));
NOTIFY pgrst,'reload schema';
COMMIT;
