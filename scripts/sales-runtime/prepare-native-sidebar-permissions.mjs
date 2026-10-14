// Builds a reviewable SQL patch from the exact inspected trigger snapshot. No DB connection.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const snapshot = readFileSync('reports/native-sidebar-guard-before-2026-10-12.sql', 'utf8').replace(/\r\n/g, '\n').trimEnd();
const anchor = '  IF permit.transaction_id IS NULL THEN';
if (!snapshot.startsWith('CREATE OR REPLACE FUNCTION crm_external_private.guard_cutover_sale()')
  || snapshot.split(anchor).length !== 2 || snapshot.includes('Native sidebar compatibility')) throw Error('Unexpected inspected guard');
const native = `
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
    END IF;`;
const updatedGuard = snapshot.replace(anchor, anchor + native);
const stockSnapshot = readFileSync('reports/native-sidebar-stock-guard-before-2026-10-12.sql','utf8').replace(/\r\n/g,'\n').trimEnd();
const stockAnchor = '  SELECT * INTO permit FROM crm_external_private.booking_writer_permits';
if (!stockSnapshot.startsWith('CREATE OR REPLACE FUNCTION crm_external_private.guard_booking_plot_stock()')
  || stockSnapshot.split(stockAnchor).length!==2) throw Error('Unexpected inspected stock guard');
const nativeStock = `  -- Native occupancy is derived from exact sales, not client-supplied customer flags.
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
`;
const updatedStock = stockSnapshot.replace(stockAnchor,nativeStock+stockAnchor);
const definitionHash = value => createHash('md5').update(value.replace(/\r\n/g,'\n').replace(/[\r\n]+$/,'')).digest('hex');
const sql = `-- User approved preserving all customers and restoring native sidebar/Lead writes for trusted Sales/Admin.
-- No customer delete/update/backfill; imported Sale identities and historical CRM FKs are preserved.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
DO $preflight$
BEGIN
 -- Hash the complete inspected definitions. Normalize CRLF only; actual code/config changes still fail.
 IF md5(rtrim(replace(pg_get_functiondef('crm_external_private.guard_cutover_sale()'::regprocedure),
   chr(13)||chr(10),chr(10)),chr(10)||chr(13))) IS DISTINCT FROM '${definitionHash(snapshot)}'
   THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_GUARD_SNAPSHOT_CHANGED'; END IF;
 IF md5(rtrim(replace(pg_get_functiondef('crm_external_private.guard_booking_plot_stock()'::regprocedure),
   chr(13)||chr(10),chr(10)),chr(10)||chr(13))) IS DISTINCT FROM '${definitionHash(stockSnapshot)}'
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
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg((to_jsonb(t)-''native_lead_id'')::text,E''\\n'' ORDER BY t.id),'''')) FROM %s t',relation)
    INTO n,checksum;
  INSERT INTO native_sidebar_retention VALUES(relation,n,checksum);
 END LOOP;
END; $snapshot$;
${updatedGuard};
${updatedStock};
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
-- Return every reviewed CRM workflow switch to native mode together. Keep the singleton id and activation guard.
UPDATE public.crm_settings SET central_intake_enabled=false,lead_work_enabled=false,lead_lifecycle_enabled=false,
 visits_enabled=false,visit_sop_enabled=false,customer_voices_enabled=false,
 booking_enabled=false,booking_cutover_reviewed=false,post_booking_enabled=false WHERE id=true;
DO $verify_retention$
DECLARE r record; n bigint; checksum text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_settings s CROSS JOIN LATERAL jsonb_each(to_jsonb(s)) j
   WHERE (right(j.key,8)='_enabled' OR j.key='booking_cutover_reviewed') AND j.value='true'::jsonb)
   THEN RAISE EXCEPTION 'NATIVE_SIDEBAR_CRM_SWITCH_REMAINS_ENABLED'; END IF;
 FOR r IN SELECT * FROM native_sidebar_retention LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg((to_jsonb(t)-''native_lead_id'')::text,E''\\n'' ORDER BY t.id),'''')) FROM %s t',r.relation)
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
`;
writeFileSync('sql/sales/native_sidebar_permissions_review.sql', sql, 'utf8');
console.log(JSON.stringify({reviewFile:'sql/sales/native_sidebar_permissions_review.sql',guardInsertionCount:1,dbConnected:false}));
