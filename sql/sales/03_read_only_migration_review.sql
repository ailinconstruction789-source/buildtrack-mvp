-- SALES V2 / STEP 3: TARGETED READ-ONLY REVIEW. Run manually in Supabase SQL Editor.
-- One SELECT/CTE statement. No DDL, DML, RPC, grants, owner assignment or merging.
-- Uses the public schema confirmed by the supplied preflight and auth.users fields
-- used by this app's existing auth migration. Run as the project administrator.
-- Never grant browser users access to auth.users to make this report work.
-- Customer names/full phones/notes and auth secrets are NOT returned. Staff names,
-- account UUIDs, legacy lead UUIDs and masked phone suffixes are returned for review.
-- Staff metadata is only a MATCHING HINT: Admin must verify identity, role and
-- account availability separately. A unique name match is NEVER authorization.
-- Limits are explicit; a truncated section is NOT a complete migration manifest.
WITH lead_base AS (
  SELECT l.id,l.project_name,l.agent_name,l.status,l.crm_status,l.lead_date,
    l.created_at,l.contacted_date,l.actual_visit_date,l.booking_date,l.transferred_date,
    l.booking_amount,
    lower(regexp_replace(btrim(COALESCE(l.customer_name,'')),'[[:space:]]+',' ','g')) AS customer_name_key,
    lower(regexp_replace(btrim(COALESCE(l.agent_name,'')),'[[:space:]]+',' ','g')) AS agent_key,
    regexp_replace(COALESCE(l.phone,''),'[^0-9]','','g') AS phone_digits
  FROM public.leads l
), leads AS (
  SELECT b.*,CASE
    WHEN length(phone_digits) IN (12,13) AND phone_digits LIKE '0066%' THEN '0'||substring(phone_digits FROM 5)
    WHEN length(phone_digits) IN (10,11) AND phone_digits LIKE '66%' THEN '0'||substring(phone_digits FROM 3)
    ELSE phone_digits END AS phone_key
  FROM lead_base b
), duplicate_groups AS (
  SELECT phone_key,min(id::text) AS group_ref,count(*) AS lead_rows,
    count(DISTINCT NULLIF(project_name,'')) AS distinct_projects,
    count(DISTINCT customer_name_key) AS distinct_name_spellings,
    count(DISTINCT agent_key) AS distinct_agent_spellings
  FROM leads WHERE phone_key<>'' GROUP BY phone_key HAVING count(*)>1
), duplicate_preview AS (
  SELECT g.group_ref,g.lead_rows,g.distinct_projects,g.distinct_name_spellings,g.distinct_agent_spellings,
    CASE WHEN length(g.phone_key)>=7 THEN repeat('*',length(g.phone_key)-4)||right(g.phone_key,4)
      ELSE '[masked invalid phone]' END AS phone_masked,
    g.lead_rows>20 AS rows_truncated,
    (SELECT jsonb_agg(jsonb_build_object('lead_id',r.id,'project_name',r.project_name,
      'agent_name',r.agent_name,'lead_date',r.lead_date,'status',r.status,'crm_status',r.crm_status,
      'sale_rows',(SELECT count(*) FROM public.sales s WHERE s.lead_id=r.id)) ORDER BY r.id)
      FROM (SELECT l.id,l.project_name,l.agent_name,l.lead_date,l.status,l.crm_status
        FROM leads l WHERE l.phone_key=g.phone_key ORDER BY l.id LIMIT 20) r) AS rows
  FROM duplicate_groups g ORDER BY g.group_ref LIMIT 50
), auth_hints AS (
  -- Explicit fields only. Do not replace this projection with to_jsonb(a) or a.*.
  SELECT a.id AS auth_user_id,
    NULLIF(btrim(a.raw_user_meta_data->>'username'),'') AS username_hint,
    NULLIF(btrim(a.raw_user_meta_data->>'name'),'') AS name_hint,
    lower(btrim(COALESCE(a.raw_user_meta_data->>'role',''))) AS role_hint
  FROM auth.users a
), auth_names AS (
  SELECT h.*,
    lower(regexp_replace(COALESCE(username_hint,''),'[[:space:]]+',' ','g')) AS username_key,
    lower(regexp_replace(COALESCE(name_hint,''),'[[:space:]]+',' ','g')) AS name_key
  FROM auth_hints h
), legacy_agents AS (
  SELECT agent_key,min(agent_name) AS legacy_agent_label,count(*) AS lead_rows,
    count(DISTINCT project_name) AS project_count
  FROM leads GROUP BY agent_key
), agent_matches AS (
  SELECT g.agent_key,a.auth_user_id,a.username_hint,a.name_hint,a.role_hint
  FROM legacy_agents g JOIN auth_names a
    ON g.agent_key<>'' AND (g.agent_key=a.username_key OR g.agent_key=a.name_key)
), agent_match_counts AS (
  SELECT g.*,count(m.auth_user_id) AS candidate_count,
    count(m.auth_user_id) FILTER (WHERE m.role_hint='sales') AS sales_hint_candidate_count
  FROM legacy_agents g LEFT JOIN agent_matches m ON m.agent_key=g.agent_key
  GROUP BY g.agent_key,g.legacy_agent_label,g.lead_rows,g.project_count
), agent_preview AS (
  SELECT g.legacy_agent_label,g.lead_rows,g.project_count,g.candidate_count,g.sales_hint_candidate_count,
    CASE WHEN g.candidate_count=0 THEN 'no_exact_name_match'
      WHEN g.candidate_count>1 THEN 'ambiguous_name_match'
      WHEN g.sales_hint_candidate_count=0 THEN 'matched_account_not_labelled_sales'
      ELSE 'candidate_requires_admin_verification' END AS review_state,
    true AS admin_verification_required,g.candidate_count>20 AS candidates_truncated,
    COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.auth_user_id) FROM
      (SELECT m.auth_user_id,m.username_hint,m.name_hint,m.role_hint
       FROM agent_matches m WHERE m.agent_key=g.agent_key ORDER BY m.auth_user_id LIMIT 20) c),'[]'::jsonb) AS candidates
  FROM agent_match_counts g ORDER BY g.agent_key LIMIT 200
), staff_preview AS (
  SELECT auth_user_id,username_hint,name_hint,role_hint
  FROM auth_hints WHERE role_hint IN ('sales','admin','owner') ORDER BY auth_user_id LIMIT 200
), sale_base AS (
  SELECT s.id,s.lead_id,s.plot_id,s.sale_price,s.booking_amount,s.contract_status,s.bank_status,s.transferred_at,
    s.created_at,l.booking_amount AS lead_booking_field,l.lead_date,l.booking_date,l.transferred_date,
    lower(btrim(COALESCE(NULLIF(to_jsonb(s)->>'crm_stage',''),s.contract_status,'unknown'))) AS effective_status,
    s.sale_price IS NOT NULL AND s.sale_price::text NOT IN ('NaN','Infinity','-Infinity') AS price_finite,
    s.booking_amount IS NOT NULL AND s.booking_amount::text NOT IN ('NaN','Infinity','-Infinity') AS deposit_finite,
    l.booking_amount IS NOT NULL AND l.booking_amount::text NOT IN ('NaN','Infinity','-Infinity') AS lead_amount_finite
  FROM public.sales s LEFT JOIN leads l ON l.id=s.lead_id
), sale_checks AS (
  SELECT s.*,array_remove(ARRAY[
    CASE WHEN NOT price_finite OR sale_price<=0 THEN 'sale_price_missing_nonpositive_or_nonfinite' END,
    CASE WHEN NOT deposit_finite OR booking_amount<0 THEN 'booking_field_missing_negative_or_nonfinite' END,
    CASE WHEN price_finite AND deposit_finite AND sale_price>0 AND booking_amount>sale_price THEN 'booking_field_exceeds_sale_price' END,
    CASE WHEN price_finite AND deposit_finite AND sale_price>0 AND booking_amount=sale_price THEN 'booking_field_equals_sale_price' END,
    CASE WHEN lead_amount_finite AND deposit_finite AND lead_booking_field<>booking_amount THEN 'lead_and_sale_booking_fields_differ' END,
    CASE WHEN booking_date IS NULL THEN 'lead_booking_date_missing' END,
    CASE WHEN lead_date IS NOT NULL AND booking_date<lead_date THEN 'booking_before_lead' END,
    CASE WHEN booking_date IS NOT NULL AND transferred_at<booking_date THEN 'transfer_before_booking' END,
    CASE WHEN transferred_date IS NOT NULL AND transferred_at IS NOT NULL
      AND (transferred_date AT TIME ZONE 'Asia/Bangkok')::date<>(transferred_at AT TIME ZONE 'Asia/Bangkok')::date
      THEN 'lead_and_sale_transfer_days_differ' END
  ],NULL) AS review_reasons
  FROM sale_base s
), sale_status_counts AS (
  SELECT contract_status,bank_status,count(*) AS rows FROM sale_base
  GROUP BY contract_status,bank_status ORDER BY contract_status,bank_status
), lead_status_counts AS (
  SELECT status,crm_status,count(*) AS rows FROM leads GROUP BY status,crm_status ORDER BY status,crm_status
), money_summary AS (
  SELECT count(*) AS sale_rows,
    count(*) FILTER (WHERE effective_status<>'cancelled') AS noncancelled_rows,
    count(*) FILTER (WHERE sale_price IS NULL) AS sale_price_null,
    count(*) FILTER (WHERE price_finite AND sale_price=0) AS sale_price_zero,
    count(*) FILTER (WHERE price_finite AND sale_price<0) AS sale_price_negative,
    count(*) FILTER (WHERE sale_price IS NOT NULL AND NOT price_finite) AS sale_price_nonfinite,
    count(*) FILTER (WHERE booking_amount IS NULL) AS booking_field_null,
    count(*) FILTER (WHERE deposit_finite AND booking_amount=0) AS booking_field_zero,
    count(*) FILTER (WHERE deposit_finite AND booking_amount<0) AS booking_field_negative,
    count(*) FILTER (WHERE booking_amount IS NOT NULL AND NOT deposit_finite) AS booking_field_nonfinite,
    count(*) FILTER (WHERE price_finite AND deposit_finite AND sale_price>0 AND booking_amount=sale_price) AS booking_field_equals_sale_price,
    count(*) FILTER (WHERE price_finite AND deposit_finite AND booking_amount>sale_price) AS booking_field_exceeds_sale_price,
    count(*) FILTER (WHERE booking_amount IN (10000,50000)) AS common_amounts_10000_or_50000_not_proof_of_default,
    count(*) FILTER (WHERE lead_booking_field IS NULL) AS lead_booking_field_null_or_lead_missing,
    count(*) FILTER (WHERE lead_booking_field IS NOT NULL AND NOT lead_amount_finite) AS lead_booking_field_nonfinite,
    count(*) FILTER (WHERE lead_amount_finite AND deposit_finite) AS comparable_lead_and_sale_booking_pairs,
    count(*) FILTER (WHERE lead_amount_finite AND deposit_finite AND lead_booking_field<>booking_amount) AS lead_and_sale_booking_fields_differ,
    sum(sale_price) FILTER (WHERE price_finite) AS stored_finite_sale_price_sum,
    sum(booking_amount) FILTER (WHERE deposit_finite) AS stored_finite_booking_field_sum,
    sum(sale_price) FILTER (WHERE price_finite AND effective_status<>'cancelled') AS stored_finite_noncancelled_sale_price_sum
  FROM sale_base
), date_summary AS (
  SELECT
    (SELECT count(*) FROM leads WHERE length(phone_digits) NOT BETWEEN 7 AND 15) AS phone_digit_length_outside_intake_range,
    (SELECT count(*) FROM leads WHERE contacted_date=lead_date) AS contact_time_equals_lead_time_not_proof_of_default,
    (SELECT count(*) FROM leads WHERE lead_date=created_at) AS lead_time_equals_record_creation_not_proof_of_default,
    (SELECT count(*) FROM leads WHERE actual_visit_date IS NOT NULL) AS leads_with_legacy_visit_date,
    (SELECT count(*) FROM public.customer_voices) AS voice_rows,
    (SELECT count(*) FROM leads WHERE actual_visit_date<lead_date) AS legacy_visit_before_lead,
    (SELECT count(*) FROM leads WHERE lead_date>CURRENT_TIMESTAMP OR contacted_date>CURRENT_TIMESTAMP
      OR actual_visit_date>CURRENT_TIMESTAMP OR booking_date>CURRENT_TIMESTAMP OR transferred_date>CURRENT_TIMESTAMP) AS leads_with_future_actual_event,
    (SELECT count(*) FROM sale_base WHERE transferred_at>CURRENT_TIMESTAMP) AS sales_with_future_transfer,
    (SELECT count(*) FROM sale_base WHERE booking_date IS NULL) AS sale_rows_without_lead_booking_date,
    (SELECT count(*) FROM sale_base WHERE lead_id IS NULL) AS sale_rows_without_lead_id,
    (SELECT count(*) FROM sale_base s WHERE s.lead_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM leads l WHERE l.id=s.lead_id)) AS sale_rows_referencing_missing_lead
), sale_review_preview AS (
  SELECT id AS sale_id,lead_id,review_reasons FROM sale_checks
  WHERE cardinality(review_reasons)>0 ORDER BY id LIMIT 50
), crm_schema_objects AS (
  SELECT n.nspname AS schema_name,c.relname AS relation_name,c.relkind::text AS relation_kind
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='sales_private' ORDER BY n.nspname,c.relname
), shared_policy_snapshot AS (
  SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
  FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN ('projects','plots','users')
), shared_grant_snapshot AS (
  -- Catalog ACLs include grantee 0 (PUBLIC); role_table_grants omits PUBLIC.
  -- Explicit table grants only: not a full role-inheritance/column-grant audit.
  SELECT n.nspname AS table_schema,c.relname AS table_name,
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,a.privilege_type,a.is_grantable
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
  WHERE n.nspname='public' AND c.relname IN ('projects','plots','users') AND c.relkind IN ('r','p','v','m','f')
    AND (a.grantee=0 OR r.rolname IN ('anon','authenticated'))
), read_visibility AS (
  SELECT n.nspname AS schema_name,c.relname AS table_name,
    pg_catalog.row_security_active(c.oid) AS row_security_active_for_runner,
    pg_catalog.has_table_privilege(c.oid,'SELECT') AS runner_can_select
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relname IN ('leads','sales','plots','customer_voices'))
    OR (n.nspname='auth' AND c.relname='users')
)
SELECT jsonb_pretty(jsonb_build_object(
  'report_version','sales-v2-migration-review-2026-09-15',
  'generated_at',CURRENT_TIMESTAMP,
  'review_only',true,
  'execution_context',jsonb_build_object('current_user',CURRENT_USER,'session_user',SESSION_USER,
    'table_visibility',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.schema_name,v.table_name) FROM read_visibility v),'[]'::jsonb),
    'expected_table_count',5,'visible_table_count',(SELECT count(*) FROM read_visibility),
    'all_expected_tables_readable_without_rls',(SELECT count(*)=5 AND bool_and(runner_can_select AND NOT row_security_active_for_runner) FROM read_visibility)),
  'baseline_counts',jsonb_build_object('legacy_leads',(SELECT count(*) FROM leads),
    'legacy_sales',(SELECT count(*) FROM sale_base),'plots',(SELECT count(*) FROM public.plots)),
  'duplicate_phone_review',jsonb_build_object('total_groups',(SELECT count(*) FROM duplicate_groups),
    'group_limit',50,'row_limit_per_group',20,'groups_truncated',(SELECT count(*)>50 FROM duplicate_groups),
    'groups',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.group_ref) FROM duplicate_preview d),'[]'::jsonb)),
  'owner_mapping_review',jsonb_build_object('total_legacy_agent_labels',(SELECT count(*) FROM legacy_agents),
    'labels_truncated',(SELECT count(*)>200 FROM legacy_agents),
    'labels_without_exact_match',(SELECT count(*) FROM agent_match_counts WHERE candidate_count=0),
    'labels_with_ambiguous_matches',(SELECT count(*) FROM agent_match_counts WHERE candidate_count>1),
    'labels',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.legacy_agent_label) FROM agent_preview a),'[]'::jsonb),
    'crm_staff_hints',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.auth_user_id) FROM staff_preview a),'[]'::jsonb),
    'crm_staff_hints_truncated',(SELECT count(*)>200 FROM auth_hints WHERE role_hint IN ('sales','admin','owner'))),
  'money_review',(SELECT to_jsonb(m) FROM money_summary m),
  'date_review',(SELECT to_jsonb(d) FROM date_summary d),
  'sale_review',jsonb_build_object('total_rows',(SELECT count(*) FROM sale_checks WHERE cardinality(review_reasons)>0),
    'rows_truncated',(SELECT count(*)>50 FROM sale_checks WHERE cardinality(review_reasons)>0),
    'rows',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sale_id) FROM sale_review_preview s),'[]'::jsonb)),
  'stored_sale_statuses',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM sale_status_counts LIMIT 100) s),'[]'::jsonb),
  'stored_sale_statuses_truncated',(SELECT count(*)>100 FROM sale_status_counts),
  'stored_lead_statuses',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM lead_status_counts LIMIT 100) s),'[]'::jsonb),
  'stored_lead_statuses_truncated',(SELECT count(*)>100 FROM lead_status_counts),
  'sales_private_schema_exists',EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='sales_private'),
  'sales_private_relations',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM crm_schema_objects c),'[]'::jsonb),
  'shared_table_policies',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM shared_policy_snapshot p),'[]'::jsonb),
  'shared_table_grants',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.table_name,g.grantee,g.privilege_type) FROM shared_grant_snapshot g),'[]'::jsonb),
  'notice','Admin review only. Reject completeness claims if expected table visibility/RLS checks fail. ACL list covers explicit table grants, not inherited or column privileges. Never merge by phone or assign by metadata/name. Stored sums are not verified revenue/deposits. Common amounts and equal timestamps do not prove imported defaults. No changes have been made by this SELECT.'
)) AS migration_review_report;
