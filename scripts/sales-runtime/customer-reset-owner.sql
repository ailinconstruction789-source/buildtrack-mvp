-- User-authorized customer reset. Run once as postgres owner, never from a browser.
-- No CASCADE, no RLS/FK disabling, no Auth changes. All writes are one transaction.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
DO $reset$
DECLARE targets text[]:=ARRAY['account_security_private.sales_restore_receipts','crm_external_private.booking_activation_permits','crm_external_private.booking_crm_links','crm_external_private.booking_history','crm_external_private.booking_release_receipts','crm_external_private.booking_writer_permits','crm_external_private.booking_writer_releases','crm_external_private.bridge_receipts','crm_external_private.customer_candidates','crm_external_private.interest_candidates','crm_external_private.prepared_booking_sales','crm_external_private.sales_cutover_permits','crm_external_private.sales_cutover_receipts','crm_external_private.sales_rollback_receipts','crm_external_private.snapshot_batches','crm_external_private.source_records','crm_external_private.visit_workflow_activation_permits','crm_external_private.visit_workflow_operations','crm_external_private.visit_workflow_releases','customer_source_membership_private.head','customer_source_membership_private.members','customer_source_membership_private.recoveries','customer_source_membership_private.revisions','customer_source_membership_private.scope_batches','customer_source_membership_private.scope_customers','customer_source_membership_private.scope_interests','customer_source_membership_private.scope_leads','customer_source_membership_private.scope_sales','public.ai_sales_reports','public.crm_audit_events','public.crm_duplicate_reviews','public.crm_import_batches','public.crm_import_rows','public.crm_legacy_lead_links','public.crm_next_actions','public.crm_notifications','public.crm_sla_exceptions','public.crm_sla_tasks','public.customer_voices','public.house_visit_checklist_items','public.house_visit_checklist_runs','public.house_visit_checklists','public.lead_activities','public.lead_appointments','public.lead_project_interests','public.lead_visits','public.leads','public.loan_attempts','public.plot_promotions','public.rental_contracts','public.rental_payments','public.sale_plot_changes','public.sales','public.sales_customers','rental_source_retirement_private.archives','rental_source_retirement_private.batches','rental_source_retirement_private.permits','rental_source_retirement_private.restores','rental_source_retirement_private.reviews','sales_activation_private.permits','sales_activation_private.releases','sales_activation_private.restorations','sales_import_private.detail_batches','sales_import_private.detail_events','sales_import_private.forecast_corrections','sales_import_private.forecast_permits','sales_operator_private.contexts','sales_operator_private.jobs','sales_operator_private.receipts','sales_private.booking_command_requests','sales_private.booking_write_permits','sales_private.central_command_requests','sales_private.crm_legacy_source_snapshots','sales_private.customer_deal_details_permits','sales_private.customer_deal_details_requests','sales_private.customer_profile_corrections','sales_private.deal_details_corrections','sales_private.lead_work_command_requests','sales_private.post_booking_command_requests','sales_private.post_booking_events','sales_private.post_booking_external_write_permits','sales_private.post_booking_write_permits','sales_private.visit_sop_command_requests','sales_private.visit_sop_events','sales_private.visit_sop_write_permits','sales_private.visit_submission_tokens','sales_private.visits_command_requests','sales_private.visits_events','sales_private.visits_write_permits','sales_private.voice_events','sales_private.voice_staff_requests','sales_private.voice_submissions','sales_private.voice_write_permits','sales_recovery_private.permits','sales_recovery_private.recoveries','sales_recovery_private.runs','sales_recovery_private.sale_identities','sales_recovery_private.seals','sales_revision_private.batches','sales_revision_private.events','sales_revision_private.permits','sales_revision_private.plot_permits','sales_source_creation_private.batches','sales_source_creation_private.events','sales_source_creation_private.permits','sales_source_creation_private.records','sales_unknown_history_private.batches','sales_unknown_history_private.events','sales_unknown_history_private.insert_permits','sales_unknown_history_private.records'];
  allowed_plot_cols text[]:=ARRAY['has_customer','sale_status','current_tenant_name','current_tenant_phone','rental_program','monthly_rent','security_deposit','accumulated_downpayment','lease_start_date','lease_end_date','handover_status','handover_completed_at','handover_completed_by','handover_notes','handover_cycle','highlight_note'];
  relation text; row record; n bigint; before_counts jsonb:='{}'; after_counts jsonb:='{}';
  checksum text; flags_sql text; preserved_count integer:=0; before_plot text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'CUSTOMER_RESET_OWNER_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 IF EXISTS(SELECT 1 FROM unnest(targets) r WHERE to_regclass(r) IS NULL) THEN RAISE EXCEPTION 'RESET_CATALOG_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f'
   AND c.confrelid=ANY(ARRAY(SELECT to_regclass(r)::oid FROM unnest(targets) r))
   AND NOT c.conrelid=ANY(ARRAY(SELECT to_regclass(r)::oid FROM unnest(targets) r))) THEN
   RAISE EXCEPTION 'RESET_HAS_PROTECTED_DEPENDENTS';
 END IF;
 CREATE TEMP TABLE reset_preserved(relation text PRIMARY KEY,hash text) ON COMMIT DROP;
 CREATE TEMP TABLE reset_trigger_states ON COMMIT DROP AS
   SELECT tgrelid,tgname,tgenabled FROM pg_trigger
   WHERE NOT tgisinternal AND tgrelid=ANY(ARRAY(SELECT to_regclass(r)::oid FROM unnest(targets||ARRAY['public.plots','public.crm_settings','public.status_history']) r));
 FOREACH relation IN ARRAY targets LOOP
   EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',relation);
   EXECUTE format('SELECT count(*) FROM %s',relation) INTO n;
   before_counts:=before_counts||jsonb_build_object(relation,n);
 END LOOP;
 FOR row IN SELECT format('%I.%I',ns.nspname,c.relname) relation FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE c.relkind='r' AND (ns.nspname='public' OR ns.nspname='account_security_private'
     OR (c.relname='adapters' AND ns.nspname IN ('customer_source_membership_private','sales_recovery_private','sales_operator_private','sales_activation_private'))
     OR (ns.nspname='sales_private' AND c.relname='crm_user_roles'))
   AND NOT format('%I.%I',ns.nspname,c.relname)=ANY(targets)
   AND c.relname NOT IN ('plots','crm_settings','status_history','notifications')
 LOOP
   EXECUTE format('LOCK TABLE %s IN SHARE MODE',row.relation);
   EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,''|'' ORDER BY to_jsonb(t)::text),'''')) FROM %s t',row.relation) INTO checksum;
   INSERT INTO reset_preserved VALUES(row.relation,checksum); preserved_count:=preserved_count+1;
 END LOOP;
 LOCK TABLE public.plots,public.crm_settings,public.status_history IN ACCESS EXCLUSIVE MODE;
 SELECT md5(coalesce(string_agg((to_jsonb(p)-allowed_plot_cols)::text,'|' ORDER BY id),'')) INTO before_plot FROM public.plots p;
 INSERT INTO reset_preserved SELECT 'public.notifications',md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM public.notifications t;
 INSERT INTO reset_preserved SELECT 'public.status_history',md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM public.status_history t WHERE entity_type NOT IN ('lead','sale','customer','rental','sales_customer','project_interest');
 FOR row IN SELECT * FROM reset_trigger_states LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',row.tgrelid::regclass,row.tgname); END LOOP;
 EXECUTE 'TRUNCATE TABLE '||array_to_string(targets,', ');
 DELETE FROM public.status_history WHERE entity_type IN ('lead','sale','customer','rental','sales_customer','project_interest');
 UPDATE public.plots SET has_customer=false,
   sale_status=CASE WHEN lower(coalesce(sale_status,'')) IN ('active','ready_for_sale','available') THEN sale_status
     WHEN paused_for_sale_at IS NOT NULL OR is_completed THEN 'ready_for_sale' ELSE 'active' END,
   current_tenant_name=NULL,current_tenant_phone=NULL,rental_program=NULL,monthly_rent=NULL,
   security_deposit=NULL,accumulated_downpayment=NULL,lease_start_date=NULL,lease_end_date=NULL,
   handover_status=NULL,handover_completed_at=NULL,handover_completed_by=NULL,handover_notes=NULL,handover_cycle=0,
   highlight_note=CASE WHEN highlight_note ~* '(customer|lead|sale|rental|ลูกค้า|จอง|เช่า|สินเชื่อ|ธนาคาร|โอน|รับมอบ|สัญญา)' THEN NULL ELSE highlight_note END;
 SELECT string_agg(format('%I=false',a.attname),',') INTO flags_sql FROM pg_attribute a
 WHERE a.attrelid='public.crm_settings'::regclass AND a.attnum>0 AND NOT a.attisdropped
 AND a.atttypid='boolean'::regtype AND (a.attname LIKE '%_enabled' OR a.attname='booking_cutover_reviewed');
 EXECUTE 'UPDATE public.crm_settings SET '||flags_sql;
 FOR row IN SELECT * FROM reset_trigger_states LOOP
   EXECUTE format('ALTER TABLE %s %s TRIGGER %I',row.tgrelid::regclass,
     CASE row.tgenabled WHEN 'O' THEN 'ENABLE' WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' END,row.tgname);
 END LOOP;
 FOREACH relation IN ARRAY targets LOOP
   EXECUTE format('SELECT count(*) FROM %s',relation) INTO n;
   IF n<>0 THEN RAISE EXCEPTION 'CUSTOMER_RESET_NOT_EMPTY: %',relation; END IF;
   after_counts:=after_counts||jsonb_build_object(relation,n);
 END LOOP;
 FOR row IN SELECT * FROM reset_preserved LOOP
   IF row.relation='public.status_history' THEN
     SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) INTO checksum FROM public.status_history t WHERE entity_type NOT IN ('lead','sale','customer','rental','sales_customer','project_interest');
   ELSE EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,''|'' ORDER BY to_jsonb(t)::text),'''')) FROM %s t',row.relation) INTO checksum; END IF;
   IF checksum IS DISTINCT FROM row.hash THEN RAISE EXCEPTION 'PROTECTED_DATA_CHANGED: %',row.relation; END IF;
 END LOOP;
 SELECT md5(coalesce(string_agg((to_jsonb(p)-allowed_plot_cols)::text,'|' ORDER BY id),'')) INTO checksum FROM public.plots p;
 IF checksum IS DISTINCT FROM before_plot THEN RAISE EXCEPTION 'PROTECTED_PLOT_FIELDS_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM reset_trigger_states s LEFT JOIN pg_trigger t ON t.tgrelid=s.tgrelid AND t.tgname=s.tgname WHERE t.tgenabled IS DISTINCT FROM s.tgenabled) THEN RAISE EXCEPTION 'TRIGGER_STATE_CHANGED'; END IF;
 CREATE TEMP TABLE reset_result ON COMMIT PRESERVE ROWS AS SELECT jsonb_build_object('status','committed','before',before_counts,'after',after_counts,'clearedTables',cardinality(targets),'protectedRelations',preserved_count+2,'protectedPlotFieldsUnchanged',true,'triggersRestored',true) result;
END;$reset$;
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
SELECT result FROM reset_result;
