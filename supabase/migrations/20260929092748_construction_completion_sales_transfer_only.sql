-- User-approved 2026-09-29: construction completion is not a sales transfer.
-- Exact reviewed LIVE body, not auto_ready_for_sale_trigger.sql in this repo.
-- No backfill, data writes, grant changes, trigger replacement or CRM activation.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
SET LOCAL search_path=public,pg_catalog;
DO $construction_sales_boundary$
DECLARE
  function_oid oid := to_regprocedure('public.auto_update_plot_sale_status()');
  definition text;
  original_metadata jsonb;
  original_triggers jsonb;
  original_upstream text;
  original_transfer text := 'UPDATE plots SET sale_status = ''transferred'' WHERE id = v_plot_id AND sale_status != ''transferred'';';
  original_vacant text := 'UPDATE plots SET sale_status = ''ready_for_sale'' WHERE id = v_plot_id AND sale_status != ''ready_for_sale'';';
BEGIN
  IF current_setting('buildtrack.construction_sales_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR current_setting('buildtrack.construction_sales_review',true) IS DISTINCT FROM 'user_approved_sales_only_transfer_20260929' THEN
    RAISE EXCEPTION 'CONSTRUCTION_SALES_REVIEW_REQUIRED';
  END IF;
  IF function_oid IS NULL THEN RAISE EXCEPTION 'CONSTRUCTION_SALES_FUNCTION_MISSING'; END IF;
  SELECT to_jsonb(p)-'prosrc',replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')
    INTO original_metadata,definition FROM pg_proc p WHERE oid=function_oid;
  IF (original_metadata->>'proowner')::oid<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR (original_metadata->>'prosecdef')::boolean THEN
    RAISE EXCEPTION 'CONSTRUCTION_SALES_OWNER_REQUIRED';
  END IF;
  IF md5(definition)<>'c6630c35e6bfeebf1469ab6136e2a129'
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.plot_task_assignments'::regclass
      AND tgname='auto_update_plot_sale_status_trigger' AND tgfoid=function_oid AND tgenabled='O'
      AND pg_get_triggerdef(oid)='CREATE TRIGGER auto_update_plot_sale_status_trigger AFTER UPDATE OF actual_end_date ON public.plot_task_assignments FOR EACH ROW WHEN (((old.actual_end_date IS DISTINCT FROM new.actual_end_date) AND (new.actual_end_date IS NOT NULL))) EXECUTE FUNCTION auto_update_plot_sale_status()') THEN
    RAISE EXCEPTION 'CONSTRUCTION_SALES_LIVE_DEFINITION_CHANGED';
  END IF;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO original_triggers
    FROM pg_trigger t WHERE tgfoid=function_oid OR tgrelid IN ('public.task_updates'::regclass,'public.plot_task_assignments'::regclass);
  SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid)) INTO original_upstream
    FROM pg_proc p WHERE p.oid IN ('public.update_task_progress_trigger()'::regprocedure,'public.sync_defect_progress()'::regprocedure);
  -- Leave task counting and assignment/defect updates exactly as before.
  -- Occupied plots retain their sales state; only the Sales workflow may transfer.
  definition:=replace(definition,original_transfer,'NULL; -- Transfer is confirmed by Sales, never by construction completion.');
  -- Do not demote a previously transferred plot even if its occupancy flag is stale.
  definition:=replace(definition,original_vacant,
    'UPDATE plots SET sale_status = ''ready_for_sale'' WHERE id = v_plot_id AND sale_status != ''ready_for_sale'' AND sale_status != ''transferred'';');
  EXECUTE definition;
  IF replace(pg_get_functiondef(function_oid),E'\r\n',E'\n') IS DISTINCT FROM definition
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=function_oid) IS DISTINCT FROM original_metadata
    OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE tgfoid=function_oid
      OR tgrelid IN ('public.task_updates'::regclass,'public.plot_task_assignments'::regclass)) IS DISTINCT FROM original_triggers
    OR (SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid)) FROM pg_proc p
      WHERE p.oid IN ('public.update_task_progress_trigger()'::regprocedure,'public.sync_defect_progress()'::regprocedure)) IS DISTINCT FROM original_upstream THEN
    RAISE EXCEPTION 'CONSTRUCTION_SALES_POSTCHECK_FAILED';
  END IF;
END;
$construction_sales_boundary$;
COMMIT;
