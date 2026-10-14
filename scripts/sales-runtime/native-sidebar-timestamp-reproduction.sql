-- Owned loopback fixture only, inside the runner's transaction. Roll back the failing attempt's rows.
DO $reproduce$
DECLARE actor record; lead uuid; sale uuid; plot text; reproduced boolean:=false;
BEGIN
 SELECT r.auth_user_id,s.id session_id INTO STRICT actor
  FROM account_security_private.reviewed_roles r JOIN auth.sessions s ON s.user_id=r.auth_user_id
  WHERE r.enabled AND r.role='Sales' LIMIT 1;
 SELECT p.id INTO plot FROM public.plots p WHERE NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=p.id)
  ORDER BY p.id LIMIT 1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'session_id',actor.session_id,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  INSERT INTO public.leads(customer_name,status,project_name)
   VALUES('Synthetic timestamp reproduction','Booked',(SELECT project_name FROM public.plots WHERE id=plot)) RETURNING id INTO lead;
  INSERT INTO public.sales(id,lead_id,plot_id,contract_status,crm_stage,payment_method,sale_price,booking_amount)
   VALUES(gen_random_uuid(),lead,plot,'Reserved','booked','mortgage',1000,10) RETURNING id INTO sale;
  UPDATE public.sales SET sale_price=900 WHERE id=sale;
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'permission denied for schema sales_recovery_private' THEN RAISE; END IF;
  reproduced:=true;
 END;
 EXECUTE 'RESET ROLE';
 IF NOT reproduced THEN RAISE EXCEPTION 'EXPECTED_TIMESTAMP_PERMISSION_FAILURE_NOT_REPRODUCED'; END IF;
END; $reproduce$;
SELECT jsonb_build_object('timestampPermissionFailureReproduced',true);
