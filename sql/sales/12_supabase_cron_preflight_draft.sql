-- SALES V2 SUPABASE CRON PREFLIGHT -- DESIGN ONLY, 2026-09-18.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--11.
-- Operator-only READ-ONLY inspection, NOT a migration or a scheduler installer.
-- No extension, job, role, token, worker, feature enablement or business writes.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: cron preparation is not authorized for database execution';
END;
$draft_only$;

-- Inventory visibility is distinct from extension authenticity. The outer
-- preflight reports both; a lookalike catalog NEVER makes automation ready.
CREATE FUNCTION sales_private.crm_first_contact_cron_inventory()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $inventory$
DECLARE
  relation_id oid; schema_id oid:=to_regnamespace('cron');
  bypasses_rls boolean; state_value text; total_count bigint; reserved_count bigint;
  active_reserved_count bigint; direct_count bigint;
BEGIN
  SELECT oid INTO relation_id FROM pg_class WHERE relnamespace=schema_id AND relname='job';
  SELECT rolsuper OR rolbypassrls INTO bypasses_rls FROM pg_roles WHERE rolname=current_user;
  IF relation_id IS NULL OR schema_id IS NULL THEN state_value:='missing_catalog';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_id AND relkind='r')
    OR EXISTS (SELECT 1 FROM (VALUES
      ('jobid','bigint'::regtype),('jobname','text'::regtype),('command','text'::regtype),
      ('schedule','text'::regtype),('database','text'::regtype),('username','text'::regtype),('active','boolean'::regtype)
    ) expected(column_name,column_type) WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid=relation_id AND attname=expected.column_name
        AND atttypid=expected.column_type AND attnum>0 AND NOT attisdropped)) THEN state_value:='unexpected_catalog';
  ELSIF NOT has_schema_privilege(current_user,schema_id,'USAGE')
    OR NOT has_table_privilege(current_user,relation_id,'SELECT') THEN state_value:='insufficient_privilege';
  ELSIF bypasses_rls IS DISTINCT FROM true THEN state_value:='partial_visibility';
  ELSE
    -- Include inactive jobs and ALL databases/owners, not only the current DB.
    -- Counts only: never expose raw commands, usernames, secrets or SQLERRM.
    EXECUTE $scan$
      SELECT count(*),count(*) FILTER (WHERE jobname='buildtrack-sales-first-contact-v1'),
        count(*) FILTER (WHERE jobname='buildtrack-sales-first-contact-v1' AND active),
        count(*) FILTER (WHERE position('crm_v2_process_first_contact' IN lower(command))>0
          OR position('crm_first_contact_worker_cycle' IN lower(command))>0
          OR position('crm_first_contact_dispatch_prepare' IN lower(command))>0
          OR position('crm_first_contact_dispatch_execute' IN lower(command))>0
          OR position('crm_first_contact_worker_tick' IN lower(command))>0)
      FROM cron.job
    $scan$ INTO total_count,reserved_count,active_reserved_count,direct_count;
    state_value:='visible';
  END IF;
  RETURN jsonb_build_object('visibility',state_value,'inventoryComplete',state_value='visible',
    'jobCount',total_count,'reservedNameCount',reserved_count,'activeReservedNameCount',active_reserved_count,
    'knownCommandCount',direct_count,'commandScanCoverage','known_direct_calls_only');
END;
$inventory$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_cron_inventory() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sales_private.crm_first_contact_cron_preflight()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC'
AS $preflight$
DECLARE
  extension_id oid; extension_version text; relation_id oid; cron_schema_id oid:=to_regnamespace('cron');
  register_id oid; alter_id oid;
  relation_owned boolean:=false; api_owned boolean:=false; inventory_value jsonb;
  settings_value jsonb:=NULL; settings_row public.crm_settings%ROWTYPE;
  settings_visible boolean:=false; candidates_visible boolean:=false; bypasses_rls boolean;
  candidate_count integer:=NULL; minimum_cycles integer:=NULL; exact_count boolean:=NULL;
