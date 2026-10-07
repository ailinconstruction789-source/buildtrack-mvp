-- READ ONLY, metadata/settings only. No customer rows, credentials or tokens.
-- Preparation report, never an installer/activation. Run only after confirming
-- the target project. Fingerprints must be compared with the reviewed source.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object(
  'reportVersion','central-visits-reviewed-preflight-v2',
  'databaseVersion',current_setting('server_version'),
  'transactionTimeoutSupported',current_setting('transaction_timeout',true) IS NOT NULL,
  'settings',(SELECT to_jsonb(s) FROM public.crm_settings s WHERE id),
  'bookingReview',(SELECT coalesce(jsonb_agg(jsonb_build_object('batchId',b.id,'sourceDigest',b.plan_digest,
    'bookingDigest',w.plan_digest,'hasRollback',EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)) ORDER BY b.id),'[]'::jsonb)
    FROM crm_external_private.snapshot_batches b LEFT JOIN crm_external_private.booking_writer_releases w ON w.batch_id=b.id),
  'functionMetadata',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
    'securityDefiner',p.prosecdef,'config',p.proconfig,'acl',p.proacl,
    'definitionMd5',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prokind='f' AND (
      (n.nspname='crm_external_private' AND p.proname IN (
        'cutover_operator_check','booking_writer_ready','booking_activation_allowed',
        'reject_unreviewed_activation','guard_materialized_history','booking_interest_allowed',
        'guard_booking_plot_stock','enable_visit_workflow','guard_visit_voice_fields'))
      OR (n.nspname='sales_private' AND p.proname='reject_sealed_legacy_fields')
      OR (n.nspname='public' AND p.proname IN (
        'crm_v2_role','crm_v2_record_lead_work','crm_v2_lead_work_snapshot',
        'crm_v2_change_lead_lifecycle','crm_v2_visits_command','crm_v2_record_visit_sop',
        'crm_v2_customer_voices_command','crm_v2_visit_follow_up_command',
        'crm_v2_customer_voice_open','crm_v2_customer_voice_submit','crm_v2_voice_row_readable',
        'crm_v2_visits_capabilities','crm_v2_visits_context','crm_v2_visit_sop_capabilities','crm_v2_visit_sop_context',
        'crm_v2_customer_voices_capabilities','crm_v2_customer_voices_context','crm_v2_visit_follow_up_capabilities',
        'crm_v2_visit_follow_up_context','crm_v2_booking_capabilities','crm_v2_booking_context','crm_v2_booking_command',
        'crm_v2_project_sales_capabilities','crm_v2_project_sales')))),
  'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'acl',a.attacl,'default',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid),
    'indexes',(SELECT coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid),'[]'::jsonb) FROM pg_index i WHERE i.indrelid=c.oid),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
      'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
    'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',pol.polname,'command',pol.polcmd,
      'permissive',pol.polpermissive,'roles',pol.polroles,'using',pg_get_expr(pol.polqual,pol.polrelid),
      'check',pg_get_expr(pol.polwithcheck,pol.polrelid)) ORDER BY pol.polname),'[]'::jsonb)
      FROM pg_policy pol WHERE pol.polrelid=c.oid)
    ) ORDER BY c.oid::regclass::text),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND ((n.nspname='public' AND c.relname IN (
      'crm_settings','customer_voices','lead_appointments','lead_visits','house_visit_checklist_runs',
      'crm_next_actions','sales','plots','sales_customers','lead_project_interests','house_visit_checklist_items'))
      OR (n.nspname='sales_private' AND c.relname='visit_submission_tokens')
      OR (n.nspname='crm_external_private' AND c.relname IN ('snapshot_batches','booking_writer_releases',
        'booking_activation_permits','visit_workflow_releases','sales_rollback_receipts')))),
  'notice','Metadata only; not approval to install. Compare fingerprints, flags, grants, backup and release identity before producing the production installer.'
) AS central_visits_preflight;
ROLLBACK;
