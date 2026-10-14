-- Repair only the timestamp trigger's private recovery call; no grants, RLS, data or UI changes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
 IF md5(rtrim(replace(pg_get_functiondef('public.update_sales_updated_at_column()'::regprocedure),chr(13)||chr(10),chr(10)),chr(10)||chr(13)))
   IS DISTINCT FROM '16c321805aded31e03e462fc212d232e' THEN RAISE EXCEPTION 'TIMESTAMP_GUARD_SNAPSHOT_CHANGED'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.update_sales_updated_at_column()'::regprocedure)
   THEN RAISE EXCEPTION 'TIMESTAMP_GUARD_MUST_REMAIN_INVOKER'; END IF;
END; $preflight$;
CREATE OR REPLACE FUNCTION public.update_sales_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 -- Recovery permits remain private. Only callers already authorized for the helper can use its exception.
 IF TG_TABLE_NAME='sales' AND TG_OP='UPDATE'
   AND pg_catalog.has_schema_privilege(current_user,'sales_recovery_private','USAGE') THEN
   IF pg_catalog.has_function_privilege(current_user,'sales_recovery_private.row_allowed(text,text,jsonb,jsonb)','EXECUTE') THEN
     IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
   END IF;
 END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;
SELECT jsonb_build_object('timestamp_guard_fixed',true,'security_invoker',NOT prosecdef)
 FROM pg_proc WHERE oid='public.update_sales_updated_at_column()'::regprocedure;
COMMIT;