BEGIN
  SELECT oid INTO relation_id FROM pg_class WHERE relnamespace=cron_schema_id AND relname='job';
  IF cron_schema_id IS NOT NULL AND has_schema_privilege(current_user,cron_schema_id,'USAGE') THEN
    register_id:=to_regprocedure('cron.schedule_in_database(text,text,text,text,text,boolean)');
    alter_id:=to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)');
  END IF;
  SELECT oid,extversion INTO extension_id,extension_version FROM pg_extension WHERE extname='pg_cron';
  IF extension_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM pg_depend WHERE classid='pg_class'::regclass AND objid=relation_id
      AND refclassid='pg_extension'::regclass AND refobjid=extension_id AND deptype='e') INTO relation_owned;
    SELECT register_id IS NOT NULL AND alter_id IS NOT NULL AND
      (SELECT count(DISTINCT objid)=2 FROM pg_depend WHERE classid='pg_proc'::regclass
        AND objid IN (register_id,alter_id) AND refclassid='pg_extension'::regclass
        AND refobjid=extension_id AND deptype='e') INTO api_owned;
  END IF;
  inventory_value:=sales_private.crm_first_contact_cron_inventory();
  SELECT rolsuper OR rolbypassrls INTO bypasses_rls FROM pg_roles WHERE rolname=current_user;
  -- Conservative: even a table owner without bypass is reported unknown. A
  -- filtered RLS count is not evidence that no tasks or settings exist.
  IF bypasses_rls AND has_schema_privilege(current_user,'public','USAGE') THEN
    IF has_table_privilege(current_user,'public.crm_settings','SELECT') THEN
      SELECT * INTO settings_row FROM public.crm_settings WHERE id;
      settings_visible:=FOUND;
      IF settings_visible THEN
        settings_value:=jsonb_build_object('centralIntake',settings_row.central_intake_enabled,
          'leadWork',settings_row.lead_work_enabled,'lifecycle',settings_row.lead_lifecycle_enabled,
          'schedule',settings_row.work_schedule_enabled,'notifications',settings_row.notifications_enabled,
          'preview',settings_row.sla_preview_enabled,'processing',settings_row.sla_processing_enabled,
          'cycle',settings_row.sla_cycle_enabled);
      END IF;
    END IF;
    IF has_table_privilege(current_user,'public.crm_sla_tasks','SELECT') THEN
      SELECT count(*) INTO candidate_count FROM (
        SELECT id FROM public.crm_sla_tasks WHERE task_type='first_contact' AND project_interest_id IS NULL
          AND source_activity_id IS NULL AND status='open' ORDER BY created_at,id LIMIT 901
      ) bounded;
      candidates_visible:=true; exact_count:=candidate_count<901; minimum_cycles:=(candidate_count+9)/10;
    END IF;
  END IF;
  RETURN jsonb_build_object('contractVersion','first_contact_cron_preflight_v1','observedAt',statement_timestamp(),
    'automationReady',false,'blockingReason','CRON_BINDING_NOT_VALIDATED',
    'reservedJobName','buildtrack-sales-first-contact-v1',
    'extension',jsonb_build_object('installed',extension_id IS NOT NULL,'version',extension_version,
      'catalogOwnedByExtension',relation_owned,'registrationApiOwnedByExtension',api_owned),
    'inventory',inventory_value,
    'settings',jsonb_build_object('known',settings_visible,'flags',settings_value,
      'allExistingGatesEnabled',CASE WHEN settings_visible THEN
        settings_row.central_intake_enabled AND settings_row.lead_work_enabled AND settings_row.lead_lifecycle_enabled
        AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled AND settings_row.sla_preview_enabled
        AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled ELSE NULL END),
    'cycleCandidates',jsonb_build_object('known',candidates_visible,'sampleCount',candidate_count,
      'countIsExact',exact_count,'sampleLimit',901,'minimumCyclesAtCurrentCap',minimum_cycles,'maxItemsPerCycle',10),
    'notice','Read-only snapshot. Visible catalog is not verified extension ownership. Candidate tasks include held and not-due work. No latency or activation approval.');
END;
$preflight$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_cron_preflight() FROM PUBLIC, anon, authenticated;

ROLLBACK;
