-- Synthetic rows/claims only inside the owned isolated cluster.
BEGIN;
DO $owned$ BEGIN
 IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true)<>'on' OR host(inet_server_addr())<>'127.0.0.1' THEN RAISE EXCEPTION 'OWNED_FIXTURE_ONLY'; END IF;
END;$owned$;
CREATE TEMP TABLE native_role_fixture AS
 SELECT r.role,r.auth_user_id,s.id session_id FROM account_security_private.reviewed_roles r
 JOIN auth.sessions s ON s.user_id=r.auth_user_id WHERE r.enabled;
GRANT SELECT ON native_role_fixture TO authenticated;
CREATE TEMP TABLE native_result(label text, passed boolean);
GRANT ALL ON native_result TO authenticated;
DO $proof$
DECLARE fixture record; lead uuid; sale uuid; plot text; n int; denied boolean;claims text;
BEGIN
 FOR fixture IN SELECT DISTINCT ON (role) * FROM native_role_fixture ORDER BY role LOOP
  SELECT p.id INTO plot FROM public.plots p WHERE NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=p.id) ORDER BY p.id LIMIT 1;
  claims:=jsonb_build_object('sub',fixture.auth_user_id,'session_id',fixture.session_id,'role','authenticated','user_metadata',jsonb_build_object('role','Admin'))::text;
  PERFORM set_config('request.jwt.claims',claims,true);PERFORM set_config('request.jwt.claim.sub','',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF fixture.role IN ('Sales','Admin') THEN
   INSERT INTO public.leads(customer_name,status,project_name) VALUES('Synthetic native proof','Booked',(SELECT project_name FROM public.plots WHERE id=plot)) RETURNING id INTO lead;
   INSERT INTO public.sales(lead_id,plot_id,sale_price,booking_amount,contract_status,crm_stage,payment_method,list_price,discount_amount,booked_at)
    VALUES(lead,plot,1234567,10000,'Reserved','booked','mortgage',1300000,65433,now()) RETURNING id INTO sale;
   UPDATE public.sales SET crm_stage='contracted',contracted_at=now(),sale_price=1200000,bank_name='Synthetic bank' WHERE id=sale; GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'NATIVE_SALE_UPDATE_FAILED'; END IF;
   UPDATE public.leads SET customer_name='Synthetic updated',crm_status='ทำสัญญา',notes='Synthetic notes' WHERE id=lead;GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'NATIVE_LEAD_UPDATE_FAILED'; END IF;
   INSERT INTO public.status_history(entity_type,entity_id,old_status,new_status,changed_by) VALUES('lead',lead,'booked','contracted','synthetic');
   INSERT INTO public.lead_activities(customer_id,activity_type,result,occurred_at,note,next_follow_up_at) VALUES(lead,'call','contact_success',now(),'Synthetic native follow-up',now()+interval '1 day');
   IF NOT EXISTS(SELECT 1 FROM public.lead_activities WHERE customer_id=lead AND recorded_by_user_id=fixture.auth_user_id) THEN RAISE EXCEPTION 'NATIVE_FOLLOW_UP_FAILED'; END IF;
   UPDATE public.sales SET crm_stage='transferred',contract_status='Transferred',transferred_at=now() WHERE id=sale;
   UPDATE public.sales SET crm_stage='handover',crm_handover_at=now() WHERE id=sale;
   denied:=false;
   BEGIN INSERT INTO public.lead_activities(customer_id,activity_type,occurred_at,recorded_by_user_id) VALUES(lead,'note',now(),gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'NATIVE_ACTIVITY_ACTOR_SPOOF_ALLOWED'; END IF;
   INSERT INTO native_result VALUES(fixture.role||'_native_create_edit_progress',true);
  ELSE
   denied:=false;
   BEGIN INSERT INTO public.leads(customer_name,status) VALUES('Synthetic forbidden','New'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'NATIVE_NON_SALES_WRITE_ALLOWED'; END IF;
   INSERT INTO native_result VALUES(fixture.role||'_write_denied_despite_forged_metadata',true);
  END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 IF (SELECT count(*) FROM native_result WHERE label LIKE '%native_create_edit_progress')<>2 THEN RAISE EXCEPTION 'MISSING_NATIVE_ROLE_FIXTURES'; END IF;
END;$proof$;
SELECT jsonb_build_object('phase','native_workflow','results',(SELECT jsonb_agg(to_jsonb(r)) FROM native_result r));
ROLLBACK;
